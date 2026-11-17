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

import { diagnoseTask, outputLines } from '../src/core/diagnose.js';
import { explain } from '../src/core/errors-ko.js';
import { allTasks } from '../src/core/lesson.js';
import { MISSIONS } from './missions.js';

let scripted;

before(async () => {
  const pyodide = await loadPyodide();
  // 일꾼 파일에서 파이썬 소스를 꺼낸다(자바스크립트 글자 틀 안에 들어 있다).
  const worker = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'py-worker.js'), 'utf8');
  const body = /const RUNNER_SOURCE = `([\s\S]*?)`;/.exec(worker)[1];
  pyodide.runPython(new Function(`return \`${body}\`;`)());
  const call = pyodide.globals.get('__kidpy_scripted');
  // limit: 한 줄씩 보기에서 보여 줄 줄 수의 한도. randoms: random.randint가 차례로 돌려줄 값.
  scripted = (code, inputs, trace, { limit, randoms } = {}) => JSON.parse(call(code, JSON.stringify(inputs ?? []), trace, limit ?? 300, JSON.stringify(randoms ?? [])));
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
  if (!task.cases) {
    const ran = scripted(code, [], false);
    return ran.error ? { kind: 'error', error: ran.error } : diagnoseTask(task, code, ran);
  }
  let diagnosis = { kind: 'correct' };
  for (const one of task.cases) {
    const ran = scripted(code, one.inputs, false, { randoms: one.randoms });
    // 끝나지 않는 반복은 실행기가 줄 수를 세다가 멈춘다.
    if (ran.error?.type === 'TraceLimit') diagnosis = { kind: 'endless' };
    else if (ran.error?.type === 'EOFError') {
      // 준 답을 다 쓰고도 또 물었다. 이 문제의 흔한 실수로 짚을 수 있으면 그 말을 한다(앱과 같다).
      const guess = diagnoseTask({ ...task, expect: one.expect, inputs: one.inputs }, code, { error: null, output: ran.output, again: true });
      diagnosis = guess.kind === 'mistake' ? guess : { kind: 'input-many' };
    }
    else if (ran.error) diagnosis = { kind: 'error', error: ran.error };
    else if (ran.unused > 0) diagnosis = { kind: 'input-few' };
    else diagnosis = diagnoseTask({ ...task, expect: one.expect, inputs: one.inputs }, code, ran);
    if (diagnosis.kind !== 'correct') {
      diagnosis.inputs = one.inputs;
      break;
    }
  }
  return diagnosis;
}

for (const m of Object.values(MISSIONS)) {
  test(`${m.id}: 예측 문제의 정답이 실제 출력과 같다`, () => {
    for (const q of m.predict ?? []) {
      const ran = shown(q.code, q.inputs, { limit: q.limit, randoms: q.randoms });
      if (q.outcome) {
        // 오류가 답인 문제: 보기 글은 설명이라서, 대본에 적어 둔 실제 결과(outcome)와 견준다.
        assert.equal(ran.error?.type, q.outcome.error, `${q.id}: 오류 종류`);
        assert.deepEqual(outputLines(ran.output), q.outcome.output, `${q.id}: 오류 전까지의 출력`);
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
        const ran = scripted(hint.card.code, hint.card.inputs ?? ['1', '2', '3'], false, { randoms: hint.card.randoms });
        assert.equal(ran.error, null, `${task.id}: 힌트 예제에서 오류 (${ran.error?.message})`);
        assert.notEqual(grade(task, hint.card.code).kind, 'correct', `${task.id}: 힌트 예제가 정답이에요`);
      }
    }
  });

  test(`${m.id}: 강의의 따라 하기와 시연 코드가 적어 둔 대로 돈다`, () => {
    for (const part of m.lecture ?? []) {
      for (const spec of part) {
        if (spec.follow) {
          const ran = typedRun(spec.follow.code, spec.follow.inputs, { randoms: spec.follow.randoms });
          // 멈춤 버튼 연습: 끝나지 않는 프로그램이어야 한다.
          if (spec.follow.stopped) {
            assert.equal(ran.error?.type, 'TraceLimit', '멈춤 연습은 끝나지 않는 프로그램이어야 해요');
            continue;
          }
          assert.equal(ran.error, null, `따라 하기에서 오류 (${ran.error?.message})`);
          if (spec.follow.match) assert.match(ran.output, new RegExp(spec.follow.match), '따라 하기 출력 모양');
          else assert.deepEqual(outputLines(ran.output), spec.follow.expect, '따라 하기 출력');
        }
        if (spec.trace !== undefined) {
          const ran = shown(spec.trace, spec.inputs, { limit: spec.limit, randoms: spec.randoms });
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
];

test('흔한 오답에 의도한 말이 나온다', () => {
  for (const [missionId, taskId, code, kind, say] of WRONG) {
    const task = allTasks(MISSIONS[missionId]).find((t) => t.id === taskId);
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
