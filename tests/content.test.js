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
  scripted = (code, inputs, trace) => JSON.parse(call(code, JSON.stringify(inputs ?? []), trace));
});

/** 한 줄씩 보기로 돌린다. 화면에 보이는 그대로(질문과 넣은 답 포함)의 출력을 돌려준다. */
function shown(code, inputs) {
  const ran = scripted(code, inputs, true);
  return { ...ran, output: ran.output.replace(/[\x01\x02]/g, '') };
}

/** 아이가 직접 실행했을 때 프로그램이 내보내는 글(질문은 있고, 친 답은 없다) */
function typedRun(code, inputs) {
  const ran = scripted(code, inputs, true);
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
    const ran = scripted(code, one.inputs, false);
    if (ran.error?.type === 'EOFError') diagnosis = { kind: 'input-many' };
    else if (ran.error) diagnosis = { kind: 'error', error: ran.error };
    else if (ran.unused > 0) diagnosis = { kind: 'input-few' };
    else diagnosis = diagnoseTask({ ...task, expect: one.expect }, code, ran);
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
      const ran = shown(q.code, q.inputs);
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
        const ran = scripted(hint.card.code, ['1', '2', '3'], false);
        assert.equal(ran.error, null, `${task.id}: 힌트 예제에서 오류 (${ran.error?.message})`);
        assert.notEqual(grade(task, hint.card.code).kind, 'correct', `${task.id}: 힌트 예제가 정답이에요`);
      }
    }
  });

  test(`${m.id}: 강의의 따라 하기와 시연 코드가 적어 둔 대로 돈다`, () => {
    for (const part of m.lecture ?? []) {
      for (const spec of part) {
        if (spec.follow) {
          const ran = typedRun(spec.follow.code, spec.follow.inputs);
          assert.equal(ran.error, null, `따라 하기에서 오류 (${ran.error?.message})`);
          if (spec.follow.match) assert.match(ran.output, new RegExp(spec.follow.match), '따라 하기 출력 모양');
          else assert.deepEqual(outputLines(ran.output), spec.follow.expect, '따라 하기 출력');
        }
        if (spec.trace !== undefined) {
          const ran = shown(spec.trace, spec.inputs);
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
