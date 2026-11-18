// 수업 내용 검증: 대본에 적힌 코드를 앱과 같은 파이썬 실행기(Pyodide)로 실제로 돌려 본다.
// 파이썬 쪽 실행 함수는 앱의 일꾼(public/py-worker.js)에 있는 것을 그대로 꺼내 쓴다.
// - 예측 문제의 정답 보기가 실제 출력과 같은가
// - 쓰기 문제의 모범 답이 채점을 통과하는가(입력을 받는 문제는 모든 입력에서)
// - 고치기 문제의 시작 코드는 통과하지 못하는가
// - 강의의 따라 하기와 시연 코드가 기대한 대로 도는가
// - 흔한 오답을 넣었을 때 의도한 말이 나오는가
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';

import { diagnoseDrawing, diagnoseGame, diagnoseTask, fileProblem, outputLines } from '../src/core/diagnose.js';
import { strokes } from '../src/core/drawing.js';
import { explain } from '../src/core/errors-ko.js';
import { allTasks } from '../src/core/lesson.js';
import { SCRIPTS } from './missions.js';
import { PRACTICE_WRONG } from './practice-wrong.js';

let scripted;

before(async () => {
  const pyodide = await loadPyodide();
  // 일꾼 파일에서 파이썬 소스를 꺼낸다(자바스크립트 글자 틀 안에 들어 있다).
  const worker = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'py-worker.js'), 'utf8');
  const body = /const RUNNER_SOURCE = `([\s\S]*?)`;/.exec(worker)[1];
  pyodide.runPython(new Function(`return \`${body}\`;`)());
  const call = pyodide.globals.get('__kidpy_scripted');
  // limit: 한 줄씩 보기에서 보여 줄 줄 수의 한도. randoms: random.randint가 차례로 돌려줄 값.
  // keys, frames: 게임을 돌려 볼 때 차례로 누를 키와 돌릴 장면 수.
  // files: 프로그램이 시작할 때 폴더에 있을 파일.
  scripted = (code, inputs, trace, { limit, randoms, keys, frames, files } = {}) =>
    JSON.parse(call(code, JSON.stringify(inputs ?? []), trace, limit ?? 300, JSON.stringify(randoms ?? []), JSON.stringify(keys ?? []), frames ?? 0, JSON.stringify(files ?? null)));
});

/** 한 줄씩 보기로 돌린다. 화면에 보이는 그대로(질문과 넣은 답 포함)의 출력을 돌려준다. */
function shown(code, inputs, options) {
  const ran = scripted(code, inputs, true, options);
  return { ...ran, output: ran.output.replace(/[\x01\x02]/g, '') };
}

/** 아이가 직접 실행했을 때 프로그램이 내보내는 글(질문은 있고, 친 답은 없다) */
function typedRun(code, inputs, options) {
  const ran = scripted(code, inputs, true, options);
  return { ...ran, output: ran.output.replace(/\x01[^\x02]*\x02\n/g, '') };
}

/** 앱의 채점(src/main.js의 grade)과 같은 차례로 채점한다. */
function grade(task, code) {
  // 그리기 문제: 모범 답이 그린 그림과 견준다.
  const want = (inputs) => scripted(task.solution, inputs ?? [], false).draw;
  if (!task.cases) {
    const ran = scripted(code, [], false, { files: task.files });
    if (ran.error) return { kind: 'error', error: ran.error };
    return task.draw ? diagnoseDrawing(task, code, ran.draw, want()) : diagnoseTask(task, code, ran);
  }
  let diagnosis = { kind: 'correct' };
  for (const one of task.cases) {
    const ran = scripted(code, one.inputs, false, { randoms: one.randoms, keys: one.keys, frames: one.frames, files: one.files ?? task.files });
    const expectFiles = one.expectFiles ?? task.expectFiles;
    // 끝나지 않는 반복은 실행기가 줄 수를 세다가 멈춘다.
    if (ran.error?.type === 'TraceLimit') diagnosis = { kind: 'endless' };
    else if (ran.error?.type === 'EOFError') {
      // 준 답을 다 쓰고도 또 물었다. 이 문제의 흔한 실수로 짚을 수 있으면 그 말을 한다(앱과 같다).
      const guess = diagnoseTask({ ...task, expect: one.expect, inputs: one.inputs, expectFiles }, code, { error: null, output: ran.output, files: ran.files, again: true });
      diagnosis = guess.kind === 'mistake' ? guess : { kind: 'input-many' };
    }
    else if (ran.error) diagnosis = { kind: 'error', error: ran.error };
    else if (ran.unused > 0) diagnosis = { kind: 'input-few' };
    else if (task.game) diagnosis = diagnoseGame(task, code, ran, scripted(task.solution, one.inputs, false, { randoms: one.randoms, keys: one.keys, frames: one.frames }));
    else if (task.draw) diagnosis = diagnoseDrawing({ ...task, inputs: one.inputs }, code, ran.draw, want(one.inputs));
    else diagnosis = diagnoseTask({ ...task, expect: one.expect, inputs: one.inputs, expectFiles }, code, ran);
    if (diagnosis.kind !== 'correct') {
      diagnosis.inputs = one.inputs;
      break;
    }
  }
  return diagnosis;
}

for (const m of Object.values(SCRIPTS)) {
  test(`${m.id}: 예측 문제의 정답이 실제 출력과 같다`, () => {
    for (const q of m.predict ?? []) {
      const ran = shown(q.code, q.inputs, { limit: q.limit, randoms: q.randoms, files: q.files });
      if (q.outcome) {
        // 오류가 답인 문제: 보기 글은 설명이라서, 대본에 적어 둔 실제 결과(outcome)와 견준다.
        assert.equal(ran.error?.type ?? null, q.outcome.error ?? null, `${q.id}: 오류 종류`);
        assert.deepEqual(outputLines(ran.output), q.outcome.output, `${q.id}: 오류 전까지의 출력`);
        // 그림이 답인 문제: 보기 글은 그림을 말로 풀어 쓴 것이라서, 대본에 적어 둔 사실(선의 수, 끝난 방향, 제자리로 돌아왔는지)과 견준다.
        const last = (ran.draw ?? []).filter((cmd) => cmd.k === 'pose').pop();
        if (q.outcome.strokes !== undefined) assert.equal(strokes(ran.draw).length, q.outcome.strokes, `${q.id}: 선의 수`);
        if (q.outcome.heading !== undefined) assert.equal(last.h, q.outcome.heading, `${q.id}: 끝난 방향`);
        if (q.outcome.at !== undefined) assert.ok(Math.hypot(last.x - q.outcome.at[0], last.y - q.outcome.at[1]) < 0.5, `${q.id}: 끝난 자리 (${last.x}, ${last.y})`);
        if (q.outcome.turtles !== undefined) assert.equal(new Map((ran.draw ?? []).filter((cmd) => cmd.k === 'pose').map((cmd) => [cmd.t, cmd.v])).values().filter((v) => v).toArray().length, q.outcome.turtles, `${q.id}: 보이는 거북이의 수`);
        if (q.outcome.home !== undefined) assert.equal(Math.hypot(last.x, last.y) < 0.5, q.outcome.home, `${q.id}: 제자리로 돌아왔는지`);
      } else {
        assert.equal(ran.error, null, `${q.id}: 오류가 나면 안 돼요 (${ran.error?.message})`);
        assert.deepEqual(outputLines(ran.output), q.choices[q.answer].text.split('\n'), `${q.id}: 정답 보기`);
      }
      assert.equal(ran.unused, 0, `${q.id}: 쓰지 않은 입력이 남았어요`);
    }
  });

  test(`${m.id}: 쓰기 문제의 모범 답이 채점을 통과한다`, () => {
    for (const task of allTasks(m)) {
      assert.deepEqual(grade(task, task.solution), { kind: 'correct' }, `${task.id}: 모범 답 채점`);
      if (task.cases) assert.deepEqual(task.expect, task.cases[0].expect, `${task.id}: expect는 첫 입력의 기대 출력과 같아야 해요`);
    }
  });

  test(`${m.id}: 고치기 문제의 시작 코드는 통과하지 못한다`, () => {
    for (const task of allTasks(m).filter((t) => t.start)) {
      assert.notEqual(grade(task, task.start).kind, 'correct', `${task.id}: 시작 코드가 이미 정답이에요`);
    }
  });

  test(`${m.id}: 힌트의 비슷한 예제는 돌아가지만 정답은 아니다`, () => {
    for (const task of allTasks(m)) {
      for (const hint of task.hints ?? []) {
        if (!hint.card?.code) continue;
        // 힌트 예제가 묻는 횟수나 무작위 수가 정해져 있어야 하면 카드에 inputs, randoms를 적는다.
        const ran = scripted(hint.card.code, hint.card.inputs ?? ['1', '2', '3'], false, { randoms: hint.card.randoms, files: hint.card.files ?? task.files ?? task.cases?.[0]?.files });
        assert.equal(ran.error, null, `${task.id}: 힌트 예제에서 오류 (${ran.error?.message})`);
        assert.notEqual(grade(task, hint.card.code).kind, 'correct', `${task.id}: 힌트 예제가 정답이에요`);
      }
    }
  });

  test(`${m.id}: 강의의 따라 하기와 시연 코드가 적어 둔 대로 돈다`, () => {
    for (const part of m.lecture ?? []) {
      for (const spec of part) {
        if (spec.follow) {
          const ran = typedRun(spec.follow.code, spec.follow.inputs, { randoms: spec.follow.randoms, keys: spec.follow.game?.keys, frames: spec.follow.game?.frames, limit: spec.follow.game ? 5000 : undefined, files: spec.follow.files });
          // 게임 따라 하기: 정해 둔 키와 장면 수로 돌렸을 때 오류 없이 거북이가 나와야 한다.
          if (spec.follow.game) {
            assert.equal(ran.error, null, `게임 따라 하기에서 오류 (${ran.error?.message})`);
            assert.ok(ran.draw.some((cmd) => cmd.k === 'pose'), '게임 따라 하기는 거북이가 나와야 해요');
            continue;
          }
          // 멈춤 버튼 연습: 끝나지 않는 프로그램이어야 한다.
          if (spec.follow.stopped) {
            assert.equal(ran.error?.type, 'TraceLimit', '멈춤 연습은 끝나지 않는 프로그램이어야 해요');
            continue;
          }
          assert.equal(ran.error, null, `따라 하기에서 오류 (${ran.error?.message})`);
          // 그리기 따라 하기는 그림을 견준다. 여기서는 무엇인가 그리는지만 본다.
          if (spec.follow.draw) {
            assert.ok(strokes(ran.draw).length > 0, '그리기 따라 하기는 선을 그어야 해요');
            continue;
          }
          if (spec.follow.match) assert.match(ran.output, new RegExp(spec.follow.match), '따라 하기 출력 모양');
          else assert.deepEqual(outputLines(ran.output), spec.follow.expect, '따라 하기 출력');
          // 파일에 쓰는 따라 하기: 적어 둔 파일이 그대로 생겨야 한다.
          if (spec.follow.expectFiles) assert.equal(fileProblem(spec.follow.expectFiles, ran.files ?? {}), null, '따라 하기 파일');
        }
        if (spec.play !== undefined) {
          // 선생님이 실행해 보이는 프로그램: 적어 둔 키를 차례로 눌러 가며 얼마쯤 돌려도 오류가 없어야 한다.
          const ran = scripted(spec.play, [], false, { keys: (spec.keys ?? []).map(([, name]) => name), frames: 80 });
          assert.equal(ran.error, null, `실행해 보이기에서 오류 (${ran.error?.message}): ${spec.play.replace(/\n/g, ' ⏎ ')}`);
        }
        if (spec.trace !== undefined) {
          const ran = shown(spec.trace, spec.inputs, { limit: spec.limit, randoms: spec.randoms, files: spec.files });
          // 일부러 오류를 내는 시연은 대본에 expectError로 적어 둔다.
          assert.equal(ran.error?.type ?? null, spec.expectError ?? null, `시연: ${spec.trace.replace(/\n/g, ' ⏎ ')}`);
          assert.equal(ran.unused, 0, '시연에 쓰지 않은 입력이 남았어요');
        }
      }
    }
  });
}

// 흔한 오답을 넣었을 때 의도한 말이 나오는가. [수업, 문제, 코드, 기대하는 종류, 기대하는 대사 열쇠]
const WRONG = [
  ['calc', 'shop', 'print(2400)\nprint(2600)\nprint(600)', 'mistake', 'shop-float'],
  ['calc', 'shop', 'print(800 * 3)\nprint((5000 - 800) * 3)\nprint(2400 / 4)', 'line-diff'],
  ['calc', 'shop', 'print("800 * 3")\nprint(5000 - 800 * 3)\nprint(2400 / 4)', 'quoted-calc'],
  ['calc', 'shop', 'print(2400)\nprint(5000 - 2400)\nprint(2400 / 4)', 'not-computed'],
  ['calc', 'power', 'print(2 * 10)\nprint(2 * 100)', 'mistake', 'power-single'],
  ['div-mod', 'movie', 'print(200 / 60)\nprint(200 % 60)', 'mistake', 'movie-slash'],
  ['div-mod', 'movie', 'print(200 % 60)\nprint(200 // 60)', 'order'],
  ['div-mod', 'movie', 'print(3)\nprint(20)', 'not-computed'],
  ['div-mod', 'seconds', 'print(1)\nprint(2)\nprint(5)', 'not-computed'],
  ['print-many', 'hours', 'print(135 // 60)\nprint("시간")\nprint(135 % 60)\nprint("분")', 'mistake', 'hours-lines'],
  ['print-many', 'hours', 'print("2 시간 15 분")', 'not-computed'],
  ['print-many', 'hours', 'print(135 // 60, "시간", 135 % 60, "분", sep="")', 'spacing'],
  ['print-many', 'tight', 'print(135 // 60, "시간", 135 % 60, "분")', 'spacing'],
  ['read-errors', 'fix-quote', 'print("두실")\nprint("7 + 8")', 'quoted-calc'],
  ['read-errors', 'fix-quote', 'print("두실")\nprint(15)', 'not-computed'],
  ['read-errors', 'fix-capital', 'print("범어사")\nPrint("남산")', 'error'],
  ['unit1-review', 'receipt', 'print("영수증")\nprint("공책", 1200 * 3)\nprint("지우개", 500 * 2)\nprint("합계", 1200 * 3 + 500 * 2)\nprint("거스름돈", 5000 - 1200 * 3 + 500 * 2)', 'mistake', 'receipt-paren'],
  ['unit1-review', 'receipt', 'print("영수증")\nprint("공책", 3600)\nprint("지우개", 1000)\nprint("합계", 4600)\nprint("거스름돈", 400)', 'not-computed'],
  ['unit1-review', 'candy', 'print("한 사람에", 50 / 6, "개")\nprint("남는 것", 50 % 6, "개")', 'line-diff'],
  ['print-order', 'blank', 'print("노포")\nprint("남산")', 'mistake', 'blank-hint'],
  // 변수 단원
  ['var-name', 'area', 'print(84)', 'mistake', 'area-names'],
  ['var-name', 'area', 'print(12 * 7)', 'mistake', 'area-names'],
  ['var-name', 'area', '가로 = 12\n세로 = 7\nprint(가로 + 세로)', 'line-diff'],
  ['var-name', 'area', '가로 = 12\n세로 = 7\nprint("가로 * 세로")', 'line-diff'],
  ['var-name', 'reuse', '한변 = 5\nprint("둘레", 36)\nprint("넓이", 81)', 'mistake', 'reuse-one'],
  ['var-one', 'swap', '왼손 = "사과"\n오른손 = "귤"\n왼손 = 오른손\n오른손 = 왼손\nprint(왼손, 오른손)', 'mistake', 'swap-lost-a'],
  ['var-one', 'swap', '왼손 = "사과"\n오른손 = "귤"\n오른손 = 왼손\n왼손 = 오른손\nprint(왼손, 오른손)', 'mistake', 'swap-lost-b'],
  ['var-one', 'swap', '왼손 = "귤"\n오른손 = "사과"\nprint(왼손, 오른손)', 'mistake', 'swap-direct'],
  ['var-one', 'swap', '왼손 = "사과"\n오른손 = "귤"\nprint(오른손, 왼손)', 'mistake', 'swap-direct'],
  ['var-one', 'swap-short', '왼손 = "사과"\n오른손 = "귤"\n맡김 = 왼손\n왼손 = 오른손\n오른손 = 맡김\nprint(왼손, 오른손)', 'mistake', 'short-how'],
  ['input', 'hello', 'print("하늘 님이 좋아하는 것: 수학")', 'input-few'],
  ['input', 'hello', '이름 = input()\n것 = input()\nprint(이름, "님이 좋아하는 것:", "수학")', 'line-diff'],
  ['input', 'hello', '이름 = input()\nprint(이름, "님이 좋아하는 것:", 이름)', 'input-few'],
  ['input', 'once', '이름 = input()\nprint(이름, "안녕")\n이름 = input()\nprint(이름, "반가워")', 'input-many'],
  ['str-int', 'age', '나이 = input("나이: ")\nprint(나이 + "1")', 'mistake', 'age-concat'],
  ['str-int', 'age', '나이 = input("나이: ")\nprint(나이 + 1)', 'error'],
  ['str-int', 'age', 'print(10)', 'input-few'],
  ['str-int', 'sum2', 'a = input()\nb = input()\nprint(a + b)', 'mistake', 'sum-concat'],
  ['str-int', 'birth', '해 = int(input())\nprint(2026 - 해)', 'line-diff'],
  ['str-ops', 'underline', '이름 = input()\nprint(이름)\nprint("--")', 'mistake', 'underline-fixed'],
  ['str-ops', 'underline', '이름 = input()\nprint(이름)\nprint("-" * 이름)', 'error'],
  ['unit2-review', 'change', '값 = input()\nprint(10000 - 값)', 'error'],
  ['unit2-review', 'calculator', 'a = input()\nb = input()\nprint("합", a + b)', 'mistake', 'calc-concat'],
  // 정해진 횟수만큼 반복 단원
  ['for-loop', 'cheer', 'print("파이팅")\nprint("파이팅")\nprint("파이팅")\nprint("파이팅")\nprint("파이팅")', 'mistake', 'need-for'],
  ['for-loop', 'cheer', 'for i in range(4):\n    print("파이팅")', 'count'],
  ['for-loop', 'cheer', 'for i in range(5):\nprint("파이팅")', 'error'],
  ['for-loop', 'cheer', 'for i in range(5)\n    print("파이팅")', 'error'],
  ['for-loop', 'two-loops', 'print("하나")\nprint("하나")\nfor i in range(3):\n    print("둘")', 'mistake', 'need-two'],
  ['loop-body', 'train', 'print("출발")\nfor i in range(4):\n    print("칙칙폭폭")\n    print("도착")', 'mistake', 'train-arrive'],
  ['loop-body', 'train', 'for i in range(4):\n    print("출발")\n    print("칙칙폭폭")\nprint("도착")', 'mistake', 'train-start'],
  ['loop-body', 'train', 'print("출발")\nfor i in range(3):\n    print("칙칙폭폭")\nprint("도착")', 'count'],
  ['loop-body', 'train', 'print("출발")\nprint("칙칙폭폭")\nprint("칙칙폭폭")\nprint("칙칙폭폭")\nprint("칙칙폭폭")\nprint("도착")', 'mistake', 'need-for'],
  ['loop-body', 'tug', 'print("준비")\nfor i in range(3):\n    print("영차")\n    print("쉬고")\nfor i in range(3):\n    print("영차")\nprint("끝")', 'count'],
  ['loop-i', 'guest', 'for i in range(5):\n    print("손님", i)', 'mistake', 'guest-zero'],
  ['loop-i', 'guest', 'for i in range(6):\n    print("손님", i + 1)', 'count'],
  ['loop-i', 'guest', 'for i in range(5):\n    print("손님", "i + 1")', 'line-diff'],
  ['loop-i', 'square', 'for i in range(5):\n    print(i * i)', 'mistake', 'square-zero'],
  ['loop-i', 'square', 'for i in range(5):\n    print(i + 1 * i + 1)', 'mistake', 'square-paren'],
  ['loop-i', 'square', 'print(1)\nprint(4)\nprint(9)\nprint(16)\nprint(25)', 'mistake', 'need-for'],
  ['range-more', 'times', 'for i in range(10):\n    print(7, "x", i, "=", 7 * i)', 'mistake', 'times-zero'],
  ['range-more', 'times', 'for i in range(1, 9):\n    print(7, "x", i, "=", 7 * i)', 'mistake', 'times-short'],
  ['range-more', 'times', 'for i in range(1, 11):\n    print(7, "x", i, "=", 7 * i)', 'mistake', 'times-long'],
  ['range-more', 'times', 'for i in range(1, 10):\n    print(7, "x", i, "=", 7 x i)', 'error'],
  ['range-more', 'times', 'for i in range(1, 10):\n    print(7, "x", i, "=", 7 + i)', 'line-diff'],
  ['range-more', 'down3', 'for i in range(30, 3, -3):\n    print(i)\nprint("끝")', 'mistake', 'down-short'],
  ['range-more', 'down3', 'for i in range(30, 0, -3):\n    print(i)\n    print("끝")', 'mistake', 'down-end-in'],
  ['range-more', 'down3', 'for i in range(30, -1, -3):\n    print(i)\nprint("끝")', 'mistake', 'down-zero'],
  ['range-more', 'down3', 'for i in range(30, 0, -3):\n    print(i)', 'count'],
  ['loop-pattern', 'triangle', 'for i in range(5):\n    print("*" * i)', 'mistake', 'tri-zero'],
  ['loop-pattern', 'triangle', 'for i in range(5):\n    print("*" * 5)', 'mistake', 'tri-same'],
  ['loop-pattern', 'triangle', 'print("*")\nprint("**")\nprint("***")\nprint("****")\nprint("*****")', 'mistake', 'need-for'],
  ['loop-pattern', 'triangle', 'for i in range(1, 5):\n    print("*" * i)', 'count'],
  ['loop-pattern', 'pyramid', 'for i in range(1, 6):\n    print(i * i)', 'mistake', 'pyr-number'],
  ['unit3-review', 'even', 'for i in range(2, 20, 2):\n    print(i)', 'mistake', 'even-short'],
  ['unit3-review', 'even', 'for i in range(0, 21, 2):\n    print(i)', 'mistake', 'even-zero'],
  ['unit3-review', 'even', 'for i in range(1, 21):\n    print(i)', 'mistake', 'even-all'],
  ['unit3-review', 'even', 'for i in range(2, 21):\n    print(i)', 'mistake', 'even-all'],
  ['unit3-review', 'table', '단 = input()\nfor i in range(1, 10):\n    print(단, "x", i, "=", 단 * i)', 'mistake', 'table-str'],
  ['unit3-review', 'table', '단 = int(input())\nfor i in range(1, 10):\n    print(3, "x", i, "=", 3 * i)', 'mistake', 'table-fixed'],
  ['unit3-review', 'table', '단 = int(input())\nfor i in range(1, 9):\n    print(단, "x", i, "=", 단 * i)', 'count'],
  ['unit3-review', 'table', '단 = int(input())\nfor i in range(10):\n    print(단, "x", i, "=", 단 * i)', 'mistake', 'table-zero'],
  ['unit3-review', 'table', 'for i in range(1, 10):\n    print(3, "x", i, "=", 3 * i)', 'input-few'],
  ['unit3-review', 'table', '단 = input()\nfor i in range(1, 단):\n    print(단)', 'error'],
  // 조건 단원
  ['if-then', 'ride', '키 = int(input())\nprint("탈 수 있어요")\nprint("다음 손님")', 'mistake', 'ride-always'],
  ['if-then', 'ride', '키 = int(input())\nif 키 >= 130:\n    print("탈 수 있어요")\n    print("다음 손님")', 'mistake', 'ride-next-in'],
  ['if-then', 'ride', '키 = int(input())\nif 키 > 130:\n    print("탈 수 있어요")\nprint("다음 손님")', 'mistake', 'ride-edge'],
  ['if-then', 'ride', '키 = input()\nif 키 >= 130:\n    print("탈 수 있어요")\nprint("다음 손님")', 'error'],
  ['if-then', 'ride', '키 = int(input())\nif 키 >= 130\n    print("탈 수 있어요")\nprint("다음 손님")', 'error'],
  ['if-then', 'ride', 'print("탈 수 있어요")\nprint("다음 손님")', 'input-few'],
  ['if-then', 'two-ifs', '키 = int(input())\nif 키 >= 130:\n    print("탈 수 있어요")\nprint("다음에 타요")', 'mistake', 'two-both'],
  ['if-then', 'two-ifs', '키 = int(input())\nif 키 > 130:\n    print("탈 수 있어요")\nif 키 < 130:\n    print("다음에 타요")', 'mistake', 'two-none'],
  ['equal', 'password', '암호 = input()\nif 암호 == "참깨":\n    print("문이 열려요")\nprint("틀렸어요")', 'mistake', 'pw-both'],
  ['equal', 'password', '암호 = input()\nif 암호 == 참깨:\n    print("문이 열려요")', 'error'],
  ['equal', 'password', '암호 = input()\nif 암호 = "참깨":\n    print("문이 열려요")', 'error'],
  ['equal', 'password', '암호 = input()\nif 암호 == "참깨":\n    print("문이 열려요")', 'mistake', 'pw-miss'],
  ['equal', 'password', '암호 = input()\nif 암호 == "참 깨":\n    print("문이 열려요")', 'mistake', 'pw-none'],
  ['equal', 'add-quiz', '답 = input()\nif 답 == 13:\n    print("정답")\nif 답 != 13:\n    print("아쉬워요")', 'mistake', 'quiz-str'],
  ['if-else', 'even', '수 = int(input())\nif 수 % 2 == 0:\n    print("짝수")\nif 수 % 2 != 0:\n    print("홀수")', 'mistake', 'need-else'],
  ['if-else', 'even', '수 = int(input())\nif 수 / 2 == 0:\n    print("짝수")\nelse:\n    print("홀수")', 'mistake', 'even-slash'],
  ['if-else', 'even', '수 = int(input())\nif 수 % 2 == 1:\n    print("짝수")\nelse:\n    print("홀수")', 'line-diff'],
  ['if-else', 'even', '수 = int(input())\nif 수 % 2 == 0:\n    print("짝수")\nelse 수 % 2 == 1:\n    print("홀수")', 'error'],
  ['if-else', 'bigger', '가 = input()\n나 = input()\nif 가 > 나:\n    print(가)\nelse:\n    print(나)', 'mistake', 'big-str'],
  ['elif', 'fee', '나이 = int(input())\nif 나이 < 8:\n    print("무료")\nif 나이 < 14:\n    print("1000원")\nelse:\n    print("3000원")', 'mistake', 'fee-both'],
  ['elif', 'fee', '나이 = int(input())\nif 나이 < 14:\n    print("1000원")\nelif 나이 < 8:\n    print("무료")\nelse:\n    print("3000원")', 'mistake', 'fee-order'],
  ['elif', 'fee', '나이 = int(input())\nif 나이 <= 8:\n    print("무료")\nelif 나이 < 14:\n    print("1000원")\nelse:\n    print("3000원")', 'mistake', 'fee-edge8'],
  ['elif', 'fee', '나이 = int(input())\nif 나이 < 8:\n    print("무료")\nelif 나이 <= 14:\n    print("1000원")\nelse:\n    print("3000원")', 'mistake', 'fee-edge14'],
  ['elif', 'fee', '나이 = int(input())\nif 나이 < 8:\n    print("무료")\nelse:\n    if 나이 < 14:\n        print("1000원")\n    else:\n        print("3000원")', 'mistake', 'need-elif'],
  ['elif', 'compare', '가 = int(input())\n나 = int(input())\nif 가 > 나:\n    print("첫째가 커요")\nelse:\n    print("둘째가 커요")', 'line-diff'],
  ['bool', 'gate', '키 = int(input())\n나이 = int(input())\nif 키 >= 130 or 나이 >= 8:\n    print("통과")\nelse:\n    print("다음에")', 'mistake', 'gate-or'],
  ['bool', 'gate', '나이 = int(input())\n키 = int(input())\nif 키 >= 130 and 나이 >= 8:\n    print("통과")\nelse:\n    print("다음에")', 'mistake', 'gate-miss'],
  ['bool', 'gate', '키 = int(input())\n나이 = int(input())\nif 키 > 130 and 나이 > 8:\n    print("통과")\nelse:\n    print("다음에")', 'mistake', 'gate-miss'],
  ['bool', 'leap', '해 = int(input())\nif 해 % 4 == 0:\n    print("윤년")\nelse:\n    print("평년")', 'mistake', 'leap-100'],
  ['bool', 'leap', '해 = int(input())\nif 해 % 100 == 0:\n    print("평년")\nelif 해 % 4 == 0:\n    print("윤년")\nelse:\n    print("평년")', 'mistake', 'leap-400'],
  ['bool', 'leap', '해 = int(input())\nif 해 % 4 == 0 and 해 % 100 != 0 or 해 % 400 == 0:\n    print("윤년")\nelse:\n    print("평년")', 'correct'],
  ['unit4-review', 'exam', '점수 = int(input())\nif 점수 > 60:\n    print("합격")\nelse:\n    print("불합격")', 'mistake', 'exam-edge'],
  ['unit4-review', 'quiz', '답 = input()\nif 답 == 7:\n    print("정답")\nelse:\n    print("땡")\n답 = input()\nif 답 == 42:\n    print("정답")\nelse:\n    print("땡")\n답 = input()\nif 답 == "서울":\n    print("정답")\nelse:\n    print("땡")', 'mistake', 'quiz-str'],
  ['unit4-review', 'quiz', '답 = input()\nif 답 == "7":\n    print("정답")\nelse:\n    print("땡")', 'input-few'],
  ['unit4-review', 'quiz', '답 = int(input())\nif 답 == 7:\n    print("정답")\nelse:\n    print("땡")\n답 = int(input())\nif 답 == 42:\n    print("정답")\nelse:\n    print("땡")\n답 = int(input())\nif 답 == "서울":\n    print("정답")\nelse:\n    print("땡")', 'error'],
  // 값 바꾸기와 세기 단원
  ['update', 'bank', 'print(500)\nprint(1700)\nprint(2000)', 'mistake', 'need-update'],
  ['update', 'bank', '저금 = 0\n저금 + 500\nprint(저금)\n저금 + 1200\nprint(저금)\n저금 + 300\nprint(저금)', 'line-diff'],
  ['update', 'bank', 'print(500)\nprint(1200)\nprint(300)', 'mistake', 'bank-each'],
  ['update', 'bank', '저금 = 0\n저금 += 500\n저금 += 1200\n저금 += 300\nprint(저금)', 'mistake', 'bank-once'],
  ['update', 'bank', '저금 += 500\nprint(저금)', 'error'],
  ['update', 'double', '수 = 1\nfor i in range(10):\n    수 = 수 * 2\n    print(수)', 'mistake', 'double-in'],
  ['update', 'double', 'for i in range(10):\n    수 = 1\n    수 = 수 * 2\nprint(수)', 'mistake', 'double-reset'],
  ['update', 'double', '수 = 1\nfor i in range(10):\n    수 = 수 + 2\nprint(수)', 'mistake', 'double-add'],
  ['update', 'double', 'print(1024)', 'mistake', 'need-for'],
  ['update', 'double', '수 = 1\nfor i in range(10):\n    수 *= 2\nprint(수)', 'correct'],
  ['sum-loop', 'gauss', '합 = 0\nfor i in range(1, 100):\n    합 = 합 + i\nprint(합)', 'mistake', 'sum-99'],
  ['sum-loop', 'gauss', '합 = 0\nfor i in range(1, 101):\n    합 = 합 + i\n    print(합)', 'mistake', 'sum-in'],
  ['sum-loop', 'gauss', 'for i in range(1, 101):\n    합 = 0\n    합 = 합 + i\nprint(합)', 'mistake', 'sum-reset'],
  ['sum-loop', 'gauss', 'print(5050)', 'mistake', 'need-for'],
  ['sum-loop', 'gauss', 'for i in range(1, 101):\n    합 = 합 + i\nprint(합)', 'error'],
  ['sum-loop', 'odd-sum', '합 = 0\nfor i in range(1, 20, 2):\n    합 += i\nprint(합)', 'mistake', 'odd-once'],
  ['sum-loop', 'odd-sum', '합 = 0\nfor i in range(1, 20):\n    합 += i\n    print(합)', 'mistake', 'odd-all'],
  ['count-if', 'seven', '개수 = 0\nfor i in range(1, 101):\n    개수 += 1\nprint(개수)', 'mistake', 'seven-all'],
  ['count-if', 'seven', '개수 = 0\nfor i in range(1, 101):\n    if i % 7 == 0:\n        개수 += 1\n    print(개수)', 'mistake', 'seven-in'],
  ['count-if', 'seven', '개수 = 0\nfor i in range(1, 101):\n    if i % 7 == 0:\n        개수 += i\nprint(개수)', 'mistake', 'seven-sum'],
  ['count-if', 'seven', '개수 = 0\nfor i in range(101):\n    if i % 7 == 0:\n        개수 += 1\nprint(개수)', 'mistake', 'seven-zero'],
  ['count-if', 'seven', 'print(14)', 'mistake', 'need-for'],
  ['count-if', 'seven', '개수 = 0\nfor i in range(7, 101, 7):\n    개수 += 1\nprint(개수)', 'mistake', 'need-if'],
  ['count-if', 'seven', '개수 = 0\nfor i in range(1, 101):\n    if i % 7 == 0:\n    개수 += 1\nprint(개수)', 'error'],
  ['count-if', 'fizz', '합 = 0\nfor i in range(1, 101):\n    if i % 3 == 0:\n        합 += i\n    if i % 5 == 0:\n        합 += i\nprint(합)', 'mistake', 'fizz-twice'],
  ['count-if', 'fizz', '합 = 0\nfor i in range(1, 101):\n    if i % 3 == 0 and i % 5 == 0:\n        합 += i\nprint(합)', 'mistake', 'fizz-and'],
  ['count-if', 'fizz', '합 = 0\nfor i in range(1, 101):\n    if i % 3 == 0 or i % 5 == 0:\n        합 += 1\nprint(합)', 'mistake', 'fizz-count'],
  ['max-product', 'biggest', '가장큰 = 0\nfor i in range(5):\n    수 = int(input())\n    가장큰 = 수\nprint(가장큰)', 'mistake', 'max-last'],
  ['max-product', 'biggest', '가장큰 = 0\nfor i in range(5):\n    수 = int(input())\n    가장큰 += 수\nprint(가장큰)', 'mistake', 'max-sum'],
  ['max-product', 'biggest', '가장큰 = "0"\nfor i in range(5):\n    수 = input()\n    if 수 > 가장큰:\n        가장큰 = 수\nprint(가장큰)', 'mistake', 'max-str-10'],
  ['max-product', 'biggest', '가장큰 = 0\nfor i in range(5):\n    수 = int(input())\n    if 수 > 가장큰:\n        가장큰 = 수\n    print(가장큰)', 'mistake', 'max-in'],
  ['max-product', 'biggest', '가장큰 = 0\nfor i in range(5):\n    수 = input()\n    if 수 > 가장큰:\n        가장큰 = 수\nprint(가장큰)', 'error'],
  ['max-product', 'biggest', '가장큰 = 0\nfor i in range(4):\n    수 = int(input())\n    if 수 > 가장큰:\n        가장큰 = 수\nprint(가장큰)', 'input-few'],
  ['max-product', 'factorial', '곱 = 0\nfor i in range(1, 11):\n    곱 = 곱 * i\nprint(곱)', 'mistake', 'fact-zero'],
  ['max-product', 'factorial', '곱 = 1\nfor i in range(1, 10):\n    곱 = 곱 * i\nprint(곱)', 'mistake', 'fact-9'],
  ['max-product', 'factorial', '곱 = 1\nfor i in range(1, 11):\n    곱 = 곱 + i\nprint(곱)', 'mistake', 'fact-sum'],
  ['divisors', 'prime', '수 = int(input())\n개수 = 0\nfor i in range(1, 수):\n    if 수 % i == 0:\n        print(i)\n        개수 += 1\nif 개수 == 2:\n    print("소수")\nelse:\n    print("소수 아님")', 'mistake', 'div-self'],
  ['divisors', 'prime', '수 = int(input())\n개수 = 0\nfor i in range(1, 수 + 1):\n    if 수 % i == 0:\n        print(i)\n        개수 += 1\n    if 개수 == 2:\n        print("소수")\n    else:\n        print("소수 아님")', 'mistake', 'div-in'],
  ['divisors', 'prime', '수 = int(input())\n개수 = 0\nfor i in range(1, 수 + 1):\n    if 수 % i == 0:\n        개수 += 1\nif 개수 == 2:\n    print("소수")\nelse:\n    print("소수 아님")', 'mistake', 'div-no-list'],
  ['divisors', 'prime', '수 = int(input())\n개수 = 0\nfor i in range(1, 수 + 1):\n    if 수 % i == 0:\n        print(i)\n        개수 += 1\nif 개수 <= 2:\n    print("소수")\nelse:\n    print("소수 아님")', 'mistake', 'div-one'],
  ['divisors', 'prime', '수 = int(input())\n개수 = 0\nfor i in range(수):\n    if 수 % i == 0:\n        print(i)\n        개수 += 1\nif 개수 == 2:\n    print("소수")\nelse:\n    print("소수 아님")', 'error'],
  ['divisors', 'perfect', '수 = int(input())\n합 = 0\nfor i in range(1, 수 + 1):\n    if 수 % i == 0:\n        합 += i\nif 합 == 수:\n    print("완전수")\nelse:\n    print("완전수 아님")', 'mistake', 'perfect-self'],
  ['unit5-review', 'four', '개수 = 0\n합 = 0\nfor i in range(51):\n    if i % 4 == 0:\n        개수 += 1\n        합 += i\nprint("개수", 개수)\nprint("합", 합)', 'mistake', 'four-zero'],
  ['unit5-review', 'four', 'print("개수", 12)\nprint("합", 312)', 'mistake', 'need-for'],
  ['unit5-review', 'primes', '개수 = 0\nfor 수 in range(2, 101):\n    for i in range(1, 수 + 1):\n        if 수 % i == 0:\n            개수 += 1\n    if 개수 == 2:\n        print(수)', 'mistake', 'prime-reset'],
  ['unit5-review', 'primes', 'for 수 in range(2, 101):\n    개수 = 0\n    for i in range(1, 수 + 1):\n        if 수 % i == 0:\n            개수 += 1\nif 개수 == 2:\n    print(수)', 'mistake', 'prime-if-out'],
  ['unit5-review', 'primes', 'for 수 in range(2, 101):\n    개수 = 0\n    for i in range(1, 수 + 1):\n        if 수 % i == 0:\n            개수 += 1\n        if 개수 == 2:\n            print(수)', 'mistake', 'prime-if-deep'],
  ['unit5-review', 'primes', 'for 수 in range(1, 101):\n    개수 = 0\n    for i in range(1, 수 + 1):\n        if 수 % i == 0:\n            개수 += 1\n    if 개수 <= 2:\n        print(수)', 'mistake', 'prime-one'],
  ['unit5-review', 'primes', 'for 수 in range(2, 101):\n개수 = 0\nfor i in range(1, 수 + 1):\n    if 수 % i == 0:\n        개수 += 1\nif 개수 == 2:\n    print(수)', 'error'],
  ['unit5-review', 'primes', 'for 수 in range(2, 50):\n    개수 = 0\n    for i in range(1, 수 + 1):\n        if 수 % i == 0:\n            개수 += 1\n    if 개수 == 2:\n        print(수)', 'count'],
  // 조건이 맞는 동안 반복 단원
  ['while-loop', 'kilo', '수 = 1\n횟수 = 0\nwhile 수 <= 1000:\n    횟수 = 횟수 + 1\nprint(횟수)', 'endless'],
  ['while-loop', 'kilo', '수 = 1\n횟수 = 0\nwhile 수 <= 1000:\n    수 = 수 * 2\n    횟수 = 횟수 + 1\nprint(수)', 'mistake', 'kilo-value'],
  ['while-loop', 'kilo', '수 = 1\n횟수 = 0\nwhile 수 <= 1000:\n    수 = 수 * 2\n    횟수 = 횟수 + 1\n    print(횟수)', 'mistake', 'kilo-in'],
  ['while-loop', 'kilo', '수 = 1\n횟수 = 0\nwhile 수 * 2 <= 1000:\n    수 = 수 * 2\n    횟수 = 횟수 + 1\nprint(횟수)', 'mistake', 'kilo-nine'],
  ['while-loop', 'kilo', 'print(10)', 'mistake', 'need-while'],
  ['while-loop', 'kilo', '수 = 1\n횟수 = 0\nwhile 수 < 1000:\n    수 = 수 * 2\n    횟수 = 횟수 + 1\nprint(횟수)', 'correct'],
  ['while-loop', 'half', '수 = 1000\nwhile 수 > 0:\n    print(수)\n    수 = 수 / 2', 'mistake', 'half-slash'],
  ['while-loop', 'half', '수 = 1000\nwhile 수 >= 0:\n    print(수)\n    수 = 수 // 2', 'endless'],
  ['while-loop', 'half', '수 = 1000\nwhile 수 > 0:\n    print(수)', 'endless'],
  ['break', 'echo', 'while True:\n    말 = input()\n    print(말)\n    if 말 == "그만":\n        break\nprint("안녕")', 'mistake', 'echo-stop'],
  ['break', 'echo', 'while True:\n    말 = input()\n    if 말 != "그만":\n        print(말)', 'input-many'],
  ['break', 'echo', 'while True:\n    말 = input()\n    if 말 == "그만":\n        break\n    print(말)', 'mistake', 'echo-no-bye'],
  ['break', 'echo', 'while True:\n    말 = input()\n    if 말 == "그만":\n    break\n    print(말)\nprint("안녕")', 'error'],
  ['break', 'echo', '말 = input()\nwhile 말 != "그만":\n    print(말)\n    말 = input()\nprint("안녕")', 'correct'],
  ['break', 'echo', '말 = input()\nwhile 말 != "그만":\n    print(말)\nprint("안녕")', 'endless'],
  ['break', 'skip', 'for i in range(1, 11):\n    if i % 3 == 0:\n        break\n    print(i)', 'mistake', 'skip-break'],
  ['break', 'skip', 'for i in range(1, 11):\n    if i % 3 != 0:\n        print(i)', 'mistake', 'need-continue'],
  ['break', 'skip', 'i = 1\nwhile i <= 10:\n    if i % 3 == 0:\n        continue\n    print(i)\n    i += 1', 'endless'],
  ['random', 'guess', 'import random\n답 = random.randint(1, 100)\nwhile True:\n    수 = int(input())\n    if 수 == 답:\n        print("정답")\n        break\n    elif 수 > 답:\n        print("더 큰 수예요")\n    else:\n        print("더 작은 수예요")', 'mistake', 'guess-reversed'],
  ['random', 'guess', 'import random\nwhile True:\n    답 = random.randint(1, 100)\n    수 = int(input())\n    if 수 == 답:\n        print("정답")\n        break\n    elif 수 < 답:\n        print("더 큰 수예요")\n    else:\n        print("더 작은 수예요")', 'mistake', 'guess-inside'],
  ['random', 'guess', 'import random\n답 = random.randint(1, 100)\nwhile True:\n    수 = int(input())\n    if 수 == 답:\n        print("정답")\n    elif 수 < 답:\n        print("더 큰 수예요")\n    else:\n        print("더 작은 수예요")', 'input-many'],
  ['random', 'guess', '답 = random.randint(1, 100)\nwhile True:\n    수 = int(input())\n    if 수 == 답:\n        print("정답")\n        break\n    elif 수 < 답:\n        print("더 큰 수예요")\n    else:\n        print("더 작은 수예요")', 'error'],
  ['random', 'guess', 'import random\n답 = random.randint(1, 100)\nwhile True:\n    수 = input()\n    if 수 == 답:\n        print("정답")\n        break\n    elif 수 < 답:\n        print("더 큰 수예요")\n    else:\n        print("더 작은 수예요")', 'error'],
  ['random', 'guess', 'import random\n답 = random.randint(1, 100)\n수 = int(input())\nif 수 == 답:\n    print("정답")\nelif 수 < 답:\n    print("더 큰 수예요")\nelse:\n    print("더 작은 수예요")', 'input-few'],
  ['random', 'count-tries', 'import random\n답 = random.randint(1, 100)\n횟수 = 0\nwhile True:\n    수 = int(input())\n    if 수 == 답:\n        print("정답")\n        print(횟수, "번 만에 맞혔어요")\n        break\n    elif 수 < 답:\n        print("더 큰 수예요")\n    else:\n        print("더 작은 수예요")\n    횟수 = 횟수 + 1', 'mistake', 'count-off'],
  ['for-or-while', 'collatz', '수 = int(input())\nwhile 수 != 1:\n    if 수 % 2 == 0:\n        수 = 수 / 2\n    else:\n        수 = 수 * 3 + 1\n    print(수)', 'mistake', 'col-slash'],
  ['for-or-while', 'collatz', '수 = int(input())\nwhile 수 != 1:\n    print(수)\n    if 수 % 2 == 0:\n        수 = 수 // 2\n    else:\n        수 = 수 * 3 + 1', 'mistake', 'col-first'],
  ['for-or-while', 'collatz', '수 = int(input())\nwhile 수 != 1:\n    if 수 % 2 == 0:\n        수 = 수 // 2\n    else:\n        수 = 수 * 3\n    print(수)', 'error'],
  ['for-or-while', 'collatz', '수 = int(input())\nwhile 수 != 1:\n    if 수 % 2 == 0:\n        수 = 수 // 2\n    else:\n        수 = 수 * 3 + 1\nprint(수)', 'count'],
  ['for-or-while', 'collatz', '수 = input()\nwhile 수 != 1:\n    if 수 % 2 == 0:\n        수 = 수 // 2\n    else:\n        수 = 수 * 3 + 1\n    print(수)', 'error'],
  ['for-or-while', 'collatz', '수 = int(input())\nwhile 수 != 1:\n    if 수 % 2 == 0:\n        수 // 2\n    else:\n        수 * 3 + 1\n    print(수)', 'endless'],
  ['for-or-while', 'steps', '수 = int(input())\n횟수 = 0\nwhile 수 != 1:\n    if 수 % 2 == 0:\n        수 = 수 // 2\n    else:\n        수 = 수 * 3 + 1\n    횟수 = 횟수 + 1\n    print(수)\nprint(횟수)', 'mistake', 'steps-list'],
  ['unit6-review', 'countdown', '수 = int(input())\nwhile 수 >= 0:\n    print(수)\n    수 = 수 - 1\nprint("발사")', 'mistake', 'count-zero'],
  ['unit6-review', 'countdown', '수 = int(input())\nwhile 수 > 0:\n    print(수)\n    수 = 수 + 1\nprint("발사")', 'endless'],
  ['unit6-review', 'countdown', '수 = int(input())\nfor i in range(수, 0, -1):\n    print(i)\nprint("발사")', 'mistake', 'need-while'],
  ['unit6-review', 'game', 'import random\n답 = random.randint(1, 100)\n횟수 = 0\nwhile True:\n    수 = int(input())\n    횟수 = 횟수 + 1\n    if 수 == 답:\n        print("정답!", 횟수, "번 만에 맞혔어요")\n        break\n    elif 수 < 답:\n        print("더 큰 수예요")\n    else:\n        print("더 작은 수예요")\nprint("게임 끝")', 'mistake', 'game-limit'],
  ['unit6-review', 'game', 'import random\n답 = random.randint(1, 100)\n횟수 = 0\nwhile 횟수 <= 7:\n    수 = int(input())\n    횟수 = 횟수 + 1\n    if 수 == 답:\n        print("정답!", 횟수, "번 만에 맞혔어요")\n        break\n    elif 수 < 답:\n        print("더 큰 수예요")\n    else:\n        print("더 작은 수예요")\nprint("게임 끝")', 'mistake', 'game-limit'],
  ['unit6-review', 'game', 'import random\n답 = random.randint(1, 100)\n횟수 = 0\nwhile 횟수 < 7:\n    수 = int(input())\n    if 수 == 답:\n        print("정답!", 횟수, "번 만에 맞혔어요")\n        break\n    elif 수 < 답:\n        print("더 큰 수예요")\n    else:\n        print("더 작은 수예요")\n    횟수 = 횟수 + 1\nprint("게임 끝")', 'mistake', 'game-count'],
  ['unit6-review', 'game', 'import random\n답 = random.randint(1, 100)\n횟수 = 0\nwhile 횟수 < 7:\n    수 = int(input())\n    횟수 = 횟수 + 1\n    if 수 == 답:\n        print("정답!", 횟수, "번 만에 맞혔어요")\n        break\n    elif 수 < 답:\n        print("더 큰 수예요")\n    else:\n        print("더 작은 수예요")\n', 'mistake', 'game-no-end'],
  ['unit6-review', 'game', 'import random\n답 = random.randint(1, 100)\n횟수 = 0\nwhile 횟수 < 7:\n    수 = int(input())\n    횟수 = 횟수 + 1\n    if 수 == 답:\n        print("정답!", 횟수, "번 만에 맞혔어요")\n        break\n    elif 수 < 답:\n        print("더 큰 수예요")\n    else:\n        print("더 작은 수예요")\n    print("게임 끝")', 'mistake', 'game-end-in'],
  ['unit6-review', 'game', 'import random\n답 = random.randint(1, 100)\n횟수 = 0\nwhile 횟수 < 7:\n    수 = int(input())\n    횟수 = 횟수 + 1\n    if 수 == 답:\n        print("정답!", 횟수, "번 만에 맞혔어요")\n    elif 수 < 답:\n        print("더 큰 수예요")\n    else:\n        print("더 작은 수예요")\nprint("게임 끝")', 'input-many'],
  // 리스트 단원
  ['list-basic', 'week', 'print("월")\nprint("금")\nprint(5)', 'mistake', 'need-index'],
  ['list-basic', 'week', '요일 = ["월", "화", "수", "목", "금"]\nprint(요일[1])\nprint(요일[4])\nprint(len(요일))', 'mistake', 'week-one'],
  ['list-basic', 'week', '요일 = ["월", "화", "수", "목", "금"]\nprint(요일[0])\nprint(요일[5])\nprint(len(요일))', 'error'],
  ['list-basic', 'week', '요일 = ["월", "화", "수", "목", "금"]\nprint(요일[0])\nprint(요일[4])\nprint(4)', 'line-diff'],
  ['list-basic', 'from-back', '색 = ["빨강", "주황", "노랑", "초록", "파랑", "남색", "보라"]\nprint(색[6])\nprint(색[5])', 'mistake', 'need-minus'],
  ['list-for', 'shopping', '목록 = ["우유", "달걀", "빵", "사과"]\nfor i in range(len(목록)):\n    print(목록[i], "사기")\nprint("모두", len(목록), "개")', 'mistake', 'need-for-in'],
  ['list-for', 'shopping', '목록 = ["우유", "달걀", "빵", "사과"]\nfor 하나 in 목록:\n    print(목록, "사기")\nprint("모두", len(목록), "개")', 'mistake', 'shop-whole'],
  ['list-for', 'shopping', '목록 = ["우유", "달걀", "빵", "사과"]\nfor 하나 in 목록:\n    print(하나, "사기")\nprint("모두 4 개")', 'mistake', 'shop-count'],
  ['list-for', 'shopping', '목록 = ["우유", "달걀", "빵", "사과"]\nfor 하나 in 목록:\n    print(하나, "사기")\n    print("모두", len(목록), "개")', 'count'],
  ['list-for', 'letters', '낱말 = input()\nprint(낱말)', 'mistake', 'letters-whole'],
  ['list-index', 'rank', '이름 = ["하늘", "바다", "구름", "나무"]\nfor i in range(len(이름)):\n    print(i, "등:", 이름[i])', 'mistake', 'rank-zero'],
  ['list-index', 'rank', '이름 = ["하늘", "바다", "구름", "나무"]\nfor 하나 in 이름:\n    print(하나)', 'mistake', 'rank-no-num'],
  ['list-index', 'rank', '이름 = ["하늘", "바다", "구름", "나무"]\nfor i in range(len(이름)):\n    print(i + 1, "등:", 이름[i + 1])', 'error'],
  ['list-index', 'enum', '색 = ["빨강", "노랑", "파랑"]\nfor i in range(len(색)):\n    print(i + 1, 색[i])', 'mistake', 'need-enum'],
  ['list-index', 'enum', '색 = ["빨강", "노랑", "파랑"]\nfor i, 하나 in enumerate(색):\n    print(i, 하나)', 'mistake', 'enum-zero'],
  ['list-change', 'collect', '모음 = []\nwhile True:\n    말 = input()\n    모음.append(말)\n    if 말 == "끝":\n        break\nprint(모음)\nprint(len(모음), "개")', 'mistake', 'collect-stop'],
  ['list-change', 'collect', 'while True:\n    모음 = []\n    말 = input()\n    if 말 == "끝":\n        break\n    모음.append(말)\nprint(모음)\nprint(len(모음), "개")', 'mistake', 'collect-reset'],
  ['list-change', 'collect', '모음 = []\nwhile True:\n    말 = input()\n    if 말 != "끝":\n        모음.append(말)\nprint(모음)', 'input-many'],
  ['list-change', 'collect', '모음 = []\nwhile True:\n    말 = input()\n    if 말 == "끝":\n        break\n    모음.add(말)\nprint(모음)\nprint(len(모음), "개")', 'error'],
  ['list-change', 'line', '줄 = ["마", "나", "다", "라"]\nprint(줄)', 'mistake', 'need-pop'],
  ['list-calc', 'exam', 'print("합", 445)\nprint("평균", 89.0)\nprint("최고", 100)', 'mistake', 'need-list'],
  ['list-calc', 'exam', '점수 = [85, 92, 78, 90, 100]\nprint("합", sum(점수))\nprint("평균", sum(점수) // len(점수))\nprint("최고", max(점수))', 'mistake', 'exam-int'],
  ['list-calc', 'exam', '점수 = [85, 92, 78, 90, 100]\nprint("합", sum(점수))\nprint("평균", sum(점수) / 4)\nprint("최고", max(점수))', 'line-diff'],
  ['list-calc', 'where', '점수 = [85, 92, 78, 100, 90]\nprint(점수.index(max(점수)) + 1, "번")', 'mistake', 'where-one'],
  ['list-calc', 'where', '점수 = [85, 92, 78, 100, 90]\nprint(max(점수), "번")', 'mistake', 'where-value'],
  ['list-calc', 'where', '점수 = [85, 92, 78, 100, 90]\nprint(점수.index(max(점수)), "번")', 'correct'],
  ['list-pair', 'price', '과일 = ["사과", "귤", "포도", "배"]\n값 = [1000, 500, 3000, 2000]\n찾는 = input()\nif 찾는 in 과일:\n    print(값[1], "원")\nelse:\n    print("없어요")', 'mistake', 'price-fixed'],
  ['list-pair', 'price', '과일 = ["사과", "귤", "포도", "배"]\n값 = [1000, 500, 3000, 2000]\n찾는 = input()\n번호 = 과일.index(찾는)\nprint(값[번호], "원")', 'error'],
  ['list-pair', 'price', '과일 = ["사과", "귤", "포도", "배"]\n값 = [1000, 500, 3000, 2000]\n찾는 = input()\nif 찾는 in 과일:\n    번호 = 과일.index(찾는)\n    print(번호, "원")\nelse:\n    print("없어요")', 'mistake', 'price-name'],
  ['list-pair', 'trip', '역 = ["노포", "범어사", "남산", "두실", "구서", "장전"]\n분 = [3, 2, 2, 2, 2]\n시작 = int(input())\n끝 = int(input())\n합 = 0\nfor i in range(시작, 끝 + 1):\n    합 = 합 + 분[i]\nprint(합, "분")', 'mistake', 'trip-extra'],
  ['list-pair', 'trip', '역 = ["노포", "범어사", "남산", "두실", "구서", "장전"]\n분 = [3, 2, 2, 2, 2]\n시작 = int(input())\n끝 = int(input())\nprint(sum(분), "분")', 'mistake', 'trip-all'],
  ['list-pair', 'trip', '역 = ["노포", "범어사", "남산", "두실", "구서", "장전"]\n분 = [3, 2, 2, 2, 2]\n시작 = input()\n끝 = input()\n합 = 0\nfor i in range(시작, 끝):\n    합 = 합 + 분[i]\nprint(합, "분")', 'error'],
  ['unit7-review', 'evens', '수 = [3, 8, 5, 12, 7, 6]\n짝수 = []\nfor 하나 in 수:\n    짝수.append(하나)\nprint(짝수)\nprint(len(짝수), "개")', 'mistake', 'even-all'],
  ['unit7-review', 'evens', '수 = [3, 8, 5, 12, 7, 6]\n짝수 = []\nfor 하나 in 수:\n    if 하나 % 2 == 1:\n        짝수.append(하나)\nprint(짝수)\nprint(len(짝수), "개")', 'mistake', 'even-odd'],
  ['unit7-review', 'evens', 'print([8, 12, 6])\nprint(3, "개")', 'mistake', 'need-append'],
  ['unit7-review', 'guide', '역 = ["노포", "범어사", "남산", "두실", "구서", "장전"]\n분 = [3, 2, 2, 2, 2]\n출발 = input()\n도착 = input()\n시작 = 역.index(출발)\n끝 = 역.index(도착)\n합 = 0\nfor i in range(시작, 끝):\n    print(역[i])\n    합 = 합 + 분[i]\nprint(합, "분")', 'mistake', 'guide-last'],
  ['unit7-review', 'guide', '역 = ["노포", "범어사", "남산", "두실", "구서", "장전"]\n분 = [3, 2, 2, 2, 2]\n출발 = input()\n도착 = input()\n시작 = 역.index(출발)\n끝 = 역.index(도착)\n합 = 0\nfor i in range(시작, 끝 + 1):\n    print(역[i])\n    합 = 합 + 분[i]\nprint(합, "분")', 'mistake', 'guide-time'],
  ['unit7-review', 'guide', '역 = ["노포", "범어사", "남산", "두실", "구서", "장전"]\n분 = [3, 2, 2, 2, 2]\n출발 = input()\n도착 = input()\n시작 = 역.index(출발)\n끝 = 역.index(도착)\n합 = 0\nfor i in range(시작, 끝):\n    print(역[i])\nprint(역[끝])', 'mistake', 'guide-no-time'],
  ['unit7-review', 'guide', '역 = ["노포", "범어사", "남산", "두실", "구서", "장전"]\n분 = [3, 2, 2, 2, 2]\n출발 = input()\n도착 = input()\n시작 = 역.index(출발)\n끝 = 역.index(도착)\n합 = 0\nfor i in range(len(역)):\n    print(역[i])\nprint(합, "분")', 'mistake', 'guide-all'],
  ['unit7-review', 'guide', '역 = ["노포", "범어사", "남산", "두실", "구서", "장전"]\n분 = [3, 2, 2, 2, 2]\n시작 = int(input())\n끝 = int(input())\nprint(역[시작])', 'error'],
  ['unit7-review', 'guide', '역 = ["노포", "범어사", "남산", "두실", "구서", "장전"]\n분 = [3, 2, 2, 2, 2]\n출발 = input()\nprint(출발)', 'input-few'],
  // 함수 단원
  ['def-basic', 'ruler', 'def 줄긋기():\n    print("=" * 10)', 'mistake', 'line-no-call'],
  ['def-basic', 'ruler', 'def 줄긋기():\n    print("=" * 10)\n    줄긋기()\n    print("파이썬")', 'mistake', 'line-no-call'],
  ['def-basic', 'ruler', 'print("=" * 10)\nprint("파이썬")\nprint("=" * 10)\nprint("끝")\nprint("=" * 10)', 'mistake', 'need-def'],
  ['def-basic', 'ruler', '줄긋기()\ndef 줄긋기():\n    print("=" * 10)', 'error'],
  ['def-basic', 'ruler', 'def 줄긋기():\n    print("=" * 10)\n줄긋기()\nprint("파이썬")\n줄긋기()\nprint("끝")', 'count'],
  ['def-basic', 'ruler', 'def 줄긋기()\n    print("=" * 10)\n줄긋기()', 'error'],
  ['def-param', 'ruler-n', 'def 줄긋기():\n    print("-" * 3)\n줄긋기()\n줄긋기()\n줄긋기()', 'mistake', 'ruler-same'],
  ['def-param', 'ruler-n', 'print("-" * 3)\nprint("-" * 6)\nprint("-" * 9)', 'mistake', 'need-param'],
  ['def-param', 'ruler-n', 'def 줄긋기(길이):\n    print("-" * 길이)\n줄긋기()', 'error'],
  ['def-param', 'ruler-n', 'def 줄긋기(길이):\n    print("-" * 길이)\n줄긋기(3, 6)', 'error'],
  ['def-param', 'rect', 'def 네모(가로, 세로):\n    for i in range(가로):\n        print("*" * 세로)\n네모(4, 2)\n네모(2, 3)', 'mistake', 'rect-swap'],
  ['def-return', 'bigger', 'def 큰수(가, 나):\n    if 가 > 나:\n        print(가)\n    else:\n        print(나)\n\nprint(큰수(3, 8))\nprint(큰수(10, 2))\nprint(큰수(5, 5))', 'mistake', 'big-print'],
  ['def-return', 'bigger', 'def 큰수(가, 나):\n    if 가 > 나:\n        return 가\n    if 가 < 나:\n        return 나\n\nprint(큰수(3, 8))\nprint(큰수(10, 2))\nprint(큰수(5, 5))', 'mistake', 'big-same'],
  ['def-return', 'bigger', '# 여기에 큰수 함수를 만들어요\n\nprint(큰수(3, 8))\nprint(큰수(10, 2))\nprint(큰수(5, 5))', 'error'],
  ['def-return', 'bigger', 'def 큰수(가, 나):\n    return 가\n\nprint(큰수(3, 8))\nprint(큰수(10, 2))\nprint(큰수(5, 5))', 'line-diff'],
  ['def-return', 'medal', 'def 메달(점수):\n    if 점수 >= 90:\n        return "금"\n    if 점수 >= 70:\n        return "은"\n\nprint(메달(95))\nprint(메달(75))\nprint(메달(50))', 'mistake', 'big-print'],
  ['def-scope', 'fix-scope', 'def 더하기(가, 나):\n    합 = 가 + 나\n\nprint(더하기(3, 4))\nprint(더하기(10, 20))', 'mistake', 'fix-none'],
  ['def-scope', 'fix-scope', 'def 더하기(가, 나):\n    합 = 가 + 나\n    return 합\n\n합 = 더하기(3, 4)\nprint(합)\n더하기(10, 20)\nprint(합)', 'mistake', 'fix-same'],
  ['def-scope', 'fix-scope', 'def 더하기(가, 나):\n    합 = 가 + 나\n\n더하기(3, 4)\nprint(합)\n더하기(10, 20)\nprint(합)', 'error'],
  ['def-scope', 'fix-scope', 'print(7)\nprint(30)', 'mistake', 'need-return'],
  ['def-split', 'primes-fn', 'def 약수개수(수):\n    개수 = 0\n    for i in range(1, 수 + 1):\n        if 수 % i == 0:\n            개수 += 1\n    return 개수\n\nfor 수 in range(2, 31):\n    if 약수개수(수) == 2:\n        print(수)', 'mistake', 'need-two'],
  ['def-split', 'primes-fn', 'def 약수개수(수):\n    개수 = 0\n    for i in range(1, 수 + 1):\n        if 수 % i == 0:\n            개수 += 1\n    return 개수\n\ndef 소수인가(수):\n    return 약수개수(수) <= 2\n\nfor 수 in range(1, 31):\n    if 소수인가(수):\n        print(수)', 'mistake', 'prime-one'],
  ['def-split', 'primes-fn', 'def 약수개수(수):\n    개수 = 0\n    for i in range(1, 수 + 1):\n        if 수 % i == 0:\n            개수 += 1\n    return 개수\n\ndef 소수인가(수):\n    return 약수개수(수) == 2\n\nfor 수 in range(2, 31):\n    print(소수인가(수))', 'mistake', 'prime-bool'],
  ['def-split', 'primes-fn', 'def 약수개수(수):\n    개수 = 0\n    for i in range(1, 수 + 1):\n        if 수 % i == 0:\n            개수 += 1\n    return 개수\n\ndef 소수인가(수):\n    약수개수(수) == 2\n\nfor 수 in range(2, 31):\n    if 소수인가(수):\n        print(수)', 'no-output'],
  ['def-split', 'twin', 'def 약수개수(수):\n    개수 = 0\n    for i in range(1, 수 + 1):\n        if 수 % i == 0:\n            개수 += 1\n    return 개수\n\ndef 소수인가(수):\n    return 약수개수(수) == 2\n\nfor 수 in range(2, 31):\n    if 소수인가(수) or 소수인가(수 + 2):\n        print(수, 수 + 2)', 'mistake', 'twin-or'],
  ['unit8-review', 'average', 'def 평균(가, 나):\n    print((가 + 나) / 2)\n\nprint(평균(80, 100))\nprint(평균(7, 4))', 'mistake', 'avg-none'],
  ['unit8-review', 'average', 'def 평균(가, 나):\n    return (가 + 나) // 2\n\nprint(평균(80, 100))\nprint(평균(7, 4))', 'mistake', 'avg-int'],
  ['unit8-review', 'average', 'def 평균(가, 나):\n    return 가 + 나 / 2\n\nprint(평균(80, 100))\nprint(평균(7, 4))', 'mistake', 'avg-paren'],
  ['unit8-review', 'table-fn', '단 = int(input("몇 단? "))\nfor i in range(1, 10):\n    print(단, "x", i, "=", 단 * i)', 'count'],
  ['unit8-review', 'table-fn', 'def 구구단(단):\n    for i in range(1, 10):\n        print(단, "x", i, "=", 단 * i)\n\n단 = int(input())\n구구단(단)', 'mistake', 'table-once'],
  ['unit8-review', 'table-fn', 'def 구구단(단):\n    for i in range(1, 10):\n        print(단, "x", i, "=", 단 * i)\n\n단 = int(input())\n구구단(단)\n구구단(단)', 'mistake', 'table-twice'],
  ['unit8-review', 'table-fn', 'def 구구단(단):\n    for i in range(1, 10):\n        print(단, "x", i, "=", 단 * i)\n\n단 = int(input())', 'mistake', 'table-none'],
  ['unit8-review', 'table-fn', '단 = int(input())\nfor i in range(1, 10):\n    print(단, "x", i, "=", 단 * i)\nfor i in range(1, 10):\n    print(단 + 1, "x", i, "=", (단 + 1) * i)', 'mistake', 'need-def-table'],
  ['unit8-review', 'table-fn', 'def 구구단(단):\n    for i in range(1, 10):\n        print(단, "x", i, "=", 단 * i)\n\n구구단(3)\n구구단(4)', 'input-few'],
  // 글자 다루기 단원
  ['str-index', 'ends', '낱말 = input()\nprint(낱말[0])\nprint(낱말[1])', 'mistake', 'ends-fixed'],
  ['str-index', 'ends', '낱말 = input()\nprint(낱말)\nprint(낱말)', 'mistake', 'ends-whole'],
  ['str-index', 'ends', '낱말 = input()\nprint(낱말[0])\nprint(낱말[len(낱말)])', 'error'],
  ['str-index', 'ends', '낱말 = input()\nprint(낱말[0])\nprint(낱말[len(낱말) - 1])', 'correct'],
  ['str-index', 'middle', '낱말 = input()\nprint(낱말[1])', 'mistake', 'middle-fixed'],
  ['str-index', 'middle', '낱말 = input()\nprint(낱말[len(낱말) / 2])', 'error'],
  ['str-for', 'squeeze', '문장 = input()\nprint(문장)', 'mistake', 'squeeze-same'],
  ['str-for', 'squeeze', '문장 = input()\nfor 글자 in 문장:\n    if 글자 != " ":\n        print(글자)', 'mistake', 'squeeze-lines'],
  ['str-for', 'squeeze', '문장 = input()\nfor 글자 in 문장:\n    새글 = ""\n    if 글자 != " ":\n        새글 = 새글 + 글자\nprint(새글)', 'mistake', 'squeeze-last'],
  ['str-for', 'squeeze', '문장 = input()\nprint(문장.replace(" ", ""))', 'correct'],
  ['str-for', 'mirror', '낱말 = input()\n뒤집은 = ""\nfor 글자 in 낱말:\n    뒤집은 = 뒤집은 + 글자\nprint(뒤집은)\nif 뒤집은 == 낱말:\n    print("거꾸로 해도 같아요")\nelse:\n    print("달라요")', 'mistake', 'mirror-same'],
  ['str-slice', 'date', '날짜 = input()\nprint(날짜[:4], "년")\nprint(날짜[4:], "월")\nprint(날짜[6:], "일")', 'mistake', 'date-long'],
  ['str-slice', 'date', '날짜 = input()\nprint(날짜[:4], "년")\nprint(날짜[5:7], "월")\nprint(날짜[7:], "일")', 'mistake', 'date-shift'],
  ['str-slice', 'date', '날짜 = int(input())\nprint(날짜[:4], "년")\nprint(날짜[4:6], "월")\nprint(날짜[6:], "일")', 'error'],
  ['str-slice', 'date', '날짜 = input()\nprint(날짜[0:4], "년")\nprint(날짜[4:6], "월")\nprint(날짜[6:8], "일")', 'correct'],
  ['str-slice', 'mask', '번호 = input()\nprint(번호[-4:])', 'mistake', 'mask-nostar'],
  ['str-slice', 'mask', '번호 = input()\nprint("*" * 7 + 번호[-4:])', 'mistake', 'mask-fixed'],
  ['str-method', 'swap', '문장 = input()\n문장.replace("사과", "포도")\nprint(문장)\nprint(문장.count("사과"), "번 바꿨어요")', 'mistake', 'swap-same'],
  ['str-method', 'swap', '문장 = input()\n문장 = 문장.replace("사과", "포도")\nprint(문장)\nprint(문장.count("사과"), "번 바꿨어요")', 'mistake', 'swap-zero'],
  ['str-method', 'swap', '문장 = input()\n개수 = 문장.count("사과")\n문장 = 문장.replace("사과", "포도")\nprint(문장)\nprint(개수, "번 바꿨어요")', 'correct'],
  ['str-method', 'colon', '글 = input()\n자리 = 글.find(":")\nprint(글[:자리])\nprint(글[자리:])', 'mistake', 'colon-kept'],
  ['str-method', 'colon', '글 = input()\n조각 = 글.split(":")\nprint(조각[0])\nprint(조각[1])', 'correct'],
  ['str-split', 'sum-line', '답 = input()\n합 = 0\nfor 하나 in 답.split():\n    합 += int(하나)\nprint(len(답), "개")\nprint("합", 합)', 'mistake', 'sum-chars'],
  ['str-split', 'sum-line', '답 = input()\n수들 = 답.split()\n합 = ""\nfor 하나 in 수들:\n    합 += 하나\nprint(len(수들), "개")\nprint("합", 합)', 'mistake', 'sum-joined'],
  ['str-split', 'sum-line', '답 = input()\n수들 = 답.split()\n합 = 0\nfor 하나 in 수들:\n    합 += 하나\nprint(len(수들), "개")\nprint("합", 합)', 'error'],
  ['str-split', 'join', 'print(input().replace(" ", ", "))', 'mistake', 'need-join'],
  ['str-split', 'join', '낱말들 = input().split()\nprint(",".join(낱말들))', 'mistake', 'join-space'],
  ['unit9-review', 'short', '문장 = input()\n줄임 = ""\nfor 글자 in 문장:\n    줄임 = 줄임 + 글자[0]\nprint(줄임)', 'mistake', 'short-letters'],
  ['unit9-review', 'short', '문장 = input()\nfor 낱말 in 문장.split():\n    print(낱말[0])', 'mistake', 'short-lines'],
  ['unit9-review', 'secret', '글자표 = "가나다라마바사아자차카타파하"\n편지 = input()\nprint(편지)', 'mistake', 'secret-same'],
  ['unit9-review', 'secret', '글자표 = "가나다라마바사아자차카타파하"\n편지 = input()\nfor 글자 in 편지:\n    if 글자 in 글자표:\n        print(글자표[(글자표.find(글자) + 1) % 14])\n    else:\n        print(글자)', 'mistake', 'secret-lines'],
  ['unit9-review', 'secret', '글자표 = "가나다라마바사아자차카타파하"\n편지 = input()\n암호 = ""\nfor 글자 in 편지:\n    if 글자 in 글자표:\n        암호 = 암호 + 글자표[글자표.find(글자) - 1]\n    else:\n        암호 = 암호 + 글자\nprint(암호)', 'mistake', 'secret-back'],
  ['unit9-review', 'secret', '글자표 = "가나다라마바사아자차카타파하"\n편지 = input()\n암호 = ""\nfor 글자 in 편지:\n    자리 = 글자표.find(글자)\n    암호 = 암호 + 글자표[(자리 + 1) % len(글자표)]\nprint(암호)', 'mistake', 'secret-space'],
  ['unit9-review', 'secret', '글자표 = "가나다라마바사아자차카타파하"\n편지 = input()\n암호 = ""\nfor 글자 in 편지:\n    if 글자 in 글자표:\n        자리 = 글자표.find(글자)\n        암호 = 암호 + 글자표[(자리 + 1) % len(글자표)]\nprint(암호)', 'mistake', 'secret-lost'],
  ['unit9-review', 'secret', '글자표 = "가나다라마바사아자차카타파하"\n편지 = input()\n암호 = ""\nfor 글자 in 편지:\n    if 글자 in 글자표:\n        암호 = 암호 + 글자표[글자표.find(글자) + 1]\n    else:\n        암호 = 암호 + 글자\nprint(암호)', 'error'],
  ['unit9-review', 'secret', '글자표 = "가나다라마바사아자차카타파하"\n편지 = input()\n긴표 = 글자표 + "가"\n암호 = ""\nfor 글자 in 편지:\n    if 글자 in 글자표:\n        암호 += 긴표[긴표.find(글자) + 1]\n    else:\n        암호 += 글자\nprint(암호)', 'correct'],
  ['unit9-review', 'secret', '글자표 = "가나다라마바사아자차카타파하"\n편지 = input()\n암호 = ""\nfor 글자 in 편지:\n    if 글자 == "하":\n        암호 += "가"\n    elif 글자 in 글자표:\n        암호 += 글자표[글자표.index(글자) + 1]\n    else:\n        암호 += 글자\nprint(암호)', 'correct'],
  // 반복 안의 반복 단원
  ['nest-basic', 'rooms', 'for 호 in range(1, 3):\n    for 층 in range(1, 4):\n        print(층, "층", 호, "호")', 'mistake', 'rooms-swap'],
  ['nest-basic', 'rooms', 'for 층 in range(3):\n    for 호 in range(2):\n        print(층, "층", 호, "호")', 'mistake', 'rooms-zero'],
  ['nest-basic', 'rooms', 'for 층 in range(1, 3):\n    for 호 in range(1, 4):\n        print(층, "층", 호, "호")', 'mistake', 'rooms-count'],
  ['nest-basic', 'rooms', 'print("1 층 1 호")\nprint("1 층 2 호")\nprint("2 층 1 호")\nprint("2 층 2 호")\nprint("3 층 1 호")\nprint("3 층 2 호")', 'mistake', 'need-nest'],
  ['nest-basic', 'rooms', 'for 층 in range(1, 4):\n    for 호 in range(1, 3):\n    print(층, "층", 호, "호")', 'error'],
  ['nest-basic', 'rooms', 'for 층 in [1, 2, 3]:\n    for 호 in [1, 2]:\n        print(층, "층", 호, "호")', 'correct'],
  ['nest-basic', 'floors-head', 'for 층 in range(1, 4):\n    for 호 in range(1, 3):\n        print(층, "층")\n        print(층 * 100 + 호, "호")', 'mistake', 'head-inner'],
  ['nest-basic', 'floors-head', 'for 층 in range(1, 4):\n    for 호 in range(1, 3):\n        print(층 * 100 + 호, "호")\n    print(층, "층")', 'mistake', 'head-after'],
  ['nest-basic', 'floors-head', 'for 층 in range(1, 4):\n    print(층, "층")\n    for 호 in range(1, 3):\n        print(str(층) + "0" + str(호), "호")', 'correct'],
  ['nest-end', 'grid', 'for 줄 in range(3):\n    for 칸 in range(1, 6):\n        print(칸, end=" ")', 'mistake', 'grid-oneline'],
  ['nest-end', 'grid', 'for 줄 in range(3):\n    for 칸 in range(1, 6):\n        print(칸)', 'mistake', 'grid-lines'],
  ['nest-end', 'grid', 'for 줄 in range(3):\n    for 칸 in range(5):\n        print(칸, end=" ")\n    print()', 'mistake', 'grid-zero'],
  ['nest-end', 'grid', 'for 줄 in range(3):\n    for 칸 in range(1, 6):\n        print(칸, end="")\n    print()', 'mistake', 'grid-nospace'],
  ['nest-end', 'grid', 'for 줄 in range(3):\n    print("1 2 3 4 5")', 'mistake', 'need-end'],
  ['nest-end', 'grid', 'for 줄 in range(3):\n    for 칸 in range(1, 6):\n        print(칸, end" ")\n    print()', 'error'],
  ['nest-end', 'rect-ask', '가로 = int(input("가로: "))\n세로 = int(input("세로: "))\nfor 줄 in range(가로):\n    for 칸 in range(세로):\n        print("#", end="")\n    print()', 'mistake', 'rect-swap'],
  ['nest-end', 'rect-ask', '가로 = int(input("가로: "))\n세로 = int(input("세로: "))\nfor 줄 in range(세로):\n    for 칸 in range(가로):\n        print("#", end="")', 'mistake', 'rect-oneline'],
  ['nest-end', 'rect-ask', '가로 = int(input("가로: "))\n세로 = int(input("세로: "))\nfor 줄 in range(세로):\n    print("#" * 가로)', 'correct'],
  ['nest-depend', 'stairs', '층 = int(input())\nfor 줄 in range(1, 층 + 1):\n    for 칸 in range(1, 줄):\n        print(칸, end=" ")\n    print()', 'mistake', 'stairs-short'],
  ['nest-depend', 'stairs', '층 = int(input())\nfor 줄 in range(1, 층 + 1):\n    for 칸 in range(줄):\n        print(칸, end=" ")\n    print()', 'mistake', 'stairs-zero'],
  ['nest-depend', 'stairs', '층 = int(input())\nfor 줄 in range(1, 층 + 1):\n    for 칸 in range(1, 층 + 1):\n        print(칸, end=" ")\n    print()', 'mistake', 'stairs-same'],
  ['nest-depend', 'stairs', '층 = int(input())\nfor 줄 in range(1, 층 + 1):\n    for 칸 in range(1, 줄 + 1):\n        print(칸, end=" ")', 'mistake', 'stairs-oneline'],
  ['nest-depend', 'stairs', '층 = input()\nfor 줄 in range(1, 층 + 1):\n    for 칸 in range(1, 줄 + 1):\n        print(칸, end=" ")\n    print()', 'error'],
  ['nest-depend', 'right-tri', '크기 = int(input())\nfor 줄 in range(1, 크기 + 1):\n    for 칸 in range(줄):\n        print("*", end="")\n    print()', 'mistake', 'tri-left'],
  ['nest-depend', 'right-tri', '크기 = int(input())\nfor 줄 in range(크기, 0, -1):\n    for 칸 in range(크기 - 줄):\n        print(" ", end="")\n    for 칸 in range(줄):\n        print("*", end="")\n    print()', 'mistake', 'tri-flip'],
  ['nest-depend', 'right-tri', '크기 = int(input())\nfor 줄 in range(1, 크기 + 1):\n    print(" " * (크기 - 줄) + "*" * 줄)', 'correct'],
  ['nest-table', 'times-grid', 'for 줄 in range(1, 6):\n    for 칸 in range(1, 6):\n        print(칸, end=" ")\n    print()', 'mistake', 'grid-same'],
  ['nest-table', 'times-grid', 'for 줄 in range(1, 6):\n    for 칸 in range(1, 6):\n        print(줄 + 칸, end=" ")\n    print()', 'mistake', 'grid-plus'],
  ['nest-table', 'times-grid', 'for 줄 in range(5):\n    for 칸 in range(5):\n        print(줄 * 칸, end=" ")\n    print()', 'mistake', 'grid-zero'],
  ['nest-table', 'times-grid', 'for 줄 in range(1, 6):\n    for 칸 in range(1, 6):\n        print(줄 * 칸, end=" ")', 'mistake', 'grid-oneline'],
  ['nest-table', 'times-grid', 'print("1 2 3 4 5")\nprint("2 4 6 8 10")\nprint("3 6 9 12 15")\nprint("4 8 12 16 20")\nprint("5 10 15 20 25")', 'mistake', 'need-nest'],
  ['nest-table', 'gugu', '시작 = int(input())\n끝 = int(input())\nfor 단 in range(시작, 끝):\n    print(단, "단")\n    for 수 in range(1, 10):\n        print(단, "x", 수, "=", 단 * 수)', 'mistake', 'gugu-end'],
  ['nest-table', 'gugu', '시작 = int(input())\n끝 = int(input())\nfor 단 in range(시작, 끝 + 1):\n    for 수 in range(1, 10):\n        print(단, "x", 수, "=", 단 * 수)', 'mistake', 'gugu-nohead'],
  ['nest-table', 'gugu', '시작 = int(input())\n끝 = int(input())\nfor 단 in range(시작, 끝 + 1):\n    print(단, "단")\n    for 수 in range(1, 9):\n        print(단, "x", 수, "=", 단 * 수)', 'mistake', 'gugu-eight'],
  ['nest-table', 'gugu', '단 = int(input())\n끝 = int(input())\nwhile 단 <= 끝:\n    print(단, "단")\n    수 = 1\n    while 수 <= 9:\n        print(단, "x", 수, "=", 단 * 수)\n        수 += 1\n    단 += 1', 'correct'],
  ['nest-search', 'matches', '팀 = ["하늘", "바다", "구름", "나무"]\n개수 = 0\nfor i in range(len(팀)):\n    for j in range(len(팀)):\n        print(팀[i], "대", 팀[j])\n        개수 += 1\nprint(개수, "경기")', 'mistake', 'match-self'],
  ['nest-search', 'matches', '팀 = ["하늘", "바다", "구름", "나무"]\n개수 = 0\nfor i in range(len(팀)):\n    for j in range(len(팀)):\n        if i != j:\n            print(팀[i], "대", 팀[j])\n            개수 += 1\nprint(개수, "경기")', 'mistake', 'match-twice'],
  ['nest-search', 'matches', '팀 = ["하늘", "바다", "구름", "나무"]\nfor i in range(len(팀)):\n    for j in range(i + 1, len(팀)):\n        print(팀[i], "대", 팀[j])', 'mistake', 'match-nocount'],
  ['nest-search', 'matches', '팀 = ["하늘", "바다", "구름", "나무"]\n개수 = 0\nfor i in range(len(팀)):\n    for j in range(i + 1, len(팀) + 1):\n        print(팀[i], "대", 팀[j])\n        개수 += 1\nprint(개수, "경기")', 'error'],
  ['nest-search', 'matches', '팀 = ["하늘", "바다", "구름", "나무"]\n개수 = 0\nfor i in range(4):\n    for j in range(4):\n        if i < j:\n            print(팀[i], "대", 팀[j])\n            개수 += 1\nprint(개수, "경기")', 'correct'],
  ['nest-search', 'chicken', '머리 = int(input())\n다리 = int(input())\nfor 닭 in range(머리):\n    for 토끼 in range(머리):\n        if 닭 + 토끼 == 머리 and 닭 * 2 + 토끼 * 4 == 다리:\n            print("닭", 닭, "마리")\n            print("토끼", 토끼, "마리")', 'mistake', 'chick-edge'],
  ['nest-search', 'chicken', '머리 = int(input())\n다리 = int(input())\nfor 닭 in range(머리 + 1):\n    for 토끼 in range(머리 + 1):\n        if 닭 * 2 + 토끼 * 4 == 다리:\n            print("닭", 닭, "마리")\n            print("토끼", 토끼, "마리")', 'mistake', 'chick-many'],
  ['nest-search', 'chicken', '머리 = int(input())\n다리 = int(input())\nfor 닭 in range(머리 + 1):\n    토끼 = 머리 - 닭\n    if 닭 * 2 + 토끼 * 4 == 다리:\n        print("닭", 닭, "마리")\n        print("토끼", 토끼, "마리")', 'correct'],
  ['unit10-review', 'pairs', '수 = int(input())\nfor a in range(1, 수):\n    for b in range(1, 수):\n        if a * b == 수:\n            print(a, "x", b)', 'mistake', 'pairs-end'],
  ['unit10-review', 'pairs', '수 = int(input())\nfor a in range(1, 수 + 1):\n    for b in range(a, 수 + 1):\n        if a * b == 수:\n            print(a, "x", b)', 'mistake', 'pairs-half'],
  ['unit10-review', 'pairs', '수 = int(input())\nfor a in range(1, 수 + 1):\n    if 수 % a == 0:\n        print(a, "x", 수 // a)', 'correct'],
  ['unit10-review', 'checker', '검은칸 = "■"\n흰칸 = "□"\n크기 = int(input())\nfor 줄 in range(크기):\n    for 칸 in range(크기):\n        if 칸 % 2 == 0:\n            print(검은칸, end="")\n        else:\n            print(흰칸, end="")\n    print()', 'mistake', 'check-cols'],
  ['unit10-review', 'checker', '검은칸 = "■"\n흰칸 = "□"\n크기 = int(input())\nfor 줄 in range(크기):\n    for 칸 in range(크기):\n        if 줄 % 2 == 0:\n            print(검은칸, end="")\n        else:\n            print(흰칸, end="")\n    print()', 'mistake', 'check-rows'],
  ['unit10-review', 'checker', '검은칸 = "■"\n흰칸 = "□"\n크기 = int(input())\nfor 줄 in range(크기):\n    for 칸 in range(크기):\n        if (줄 + 칸) % 2 == 1:\n            print(검은칸, end="")\n        else:\n            print(흰칸, end="")\n    print()', 'mistake', 'check-flip'],
  ['unit10-review', 'checker', '검은칸 = "■"\n흰칸 = "□"\n크기 = int(input())\nfor 줄 in range(크기):\n    for 칸 in range(크기):\n        if (줄 + 칸) % 2 == 0:\n            print(검은칸, end="")\n        else:\n            print(흰칸, end="")', 'mistake', 'check-oneline'],
  ['unit10-review', 'checker', '검은칸 = "■"\n흰칸 = "□"\n크기 = int(input())\nfor 줄 in range(크기):\n    for 칸 in range(크기):\n        if (줄 + 칸) % 2 == 0:\n            print(검은칸)\n        else:\n            print(흰칸)', 'mistake', 'check-lines'],
  ['unit10-review', 'checker', '검은칸 = "■"\n흰칸 = "□"\n크기 = input()\nfor 줄 in range(크기):\n    for 칸 in range(크기):\n        print(검은칸, end="")\n    print()', 'error'],
  ['unit10-review', 'checker', '검은칸 = "■"\n흰칸 = "□"\n크기 = int(input())\nfor 줄 in range(크기):\n    한줄 = ""\n    for 칸 in range(크기):\n        if 줄 % 2 == 칸 % 2:\n            한줄 += 검은칸\n        else:\n            한줄 += 흰칸\n    print(한줄)', 'correct'],
  // 딕셔너리 단원
  ['dict-basic', 'price', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n과일 = input()\nprint(가격)', 'mistake', 'price-all'],
  ['dict-basic', 'price', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n과일 = input()\nprint(과일, "원")', 'mistake', 'price-key'],
  ['dict-basic', 'price', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n과일 = input()\nif 과일 == "사과":\n    print("1000 원")\nelif 과일 == "귤":\n    print("500 원")\nelif 과일 == "포도":\n    print("3000 원")\nelse:\n    print("2000 원")', 'mistake', 'need-dict'],
  ['dict-basic', 'price', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n과일 = input()\nprint(가격["과일"], "원")', 'error'],
  ['dict-basic', 'price', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n과일 = input()\nprint(가격(과일), "원")', 'error'],
  ['dict-basic', 'price', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\nprint(가격[input()], "원")', 'correct'],
  ['dict-basic', 'two', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n하나 = input()\n둘 = input()\nprint(가격[하나], "원")\nprint(가격[둘], "원")', 'mistake', 'two-lines'],
  ['dict-basic', 'two', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n합 = 0\nfor i in range(2):\n    합 += 가격[input()]\nprint(합, "원")', 'correct'],
  ['dict-change', 'stock', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n과일 = input()\nif "과일" in 가격:\n    print(가격[과일], "원")\nelse:\n    print("없어요")', 'mistake', 'stock-always'],
  ['dict-change', 'stock', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n과일 = input()\nprint(가격[과일], "원")', 'error'],
  ['dict-change', 'stock', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n과일 = input()\nif not 과일 in 가격:\n    print("없어요")\nelse:\n    print(가격[과일], "원")', 'correct'],
  ['dict-change', 'add-new', '가격 = {"사과": 1000, "귤": 500}\n과일 = input()\n값 = int(input())\n가격[과일] = 값\nif 과일 in 가격:\n    print("바꿨어요")\nelse:\n    print("넣었어요")\nprint(가격[과일], "원")\nprint(len(가격), "가지")', 'mistake', 'add-after-store'],
  ['dict-change', 'add-new', '가격 = {"사과": 1000, "귤": 500}\n과일 = input()\n값 = int(input())\nif 과일 in 가격:\n    print("바꿨어요")\nelse:\n    print("넣었어요")\n가격.append(과일)\nprint(가격[과일], "원")\nprint(len(가격), "가지")', 'error'],
  ['dict-change', 'add-new', '가격 = {"사과": 1000, "귤": 500}\n과일 = input()\n값 = int(input())\nif 과일 in 가격:\n    가격[과일] = 값\n    print("바꿨어요")\nelse:\n    가격[과일] = 값\n    print("넣었어요")\nprint(값, "원")\nprint(len(가격), "가지")', 'correct'],
  ['dict-for', 'receipt', '장바구니 = {"우유": 2500, "빵": 1800, "사과": 3000}\nfor 물건 in 장바구니:\n    print(물건)', 'mistake', 'rc-keys'],
  ['dict-for', 'receipt', '장바구니 = {"우유": 2500, "빵": 1800, "사과": 3000}\nfor 물건 in 장바구니:\n    print(물건, 장바구니[물건], "원")', 'mistake', 'rc-nosum'],
  ['dict-for', 'receipt', '장바구니 = {"우유": 2500, "빵": 1800, "사과": 3000}\n합 = 0\nfor 물건 in 장바구니:\n    print(물건, 장바구니[물건], "원")\n    합 += 장바구니[물건]\n    print("합", 합, "원")', 'mistake', 'rc-inner'],
  ['dict-for', 'receipt', '장바구니 = {"우유": 2500, "빵": 1800, "사과": 3000}\nprint("우유 2500 원")\nprint("빵 1800 원")\nprint("사과 3000 원")\nprint("합 7300 원")', 'mistake', 'need-for'],
  ['dict-for', 'receipt', '장바구니 = {"우유": 2500, "빵": 1800, "사과": 3000}\n합 = 0\nfor 물건 in 장바구니:\n    print(물건, 장바구니[0], "원")', 'error'],
  ['dict-for', 'afford', '장바구니 = {"우유": 2500, "빵": 1800, "사과": 3000}\n돈 = int(input())\n개수 = 0\nfor 물건 in 장바구니:\n    if 장바구니[물건] < 돈:\n        print(물건)\n        개수 += 1\nprint(개수, "가지")', 'mistake', 'afford-equal'],
  ['dict-for', 'afford', '장바구니 = {"우유": 2500, "빵": 1800, "사과": 3000}\n돈 = int(input())\nfor 물건 in 장바구니:\n    if 장바구니[물건] <= 돈:\n        print(물건)', 'mistake', 'afford-count'],
  ['dict-for', 'afford', '장바구니 = {"우유": 2500, "빵": 1800, "사과": 3000}\n돈 = int(input())\n살것 = []\nfor 물건 in 장바구니:\n    if 돈 >= 장바구니[물건]:\n        살것.append(물건)\nfor 물건 in 살것:\n    print(물건)\nprint(len(살것), "가지")', 'correct'],
  ['dict-count', 'votes', '답 = input()\n개수 = {}\nfor 하나 in 답.split():\n    if 하나 in 개수:\n        개수[하나] += 1\n    else:\n        개수[하나] = 0\nfor 하나 in 개수:\n    print(하나, 개수[하나])', 'mistake', 'votes-zero'],
  ['dict-count', 'votes', '답 = input()\n개수 = {}\nfor 하나 in 답:\n    if 하나 in 개수:\n        개수[하나] += 1\n    else:\n        개수[하나] = 1\nfor 하나 in 개수:\n    print(하나, 개수[하나])', 'mistake', 'votes-chars'],
  ['dict-count', 'votes', '답 = input()\n개수 = {}\nfor 하나 in 답.split():\n    if 하나 in 개수:\n        개수[하나] += 1\n    else:\n        개수[하나] = 1\n    print(하나, 개수[하나])', 'mistake', 'votes-running'],
  ['dict-count', 'votes', '답 = input()\n개수 = {}\nfor 하나 in 답.split():\n    개수[하나] += 1\nfor 하나 in 개수:\n    print(하나, 개수[하나])', 'error'],
  ['dict-count', 'votes', '낱말들 = input().split()\n개수 = {}\nfor 하나 in 낱말들:\n    개수[하나] = 낱말들.count(하나)\nfor 하나 in 개수:\n    print(하나, 개수[하나])', 'correct'],
  ['dict-count', 'winner', '답 = input()\n개수 = {}\nfor 하나 in 답.split():\n    if 하나 in 개수:\n        개수[하나] += 1\n    else:\n        개수[하나] = 1\n으뜸 = ""\n많은 = 0\nfor 하나 in 개수:\n    if 개수[하나] >= 많은:\n        많은 = 개수[하나]\n        으뜸 = 하나\nprint(으뜸, 많은, "표")', 'mistake', 'winner-tie'],
  ['dict-count', 'winner', '답 = input()\n개수 = {}\nfor 하나 in 답.split():\n    if 하나 in 개수:\n        개수[하나] += 1\n    else:\n        개수[하나] = 1\nfor 하나 in 개수:\n    print(하나, 개수[하나], "표")', 'mistake', 'winner-all'],
  ['dict-table', 'read-number', '읽기 = {"0": "영", "1": "일", "2": "이", "3": "삼", "4": "사",\n      "5": "오", "6": "육", "7": "칠", "8": "팔", "9": "구"}\n글 = input()\nprint(글)', 'mistake', 'rn-same'],
  ['dict-table', 'read-number', '읽기 = {"0": "영", "1": "일", "2": "이", "3": "삼", "4": "사",\n      "5": "오", "6": "육", "7": "칠", "8": "팔", "9": "구"}\n글 = input()\nfor 글자 in 글:\n    if 글자 in 읽기:\n        print(읽기[글자])\n    else:\n        print(글자)', 'mistake', 'rn-lines'],
  ['dict-table', 'read-number', '읽기 = {"0": "영", "1": "일", "2": "이", "3": "삼", "4": "사",\n      "5": "오", "6": "육", "7": "칠", "8": "팔", "9": "구"}\n글 = input()\n새글 = ""\nfor 글자 in 글:\n    if 글자 in 읽기:\n        새글 += 읽기[글자]\nprint(새글)', 'mistake', 'rn-lost'],
  ['dict-table', 'read-number', '읽기 = {"0": "영", "1": "일", "2": "이", "3": "삼", "4": "사",\n      "5": "오", "6": "육", "7": "칠", "8": "팔", "9": "구"}\n글 = input()\n새글 = ""\nfor 글자 in 글:\n    새글 += 읽기[글자]\nprint(새글)', 'error'],
  ['dict-table', 'read-number', '읽기 = {"0": "영", "1": "일", "2": "이", "3": "삼", "4": "사",\n      "5": "오", "6": "육", "7": "칠", "8": "팔", "9": "구"}\n글 = int(input())\n새글 = ""\nfor 글자 in 글:\n    새글 += 읽기[글자]\nprint(새글)', 'error'],
  ['dict-table', 'read-number', '읽기 = {"0": "영", "1": "일", "2": "이", "3": "삼", "4": "사",\n      "5": "오", "6": "육", "7": "칠", "8": "팔", "9": "구"}\n글 = input()\nfor 숫자 in 읽기:\n    글 = 글.replace(숫자, 읽기[숫자])\nprint(글)', 'correct'],
  ['dict-table', 'decode', '글자표 = "가나다라마바사아자차카타파하"\n풀기 = {}\nfor i in range(len(글자표)):\n    풀기[글자표[i]] = 글자표[(i + 1) % len(글자표)]\n암호 = input()\n편지 = ""\nfor 글자 in 암호:\n    if 글자 in 풀기:\n        편지 += 풀기[글자]\n    else:\n        편지 += 글자\nprint(편지)', 'mistake', 'dec-forward'],
  ['dict-table', 'decode', '글자표 = "가나다라마바사아자차카타파하"\n암호 = input()\nprint(암호)', 'mistake', 'dec-same'],
  ['dict-table', 'decode', '글자표 = "가나다라마바사아자차카타파하"\n암호 = input()\n편지 = ""\nfor 글자 in 암호:\n    if 글자 in 글자표:\n        편지 += 글자표[글자표.find(글자) - 1]\n    else:\n        편지 += 글자\nprint(편지)', 'correct'],
  ['unit11-review', 'cart', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n답 = input()\n합 = 0\nfor 물건 in 답.split():\n    if 물건 in 가격:\n        합 += 가격[물건]\nprint(합, "원")', 'mistake', 'cart-skip'],
  ['unit11-review', 'cart', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n답 = input()\n합 = 0\nfor 물건 in 답.split():\n    if 물건 in 가격:\n        합 += 가격[물건]\n    else:\n        print(물건, "없어요")\n    print(합, "원")', 'mistake', 'cart-running'],
  ['unit11-review', 'cart', '가격 = {"사과": 1000, "귤": 500, "포도": 3000, "배": 2000}\n답 = input()\n합 = 0\nfor 물건 in 답.split():\n    합 += 가격[물건]\nprint(합, "원")', 'error'],
  ['unit11-review', 'wordbook', '단어장 = {"apple": "사과", "dog": "개"}\nwhile True:\n    낱말 = input()\n    if 낱말 == "끝":\n        break\n    if 낱말 in 단어장:\n        print(단어장[낱말])\n    else:\n        뜻 = input()\n        print("넣었어요")\nprint("낱말", len(단어장), "개")', 'mistake', 'wb-nostore'],
  ['unit11-review', 'wordbook', '단어장 = {"apple": "사과", "dog": "개"}\nwhile True:\n    낱말 = input()\n    if 낱말 in 단어장:\n        print(단어장[낱말])\n    else:\n        단어장[낱말] = input()\n        print("넣었어요")\nprint("낱말", len(단어장), "개")', 'mistake', 'wb-noend'],
  ['unit11-review', 'wordbook', '단어장 = {"apple": "사과", "dog": "개"}\nwhile True:\n    낱말 = input()\n    if 낱말 == "끝":\n        break\n    if 낱말 in 단어장:\n        print(단어장[낱말])\n    else:\n        단어장[낱말] = input()\n        print("넣었어요")', 'mistake', 'wb-nocount'],
  ['unit11-review', 'wordbook', '단어장 = {"apple": "사과", "dog": "개"}\nwhile True:\n    낱말 = input()\n    if 낱말 == "끝":\n        break\n    if 낱말 in 단어장:\n        print(단어장[낱말])\n    else:\n        단어장[낱말] = input()\n        print("넣었어요")\nprint("낱말 2 개")', 'mistake', 'wb-count'],
  ['unit11-review', 'wordbook', '단어장 = {"apple": "사과", "dog": "개"}\nwhile True:\n    낱말 = input()\n    if 낱말 == "끝":\n        break\n    print(단어장[낱말])\nprint("낱말", len(단어장), "개")', 'error'],
  ['unit11-review', 'wordbook', '단어장 = {"apple": "사과", "dog": "개"}\n낱말 = input()\nwhile 낱말 != "끝":\n    if 낱말 in 단어장:\n        print(단어장[낱말])\n    else:\n        단어장[낱말] = input()\n        print("넣었어요")\n    낱말 = input()\nprint("낱말", len(단어장), "개")', 'correct'],
  // 표 모양 리스트 단원
  ['grid-basic', 'seat', '자리 = [["하늘", "바다", "구름"],\n        ["나무", "별", "달"]]\n줄 = int(input())\n칸 = int(input())\nprint(자리[칸][줄])', 'mistake', 'seat-swap'],
  ['grid-basic', 'seat', '자리 = [["하늘", "바다", "구름"],\n        ["나무", "별", "달"]]\n줄 = int(input())\n칸 = int(input())\nprint(자리[줄])', 'mistake', 'seat-row'],
  ['grid-basic', 'seat', '자리 = [["하늘", "바다", "구름"],\n        ["나무", "별", "달"]]\n줄 = int(input())\n칸 = int(input())\nprint(자리[줄, 칸])', 'error'],
  ['grid-basic', 'seat', '자리 = [["하늘", "바다", "구름"],\n        ["나무", "별", "달"]]\n줄 = input()\n칸 = input()\nprint(자리[줄][칸])', 'error'],
  ['grid-basic', 'seat', '자리 = [["하늘", "바다", "구름"],\n        ["나무", "별", "달"]]\n줄 = int(input())\n칸 = int(input())\n한줄 = 자리[줄]\nprint(한줄[칸])', 'correct'],
  ['grid-basic', 'seat-one', '자리 = [["하늘", "바다", "구름"],\n        ["나무", "별", "달"]]\n줄 = int(input())\n칸 = int(input())\nif 줄 < len(자리) and 칸 < len(자리[0]):\n    print(자리[줄][칸])\nelse:\n    print("없는 자리예요")', 'mistake', 'seat-noshift'],
  ['grid-basic', 'seat-one', '자리 = [["하늘", "바다", "구름"],\n        ["나무", "별", "달"]]\n줄 = int(input()) - 1\n칸 = int(input()) - 1\nif 줄 < len(자리) and 칸 < len(자리[0]):\n    print(자리[줄][칸])\nelse:\n    print("없는 자리예요")', 'mistake', 'seat-zero'],
  ['grid-basic', 'seat-one', '자리 = [["하늘", "바다", "구름"],\n        ["나무", "별", "달"]]\n줄 = int(input()) - 1\n칸 = int(input()) - 1\nprint(자리[줄][칸])', 'error'],
  ['grid-basic', 'seat-one', '자리 = [["하늘", "바다", "구름"],\n        ["나무", "별", "달"]]\n줄 = int(input())\n칸 = int(input())\nif 줄 < 1 or 줄 > 2 or 칸 < 1 or 칸 > 3:\n    print("없는 자리예요")\nelse:\n    print(자리[줄 - 1][칸 - 1])', 'correct'],
  ['grid-for', 'show', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nfor 한줄 in 판:\n    print(한줄)', 'mistake', 'show-raw'],
  ['grid-for', 'show', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값)', 'mistake', 'show-lines'],
  ['grid-for', 'show', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")', 'mistake', 'show-oneline'],
  ['grid-for', 'show', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nprint("7 2 9")\nprint("4 5 1")\nprint("8 3 6")', 'mistake', 'need-nest'],
  ['grid-for', 'show', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nfor 줄 in range(3):\n    for 칸 in range(3):\n        print(판[줄][칸], end=" ")\n    print()', 'correct'],
  ['grid-for', 'turn', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nfor 줄 in range(3):\n    for 칸 in range(3):\n        print(판[줄][칸], end=" ")\n    print()', 'mistake', 'turn-same'],
  ['grid-for', 'turn', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nfor 칸 in range(3):\n    for 한줄 in 판:\n        print(한줄[칸], end=" ")\n    print()', 'correct'],
  ['grid-sum', 'totals', '이름 = ["하늘", "바다", "구름"]\n점수 = [[90, 80, 70],\n        [60, 100, 85],\n        [75, 75, 90]]\n합 = 0\nfor i in range(3):\n    for 값 in 점수[i]:\n        합 += 값\n    print(이름[i], 합)', 'mistake', 'tot-carry'],
  ['grid-sum', 'totals', '이름 = ["하늘", "바다", "구름"]\n점수 = [[90, 80, 70],\n        [60, 100, 85],\n        [75, 75, 90]]\nfor 한줄 in 점수:\n    print(sum(한줄))', 'mistake', 'tot-noname'],
  ['grid-sum', 'totals', '이름 = ["하늘", "바다", "구름"]\n점수 = [[90, 80, 70],\n        [60, 100, 85],\n        [75, 75, 90]]\nprint("하늘 240")\nprint("바다 245")\nprint("구름 240")', 'mistake', 'need-for'],
  ['grid-sum', 'totals', '이름 = ["하늘", "바다", "구름"]\n점수 = [[90, 80, 70],\n        [60, 100, 85],\n        [75, 75, 90]]\nfor i in range(3):\n    print(이름[i], sum(점수))', 'error'],
  ['grid-sum', 'totals', '이름 = ["하늘", "바다", "구름"]\n점수 = [[90, 80, 70],\n        [60, 100, 85],\n        [75, 75, 90]]\nfor i in range(3):\n    합 = 0\n    for 값 in 점수[i]:\n        합 += 값\n    print(이름[i], 합)', 'correct'],
  ['grid-sum', 'subjects', '과목 = ["국어", "수학", "과학"]\n점수 = [[90, 80, 70],\n        [60, 100, 85],\n        [75, 75, 90]]\nfor i in range(3):\n    print(과목[i], sum(점수[i]))', 'mistake', 'sub-rows'],
  ['grid-sum', 'subjects', '과목 = ["국어", "수학", "과학"]\n점수 = [[90, 80, 70],\n        [60, 100, 85],\n        [75, 75, 90]]\n합 = 0\nfor 칸 in range(3):\n    for 줄 in range(3):\n        합 += 점수[줄][칸]\n    print(과목[칸], 합)', 'mistake', 'sub-carry'],
  ['grid-sum', 'subjects', '과목 = ["국어", "수학", "과학"]\n점수 = [[90, 80, 70],\n        [60, 100, 85],\n        [75, 75, 90]]\nfor 칸 in range(3):\n    합 = 0\n    for 한줄 in 점수:\n        합 += 한줄[칸]\n    print(과목[칸], 합)', 'correct'],
  ['grid-change', 'mark', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\n수 = input()\nfor 줄 in range(3):\n    for 칸 in range(3):\n        if 판[줄][칸] == 수:\n            판[줄][칸] = "X"\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")\n    print()\n', 'mistake', 'mark-same'],
  ['grid-change', 'mark', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\n수 = int(input())\nfor 한줄 in 판:\n    for 값 in 한줄:\n        if 값 == 수:\n            값 = "X"\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")\n    print()\n', 'mistake', 'mark-same'],
  ['grid-change', 'mark', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\n수 = int(input())\nfor 줄 in range(3):\n    for 칸 in range(3):\n        if 판[줄][칸] == 수:\n            판[줄][칸] = "X"\nfor 한줄 in 판:\n    print(한줄)', 'mistake', 'mark-raw'],
  ['grid-change', 'mark', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\n수 = int(input())\nfor 한줄 in 판:\n    for 값 in 한줄:\n        if 값 == 수:\n            print("X", end=" ")\n        else:\n            print(값, end=" ")\n    print()', 'correct'],
  ['grid-change', 'diag', '크기 = int(input())\n판 = []\nfor 줄 in range(크기):\n    한줄 = []\n    for 칸 in range(크기):\n        한줄.append(0)\n    판.append(한줄)\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")\n    print()', 'mistake', 'diag-zero'],
  ['grid-change', 'diag', '크기 = int(input())\n판 = []\nfor 줄 in range(크기):\n    한줄 = []\n    for 칸 in range(크기):\n        한줄.append(0)\n    판.append(한줄)\nfor i in range(크기):\n    판[i][i] = 1\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")\n    print()', 'correct'],
  ['grid-find', 'find', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\n수 = int(input())\nfor 줄 in range(3):\n    for 칸 in range(3):\n        if 판[줄][칸] == 수:\n            print("줄", 줄, "칸", 칸)\n        else:\n            print("없어요")', 'mistake', 'find-many'],
  ['grid-find', 'find', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\n수 = input()\n찾음 = False\nfor 줄 in range(3):\n    for 칸 in range(3):\n        if 판[줄][칸] == 수:\n            print("줄", 줄, "칸", 칸)\n            찾음 = True\nif not 찾음:\n    print("없어요")', 'mistake', 'find-str'],
  ['grid-find', 'find', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\n수 = int(input())\nfor 줄 in range(3):\n    for 칸 in range(3):\n        if 판[줄][칸] == 수:\n            print("줄", 줄, "칸", 칸)\nprint("없어요")', 'mistake', 'find-both'],
  ['grid-find', 'find', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\n수 = int(input())\n자리 = ""\nfor 줄 in range(3):\n    if 수 in 판[줄]:\n        자리 = "줄 " + str(줄) + " 칸 " + str(판[줄].index(수))\nif 자리 == "":\n    print("없어요")\nelse:\n    print(자리)', 'correct'],
  ['grid-find', 'mines', '지도 = ["*...",\n        "..*.",\n        "....",\n        ".*.*"]\n줄 = int(input())\n칸 = int(input())\n개수 = 0\nfor 옆줄 in range(줄 - 1, 줄 + 2):\n    for 옆칸 in range(칸 - 1, 칸 + 2):\n        if 옆줄 < len(지도) and 옆칸 < len(지도[0]):\n            if 지도[옆줄][옆칸] == "*":\n                개수 += 1\nprint(개수, "개")', 'mistake', 'mines-wrap'],
  ['grid-find', 'mines', '지도 = ["*...",\n        "..*.",\n        "....",\n        ".*.*"]\n줄 = int(input())\n칸 = int(input())\n개수 = 0\nfor 옆줄 in range(줄 - 1, 줄 + 2):\n    for 옆칸 in range(칸 - 1, 칸 + 2):\n        if 옆줄 >= 0 and 옆칸 >= 0:\n            if 지도[옆줄][옆칸] == "*":\n                개수 += 1\nprint(개수, "개")', 'error'],
  ['grid-find', 'mines', '지도 = ["*...",\n        "..*.",\n        "....",\n        ".*.*"]\n줄 = int(input())\n칸 = int(input())\n개수 = 0\nfor r in range(len(지도)):\n    for c in range(len(지도[r])):\n        if r - 줄 <= 1 and 줄 - r <= 1 and c - 칸 <= 1 and 칸 - c <= 1:\n            if 지도[r][c] == "*":\n                개수 += 1\nprint(개수, "개")', 'correct'],
  ['unit12-review', 'row-info', '점수 = [[90, 80, 70],\n        [60, 100, 85],\n        [75, 75, 90]]\n줄 = int(input())\n합 = 0\nfor 한줄 in 점수:\n    합 += sum(한줄)\nprint("합", 합)\nprint("가장 큰 값", max(점수[줄]))', 'mistake', 'ri-all'],
  ['unit12-review', 'row-info', '점수 = [[90, 80, 70],\n        [60, 100, 85],\n        [75, 75, 90]]\n줄 = int(input())\nprint("합", sum(점수))\nprint("가장 큰 값", max(점수[줄]))', 'error'],
  ['unit12-review', 'bingo', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nwhile True:\n    답 = input()\n    수 = int(답)\n    for 줄 in range(3):\n        for 칸 in range(3):\n            if 판[줄][칸] == 수:\n                판[줄][칸] = "X"\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")\n    print()\n빙고 = 0\nfor 줄 in range(3):\n    개수 = 0\n    for 칸 in range(3):\n        if 판[줄][칸] == "X":\n            개수 += 1\n    if 개수 == 3:\n        빙고 += 1\nfor 칸 in range(3):\n    개수 = 0\n    for 줄 in range(3):\n        if 판[줄][칸] == "X":\n            개수 += 1\n    if 개수 == 3:\n        빙고 += 1\nprint("빙고", 빙고, "줄")', 'error'],
  ['unit12-review', 'bingo', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nwhile True:\n    답 = input()\n    for 줄 in range(3):\n        for 칸 in range(3):\n            if 판[줄][칸] == 답:\n                판[줄][칸] = "X"\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")\n    print()\nprint("빙고 0 줄")', 'mistake', 'bingo-noend'],
  ['unit12-review', 'bingo', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nwhile True:\n    답 = input()\n    if 답 == "끝":\n        break\n    for 줄 in range(3):\n        for 칸 in range(3):\n            if 판[줄][칸] == 답:\n                판[줄][칸] = "X"\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")\n    print()\n빙고 = 0\nfor 줄 in range(3):\n    개수 = 0\n    for 칸 in range(3):\n        if 판[줄][칸] == "X":\n            개수 += 1\n    if 개수 == 3:\n        빙고 += 1\nfor 칸 in range(3):\n    개수 = 0\n    for 줄 in range(3):\n        if 판[줄][칸] == "X":\n            개수 += 1\n    if 개수 == 3:\n        빙고 += 1\nprint("빙고", 빙고, "줄")', 'mistake', 'bingo-same'],
  ['unit12-review', 'bingo', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nwhile True:\n    답 = input()\n    if 답 == "끝":\n        break\n    수 = int(답)\n    for 줄 in range(3):\n        for 칸 in range(3):\n            if 판[줄][칸] == 수:\n                판[줄][칸] = "X"\nprint(판)', 'mistake', 'bingo-raw'],
  ['unit12-review', 'bingo', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nwhile True:\n    답 = input()\n    if 답 == "끝":\n        break\n    수 = int(답)\n    for 줄 in range(3):\n        for 칸 in range(3):\n            if 판[줄][칸] == 수:\n                판[줄][칸] = "X"\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")\n    print()\n', 'mistake', 'bingo-nocount'],
  ['unit12-review', 'bingo', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nwhile True:\n    답 = input()\n    if 답 == "끝":\n        break\n    수 = int(답)\n    for 줄 in range(3):\n        for 칸 in range(3):\n            if 판[줄][칸] == 수:\n                판[줄][칸] = "X"\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")\n    print()\n빙고 = 0\nfor 줄 in range(3):\n    개수 = 0\n    for 칸 in range(3):\n        if 판[줄][칸] == "X":\n            개수 += 1\n    if 개수 == 3:\n        빙고 += 1\nprint("빙고", 빙고, "줄")', 'mistake', 'bingo-cols'],
  ['unit12-review', 'bingo', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nwhile True:\n    답 = input()\n    if 답 == "끝":\n        break\n    수 = int(답)\n    for 줄 in range(3):\n        for 칸 in range(3):\n            if 판[줄][칸] == 수:\n                판[줄][칸] = "X"\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")\n    print()\n빙고 = 0\nfor 한줄 in 판:\n    빙고 += 한줄.count("X")\nprint("빙고", 빙고, "줄")', 'mistake', 'bingo-count'],
  ['unit12-review', 'bingo', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nwhile True:\n    답 = input()\n    if 답 == "끝":\n        break\n    수 = int(답)\n    for 줄 in range(3):\n        for 칸 in range(3):\n            if 판[줄][칸] == 수:\n                판[줄][칸] = "X"\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")\n    print()\n빙고 = 0\nfor 줄 in range(3):\n    개수 = 0\n    for 칸 in range(3):\n        if 판[줄][칸] == "X":\n            개수 += 1\n    if 개수 == 3:\n        빙고 += 1\nfor 칸 in range(3):\n    개수 = 0\n    for 줄 in range(3):\n        if 판[줄][칸] == "X":\n            개수 += 1\n    if 개수 == 3:\n        빙고 += 1\nif 판[0][0] == "X" and 판[1][1] == "X" and 판[2][2] == "X":\n    빙고 += 1\nprint("빙고", 빙고, "줄")', 'mistake', 'bingo-diag'],
  ['unit12-review', 'bingo', '판 = [[7, 2, 9],\n      [4, 5, 1],\n      [8, 3, 6]]\nwhile True:\n    답 = input()\n    if 답 == "끝":\n        break\n    수 = int(답)\n    for 줄 in range(3):\n        for 칸 in range(3):\n            if 판[줄][칸] == 수:\n                판[줄][칸] = "X"\nfor 한줄 in 판:\n    for 값 in 한줄:\n        print(값, end=" ")\n    print()\n빙고 = 0\nfor i in range(3):\n    if 판[i].count("X") == 3:\n        빙고 += 1\n    if 판[0][i] == "X" and 판[1][i] == "X" and 판[2][i] == "X":\n        빙고 += 1\nprint("빙고", 빙고, "줄")', 'correct'],
  // 거북이로 그리기 단원
  ['turtle-move', 'stairs', 'import turtle\nturtle.forward(40)\nturtle.right(90)\nturtle.forward(40)\nturtle.left(90)\nturtle.forward(40)\nturtle.right(90)\nturtle.forward(40)', 'mistake', 'stairs-down'],
  ['turtle-move', 'stairs', 'import turtle\nturtle.forward(40)\nturtle.left(90)\nturtle.forward(40)', 'draw-missing'],
  ['turtle-move', 'stairs', 'import turtle\n', 'draw-none'],
  ['turtle-move', 'stairs', 'import turtle\nturtle.forward(80)\nturtle.left(90)\nturtle.forward(80)\nturtle.right(90)\nturtle.forward(80)\nturtle.left(90)\nturtle.forward(80)', 'draw-size'],
  ['turtle-move', 'stairs', 'turtle.forward(40)', 'error'],
  ['turtle-move', 'stairs', 'import turtle\nturtle.foward(40)', 'error'],
  ['turtle-move', 'stairs', 'import turtle\nfor i in range(2):\n    turtle.forward(40)\n    turtle.left(90)\n    turtle.forward(40)\n    turtle.right(90)', 'correct'],
  ['turtle-move', 'plus', 'import turtle\nturtle.forward(50)\nturtle.backward(100)\nturtle.forward(50)\nturtle.left(90)\nturtle.forward(50)\nturtle.backward(100)', 'correct'],
  ['turtle-move', 'plus', 'import turtle\nfor i in range(4):\n    turtle.forward(50)\n    turtle.left(90)', 'draw-diff'],
  ['turtle-loop', 'hexagon', 'import turtle\nfor i in range(6):\n    turtle.forward(60)\n    turtle.left(120)', 'mistake', 'hex-inner'],
  ['turtle-loop', 'hexagon', 'import turtle\nturtle.forward(60)\nturtle.left(60)\nturtle.forward(60)\nturtle.left(60)\nturtle.forward(60)\nturtle.left(60)\nturtle.forward(60)\nturtle.left(60)\nturtle.forward(60)\nturtle.left(60)\nturtle.forward(60)\nturtle.left(60)', 'mistake', 'need-loop'],
  ['turtle-loop', 'hexagon', 'import turtle\nfor i in range(6):\n    turtle.forward(60)\n    turtle.right(60)', 'draw-mirror'],
  ['turtle-loop', 'hexagon', 'import turtle\nfor i in range(5):\n    turtle.forward(60)\n    turtle.left(60)', 'draw-missing'],
  ['turtle-loop', 'hexagon', 'import turtle\nfor i in range(6):\n    turtle.forward(60)\n    turtle.left(60)', 'correct'],
  ['turtle-loop', 'polygon', 'import turtle\n변 = int(input())\nfor i in range(3):\n    turtle.forward(50)\n    turtle.left(120)', 'mistake', 'poly-fixed'],
  ['turtle-loop', 'polygon', 'import turtle\n변 = input()\nfor i in range(변):\n    turtle.forward(50)\n    turtle.left(360 / 변)', 'error'],
  ['turtle-loop', 'polygon', 'import turtle\n변 = int(input())\n각 = 360 / 변\nfor i in range(변):\n    turtle.forward(50)\n    turtle.left(각)', 'correct'],
  ['turtle-pen', 'dash', 'import turtle\nfor i in range(5):\n    turtle.forward(20)\n    turtle.forward(20)', 'mistake', 'dash-solid'],
  ['turtle-pen', 'dash', 'import turtle\nfor i in range(5):\n    turtle.forward(20)\n    turtle.penup()\n    turtle.forward(20)', 'mistake', 'dash-once'],
  ['turtle-pen', 'dash', 'import turtle\nturtle.forward(20)\nturtle.penup()\nturtle.forward(20)\nturtle.pendown()\nturtle.forward(20)\nturtle.penup()\nturtle.forward(20)\nturtle.pendown()\nturtle.forward(20)\nturtle.penup()\nturtle.forward(20)\nturtle.pendown()\nturtle.forward(20)\nturtle.penup()\nturtle.forward(20)\nturtle.pendown()\nturtle.forward(20)', 'mistake', 'need-loop'],
  ['turtle-pen', 'dash', 'import turtle\nfor i in range(5):\n    turtle.pendown()\n    turtle.forward(20)\n    turtle.penup()\n    turtle.forward(20)', 'correct'],
  ['turtle-pen', 'two-color', 'import turtle\n색 = ["red", "blue"]\nfor i in range(6):\n    turtle.forward(20)\n    turtle.color(색[i % 2])\n    turtle.penup()\n    turtle.forward(10)\n    turtle.pendown()', 'mistake', 'two-late'],
  ['turtle-pen', 'two-color', 'import turtle\n색 = ["빨강", "파랑"]\nfor i in range(6):\n    turtle.color(색[i % 2])\n    turtle.forward(20)', 'error'],
  ['turtle-pen', 'two-color', 'import turtle\nfor i in range(3):\n    turtle.color("red")\n    turtle.forward(20)\n    turtle.penup()\n    turtle.forward(10)\n    turtle.pendown()\n    turtle.color("blue")\n    turtle.forward(20)\n    turtle.penup()\n    turtle.forward(10)\n    turtle.pendown()', 'correct'],
  ['turtle-def', 'three', 'import turtle\ndef 네모(크기):\n    for i in range(4):\n        turtle.forward(크기)\n        turtle.left(90)\nfor i in range(3):\n    네모(40)\n    turtle.forward(60)', 'mistake', 'three-joined'],
  ['turtle-def', 'three', 'import turtle\nfor i in range(3):\n    for j in range(4):\n        turtle.forward(40)\n        turtle.left(90)\n    turtle.penup()\n    turtle.forward(60)\n    turtle.pendown()', 'mistake', 'need-def'],
  ['turtle-def', 'three', 'import turtle\ndef 네모(크기):\n    for i in range(4):\n        turtle.forward(크기)\n        turtle.left(90)\n', 'draw-none'],
  ['turtle-def', 'three', 'import turtle\ndef 네모(크기):\n    for i in range(4):\n        turtle.forward(크기)\n        turtle.left(90)\nfor i in range(2):\n    네모(40)\n    turtle.penup()\n    turtle.forward(60)\n    turtle.pendown()', 'draw-missing'],
  ['turtle-def', 'three', 'import turtle\ndef 네모(크기):\n    for i in range(4):\n        turtle.forward(크기)\n        turtle.left(90)\n    turtle.penup()\n    turtle.forward(60)\n    turtle.pendown()\n네모(40)\n네모(40)\n네모(40)', 'correct'],
  ['turtle-def', 'flower', 'import turtle\ndef 세모(크기):\n    for i in range(3):\n        turtle.forward(크기)\n        turtle.left(120)\nfor i in range(12):\n    세모(80)\n    turtle.left(45)', 'draw-diff'],
  ['turtle-def', 'flower', 'import turtle\ndef 세모(크기):\n    for i in range(3):\n        turtle.forward(크기)\n        turtle.left(120)\nfor i in range(12):\n    세모(80)\n    turtle.left(30)', 'correct'],
  ['turtle-goto', 'tri-fill', 'import turtle\nturtle.goto(-60, -40)\nturtle.color("green")\nturtle.begin_fill()\nturtle.goto(60, -40)\nturtle.goto(0, 60)\nturtle.goto(-60, -40)\nturtle.end_fill()', 'mistake', 'tri-pen'],
  ['turtle-goto', 'tri-fill', 'import turtle\nturtle.penup()\nturtle.goto(-60, -40)\nturtle.pendown()\nturtle.color("green")\nturtle.goto(60, -40)\nturtle.goto(0, 60)\nturtle.goto(-60, -40)', 'mistake', 'tri-nofill'],
  ['turtle-goto', 'tri-fill', 'import turtle\nturtle.penup()\nturtle.goto(-60, -40)\nturtle.pendown()\nturtle.color("green")\nturtle.begin_fill()\nturtle.goto(60, -40)\nturtle.goto(0, 60)\nturtle.end_fill()', 'mistake', 'tri-open'],
  ['turtle-goto', 'tri-fill', 'import turtle\nturtle.penup()\nturtle.goto(-60 -40)\nturtle.pendown()', 'error'],
  ['turtle-goto', 'tri-fill', 'import turtle\nturtle.penup()\nturtle.goto(0, 60)\nturtle.pendown()\nturtle.color("green")\nturtle.begin_fill()\nturtle.goto(-60, -40)\nturtle.goto(60, -40)\nturtle.goto(0, 60)\nturtle.end_fill()', 'correct'],
  ['turtle-goto', 'target', 'import turtle\nfor 반지름 in [30, 60, 90]:\n    turtle.circle(반지름)', 'mistake', 'target-stack'],
  ['turtle-goto', 'target', 'import turtle\nfor 반지름 in [30, 60, 90]:\n    turtle.goto(0, -반지름)\n    turtle.circle(반지름)', 'mistake', 'target-joined'],
  ['turtle-goto', 'target', 'import turtle\nturtle.penup()\nturtle.goto(0, -30)\nturtle.pendown()\nturtle.circle(30)\nturtle.penup()\nturtle.goto(0, -60)\nturtle.pendown()\nturtle.circle(60)\nturtle.penup()\nturtle.goto(0, -90)\nturtle.pendown()\nturtle.circle(90)', 'correct'],
  ['unit13-review', 'stars', 'import turtle\ndef 별(크기):\n    for i in range(5):\n        turtle.forward(크기)\n        turtle.right(144)\nturtle.penup()\nturtle.goto(-170, 60)\nturtle.pendown()\n별(60)\nturtle.goto(-40, 60)\n별(120)', 'mistake', 'stars-joined'],
  ['unit13-review', 'stars', 'import turtle\nturtle.penup()\nturtle.goto(-170, 60)\nturtle.pendown()\nfor i in range(5):\n    turtle.forward(60)\n    turtle.right(144)\nturtle.penup()\nturtle.goto(-40, 60)\nturtle.pendown()\nfor i in range(5):\n    turtle.forward(120)\n    turtle.right(144)', 'mistake', 'need-def'],
  ['unit13-review', 'stars', 'import turtle\ndef 별(크기):\n    for i in range(5):\n        turtle.forward(크기)\n        turtle.right(72)\nturtle.penup()\nturtle.goto(-170, 60)\nturtle.pendown()\n별(60)\nturtle.penup()\nturtle.goto(-40, 60)\nturtle.pendown()\n별(120)', 'draw-diff'],
  ['unit13-review', 'house', 'import turtle\ndef 네모(x, y, 가로, 세로):\n    turtle.penup()\n    turtle.goto(x, y)\n    turtle.pendown()\n    for i in range(2):\n        turtle.forward(가로)\n        turtle.left(90)\n        turtle.forward(세로)\n        turtle.left(90)\n네모(-60, -80, 120, 100)\n네모(-15, -80, 30, 50)\nturtle.goto(-60, 20)\nturtle.color("red")\nturtle.begin_fill()\nturtle.goto(60, 20)\nturtle.goto(0, 90)\nturtle.goto(-60, 20)\nturtle.end_fill()', 'mistake', 'house-pen'],
  ['unit13-review', 'house', 'import turtle\ndef 네모(x, y, 가로, 세로):\n    turtle.penup()\n    turtle.goto(x, y)\n    turtle.pendown()\n    for i in range(2):\n        turtle.forward(가로)\n        turtle.left(90)\n        turtle.forward(세로)\n        turtle.left(90)\n네모(-60, -80, 120, 100)\n네모(-15, -80, 30, 50)\nturtle.penup()\nturtle.goto(-60, 20)\nturtle.pendown()\nturtle.color("red")\nturtle.goto(60, 20)\nturtle.goto(0, 90)\nturtle.goto(-60, 20)', 'mistake', 'house-fill'],
  ['unit13-review', 'house', 'import turtle\ndef 네모(x, y, 가로, 세로):\n    turtle.penup()\n    turtle.goto(x, y)\n    turtle.pendown()\n    for i in range(2):\n        turtle.forward(가로)\n        turtle.left(90)\n        turtle.forward(세로)\n        turtle.left(90)\n네모(-60, -80, 120, 100)\nturtle.penup()\nturtle.goto(-60, 20)\nturtle.pendown()\nturtle.color("red")\nturtle.begin_fill()\nturtle.goto(60, 20)\nturtle.goto(0, 90)\nturtle.goto(-60, 20)\nturtle.end_fill()', 'mistake', 'house-missing'],
  ['unit13-review', 'house', 'import turtle\nturtle.color("red")\nturtle.begin_fill()\ndef 네모(x, y, 가로, 세로):\n    turtle.penup()\n    turtle.goto(x, y)\n    turtle.pendown()\n    for i in range(2):\n        turtle.forward(가로)\n        turtle.left(90)\n        turtle.forward(세로)\n        turtle.left(90)\n네모(-60, -80, 120, 100)\n네모(-15, -80, 30, 50)\nturtle.end_fill()\nturtle.penup()\nturtle.goto(-60, 20)\nturtle.pendown()\nturtle.color("red")\nturtle.begin_fill()\nturtle.goto(60, 20)\nturtle.goto(0, 90)\nturtle.goto(-60, 20)\nturtle.end_fill()', 'mistake', 'house-fill'],
  ['unit13-review', 'house', 'import turtle\nturtle.penup()\nturtle.goto(-60, 20)\nturtle.pendown()\nturtle.color("red")\nturtle.begin_fill()\nturtle.goto(60, 20)\nturtle.goto(0, 90)\nturtle.goto(-60, 20)\nturtle.end_fill()\nturtle.color("black")\nturtle.goto(-60, -80)\nturtle.goto(60, -80)\nturtle.goto(60, 20)\nturtle.penup()\nturtle.goto(-15, -80)\nturtle.pendown()\nturtle.goto(-15, -30)\nturtle.goto(15, -30)\nturtle.goto(15, -80)', 'correct'],
  // 움직이는 그림과 게임 단원
  ['game-many', 'two', 'import turtle\n공 = turtle.Turtle()\n공.shape("circle")\n공.color("blue")\n공.penup()\n공.goto(100, 0)\n판 = turtle.Turtle()\n판.shape("square")\n판.color("red")\n판.penup()\n판.goto(-100, 0)', 'mistake', 'two-look'],
  ['game-many', 'two', 'import turtle\n공 = turtle.Turtle()\n공.shape("circle")\n공.color("red")\n공.penup()\n공.goto(0, 100)\n판 = turtle.Turtle()\n판.shape("square")\n판.color("blue")\n판.penup()\n판.goto(0, -100)', 'mistake', 'two-pos'],
  ['game-many', 'two', 'import turtle\n공 = turtle.Turtle()\n공.shape("circle")\n공.color("red")\n공.penup()\n공.goto(100, 0)', 'mistake', 'two-count'],
  ['game-many', 'two', 'import turtle\n공 = turtle.turtle()', 'error'],
  ['game-many', 'two', 'import turtle\n판 = turtle.Turtle()\n판.penup()\n판.shape("square")\n판.color("blue")\n판.setx(-100)\n공 = turtle.Turtle()\n공.penup()\n공.shape("circle")\n공.color("red")\n공.setx(100)', 'correct'],
  ['game-many', 'row', 'import turtle\nfor i in range(5):\n    공 = turtle.Turtle()\n    공.shape("circle")\n    공.penup()\n    공.goto(i * 50, 0)', 'game-pos'],
  ['game-many', 'row', 'import turtle\nfor x in [-100, -50, 0, 50, 100]:\n    공 = turtle.Turtle()\n    공.shape("circle")\n    공.penup()\n    공.setx(x)', 'correct'],
  ['game-loop', 'bounce', 'import turtle\nimport time\n공 = turtle.Turtle()\n공.shape("circle")\n공.penup()\nturtle.tracer(0)\ndy = 5\nwhile True:\n    공.sety(공.ycor() + dy)\n    if 공.ycor() > 150 or 공.ycor() < -150:\n        dy = -dy\n    turtle.update()', 'mistake', 'bounce-nosleep'],
  ['game-loop', 'bounce', 'import turtle\nimport time\n공 = turtle.Turtle()\n공.shape("circle")\n공.penup()\nturtle.tracer(0)\ndy = 5\nwhile True:\n    공.sety(공.ycor() + dy)\n    if 공.ycor() > 150 or 공.ycor() < -150:\n        dy = -dy\n    time.sleep(0.02)', 'mistake', 'bounce-noupdate'],
  ['game-loop', 'bounce', 'import turtle\nimport time\n공 = turtle.Turtle()\n공.shape("circle")\n공.penup()\nturtle.tracer(0)\ndy = 5\nwhile True:\n    공.sety(공.ycor() + dy)\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'bounce-pos'],
  ['game-loop', 'bounce', 'import turtle\nimport time\n공 = turtle.Turtle()\n공.shape("circle")\n공.penup()\nturtle.tracer(0)\ndy = 5\nwhile True:\n    공.sety(공.ycor() + dy)\n    if 공.ycor() > 150:\n        dy = 0\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'bounce-pos'],
  ['game-loop', 'bounce', 'import turtle\nimport time\n공 = turtle.Turtle()\n공.shape("circle")\n공.penup()\nturtle.tracer(0)\ndy = 5\nwhile True:\n    공.goto(0, 공.ycor() + dy)\n    if 공.ycor() > 150:\n        dy = -5\n    if 공.ycor() < -150:\n        dy = 5\n    turtle.update()\n    time.sleep(0.02)', 'correct'],
  ['game-loop', 'both', 'import turtle\nimport time\n공 = turtle.Turtle()\n공.shape("circle")\n공.penup()\nturtle.tracer(0)\ndx = 6\ndy = 4\nwhile True:\n    공.setx(공.xcor() + dx)\n    공.sety(공.ycor() + dy)\n    if 공.xcor() > 220 or 공.xcor() < -220 or 공.ycor() > 160 or 공.ycor() < -160:\n        dx = -dx\n        dy = -dy\n    turtle.update()\n    time.sleep(0.02)', 'game-pos'],
  ['game-key', 'four', 'import turtle\n공 = turtle.Turtle()\n공.shape("turtle")\n공.penup()\ndef 오른쪽():\n    공.setx(공.xcor() + 20)\ndef 왼쪽():\n    공.setx(공.xcor() - 20)\ndef 위():\n    공.sety(공.ycor() + 20)\ndef 아래():\n    공.sety(공.ycor() - 20)\nturtle.onkeypress(오른쪽, "Right")\nturtle.onkeypress(왼쪽, "Left")\nturtle.onkeypress(위, "Up")\nturtle.onkeypress(아래, "Down")\nturtle.done()', 'mistake', 'four-nolisten'],
  ['game-key', 'four', 'import turtle\n공 = turtle.Turtle()\n공.shape("turtle")\n공.penup()\ndef 오른쪽():\n    공.setx(공.xcor() + 20)\ndef 왼쪽():\n    공.setx(공.xcor() - 20)\ndef 위():\n    공.sety(공.ycor() + 20)\ndef 아래():\n    공.sety(공.ycor() - 20)\nturtle.onkeypress(오른쪽, "Right")\nturtle.onkeypress(왼쪽, "Left")\nturtle.onkeypress(아래, "Up")\nturtle.onkeypress(위, "Down")\nturtle.listen()\nturtle.done()', 'mistake', 'four-pos'],
  ['game-key', 'four', 'import turtle\n공 = turtle.Turtle()\n공.shape("turtle")\n공.penup()\ndef 오른쪽():\n    공.setx(공.xcor() + 20)\ndef 왼쪽():\n    공.setx(공.xcor() - 20)\ndef 위():\n    공.sety(공.ycor() + 20)\ndef 아래():\n    공.sety(공.ycor() - 20)\nturtle.onkeypress(오른쪽(), "Right")\nturtle.listen()', 'error'],
  ['game-key', 'four', 'import turtle\n공 = turtle.Turtle()\n공.shape("turtle")\n공.penup()\ndef 오른쪽():\n    공.setx(공.xcor() + 20)\ndef 왼쪽():\n    공.setx(공.xcor() - 20)\ndef 위():\n    공.sety(공.ycor() + 20)\ndef 아래():\n    공.sety(공.ycor() - 20)\nturtle.onkeypress(오른쪽, "right")\nturtle.listen()', 'error'],
  ['game-key', 'four', 'import turtle\n공 = turtle.Turtle()\n공.shape("turtle")\n공.penup()\ndef 오른쪽():\n    공.setx(공.xcor() + 20)\ndef 왼쪽():\n    공.setx(공.xcor() - 20)\ndef 위():\n    공.sety(공.ycor() + 20)\ndef 아래():\n    공.sety(공.ycor() - 20)\nturtle.onkeypress(오른쪽, "Right")\nturtle.onkeypress(왼쪽, "Left")\nturtle.onkeypress(위, "Up")\nturtle.onkeypress(아래, "Down")\nturtle.listen()', 'correct'],
  ['game-key', 'wall', 'import turtle\n공 = turtle.Turtle()\n공.shape("turtle")\n공.penup()\n공.setx(160)\ndef 오른쪽():\n    공.setx(공.xcor() + 20)\ndef 왼쪽():\n    공.setx(공.xcor() - 20)\nturtle.onkeypress(오른쪽, "Right")\nturtle.onkeypress(왼쪽, "Left")\nturtle.listen()\nturtle.done()', 'mistake', 'wall-out'],
  ['game-touch', 'eat', 'import turtle\nimport time\nimport random\nturtle.tracer(0)\n공 = turtle.Turtle()\n공.shape("turtle")\n공.penup()\n먹이 = turtle.Turtle()\n먹이.shape("circle")\n먹이.color("red")\n먹이.penup()\n먹이.goto(100, 0)\n판 = turtle.Turtle()\n판.hideturtle()\n판.penup()\n판.goto(-220, 140)\n점수 = 0\ndef 오른쪽():\n    공.setx(공.xcor() + 20)\ndef 왼쪽():\n    공.setx(공.xcor() - 20)\nturtle.onkeypress(오른쪽, "Right")\nturtle.onkeypress(왼쪽, "Left")\nturtle.listen()\nwhile True:\n    if 공.distance(먹이) < 20:\n        먹이.setx(random.randint(-10, 10) * 20)\n    판.clear()\n    판.write("점수: " + str(점수))\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'eat-text'],
  ['game-touch', 'eat', 'import turtle\nimport time\nimport random\nturtle.tracer(0)\n공 = turtle.Turtle()\n공.shape("turtle")\n공.penup()\n먹이 = turtle.Turtle()\n먹이.shape("circle")\n먹이.color("red")\n먹이.penup()\n먹이.goto(100, 0)\n판 = turtle.Turtle()\n판.hideturtle()\n판.penup()\n판.goto(-220, 140)\n점수 = 0\ndef 오른쪽():\n    공.setx(공.xcor() + 20)\ndef 왼쪽():\n    공.setx(공.xcor() - 20)\nturtle.onkeypress(오른쪽, "Right")\nturtle.onkeypress(왼쪽, "Left")\nturtle.listen()\nwhile True:\n    if 공.distance(먹이) < 20:\n        점수 += 1\n    판.clear()\n    판.write("점수: " + str(점수))\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'eat-pos'],
  ['game-touch', 'eat', 'import turtle\nimport time\nimport random\nturtle.tracer(0)\n공 = turtle.Turtle()\n공.shape("turtle")\n공.penup()\n먹이 = turtle.Turtle()\n먹이.shape("circle")\n먹이.color("red")\n먹이.penup()\n먹이.goto(100, 0)\n판 = turtle.Turtle()\n판.hideturtle()\n판.penup()\n판.goto(-220, 140)\n점수 = 0\ndef 오른쪽():\n    공.setx(공.xcor() + 20)\ndef 왼쪽():\n    공.setx(공.xcor() - 20)\nturtle.onkeypress(오른쪽, "Right")\nturtle.onkeypress(왼쪽, "Left")\nturtle.listen()\nwhile True:\n    if 공.distance(먹이) < 20:\n        점수 += 1\n        먹이.setx(random.randint(-10, 10) * 20)\n    판.clear()\n    판.write("점수: " + 점수)\n    turtle.update()\n    time.sleep(0.02)', 'error'],
  ['game-touch', 'eat', 'import turtle\nimport time\nimport random\nturtle.tracer(0)\n공 = turtle.Turtle()\n공.shape("turtle")\n공.penup()\n먹이 = turtle.Turtle()\n먹이.shape("circle")\n먹이.color("red")\n먹이.penup()\n먹이.goto(100, 0)\n판 = turtle.Turtle()\n판.hideturtle()\n판.penup()\n판.goto(-220, 140)\n점수 = 0\ndef 오른쪽():\n    공.setx(공.xcor() + 20)\ndef 왼쪽():\n    공.setx(공.xcor() - 20)\nturtle.onkeypress(오른쪽, "Right")\nturtle.onkeypress(왼쪽, "Left")\nturtle.listen()\nwhile True:\n    if 공.distance(먹이) < 20:\n        점수 = 점수 + 1\n        먹이.goto(random.randint(-10, 10) * 20, 0)\n    판.clear()\n    판.write("점수: " + str(점수))\n    turtle.update()\n    time.sleep(0.02)', 'correct'],
  ['game-list', 'rain', 'import turtle\nimport time\nturtle.tracer(0)\n별들 = []\nfor i in range(3):\n    별 = turtle.Turtle()\n    별.shape("circle")\n    별.color("gold")\n    별.penup()\n    별.goto(i * 100 - 100, 150)\n    별들.append(별)\nwhile True:\n    for 별 in 별들:\n        별.sety(별.ycor() - 3)\n        if 별.ycor() < -150:\n            별.sety(150)\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'rain-same'],
  ['game-list', 'rain', 'import turtle\nimport time\nturtle.tracer(0)\n별들 = []\nfor i in range(3):\n    별 = turtle.Turtle()\n    별.shape("circle")\n    별.color("gold")\n    별.penup()\n    별.goto(i * 100 - 100, 150)\n    별들.append(별)\nwhile True:\n    for i in range(3):\n        별들[i].sety(별들[i].ycor() - (i + 2))\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'rain-pos'],
  ['game-list', 'rain', 'import turtle\nimport time\nturtle.tracer(0)\n별들 = []\nfor i in range(3):\n    별 = turtle.Turtle()\n    별.shape("circle")\n    별.color("gold")\n    별.penup()\n    별.goto(i * 100 - 100, 150)\n    별들.append(별)\nwhile True:\n    별들.sety(-3)\n    turtle.update()\n    time.sleep(0.02)', 'error'],
  ['unit14-review', 'jump', 'import turtle\n공 = turtle.Turtle()\n공.shape("turtle")\n공.penup()\ndef 뛰기():\n    공.sety(공.ycor() + 30)\ndef 내리기():\n    공.sety(공.ycor() - 30)\nturtle.onkeypress(뛰기, "space")\nturtle.onkeypress(내리기, "Down")\nturtle.listen()\nturtle.done()', 'mistake', 'jump-floor'],
  ['unit14-review', 'jump', 'import turtle\n공 = turtle.Turtle()\n공.shape("turtle")\n공.penup()\ndef 뛰기():\n    공.sety(공.ycor() + 30)\ndef 내리기():\n    if 공.ycor() > 0:\n        공.sety(공.ycor() - 30)\nturtle.onkeypress(뛰기, "space")\nturtle.onkeypress(내리기, "Down")\nturtle.done()', 'mistake', 'jump-nolisten'],
  ['unit14-review', 'star', 'import turtle\nimport time\nimport random\nturtle.tracer(0)\n바구니 = turtle.Turtle()\n바구니.shape("square")\n바구니.shapesize(1, 4)\n바구니.color("blue")\n바구니.penup()\n바구니.goto(0, -150)\n별 = turtle.Turtle()\n별.shape("circle")\n별.color("gold")\n별.penup()\n별.goto(0, 160)\n판 = turtle.Turtle()\n판.hideturtle()\n판.penup()\n판.goto(-220, 140)\n점수 = 0\ndef 왼쪽():\n    바구니.setx(바구니.xcor() - 20)\ndef 오른쪽():\n    바구니.setx(바구니.xcor() + 20)\nturtle.onkeypress(왼쪽, "Left")\nturtle.onkeypress(오른쪽, "Right")\nwhile True:\n    별.sety(별.ycor() - 5)\n    if 별.distance(바구니) < 40:\n        점수 += 1\n        별.goto(random.randint(-10, 10) * 20, 160)\n    판.clear()\n    판.write("점수: " + str(점수))\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'star-nolisten'],
  ['unit14-review', 'star', 'import turtle\nimport time\nimport random\nturtle.tracer(0)\n바구니 = turtle.Turtle()\n바구니.shape("square")\n바구니.shapesize(1, 4)\n바구니.color("blue")\n바구니.penup()\n바구니.goto(0, -150)\n별 = turtle.Turtle()\n별.shape("circle")\n별.color("gold")\n별.penup()\n별.goto(0, 160)\n판 = turtle.Turtle()\n판.hideturtle()\n판.penup()\n판.goto(-220, 140)\n점수 = 0\ndef 왼쪽():\n    바구니.setx(바구니.xcor() - 20)\ndef 오른쪽():\n    바구니.setx(바구니.xcor() + 20)\nturtle.onkeypress(왼쪽, "Left")\nturtle.onkeypress(오른쪽, "Right")\nturtle.listen()\nwhile True:\n    별.sety(별.ycor() - 5)\n    if 별.distance(바구니) < 40:\n        별.goto(random.randint(-10, 10) * 20, 160)\n    판.clear()\n    if 별.ycor() < -170:\n        판.write("끝! 점수: " + str(점수))\n        turtle.update()\n        break\n    판.write("점수: " + str(점수))\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'star-text'],
  ['unit14-review', 'star', 'import turtle\nimport time\nimport random\nturtle.tracer(0)\n바구니 = turtle.Turtle()\n바구니.shape("square")\n바구니.shapesize(1, 4)\n바구니.color("blue")\n바구니.penup()\n바구니.goto(0, -150)\n별 = turtle.Turtle()\n별.shape("circle")\n별.color("gold")\n별.penup()\n별.goto(0, 160)\n판 = turtle.Turtle()\n판.hideturtle()\n판.penup()\n판.goto(-220, 140)\n점수 = 0\ndef 왼쪽():\n    바구니.setx(바구니.xcor() - 20)\ndef 오른쪽():\n    바구니.setx(바구니.xcor() + 20)\nturtle.onkeypress(왼쪽, "Left")\nturtle.onkeypress(오른쪽, "Right")\nturtle.listen()\nwhile True:\n    별.sety(별.ycor() - 5)\n    if 별.distance(바구니) < 40:\n        점수 += 1\n        별.goto(random.randint(-10, 10) * 20, 160)\n    판.clear()\n    판.write("점수: " + str(점수))\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'star-pos'],
  ['unit14-review', 'star', 'import turtle\nimport time\nimport random\nturtle.tracer(0)\n바구니 = turtle.Turtle()\n바구니.shape("square")\n바구니.shapesize(1, 4)\n바구니.color("blue")\n바구니.penup()\n바구니.goto(0, -150)\n별 = turtle.Turtle()\n별.shape("circle")\n별.color("gold")\n별.penup()\n별.goto(0, 160)\n판 = turtle.Turtle()\n판.hideturtle()\n판.penup()\n판.goto(-220, 140)\n점수 = 0\ndef 왼쪽():\n    바구니.setx(바구니.xcor() - 20)\ndef 오른쪽():\n    바구니.setx(바구니.xcor() + 20)\nturtle.onkeypress(왼쪽, "Left")\nturtle.onkeypress(오른쪽, "Right")\nturtle.listen()\nwhile True:\n    별.sety(별.ycor() - 3)\n    판.clear()\n    판.write("점수: " + str(점수))\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'star-pos'],
  // 클래스 단원
  ['class-basic', 'card', 'class 학생:\n    pass\nprint("민수 90")\nprint("지아 85")\nprint(90 + 85)', 'mistake', 'need-object'],
  ['class-basic', 'card', 'class 학생:\n    pass\n가 = 학생()\n가.이름 = "민수"\n가.점수 = 90\n나 = 학생()\n나.이름 = "지아"\n나.점수 = 85\nprint(가.이름, 가.점수)\nprint(나.이름, 나.점수)', 'mistake', 'card-nosum'],
  ['class-basic', 'card', 'class 학생:\n    pass\n가 = 학생()\n가.이름 = "민수"\n가.점수 = "90"\n나 = 학생()\n나.이름 = "지아"\n나.점수 = "85"\nprint(가.이름, 가.점수)\nprint(나.이름, 나.점수)\nprint(가.점수 + 나.점수)', 'mistake', 'card-join'],
  ['class-basic', 'card', 'class 학생:\n    pass\n가 = 학생()\n가.이름 = "민수"\nprint(가.이름, 가.점수)', 'error'],
  ['class-basic', 'card', 'class 학생:\n    pass\n반 = []\nfor 이름 in ["민수", "지아"]:\n    한명 = 학생()\n    한명.이름 = 이름\n    반.append(한명)\n반[0].점수 = 90\n반[1].점수 = 85\nfor 한명 in 반:\n    print(한명.이름, 한명.점수)\nprint(반[0].점수 + 반[1].점수)', 'correct'],
  ['class-basic', 'raise', 'class 학생:\n    pass\n가 = 학생()\n가.이름 = "민수"\n가.점수 = 90\n나 = 학생()\n나.이름 = "지아"\n나.점수 = 85\n누구 = input()\nprint(가.이름, 가.점수)\nprint(나.이름, 나.점수)', 'mistake', 'raise-same'],
  ['class-basic', 'raise', 'class 학생:\n    pass\n가 = 학생()\n가.이름 = "민수"\n가.점수 = 90\n나 = 학생()\n나.이름 = "지아"\n나.점수 = 85\n누구 = input()\n가.점수 += 10\n나.점수 += 10\nprint(가.이름, 가.점수)\nprint(나.이름, 나.점수)', 'mistake', 'raise-both'],
  ['class-basic', 'raise', 'class 학생:\n    pass\n가 = 학생()\n가.이름 = "민수"\n가.점수 = 90\n나 = 학생()\n나.이름 = "지아"\n나.점수 = 85\n누구 = input()\nif 가.이름 == 누구:\n    가.점수 = 가.점수 + 10\nif 나.이름 == 누구:\n    나.점수 = 나.점수 + 10\nprint(가.이름, 가.점수)\nprint(나.이름, 나.점수)', 'correct'],
  ['class-init', 'book', 'print("모험 120")\nprint("우주 80")\nprint(200)', 'mistake', 'need-init'],
  ['class-init', 'book', 'class 책:\n    def _init_(self, 제목, 쪽수):\n        self.제목 = 제목\n        self.쪽수 = 쪽수\n\n가 = 책("모험", 120)\n나 = 책("우주", 80)\nprint(가.제목, 가.쪽수)\nprint(나.제목, 나.쪽수)\nprint(가.쪽수 + 나.쪽수)', 'error'],
  ['class-init', 'book', 'class 책:\n    def __init__(self, 제목, 쪽수):\n        제목 = 제목\n        쪽수 = 쪽수\n\n가 = 책("모험", 120)\n나 = 책("우주", 80)\nprint(가.제목, 가.쪽수)\nprint(나.제목, 나.쪽수)\nprint(가.쪽수 + 나.쪽수)', 'error'],
  ['class-init', 'book', 'class 책:\n    def __init__(제목, 쪽수):\n        self.제목 = 제목\n        self.쪽수 = 쪽수\n\n가 = 책("모험", 120)\n나 = 책("우주", 80)\nprint(가.제목, 가.쪽수)\nprint(나.제목, 나.쪽수)\nprint(가.쪽수 + 나.쪽수)', 'error'],
  ['class-init', 'book', 'class 책:\n    def __init__(self, a, b):\n        self.쪽수 = b\n        self.제목 = a\n\n가 = 책("모험", 120)\n나 = 책("우주", 80)\nprint(가.제목, 가.쪽수)\nprint(나.제목, 나.쪽수)\nprint(가.쪽수 + 나.쪽수)', 'correct'],
  ['class-init', 'age', 'class 사람:\n    def __init__(self, 이름, 나이):\n        self.이름 = 이름\n        self.나이 = 나이\n이름 = input()\n나이 = int(input())\n가 = 사람(이름, 나이)\nprint(가.이름, 가.나이)', 'mistake', 'age-same'],
  ['class-init', 'age', 'class 사람:\n    def __init__(self, 이름, 나이):\n        self.이름 = 이름\n        self.나이 = 나이\n이름 = input()\n나이 = input()\n가 = 사람(이름, 나이)\n가.나이 += 1\nprint(가.이름, 가.나이)', 'error'],
  ['class-init', 'age', 'class 사람:\n    def __init__(self, 이름, 나이):\n        self.이름 = 이름\n        self.나이 = 나이\n가 = 사람(input(), int(input()) + 1)\nprint(가.이름, 가.나이)', 'correct'],
  ['class-method', 'bank', 'class 저금통:\n    def __init__(self):\n        self.돈 = 0\n    def 넣기(self, 얼마):\n        self.돈 += 얼마\n    def 꺼내기(self, 얼마):\n        self.돈 -= 얼마\n\n통 = 저금통()\n통.넣기(1000)\n통.넣기(500)\n통.꺼내기(700)\n통.꺼내기(2000)\nprint(통.돈)', 'mistake', 'bank-minus'],
  ['class-method', 'bank', 'class 저금통:\n    def __init__(self):\n        self.돈 = 0\n    def 넣기(self, 얼마):\n        self.돈 += 얼마\n    def 꺼내기(self, 얼마):\n        if 얼마 <= self.돈:\n            self.돈 -= 얼마\n\n통 = 저금통()\n통.넣기(1000)\n통.넣기(500)\n통.꺼내기(700)\n통.꺼내기(2000)\nprint(통.돈)', 'mistake', 'bank-nosay'],
  ['class-method', 'bank', 'class 저금통:\n    def __init__(self):\n        self.돈 = 0\n    def 넣기(self, 얼마):\n        self.돈 += 얼마\n    def 꺼내기(self, 얼마):\n        if 얼마 > self.돈:\n            print("모자라요")\n        self.돈 -= 얼마\n\n통 = 저금통()\n통.넣기(1000)\n통.넣기(500)\n통.꺼내기(700)\n통.꺼내기(2000)\nprint(통.돈)', 'mistake', 'bank-took'],
  ['class-method', 'bank', 'class 저금통:\n    def __init__(self):\n        self.돈 = 0\n    def 넣기(얼마):\n        self.돈 += 얼마\n    def 꺼내기(얼마):\n        self.돈 -= 얼마\n\n통 = 저금통()\n통.넣기(1000)\n통.넣기(500)\n통.꺼내기(700)\n통.꺼내기(2000)\nprint(통.돈)', 'error'],
  ['class-method', 'bank', 'class 저금통:\n    def __init__(self):\n        self.돈 = 0\n    def 넣기(self, 얼마):\n        돈 += 얼마\n    def 꺼내기(self, 얼마):\n        돈 -= 얼마\n\n통 = 저금통()\n통.넣기(1000)\n통.넣기(500)\n통.꺼내기(700)\n통.꺼내기(2000)\nprint(통.돈)', 'error'],
  ['class-method', 'bank', 'class 저금통:\n    def __init__(self):\n        self.돈 = 0\n    def 꺼내기(self, 돈):\n        if self.돈 >= 돈:\n            self.돈 = self.돈 - 돈\n        else:\n            print("모자라요")\n    def 넣기(self, 돈):\n        self.돈 = self.돈 + 돈\n\n통 = 저금통()\n통.넣기(1000)\n통.넣기(500)\n통.꺼내기(700)\n통.꺼내기(2000)\nprint(통.돈)', 'correct'],
  ['class-method', 'avg', 'class 학생:\n    def __init__(self, 이름):\n        self.이름 = 이름\n        self.점수들 = []\n    def 더하기(self, 점수):\n        self.점수들.append(점수)\n    def 평균(self):\n        return sum(self.점수들)\n\n가 = 학생("민수")\n가.더하기(90)\n가.더하기(80)\n가.더하기(70)\nprint(가.이름, 가.평균())', 'mistake', 'avg-sum'],
  ['class-method', 'avg', 'class 학생:\n    def __init__(self, 이름):\n        self.이름 = 이름\n        self.합 = 0\n        self.수 = 0\n    def 더하기(self, 점수):\n        self.합 += 점수\n        self.수 += 1\n    def 평균(self):\n        return self.합 / self.수\n\n가 = 학생("민수")\n가.더하기(90)\n가.더하기(80)\n가.더하기(70)\nprint(가.이름, 가.평균())', 'correct'],
  ['class-list', 'pass', 'class 학생:\n    def __init__(self, 이름, 점수):\n        self.이름 = 이름\n        self.점수 = 점수\n반 = [학생("민수", 70), 학생("지아", 95), 학생("하준", 80), 학생("서연", 60)]\n기준 = int(input())\n수 = 0\nfor 한명 in 반:\n    print(한명.이름)\n    수 += 1\nprint(수, "명")', 'mistake', 'pass-all'],
  ['class-list', 'pass', 'class 학생:\n    def __init__(self, 이름, 점수):\n        self.이름 = 이름\n        self.점수 = 점수\n반 = [학생("민수", 70), 학생("지아", 95), 학생("하준", 80), 학생("서연", 60)]\n기준 = int(input())\nfor 한명 in 반:\n    if 한명.점수 >= 기준:\n        print(한명.이름)', 'mistake', 'pass-nocount'],
  ['class-list', 'pass', 'class 학생:\n    def __init__(self, 이름, 점수):\n        self.이름 = 이름\n        self.점수 = 점수\n반 = [학생("민수", 70), 학생("지아", 95), 학생("하준", 80), 학생("서연", 60)]\n기준 = int(input())\n수 = 0\nfor 한명 in 반:\n    if 한명.점수 >= 기준:\n        print(한명.점수)\n        수 += 1\nprint(수, "명")', 'mistake', 'pass-score'],
  ['class-list', 'pass', 'class 학생:\n    def __init__(self, 이름, 점수):\n        self.이름 = 이름\n        self.점수 = 점수\n반 = [학생("민수", 70), 학생("지아", 95), 학생("하준", 80), 학생("서연", 60)]\n기준 = int(input())\n수 = 0\nfor 한명 in 반:\n    if 반.점수 >= 기준:\n        print(반.이름)\n        수 += 1\nprint(수, "명")', 'error'],
  ['class-list', 'pass', 'class 학생:\n    def __init__(self, 이름, 점수):\n        self.이름 = 이름\n        self.점수 = 점수\n반 = [학생("민수", 70), 학생("지아", 95), 학생("하준", 80), 학생("서연", 60)]\n기준 = int(input())\n수 = 0\nfor i in range(len(반)):\n    if 반[i].점수 >= 기준:\n        print(반[i].이름)\n        수 = 수 + 1\nprint(수, "명")', 'correct'],
  ['class-list', 'top', 'class 학생:\n    def __init__(self, 이름, 점수):\n        self.이름 = 이름\n        self.점수 = 점수\n    def 올리기(self, 얼마):\n        self.점수 += 얼마\n반 = [학생("민수", 70), 학생("지아", 95), 학생("하준", 80), 학생("서연", 60)]\n누구 = input()\n으뜸 = 반[0]\nfor 한명 in 반:\n    if 한명.점수 > 으뜸.점수:\n        으뜸 = 한명\nprint(으뜸.이름, 으뜸.점수)', 'mistake', 'top-noraise'],
  ['class-list', 'top', 'class 학생:\n    def __init__(self, 이름, 점수):\n        self.이름 = 이름\n        self.점수 = 점수\n    def 올리기(self, 얼마):\n        self.점수 += 얼마\n반 = [학생("민수", 70), 학생("지아", 95), 학생("하준", 80), 학생("서연", 60)]\n누구 = input()\nfor 한명 in 반:\n    if 한명.이름 == 누구:\n        한명.올리기(20)\n으뜸 = 반[0]\nprint(으뜸.이름, 으뜸.점수)', 'mistake', 'top-first'],
  ['class-list', 'top', 'class 학생:\n    def __init__(self, 이름, 점수):\n        self.이름 = 이름\n        self.점수 = 점수\n    def 올리기(self, 얼마):\n        self.점수 += 얼마\n반 = [학생("민수", 70), 학생("지아", 95), 학생("하준", 80), 학생("서연", 60)]\n누구 = input()\n으뜸 = 반[0]\nfor 한명 in 반:\n    if 한명.이름 == 누구:\n        한명.점수 += 20\n    if 한명.점수 > 으뜸.점수:\n        으뜸 = 한명\nprint(으뜸.이름, 으뜸.점수)', 'correct'],
  ['class-move', 'three', 'import turtle\nimport time\nturtle.tracer(0)\nclass 공:\n    def __init__(self, y, dx):\n        self.몸 = turtle.Turtle()\n        self.몸.shape("circle")\n        self.몸.penup()\n        self.몸.sety(y)\n        self.dx = dx\n    def 움직이기(self):\n        self.몸.setx(self.몸.xcor() + self.dx)\n\n공들 = [공(100, 2), 공(0, 4), 공(-100, -6)]\nwhile True:\n    for 한개 in 공들:\n        한개.움직이기()\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'three-nobounce'],
  ['class-move', 'three', 'import turtle\nimport time\nturtle.tracer(0)\nclass 공:\n    def __init__(self, y, dx):\n        self.몸 = turtle.Turtle()\n        self.몸.shape("circle")\n        self.몸.penup()\n        self.몸.sety(y)\n        self.dx = dx\n    def 움직이기(self):\n        self.몸.setx(self.몸.xcor() + self.dx)\n        if self.몸.xcor() > 220 or self.몸.xcor() < -220:\n            self.dx = -self.dx\n\n공들 = [공(100, 2), 공(0, 4), 공(-100, -6)]\nwhile True:\n    for 한개 in 공들:\n        한개.움직이기()\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'three-pos'],
  ['class-move', 'three', 'import turtle\nimport time\nturtle.tracer(0)\nclass 공:\n    def __init__(self, y, dx):\n        self.몸 = turtle.Turtle()\n        self.몸.shape("circle")\n        self.몸.penup()\n        self.몸.sety(y)\n        self.dx = dx\n    def 움직이기(self):\n        self.몸.setx(self.몸.xcor() + dx)\n        if self.몸.xcor() > 200 or self.몸.xcor() < -200:\n            dx = -dx\n\n공들 = [공(100, 2), 공(0, 4), 공(-100, -6)]\nwhile True:\n    for 한개 in 공들:\n        한개.움직이기()\n    turtle.update()\n    time.sleep(0.02)', 'error'],
  ['class-move', 'three', 'import turtle\nimport time\nturtle.tracer(0)\nclass 공:\n    def __init__(self, y, dx):\n        self.몸 = turtle.Turtle()\n        self.몸.shape("circle")\n        self.몸.penup()\n        self.몸.sety(y)\n        self.dx = dx\n    def 움직이기():\n        self.몸.setx(self.몸.xcor() + self.dx)\n\n공들 = [공(100, 2), 공(0, 4), 공(-100, -6)]\nwhile True:\n    for 한개 in 공들:\n        한개.움직이기()\n    turtle.update()\n    time.sleep(0.02)', 'error'],
  ['class-move', 'three', 'import turtle\nimport time\nturtle.tracer(0)\nclass 공:\n    def __init__(self, y, dx):\n        self.몸 = turtle.Turtle()\n        self.몸.shape("circle")\n        self.몸.penup()\n        self.몸.sety(y)\n        self.dx = dx\n    def 움직이기(self):\n        self.몸.forward(self.dx)\n        if self.몸.xcor() > 200:\n            self.dx = -self.dx\n        if self.몸.xcor() < -200:\n            self.dx = -self.dx\n\n공들 = [공(100, 2), 공(0, 4), 공(-100, -6)]\nwhile True:\n    for i in range(3):\n        공들[i].움직이기()\n    turtle.update()\n    time.sleep(0.02)', 'correct'],
  ['class-move', 'both', 'import turtle\nimport time\nturtle.tracer(0)\nclass 공:\n    def __init__(self, dx, dy):\n        self.몸 = turtle.Turtle()\n        self.몸.shape("circle")\n        self.몸.penup()\n        self.dx = dx\n        self.dy = dy\n    def 움직이기(self):\n        self.몸.setx(self.몸.xcor() + self.dx)\n        self.몸.sety(self.몸.ycor() + self.dy)\n        if self.몸.xcor() > 220 or self.몸.xcor() < -220 or self.몸.ycor() > 160 or self.몸.ycor() < -160:\n            self.dx = -self.dx\n            self.dy = -self.dy\n\n공들 = [공(5, 3), 공(-4, 6)]\nwhile True:\n    for 한개 in 공들:\n        한개.움직이기()\n    turtle.update()\n    time.sleep(0.02)', 'mistake', 'both-pos'],
  ['class-move', 'both', 'import turtle\nimport time\nturtle.tracer(0)\nclass 공:\n    def __init__(self, dx, dy):\n        self.몸 = turtle.Turtle()\n        self.몸.shape("circle")\n        self.몸.penup()\n        self.dx = dx\n        self.dy = dy\n    def 움직이기(self):\n        self.몸.goto(self.몸.xcor() + self.dx, self.몸.ycor() + self.dy)\n        if self.몸.xcor() > 220 or self.몸.xcor() < -220:\n            self.dx = -self.dx\n        if self.몸.ycor() > 160 or self.몸.ycor() < -160:\n            self.dy = -self.dy\n\n공들 = [공(5, 3), 공(-4, 6)]\nwhile True:\n    for 한개 in 공들:\n        한개.움직이기()\n    turtle.update()\n    time.sleep(0.02)', 'correct'],
  ['unit15-review', 'board', 'class 점수판:\n    def __init__(self):\n        self.점수 = 0\n        self.목숨 = 3\n    def 맞음(self):\n        self.점수 += 1\n    def 틀림(self):\n        self.목숨 -= 1\n    def 끝났나(self):\n        self.목숨 == 0\n\n판 = 점수판()\n판.맞음()\n판.맞음()\n판.틀림()\nprint(판.점수, 판.목숨)\n판.틀림()\n판.틀림()\nprint(판.끝났나())', 'mistake', 'board-none'],
  ['unit15-review', 'board', 'class 점수판:\n    def __init__(self):\n        self.점수 = 0\n        self.목숨 = 5\n    def 맞음(self):\n        self.점수 += 1\n    def 틀림(self):\n        self.목숨 -= 1\n    def 끝났나(self):\n        return self.목숨 == 0\n\n판 = 점수판()\n판.맞음()\n판.맞음()\n판.틀림()\nprint(판.점수, 판.목숨)\n판.틀림()\n판.틀림()\nprint(판.끝났나())', 'mistake', 'board-start'],
  ['unit15-review', 'board', 'class 점수판:\n    def __init__(self):\n        self.점수 = 0\n        self.목숨 = 3\n    def 맞음(self):\n        self.점수 += 1\n    def 틀림(self):\n        self.목숨 -= 1\n    def 끝났나(self):\n        return 목숨 == 0\n\n판 = 점수판()\n판.맞음()\n판.맞음()\n판.틀림()\nprint(판.점수, 판.목숨)\n판.틀림()\n판.틀림()\nprint(판.끝났나())', 'error'],
  ['unit15-review', 'board', 'class 점수판:\n    def __init__(self):\n        self.점수 = 0\n        self.목숨 = 3\n    def 맞음(self):\n        self.점수 += 1\n    def 틀림(self):\n        self.목숨 -= 1\n    def 끝났나(self):\n        if self.목숨 == 0:\n            return True\n        else:\n            return False\n\n판 = 점수판()\n판.맞음()\n판.맞음()\n판.틀림()\nprint(판.점수, 판.목숨)\n판.틀림()\n판.틀림()\nprint(판.끝났나())', 'correct'],
  ['unit15-review', 'rain', 'import turtle\nimport time\nimport random\nturtle.tracer(0)\n바구니 = turtle.Turtle()\n바구니.shape("square")\n바구니.shapesize(1, 4)\n바구니.color("blue")\n바구니.penup()\n바구니.goto(0, -150)\n판 = turtle.Turtle()\n판.hideturtle()\n판.penup()\n판.goto(-220, 140)\ndef 왼쪽():\n    바구니.setx(바구니.xcor() - 20)\ndef 오른쪽():\n    바구니.setx(바구니.xcor() + 20)\nturtle.onkeypress(왼쪽, "Left")\nturtle.onkeypress(오른쪽, "Right")\nturtle.listen()\n\nclass 별:\n    def __init__(self, x, 빠르기):\n        self.몸 = turtle.Turtle()\n        self.몸.shape("circle")\n        self.몸.color("gold")\n        self.몸.penup()\n        self.몸.goto(x, 160)\n        self.빠르기 = 빠르기\n    def 위로(self):\n        self.몸.goto(random.randint(-10, 10) * 20, 160)\n    def 내리기(self):\n        self.몸.sety(self.몸.ycor() - self.빠르기)\n\n별들 = [별(-100, 1), 별(0, 2), 별(100, 3)]\n점수 = 0\n목숨 = 5\nwhile 목숨 > 0:\n    for 한개 in 별들:\n        한개.내리기()\n        if 한개.몸.distance(바구니) < 40:\n            한개.위로()\n        elif 한개.몸.ycor() < -170:\n            목숨 -= 1\n            한개.위로()\n    판.clear()\n    판.write("점수: " + str(점수) + " 목숨: " + str(목숨))\n    turtle.update()\n    time.sleep(0.02)\n판.clear()\n판.write("끝! 점수: " + str(점수))\nturtle.update()', 'mistake', 'rain-text'],
  ['unit15-review', 'rain', 'import turtle\nimport time\nimport random\nturtle.tracer(0)\n바구니 = turtle.Turtle()\n바구니.shape("square")\n바구니.shapesize(1, 4)\n바구니.color("blue")\n바구니.penup()\n바구니.goto(0, -150)\n판 = turtle.Turtle()\n판.hideturtle()\n판.penup()\n판.goto(-220, 140)\ndef 왼쪽():\n    바구니.setx(바구니.xcor() - 20)\ndef 오른쪽():\n    바구니.setx(바구니.xcor() + 20)\nturtle.onkeypress(왼쪽, "Left")\nturtle.onkeypress(오른쪽, "Right")\nturtle.listen()\n\nclass 별:\n    def __init__(self, x, 빠르기):\n        self.몸 = turtle.Turtle()\n        self.몸.shape("circle")\n        self.몸.color("gold")\n        self.몸.penup()\n        self.몸.goto(x, 160)\n        self.빠르기 = 빠르기\n    def 위로(self):\n        self.몸.goto(random.randint(-10, 10) * 20, 160)\n    def 내리기(self):\n        self.몸.sety(self.몸.ycor() - self.빠르기)\n\n별들 = [별(-100, 1), 별(0, 2), 별(100, 3)]\n점수 = 0\n목숨 = 5\nwhile 목숨 > 0:\n    for 한개 in 별들:\n        한개.내리기()\n        if 한개.몸.distance(바구니) < 40:\n            점수 += 1\n            한개.위로()\n        elif 한개.몸.ycor() < -170:\n            목숨 -= 1\n            한개.위로()\n    판.clear()\n    판.write("점수: " + str(점수) + " 목숨: " + str(목숨))\n    turtle.update()\n    time.sleep(0.02)\n', 'mistake', 'rain-text'],
  ['unit15-review', 'rain', 'import turtle\nimport time\nimport random\nturtle.tracer(0)\n바구니 = turtle.Turtle()\n바구니.shape("square")\n바구니.shapesize(1, 4)\n바구니.color("blue")\n바구니.penup()\n바구니.goto(0, -150)\n판 = turtle.Turtle()\n판.hideturtle()\n판.penup()\n판.goto(-220, 140)\ndef 왼쪽():\n    바구니.setx(바구니.xcor() - 20)\ndef 오른쪽():\n    바구니.setx(바구니.xcor() + 20)\nturtle.onkeypress(왼쪽, "Left")\nturtle.onkeypress(오른쪽, "Right")\nturtle.listen()\n\nclass 별:\n    def __init__(self, x, 빠르기):\n        self.몸 = turtle.Turtle()\n        self.몸.shape("circle")\n        self.몸.color("gold")\n        self.몸.penup()\n        self.몸.goto(x, 160)\n        self.빠르기 = 빠르기\n    def 위로(self):\n        self.몸.goto(random.randint(-10, 10) * 20, 160)\n    def 내리기(self):\n        self.몸.sety(self.몸.ycor() - self.빠르기)\n\n별들 = [별(-100, 1), 별(0, 2), 별(100, 3)]\n점수 = 0\n목숨 = 5\nwhile 목숨 > 0:\n    for 한개 in 별들:\n        한개.내리기()\n        if 한개.몸.distance(바구니) < 40:\n            점수 += 1\n            한개.위로()\n        elif 한개.몸.ycor() < -170:\n            목숨 -= 1\n    판.clear()\n    판.write("점수: " + str(점수) + " 목숨: " + str(목숨))\n    turtle.update()\n    time.sleep(0.02)\n판.clear()\n판.write("끝! 점수: " + str(점수))\nturtle.update()', 'mistake', 'rain-pos'],
  ['unit15-review', 'rain', 'import turtle\nimport time\nimport random\nturtle.tracer(0)\n바구니 = turtle.Turtle()\n바구니.shape("square")\n바구니.shapesize(1, 4)\n바구니.color("blue")\n바구니.penup()\n바구니.goto(0, -150)\n판 = turtle.Turtle()\n판.hideturtle()\n판.penup()\n판.goto(-220, 140)\ndef 왼쪽():\n    바구니.setx(바구니.xcor() - 20)\ndef 오른쪽():\n    바구니.setx(바구니.xcor() + 20)\nturtle.onkeypress(왼쪽, "Left")\nturtle.onkeypress(오른쪽, "Right")\nturtle.listen()\n\nclass 별:\n    def __init__(self, x, 빠르기):\n        self.몸 = turtle.Turtle()\n        self.몸.shape("circle")\n        self.몸.color("gold")\n        self.몸.penup()\n        self.몸.goto(x, 160)\n        self.빠르기 = 빠르기\n    def 위로(self):\n        self.몸.goto(random.randint(-10, 10) * 20, 160)\n    def 내리기(self):\n        self.몸.sety(self.몸.ycor() - self.빠르기)\n\n별들 = [별(-100, 1), 별(0, 2), 별(100, 3)]\n점수 = 0\n목숨 = 5\nwhile 목숨 > 0:\n    for 한개 in 별들:\n        한개.내리기()\n        if 한개.몸.distance(바구니) < 40:\n            점수 += 1\n            한개.위로()\n        if 한개.몸.ycor() < -170:\n            목숨 = 목숨 - 1\n            한개.위로()\n    판.clear()\n    판.write("점수: " + str(점수) + " 목숨: " + str(목숨))\n    turtle.update()\n    time.sleep(0.02)\n판.clear()\n판.write("끝! 점수: " + str(점수))\nturtle.update()', 'correct'],
  // 문제 푸는 방법 단원
  ['solve-try', 'legs', '머리 = int(input())\n다리 = int(input())\nfor 닭 in range(1, 머리):\n    토끼 = 머리 - 닭\n    if 닭 * 2 + 토끼 * 4 == 다리:\n        print("닭", 닭, "토끼", 토끼)', 'mistake', 'legs-range'],
  ['solve-try', 'legs', '머리 = int(input())\n다리 = int(input())\nfor 닭 in range(0, 머리 + 1):\n    토끼 = 머리 - 닭\n    if 닭 * 4 + 토끼 * 2 == 다리:\n        print("닭", 닭, "토끼", 토끼)', 'mistake', 'legs-swap'],
  ['solve-try', 'legs', '머리 = input()\n다리 = input()\nfor 닭 in range(0, 머리 + 1):\n    토끼 = 머리 - 닭\n    if 닭 * 2 + 토끼 * 4 == 다리:\n        print("닭", 닭, "토끼", 토끼)', 'error'],
  ['solve-try', 'legs', '머리 = int(input())\n다리 = int(input())\nfor 닭 in range(머리 + 1):\n    for 토끼 in range(머리 + 1):\n        if 닭 + 토끼 == 머리 and 닭 * 2 + 토끼 * 4 == 다리:\n            print("닭", 닭, "토끼", 토끼)', 'correct'],
  ['solve-try', 'buy', '돈 = int(input())\nfor 연필 in range(0, 11):\n    for 공책 in range(0, 11):\n        if 연필 * 300 + 공책 * 700 == 돈:\n            print(연필, 공책)', 'mistake', 'buy-nonone'],
  ['solve-try', 'buy', '돈 = int(input())\n찾은 = 0\nfor 공책 in range(0, 11):\n    for 연필 in range(0, 11):\n        if 연필 * 300 + 공책 * 700 == 돈:\n            print(연필, 공책)\n            찾은 += 1\nif 찾은 == 0:\n    print("없어요")', 'mistake', 'buy-order'],
  ['solve-try', 'buy', '돈 = int(input())\n있음 = False\nfor 연필 in range(11):\n    for 공책 in range(11):\n        if 300 * 연필 + 700 * 공책 == 돈:\n            print(연필, 공책)\n            있음 = True\nif not 있음:\n    print("없어요")', 'correct'],
  ['solve-sort', 'second', '수들 = []\nfor i in range(5):\n    수들.append(input())\n차례 = sorted(수들)\nprint(차례)\nprint(차례[-2])\nprint(차례[2])', 'mistake', 'second-text'],
  ['solve-sort', 'second', '수들 = []\nfor i in range(5):\n    수들.append(int(input("수: ")))\n차례 = 수들.sort()\nprint(차례)\nprint(수들[-2])\nprint(수들[2])', 'mistake', 'second-none'],
  ['solve-sort', 'second', '수들 = []\nfor i in range(5):\n    수들.append(int(input("수: ")))\n차례 = sorted(수들)\nprint(수들)\nprint(차례[-2])\nprint(차례[2])', 'mistake', 'second-unsorted'],
  ['solve-sort', 'second', '수들 = []\nfor i in range(5):\n    수들.append(int(input("수: ")))\n차례 = sorted(수들)\nprint(차례)\nprint(차례[5])\nprint(차례[2])', 'error'],
  ['solve-sort', 'second', '수들 = []\nfor i in range(5):\n    수들.append(int(input("수: ")))\n수들.sort()\nprint(수들)\nprint(수들[3])\nprint(수들[2])', 'correct'],
  ['solve-sort', 'near', '수들 = []\nfor i in range(5):\n    수들.append(int(input("수: ")))\n수들.sort()\nprint(수들[1] - 수들[0])', 'mistake', 'near-first'],
  ['solve-sort', 'near', '수들 = []\nfor i in range(5):\n    수들.append(int(input("수: ")))\n작은 = 1000\nfor i in range(5):\n    for j in range(i + 1, 5):\n        차이 = 수들[i] - 수들[j]\n        if 차이 < 0:\n            차이 = -차이\n        if 차이 < 작은:\n            작은 = 차이\nprint(작은)', 'correct'],
  ['solve-half', 'guess', '비밀 = int(input())\n번 = 0\nfor 수 in range(1, 101):\n    번 += 1\n    if 수 == 비밀:\n        break\nprint(수, 번)', 'mistake', 'guess-line'],
  ['solve-half', 'guess', '비밀 = int(input())\n낮은 = 1\n높은 = 100\n번 = 0\nwhile True:\n    가운데 = (낮은 + 높은 + 1) // 2\n    번 += 1\n    if 가운데 == 비밀:\n        break\n    if 가운데 < 비밀:\n        낮은 = 가운데 + 1\n    else:\n        높은 = 가운데 - 1\nprint(가운데, 번)', 'mistake', 'guess-count'],
  ['solve-half', 'guess', '비밀 = int(input())\n낮은 = 1\n높은 = 100\n번 = 0\nwhile True:\n    가운데 = (낮은 + 높은) // 2\n    번 += 1\n    if 가운데 == 비밀:\n        break\n    if 가운데 < 비밀:\n        낮은 = 가운데\n    else:\n        높은 = 가운데\nprint(가운데, 번)', 'endless'],
  ['solve-half', 'guess', '비밀 = int(input())\n낮은 = 1\n높은 = 100\n번 = 1\n가운데 = (낮은 + 높은) // 2\nwhile 가운데 != 비밀:\n    if 가운데 < 비밀:\n        낮은 = 가운데 + 1\n    else:\n        높은 = 가운데 - 1\n    가운데 = (낮은 + 높은) // 2\n    번 = 번 + 1\nprint(가운데, 번)', 'correct'],
  ['solve-half', 'big', '버림 = input()\n비밀 = int(input())\n낮은 = 1\n높은 = 100\n번 = 0\nwhile True:\n    가운데 = (낮은 + 높은) // 2\n    번 += 1\n    if 가운데 == 비밀:\n        break\n    if 가운데 < 비밀:\n        낮은 = 가운데 + 1\n    else:\n        높은 = 가운데 - 1\nprint(번)', 'mistake', 'big-range'],
  ['solve-mod', 'binary', '수 = int(input())\n글 = ""\nwhile 수 > 0:\n    글 = 글 + str(수 % 2)\n    수 = 수 // 2\nprint(글)', 'mistake', 'binary-back'],
  ['solve-mod', 'binary', '수 = int(input())\n글 = ""\nwhile 수 > 1:\n    글 = str(수 % 2) + 글\n    수 = 수 // 2\nprint(글)', 'mistake', 'binary-short'],
  ['solve-mod', 'binary', '수 = int(input())\n글 = ""\nwhile 수 > 0:\n    글 = 수 % 2 + 글\n    수 = 수 // 2\nprint(글)', 'error'],
  ['solve-mod', 'binary', '수 = int(input())\n글 = ""\nwhile 수 > 0:\n    글 = str(수 % 2) + 글\nprint(글)', 'endless'],
  ['solve-mod', 'binary', '수 = int(input())\n나머지들 = []\nwhile 수 > 0:\n    나머지들.append(수 % 2)\n    수 = 수 // 2\n글 = ""\nfor 값 in 나머지들:\n    글 = str(값) + 글\nprint(글)', 'correct'],
  ['solve-mod', 'gcd', '큰 = int(input())\n작은 = int(input())\n답 = 1\nfor 수 in range(1, 큰 + 1):\n    if 큰 % 수 == 0 and 작은 % 수 == 0:\n        답 = 수\nprint(답)', 'correct'],
  ['solve-mod', 'gcd', '큰 = int(input())\n작은 = int(input())\nwhile 작은 != 0:\n    나머지 = 큰 % 작은\n    큰 = 작은\nprint(큰)', 'endless'],
  ['solve-sim', 'steps', '수 = int(input())\n번 = 0\nwhile 수 != 1:\n    if 수 % 2 == 0:\n        수 = 수 // 2\n    else:\n        수 = 수 * 3 + 1\n번 += 1\nprint(번)', 'mistake', 'steps-out'],
  ['solve-sim', 'steps', '수 = int(input())\n번 = 1\nwhile 수 != 1:\n    if 수 % 2 == 0:\n        수 = 수 // 2\n    else:\n        수 = 수 * 3 + 1\n    번 += 1\nprint(번)', 'mistake', 'steps-plus'],
  ['solve-sim', 'steps', '수 = int(input())\n번 = 0\nwhile 수 != 1:\n    if 수 % 2 == 0:\n        수 = 수 // 2\n    번 += 1\nprint(번)', 'endless'],
  ['solve-sim', 'steps', '수 = int(input())\n번 = 0\nwhile True:\n    if 수 == 1:\n        break\n    if 수 % 2 == 1:\n        수 = 3 * 수 + 1\n    else:\n        수 = 수 // 2\n    번 = 번 + 1\nprint(번)', 'correct'],
  ['solve-sim', 'robot', '가로 = 0\n세로 = 0\n명령 = input()\nfor 글자 in 명령:\n    if 글자 == "R":\n        가로 += 1\n    elif 글자 == "L":\n        가로 -= 1\n    elif 글자 == "U":\n        세로 += 1\n    elif 글자 == "D":\n        세로 -= 1\nprint(세로, 가로)', 'mistake', 'robot-swap'],
  ['solve-sim', 'robot', 'x = 0\ny = 0\n명령 = input()\nfor i in range(len(명령)):\n    if 명령[i] == "R":\n        x = x + 1\n    if 명령[i] == "L":\n        x = x - 1\n    if 명령[i] == "U":\n        y = y + 1\n    if 명령[i] == "D":\n        y = y - 1\nprint(x, y)', 'correct'],
];

test('흔한 오답에 의도한 말이 나온다', () => {
  for (const [missionId, taskId, code, kind, say] of [...WRONG, ...PRACTICE_WRONG]) {
    const task = allTasks(SCRIPTS[missionId]).find((t) => t.id === taskId);
    assert.ok(task, `${missionId}/${taskId}: 문제가 없어요`);
    const result = grade(task, code);
    assert.equal(result.kind, kind, `${missionId}/${taskId}: ${code.replace(/\n/g, ' ⏎ ')}`);
    if (say) assert.equal(result.say, say, `${missionId}/${taskId}: 대사`);
  }
});

test('파이썬이 내는 오류를 우리 설명이 알아듣는다', () => {
  const variables = { variables: true };
  const loops = { variables: true, loops: true };
  const functions = { variables: true, loops: true, functions: true };
  // [코드, 오류 종류, 설명에 들어 있어야 하는 말, 아이가 배운 것]
  const cases = [
    ['print("하나")\nprint(둘)\nprint("셋")', 'NameError', /따옴표/],
    ['print("하나")\nprint("둘"', 'SyntaxError', /괄호/],
    ['print("노포"', 'SyntaxError', /괄호/],
    ['print("범어사")\nPrint("남산")', 'NameError', /작은 글자/],
    ['print(두실)\nprint("7 + 8")', 'NameError', /따옴표/],
    ['print("서면)\nprint(3 x 4)\nprint("부전")', 'SyntaxError', /따옴표/],
    ['print("서면")\nprint(3 x 4)\nprint("부전")', 'SyntaxError', /별표/],
    ['print("가")\nprint("나)', 'SyntaxError', /따옴표/],
    // 변수를 배운 뒤
    ['print(점수)\n점수 = 100', 'NameError', /이름표가 아직 없어요/, variables],
    ['나이 = 9\nprint(나아)', 'NameError', /철자/, variables],
    ['내 나이 = 9', 'SyntaxError', /빈칸/, variables],
    ['2반 = 3', 'SyntaxError', /숫자로 시작/, variables],
    ['3 = x', 'SyntaxError', /왼쪽/, variables],
    ['print("나이" + 9)', 'TypeError', /int\( \)/, variables],
    ['수 = "12"\nprint(수 + 1)', 'TypeError', /int\( \)/, variables],
    ['값 = "3500"\nprint(10000 - 값)', 'TypeError', /숫자로 바꿔요/, variables],
    ['print(int("삼"))', 'ValueError', /숫자로 바꿀 수 없어요/, variables],
    ['Input("이름: ")', 'NameError', /작은 글자/, variables],
    // 반복을 배운 뒤
    ['for i in range(3):\nprint("안녕")', 'IndentationError', /들여써야/, variables],
    ['for i in range(3)\n    print("안녕")', 'SyntaxError', /콜론/, variables],
    ['print("가")\n    print("나")', 'IndentationError', /맨 앞/, variables],
    ['for i in range(2):\n    print("가")\n  print("나")', 'IndentationError', /빈칸 수/, variables],
    ['For i in range(3):\n    print(i)', 'SyntaxError', /작은 글자/, variables],
    ['for i in range("3"):\n    print(i)', 'TypeError', /range\( \) 안에는 숫자/, variables],
    ['for i in range(3):\n    print(I)', 'NameError', /이름표가 아직 없어요/, variables],
    // 조건을 배운 뒤
    ['x = 5\nif x = 5:\n    print("다섯")', 'SyntaxError', /등호 두 개/, variables],
    ['x = 5\nif x == 5\n    print("다섯")', 'SyntaxError', /콜론/, variables],
    ['x = 5\nif x => 5:\n    print("다섯")', 'SyntaxError', /등호가 뒤에/, variables],
    ['x = 5\nif x =< 5:\n    print("다섯")', 'SyntaxError', /등호가 뒤에/, variables],
    ['x = 5\nif x ≥ 5:\n    print("다섯")', 'SyntaxError', />= 로/, variables],
    ['x = 5\nif x ≠ 5:\n    print("다섯")', 'SyntaxError', /!= 로/, variables],
    ['x = 5\nIf x == 5:\n    print("다섯")', 'SyntaxError', /if는 모두 작은 글자/, variables],
    ['x = 5\nif x == 5:\n    print("가")\nelse x != 5:\n    print("나")', 'SyntaxError', /else 뒤에는 조건을 쓰지 않아요/, variables],
    ['x = 5\nif x == 5:\n    print("가")\nelse if x == 6:\n    print("나")', 'SyntaxError', /elif/, variables],
    ['x = 5\nif x == 5:\n    print("가")\n    else:\n    print("나")', 'SyntaxError', /줄의 앞을 맞춰/, variables],
    ['x = 5\nif x == 5:\nprint("가")', 'IndentationError', /들여써야/, variables],
    ['키 = "135"\nif 키 >= 130:\n    print("가")', 'TypeError', /크기를 견줄 수 없어요/, variables],
    ['비 = true', 'NameError', /첫 글자만 큰 글자/, variables],
    ['x = 5\nif x == 5:\n    print("가")\nElse:\n    print("나")', 'SyntaxError', /else는 모두 작은 글자/, variables],
    // 값 바꾸기를 배운 뒤
    ['점수 = 5\n점수 + = 1', 'SyntaxError', /붙여 써요/, loops],
    ['수 = 12\nfor i in range(수):\n    if 수 % i == 0:\n        print(i)', 'ZeroDivisionError', /1부터 시작/, loops],
    ['print(5 / 0)', 'ZeroDivisionError', /^0으로 나눌 수 없어요\.$/],
    ['합 = 합 + 1', 'NameError', /이름표가 아직 없어요/, loops],
    ['for i in range(3):\n    합 += i\nprint(합)', 'NameError', /이름표가 아직 없어요/, loops],
    // while과 무작위 수를 배운 뒤
    ['수 = 1\nWhile 수 < 3:\n    수 += 1', 'SyntaxError', /while는 모두 작은 글자/, loops],
    ['수 = 1\nif 수 == 1:\n    break', 'SyntaxError', /반복 안에서만/, loops],
    ['while True\n    print(1)', 'SyntaxError', /콜론/, loops],
    ['수 = random.randint(1, 6)', 'NameError', /import random/, loops],
    ['import random\n수 = randint(1, 6)', 'NameError', /random과 점/, loops],
    ['import random\n수 = random.randit(1, 6)', 'AttributeError', /철자/, loops],
    ['import Random', 'ModuleNotFoundError', /작은 글자/, loops],
    ['import random\n수 = random.randint(6, 1)', 'ValueError', /작은 수를 먼저/, loops],
    ['수 = 3\nwhile 수 != 1:\n    수 = 수 * 3\n    print(수)', 'ValueError', /끝없이 커졌어요/, loops],
    // 리스트를 배운 뒤
    ['수 = [1, 2, 3]\nprint(수[3])', 'IndexError', /마지막 번호는 항목 수보다 하나 작아요/, loops],
    ['수 = [1, 2, 3]\n수.remove(5)', 'ValueError', /없는 값은 지울 수 없어요/, loops],
    ['이름 = ["하늘"]\nprint(이름.index("바다"))', 'ValueError', /리스트에 없어요/, loops],
    ['수 = [1, 2, 3]\nprint(수["1"])', 'TypeError', /번호는 숫자여야/, loops],
    ['for 하나 in 5:\n    print(하나)', 'TypeError', /리스트나 range/, loops],
    ['수 = [1, 2\nprint(수)', 'SyntaxError', /대괄호/, loops],
    ['수 = [1, 2]\n수.add(3)', 'AttributeError', /append/, loops],
    ['수 = 5\nprint(수[0])', 'TypeError', /리스트와 글자/, loops],
    ['수 = [1, 2]\n수 = 수 + 3', 'TypeError', /append/, loops],
    ['수 = [1 2 3]', 'SyntaxError', /쉼표/, loops],
    // 함수를 배운 뒤
    ['인사()\ndef 인사():\n    print("안녕")', 'NameError', /함수가 아직 없어요/, functions],
    ['def 계산():\n    답 = 3\n계산()\nprint(답)', 'NameError', /함수 안에서 만든 이름은 함수 밖에서 쓸 수 없어요/, functions],
    ['def 인사(이름):\n    print(이름)\n인사()', 'TypeError', /다 넘기지 않았어요/, functions],
    ['def 인사():\n    print("안녕")\n인사("하늘")', 'TypeError', /많이 넘겼어요/, functions],
    ['def 두배(수):\n    print(수 * 2)\n답 = 두배(3) + 1', 'TypeError', /return으로 값을 돌려줘요/, functions],
    ['return 3', 'SyntaxError', /함수 안에서만/, functions],
    ['Def 인사():\n    print("안녕")', 'SyntaxError', /def는 모두 작은 글자/, functions],
    ['def 인사()\n    print("안녕")', 'SyntaxError', /콜론/, functions],
    ['점수 = 0\ndef 올리기():\n    점수 = 점수 + 10\n올리기()', 'UnboundLocalError', /넘겨받고/, functions],
    ['def 인사():\nprint("안녕")', 'IndentationError', /들여써야/, functions],
    // 글자 다루기를 배운 뒤
    ['글 = "가나다"\n글[0] = "바"', 'TypeError', /한 글자만 바꿀 수 없어요/, functions],
    ['글 = "가나다"\nprint(글[3])', 'IndexError', /글자 수보다 하나 작아요/, functions],
    ['글 = "가나다"\n글.append("라")', 'AttributeError', /더하기/, functions],
    ['글 = "가나다"\n글.replce("가", "나")', 'AttributeError', /철자/, functions],
    ['글 = "가나다"\nprint(글.Replace("가", "나"))', 'AttributeError', /작은 글자/, functions],
    ['글 = "가나다"\nprint(글["1"])', 'TypeError', /번호는 숫자여야/, functions],
    ['글 = "가나다"\nprint(글[len(글) / 2])', 'TypeError', /몫/, functions],
    ['글 = "가나다"\nprint(글[0:1.5])', 'TypeError', /몫/, functions],
    ['글 = "가나다"\nprint(글.replace("가"))', 'TypeError', /두 개/, functions],
    ['글 = "가나다"\nprint(글.find())', 'TypeError', /찾을 글자/, functions],
    ['글 = "a1"\nprint(글.count(1))', 'TypeError', /글자로 물어요/, functions],
    ['글 = "a1"\nprint(1 in 글)', 'TypeError', /글자로 물어요/, functions],
    ['글 = "가나다"\nprint(글.index("라"))', 'ValueError', /찾는 글자가 없어요/, functions],
    ['print(", ".join([1, 2]))', 'TypeError', /join/, functions],
    ['수 = 123\nprint(수[0])', 'TypeError', /숫자에는 쓸 수 없어요/, functions],
    ['수 = 123\nprint(len(수))', 'TypeError', /str\( \)/, functions],
    ['수 = 123\nfor 글자 in 수:\n    print(글자)', 'TypeError', /str\( \)/, functions],
    ['합 = 0\nfor 하나 in "3 5".split():\n    합 += 하나', 'TypeError', /int\( \)/, functions],
    ['글 = "3 5"\nprint(sum(글.split()))', 'TypeError', /int\( \)/, functions],
    ['글 = "가나다"\nprint(글 - "다")', 'TypeError', /replace/, functions],
    ['글 = "가 나"\n조각 = 글.split()\nprint(조각.replace("가", "나"))', 'AttributeError', /리스트에서 글자를 하나 꺼내서/, functions],
    ['글 = "가나다"\nprint(글.split(""))', 'ValueError', /괄호 안을 비워요/, functions],
    // 반복 안의 반복 단원: print의 end=
    ['print(1, end" ")', 'SyntaxError', /등호/, functions],
    ['print(1 end=" ")', 'SyntaxError', /쉼표가 빠졌어요/, functions],
    ['print(1, End=" ")', 'TypeError', /작은 글자/, functions],
    ['print(1, 끝=" ")', 'TypeError', /end예요/, functions],
    ['print(1, end=1)', 'TypeError', /따옴표로 감싸요/, functions],
    ['print(1, end=)', 'SyntaxError', /값이 빠졌어요/, functions],
    ['print(end=" ", 1)', 'SyntaxError', /맨 뒤/, functions],
    ['for a in range(2):\n    for b in range(3):\n    print(a, b)', 'IndentationError', /들여써야/, functions],
    ['for a in range(2):\n    for b in range(3):\n        print(a, b)\n      print()', 'IndentationError', /빈칸 수/, functions],
    // 딕셔너리 단원
    ['가격 = {"사과": 1000, "귤": 500}\nprint(가격["수박"])', 'KeyError', /"수박"이라는 키가 딕셔너리에 없어요/, functions],
    ['가격 = {"사과": 1000, "귤": 500}\nprint(가격[0])', 'KeyError', /번호가 아니라 키/, functions],
    ['가격 = {"사과": 1000, "귤": 500}\nprint(가격["사과 "])', 'KeyError', /빈칸/, functions],
    ['가격 = {"사과": 1000, "귤": 500}\n가격["배"] += 1', 'KeyError', /= 로 넣어요/, functions],
    ['가격 = {"사과": 1000, "귤": 500}\nprint(가격[사과])', 'NameError', /따옴표로 감싸요/, functions],
    ['가격 = {"사과": 1000, "귤": 500}\n가격.append("배")', 'AttributeError', /이름\[키\] = 값/, functions],
    ['가격 = {"사과": 1000, "귤": 500}\nprint(가격.사과)', 'AttributeError', /대괄호/, functions],
    ['가격 = {"사과": 1000, "귤": 500}\nprint(가격("사과"))', 'TypeError', /대괄호/, functions],
    ['가격 = {"사과": 1000, "귤": 500}\n가격.Pop("귤")', 'AttributeError', /작은 글자/, functions],
    ['가격 = {"사과": 1000, "귤": 500', 'SyntaxError', /중괄호/, functions],
    ['가격 = {"사과": 1000 "귤": 500}', 'SyntaxError', /쉼표가 빠졌어요/, functions],
    ['가격 = {"사과" 1000}', 'SyntaxError', /콜론/, functions],
    ['가격 = {"사과" = 1000}', 'SyntaxError', /등호가 아니라 콜론/, functions],
    ['가격 = ["사과": 1000]', 'SyntaxError', /중괄호/, functions],
    ['가격 = {"사과": 1000}}', 'SyntaxError', /하나 더 많아요/, functions],
    ['가격 = {"사과": 1000, "귤": 500}\nfor 과일 in 가격:\n    가격[과일 + "즙"] = 1', 'RuntimeError', /도는 동안/, functions],
    ['표 = {["a"]: 1}', 'TypeError', /키로 쓸 수 없어요/, functions],
    // 표 모양 리스트 단원
    ['표 = [[1, 2, 3], [4, 5, 6]]\nprint(표[0, 1])', 'TypeError', /대괄호를 따로/, functions],
    ['표 = [[1, 2] [3, 4]]', 'TypeError', /쉼표가 빠졌는지/, functions],
    ['표 = [[1, 2, 3], [4, 5, 6]]\nprint(sum(표))', 'TypeError', /한 줄은 리스트/, functions],
    ['표 = [[1, 2, 3], [4, 5, 6]]\n합 = 0\nfor 한줄 in 표:\n    합 += 한줄', 'TypeError', /한 줄은 리스트/, functions],
    ['표 = [[1, 2, 3], [4, 5, 6]]\nprint(표[2][0])', 'IndexError', /없는 번호/, functions],
    ['지도 = ["..", ".."]\n지도[0][1] = "#"', 'TypeError', /한 글자만 바꿀 수 없어요/, functions],
  ];
  for (const [code, type, pattern, knows] of cases) {
    const ran = scripted(code, [], false);
    assert.equal(ran.error?.type, type, code);
    assert.match(explain(ran.error, knows), pattern, `${code.replace(/\n/g, ' ⏎ ')} → ${ran.error.message}`);
  }
});

test('한 줄씩 보기: 줄마다 변수 값이 기록된다', () => {
  const ran = scripted('a = 3\nb = a\na = 10\nprint(a, b)', [], true);
  assert.deepEqual(ran.steps.map((s) => s.line), [1, 2, 3, 4]);
  assert.deepEqual(ran.steps.map((s) => s.vars), [{ a: '3' }, { a: '3', b: '3' }, { a: '10', b: '3' }, { a: '10', b: '3' }]);
  assert.equal(ran.steps[3].out, '10 3\n');
  // 글자는 따옴표가 붙어서 숫자와 구분된다
  assert.deepEqual(scripted('a = 3\nb = "3"', [], true).vars, { a: '3', b: '"3"' });
});

test('한 줄씩 보기: input에 넣은 답이 질문 뒤에 표시와 함께 남는다', () => {
  const ran = scripted('이름 = input("이름: ")\nprint("안녕", 이름)', ['하늘'], true);
  assert.equal(ran.steps[0].out, '이름: \x01하늘\x02\n');
  assert.equal(ran.steps[1].out, '안녕 하늘\n');
  assert.deepEqual(ran.vars, { 이름: '"하늘"' });
  // 채점에서는 질문 글이 출력에 들어가지 않는다
  assert.equal(scripted('이름 = input("이름: ")\nprint("안녕", 이름)', ['하늘'], false).output, '안녕 하늘\n');
});
