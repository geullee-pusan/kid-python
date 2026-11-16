// 수업 내용 검증: 대본에 적힌 코드를 앱과 같은 파이썬 실행기(Pyodide)로 실제로 돌려 본다.
// - 예측 문제의 정답 보기가 실제 출력과 같은가
// - 쓰기 문제의 모범 답이 채점을 통과하는가
// - 고치기 문제의 시작 코드는 통과하지 못하는가
// - 강의의 따라 하기와 시연 코드가 기대한 대로 도는가
// - 흔한 오답을 넣었을 때 의도한 말이 나오는가
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

import { loadPyodide } from 'pyodide';

import { diagnoseTask, outputLines } from '../src/core/diagnose.js';
import { explain } from '../src/core/errors-ko.js';
import { allTasks } from '../src/core/lesson.js';
import { MISSIONS } from './missions.js';

let run;

before(async () => {
  const pyodide = await loadPyodide();
  pyodide.runPython(`
import io, sys, json, traceback

def __run(code):
    buf = io.StringIO()
    old = sys.stdout
    sys.stdout = buf
    error = None
    try:
        exec(compile(code, "main.py", "exec"), {"__name__": "__main__"})
    except SystemExit:
        pass
    except BaseException as e:
        message = e.msg if isinstance(e, SyntaxError) else str(e)
        text = "".join(traceback.format_exception_only(type(e), e))
        error = {"type": type(e).__name__, "message": message, "text": text}
    finally:
        sys.stdout = old
    return json.dumps({"output": buf.getvalue(), "error": error})
`);
  const call = pyodide.globals.get('__run');
  run = (code) => JSON.parse(call(code));
});

for (const m of Object.values(MISSIONS)) {
  test(`${m.id}: 예측 문제의 정답이 실제 출력과 같다`, () => {
    for (const q of m.predict ?? []) {
      const ran = run(q.code);
      if (q.outcome) {
        // 오류가 답인 문제: 보기 글은 설명이라서, 대본에 적어 둔 실제 결과(outcome)와 견준다.
        assert.equal(ran.error?.type, q.outcome.error, `${q.id}: 오류 종류`);
        assert.deepEqual(outputLines(ran.output), q.outcome.output, `${q.id}: 오류 전까지의 출력`);
      } else {
        assert.equal(ran.error, null, `${q.id}: 오류가 나면 안 돼요 (${ran.error?.message})`);
        assert.deepEqual(outputLines(ran.output), q.choices[q.answer].text.split('\n'), `${q.id}: 정답 보기`);
      }
    }
  });

  test(`${m.id}: 쓰기 문제의 모범 답이 채점을 통과한다`, () => {
    for (const task of allTasks(m)) {
      const ran = run(task.solution);
      assert.equal(ran.error, null, `${task.id}: 모범 답에서 오류 (${ran.error?.message})`);
      assert.deepEqual(diagnoseTask(task, task.solution, ran), { kind: 'correct' }, `${task.id}: 모범 답 채점`);
    }
  });

  test(`${m.id}: 고치기 문제의 시작 코드는 통과하지 못한다`, () => {
    for (const task of allTasks(m).filter((t) => t.start)) {
      const ran = run(task.start);
      assert.notEqual(diagnoseTask(task, task.start, ran).kind, 'correct', `${task.id}: 시작 코드가 이미 정답이에요`);
    }
  });

  test(`${m.id}: 힌트의 비슷한 예제는 돌아가지만 정답은 아니다`, () => {
    for (const task of allTasks(m)) {
      for (const hint of task.hints ?? []) {
        if (!hint.card?.code) continue;
        const ran = run(hint.card.code);
        assert.equal(ran.error, null, `${task.id}: 힌트 예제에서 오류`);
        assert.notEqual(diagnoseTask(task, hint.card.code, ran).kind, 'correct', `${task.id}: 힌트 예제가 정답이에요`);
      }
    }
  });

  test(`${m.id}: 강의의 따라 하기 코드가 적어 둔 출력을 낸다`, () => {
    for (const part of m.lecture ?? []) {
      for (const spec of part) {
        if (!spec.follow) continue;
        const ran = run(spec.follow.code);
        assert.equal(ran.error, null);
        assert.deepEqual(outputLines(ran.output), spec.follow.expect);
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
];

test('흔한 오답에 의도한 말이 나온다', () => {
  for (const [missionId, taskId, code, kind, say] of WRONG) {
    const task = allTasks(MISSIONS[missionId]).find((t) => t.id === taskId);
    assert.ok(task, `${missionId}/${taskId}: 문제가 없어요`);
    const result = diagnoseTask(task, code, run(code));
    assert.equal(result.kind, kind, `${missionId}/${taskId}: ${code.replace(/\n/g, ' ⏎ ')}`);
    if (say) assert.equal(result.say, say, `${missionId}/${taskId}: 대사`);
  }
});

test('오류 수업의 시연과 고치기: 파이썬이 내는 오류를 우리 설명이 알아듣는다', () => {
  const cases = [
    ['print("하나")\nprint(둘)\nprint("셋")', 'NameError', /따옴표/],
    ['print("하나")\nprint("둘"', 'SyntaxError', /괄호/],
    ['print("노포"', 'SyntaxError', /괄호/],
    ['print("범어사")\nPrint("남산")', 'NameError', /작은 글자/],
    ['print(두실)\nprint("7 + 8")', 'NameError', /따옴표/],
    ['print("서면)\nprint(3 x 4)\nprint("부전")', 'SyntaxError', /따옴표/],
    ['print("서면")\nprint(3 x 4)\nprint("부전")', 'SyntaxError', /별표/],
    ['print("가")\nprint("나)', 'SyntaxError', /따옴표/],
  ];
  for (const [code, type, pattern] of cases) {
    const ran = run(code);
    assert.equal(ran.error?.type, type, code);
    assert.match(explain(ran.error), pattern, `${code.replace(/\n/g, ' ⏎ ')} → ${ran.error.message}`);
  }
});
