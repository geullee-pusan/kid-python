// 순수 함수 테스트: 대사 틀, 대본 점검, 채점과 오답 짐작, 오류 설명.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { diagnoseTask, outputLines, stripStrings } from '../src/core/diagnose.js';
import { explain } from '../src/core/errors-ko.js';
import { fill, lectureParts, line, missingLines, predictFeedback, splitSpoken, taskFeedback, hintScenes } from '../src/core/lesson.js';

const missionsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'missions');
const missions = readdirSync(missionsDir).map((file) => JSON.parse(readFileSync(join(missionsDir, file), 'utf8')));
const mission = missions.find((m) => m.id === 'print-order');

test('대사 틀: 조사를 받침에 맞춰 고른다', () => {
  assert.equal(fill('{a를} 써요', { a: '12 + 30' }), '12 + 30을 써요');
  assert.equal(fill('{a가} 나왔어요', { a: '노포' }), '노포가 나왔어요');
  assert.equal(fill('{a이} 나왔어요', { a: '남산' }), '남산이 나왔어요');
  assert.throws(() => fill('{missing}', {}));
});

test('자막과 읽을 말을 가른다', () => {
  assert.deepEqual(splitSpoken('[print|프린트]라고 써요'), { caption: 'print라고 써요', speech: '프린트라고 써요' });
});

test('같은 시드면 같은 말을 한다', () => {
  assert.equal(line(mission, 'greet', 1).text, line(mission, 'greet', 1).text);
});

for (const m of missions) {
  test(`대본 ${m.id}: 장면이 가리키는 대사가 모두 있다`, () => {
    assert.deepEqual(missingLines(m), []);
  });
  test(`대본 ${m.id}: 강의가 장면으로 바뀐다`, () => {
    const parts = lectureParts(m, 0);
    assert.ok(parts.length > 0);
    for (const part of parts) for (const scene of part) assert.ok(scene.kind);
  });
  test(`대본 ${m.id}: 예측 문제마다 정답이 하나 있고 보기가 서로 다르다`, () => {
    for (const q of m.predict) {
      assert.ok(q.choices[q.answer]);
      assert.equal(new Set(q.choices.map((c) => c.text)).size, q.choices.length);
    }
  });
  test(`대본 ${m.id}: 힌트와 채점 뒤 대사가 만들어진다`, () => {
    m.hints.forEach((_, level) => assert.ok(hintScenes(m, level).length > 0));
    const vars = { calc: '12 + 30', got: 2, want: 3, no: 1 };
    for (const kind of ['not-computed', 'quoted-calc', 'order', 'count', 'spacing', 'line-diff', 'no-output']) {
      assert.ok(taskFeedback(m, { kind, vars: { ...vars, want: kind === 'count' ? 3 : '노포', got: kind === 'count' ? 2 : '노표' } })[0].text);
    }
  });
}

test('예측 문제: 고른 것에 따라 다른 말을 한다', () => {
  const q = mission.predict[0];
  assert.equal(predictFeedback(mission, q, q.answer).correct, true);
  const wrong = predictFeedback(mission, q, 1);
  assert.equal(wrong.correct, false);
  assert.match(wrong.scenes[0].text, /가나다/);
});

test('출력 줄 나누기와 따옴표 지우기', () => {
  assert.deepEqual(outputLines('노포 \n범어사\n\n'), ['노포', '범어사']);
  assert.equal(stripStrings('print("12 + 30")  # 12 + 30').includes('12'), false);
  assert.equal(stripStrings("print(12 + 30)").includes('12 + 30'), true);
});

test('쓰기 문제 채점: 정답과 흔한 오답을 가려낸다', () => {
  const task = mission.task;
  const run = (output, error = null) => ({ output, error });
  const kind = (code, output, error) => diagnoseTask(task, code, run(output, error)).kind;

  assert.equal(kind('print("노포")\nprint("범어사")\nprint(12 + 30)', '노포\n범어사\n42\n'), 'correct');
  assert.equal(kind('print("노포")\nprint("범어사")\nprint(30+12)', '노포\n범어사\n42\n'), 'correct');
  // 답은 맞지만 계산을 직접 해서 적은 경우
  assert.equal(kind('print("노포")\nprint("범어사")\nprint(42)', '노포\n범어사\n42\n'), 'not-computed');
  assert.equal(kind('print("노포")\nprint("범어사")\nprint("42")', '노포\n범어사\n42\n'), 'not-computed');
  // 계산을 따옴표 안에 넣은 경우
  assert.equal(kind('print("노포")\nprint("범어사")\nprint("12 + 30")', '노포\n범어사\n12 + 30\n'), 'quoted-calc');
  assert.equal(kind('print("노포")\nprint("범어사")\nprint("12+30")', '노포\n범어사\n12+30\n'), 'quoted-calc');
  // 순서가 다른 경우
  assert.equal(kind('print("범어사")\nprint("노포")\nprint(12 + 30)', '범어사\n노포\n42\n'), 'order');
  // 줄 수가 다른 경우
  assert.equal(kind('print("노포")\nprint("범어사")', '노포\n범어사\n'), 'count');
  assert.equal(kind('print("노포", "범어사", 12 + 30)', '노포 범어사 42\n'), 'count');
  // 글자가 다른 경우
  assert.equal(kind('print("노표")\nprint("범어사")\nprint(12 + 30)', '노표\n범어사\n42\n'), 'line-diff');
  assert.equal(kind('print("노 포")\nprint("범어사")\nprint(12 + 30)', '노 포\n범어사\n42\n'), 'spacing');
  // 아무것도 안 나온 경우, 오류가 난 경우
  assert.equal(kind('"노포"', ''), 'no-output');
  assert.equal(kind('print(노포)', '', { type: 'NameError', message: "name '노포' is not defined" }), 'error');
});

test('오류 설명: 첫 미션에서 나올 만한 실수', () => {
  assert.match(explain({ type: 'NameError', message: "name '노포' is not defined" }), /따옴표/);
  assert.match(explain({ type: 'NameError', message: "name 'Print' is not defined" }), /작은 글자/);
  assert.match(explain({ type: 'SyntaxError', message: "'(' was never closed" }), /괄호/);
  assert.match(explain({ type: 'SyntaxError', message: 'unterminated string literal (detected at line 1)' }), /따옴표/);
  assert.match(explain({ type: 'SyntaxError', message: "invalid character '“' (U+201C)" }), /한\/영/);
  assert.match(explain({ type: 'SyntaxError', message: "Missing parentheses in call to 'print'. Did you mean print(...)?" }), /괄호/);
  assert.match(explain({ type: 'IndentationError', message: 'unexpected indent' }), /빈칸/);
});
