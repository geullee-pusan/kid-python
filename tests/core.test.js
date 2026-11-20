// 순수 함수 테스트: 대사 틀, 대본 점검, 채점과 오답 짐작, 오류 설명.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diagnoseTask, outputLines, stripStrings } from '../src/core/diagnose.js';
import { explain } from '../src/core/errors-ko.js';
import { allTasks, fill, lectureParts, line, missingLines, predictFeedback, splitSpoken, taskFeedback, tracePace } from '../src/core/lesson.js';
import { CURRICULUM, MISSIONS, PRACTICE } from './missions.js';

const first = MISSIONS['print-order'];

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
  assert.equal(line(first, 'greet', 1).text, line(first, 'greet', 1).text);
});

test('수업 제목이 대사에 들어가고, 읽는 말은 따로 간다', () => {
  const scene = line(first, 'intro-ask');
  assert.match(scene.text, /^print로 말하기 수업이에요/);
  assert.match(scene.speech, /^프린트로 말하기 수업이에요/);
});

test('수업 목록의 수업이 모두 있고, 단원 안에서 번호가 차례대로다', () => {
  for (const unit of CURRICULUM.units) {
    (unit.lessons ?? []).forEach((id, index) => {
      assert.ok(MISSIONS[id], `수업이 없어요: ${id}`);
      assert.equal(MISSIONS[id].unit, unit.title);
      assert.equal(MISSIONS[id].no, index + 1);
    });
  }
});

for (const m of Object.values(MISSIONS)) {
  test(`대본 ${m.id}: 장면과 문제가 가리키는 대사가 모두 있다`, () => {
    assert.deepEqual(missingLines(m), []);
  });
  test(`대본 ${m.id}: 강의가 장면으로 바뀐다`, () => {
    for (const part of lectureParts(m, 0)) for (const scene of part) assert.ok(scene.kind);
  });
  test(`대본 ${m.id}: 예측 문제마다 정답이 하나 있고 보기가 서로 다르다`, () => {
    for (const q of m.predict ?? []) {
      assert.ok(q.choices[q.answer], `${q.id}: 정답 번호`);
      assert.equal(new Set(q.choices.map((c) => c.text)).size, q.choices.length, `${q.id}: 보기가 겹쳐요`);
      assert.ok(m.lines[q.explain], `${q.id}: 설명 대사`);
    }
  });
  test(`대본 ${m.id}: 쓰기 문제마다 필요한 것이 있고, 채점 뒤 대사가 만들어진다`, () => {
    assert.ok((m.tasks ?? []).length > 0, '쓰기 문제가 하나는 있어야 해요');
    const ids = allTasks(m).map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, '문제 id가 겹쳐요');
    for (const task of allTasks(m)) {
      // 파일에 쓰는 문제는 출력이 없어도 된다(expectFiles로 채점한다).
      const fileTask = Boolean(task.expectFiles || task.cases?.some((one) => one.expectFiles));
      // free: 채점하지 않는 쓰기(단원 20)는 나와야 하는 출력이 없다.
      assert.ok(task.id && task.title && task.steps.length && (task.expect.length || task.draw || task.game || task.free || fileTask) && task.solution, `${task.id}: 빠진 것`);
      if (fileTask) {
        for (const kind of ['file-none', 'file-printed', 'file-empty']) assert.ok(taskFeedback(m, task, { kind, vars: { name: '점수.txt' } })[0].text);
        assert.ok(taskFeedback(m, task, { kind: 'file-missing', vars: { name: '점수.txt', got: '점수.text' } })[0].text);
        assert.ok(taskFeedback(m, task, { kind: 'file-count', vars: { name: '점수.txt', want: 3, got: 2 } })[0].text);
        assert.ok(taskFeedback(m, task, { kind: 'file-diff', vars: { name: '점수.txt', no: '첫째', want: '90', got: '9' } })[0].text);
        // 칠판과 다른 파일(또는 파일이 없을 때)로 돌려서 틀렸으면 그 말을 먼저 한다.
        assert.equal(taskFeedback(m, task, { kind: 'line-diff', otherFiles: 'other', vars: { no: '첫째', want: '1', got: '2' } })[0].key, 'task-case-files');
        assert.equal(taskFeedback(m, task, { kind: 'error', otherFiles: 'none', text: '파일이 없어요' })[0].key, 'task-case-nofile');
      }
      const vars = { calc: '12 + 30', got: 2, want: 3, no: '첫째' };
      assert.ok(taskFeedback(m, task, { kind: 'correct', first: true }).length >= 2);
      for (const kind of ['not-computed', 'quoted-calc', 'order', 'count']) assert.ok(taskFeedback(m, task, { kind, vars })[0].text);
      for (const kind of ['spacing', 'line-diff']) assert.ok(taskFeedback(m, task, { kind, vars: { ...vars, want: '노포', got: '노표' } })[0].text);
      assert.ok(taskFeedback(m, task, { kind: 'no-output' })[0].text);
      assert.ok(taskFeedback(m, task, { kind: 'input-few', vars: { want: 2, got: 1 } })[0].text);
      assert.ok(taskFeedback(m, task, { kind: 'input-many', vars: { want: 1 } })[0].text);
      assert.equal(taskFeedback(m, task, { kind: 'no-output', inputs: ['하늘', '수학'] }).length, 2, '어떤 입력에서 틀렸는지 먼저 말한다');
      for (const rule of task.checks ?? []) assert.ok(taskFeedback(m, task, { kind: 'mistake', say: rule.say })[0].text);
      for (const mistake of task.mistakes ?? []) assert.ok(taskFeedback(m, task, { kind: 'mistake', say: mistake.say })[0].text);
    }
  });
  test(`대본 ${m.id}: 처음 화면에 필요한 것이 있다`, () => {
    assert.ok(m.unit && m.no && m.title && m.desc && m.minutes);
  });
}

test('연습 문제: 단원마다 한 묶음이 있고, 문제 id가 어디서도 겹치지 않는다', () => {
  const sets = Object.values(PRACTICE);
  assert.deepEqual(sets.map((set) => set.unit).sort(), CURRICULUM.units.map((unit) => unit.title).sort());
  const ids = sets.flatMap((set) => set.tasks.map((task) => task.id));
  assert.equal(new Set(ids).size, ids.length, '문제 id가 겹쳐요');
});

for (const set of Object.values(PRACTICE)) {
  test(`연습 ${set.id}: 대사가 모두 있고, 문제마다 필요한 것이 있다`, () => {
    assert.deepEqual(missingLines(set), []);
    // 연습 문제는 단원에서 배운 것까지만 안다고 본다(오류 설명의 말을 고르는 데 쓴다).
    const lessons = CURRICULUM.units.find((unit) => unit.title === set.unit).lessons.map((id) => MISSIONS[id]);
    assert.deepEqual(set.knows, lessons[lessons.length - 1].knows ?? [], '단원의 마지막 수업과 knows가 같아야 해요');
    assert.equal(Boolean(set.showVars), Boolean(lessons[lessons.length - 1].showVars));
    for (const task of set.tasks) {
      assert.ok(task.id && task.title && task.summary && task.story && task.steps.length && (task.expect.length || task.draw || task.game) && task.solution && task.praise, `${task.id}: 빠진 것`);
      assert.ok(['기본', '응용', '도전'].includes(task.level), `${task.id}: level`);
      assert.ok(['쓰기', '고치기'].includes(task.kind), `${task.id}: kind`);
      if (task.kind === '고치기') assert.ok(task.start, `${task.id}: 고치기 문제에는 시작 코드가 있어야 해요`);
      assert.ok((task.hints ?? []).length > 0, `${task.id}: 힌트가 하나는 있어야 해요`);
      assert.ok(taskFeedback(set, task, { kind: 'correct', first: true }).length >= 3, `${task.id}: 칭찬 대사`);
      for (const rule of [...(task.checks ?? []), ...(task.mistakes ?? [])]) assert.ok(taskFeedback(set, task, { kind: 'mistake', say: rule.say })[0].text);
    }
  });
  test(`연습 ${set.id}: 쉬운 문제가 앞에 온다`, () => {
    const order = set.tasks.map((task) => ['기본', '응용', '도전'].indexOf(task.level));
    assert.deepEqual(order, [...order].sort());
  });
}

test('한 줄씩 보기: 긴 반복은 앞부분만 제 속도로, 나머지는 빠르게 보여 준다', () => {
  // 짧은 시연은 끝까지 제 속도
  for (let i = 0; i < 12; i++) assert.equal(tracePace(i, 12), 1);
  assert.equal(tracePace(15, 16), 1);
  // 긴 시연: 앞의 14줄은 제 속도, 그 뒤는 빠르게(너무 빨라지지는 않게 0.2에서 멈춘다)
  assert.equal(tracePace(13, 81), 1);
  assert.equal(tracePace(14, 81), 0.2);
  assert.ok(tracePace(14, 32) > 0.5 && tracePace(14, 32) < 0.6);
  // 걸리는 시간(줄마다 1.2초): 81줄짜리도 40초를 넘지 않는다
  const seconds = (total) => Array.from({ length: total }, (_, i) => 1.2 * tracePace(i, total)).reduce((a, b) => a + b, 0);
  assert.ok(seconds(81) < 40, `81줄: ${seconds(81)}초`);
  assert.ok(seconds(32) < 30, `32줄: ${seconds(32)}초`);
  // 끝없는 재귀가 오류로 멈추는 시연(2000줄쯤)도 30초 안에 끝난다
  assert.ok(seconds(2000) < 30, `2000줄: ${seconds(2000)}초`);
});

test('예측 문제: 고른 것에 따라 다른 말을 한다', () => {
  const q = first.predict[0];
  assert.equal(predictFeedback(first, q, q.answer).correct, true);
  const wrong = predictFeedback(first, q, 1);
  assert.equal(wrong.correct, false);
  assert.match(wrong.scenes[0].text, /가나다/);
});

test('출력 줄 나누기와 따옴표 지우기', () => {
  assert.deepEqual(outputLines('노포 \n범어사\n\n'), ['노포', '범어사']);
  assert.deepEqual(outputLines('노포\n\n남산\n'), ['노포', '', '남산']);
  assert.equal(stripStrings('print("12 + 30")  # 12 + 30').includes('12'), false);
  assert.equal(stripStrings('print(12 + 30)').includes('12 + 30'), true);
});

test('쓰기 문제 채점: 정답과 흔한 오답을 가려낸다', () => {
  const task = first.tasks[0];
  const kind = (code, output, error = null) => diagnoseTask(task, code, { output, error }).kind;

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

test('오류 설명: 첫 단원에서 나올 만한 실수', () => {
  assert.match(explain({ type: 'NameError', message: "name '노포' is not defined" }), /따옴표/);
  assert.match(explain({ type: 'NameError', message: "name 'Print' is not defined" }), /작은 글자/);
  assert.match(explain({ type: 'SyntaxError', message: "'(' was never closed" }), /괄호/);
  assert.match(explain({ type: 'SyntaxError', message: 'unterminated string literal (detected at line 1)' }), /따옴표/);
  assert.match(explain({ type: 'SyntaxError', message: "invalid character '“' (U+201C)" }), /한\/영/);
  assert.match(explain({ type: 'SyntaxError', message: "Missing parentheses in call to 'print'. Did you mean print(...)?" }), /괄호/);
  assert.match(explain({ type: 'IndentationError', message: 'unexpected indent' }), /빈칸/);
  // 곱하기를 x로 쓴 경우: 파이썬의 글에는 "쉼표를 잊었나요?"라고 나오지만, 코드 줄을 보고 곱하기 기호를 알려 준다
  assert.match(explain({ type: 'SyntaxError', message: 'invalid syntax. Perhaps you forgot a comma?', text: '  File "main.py", line 2\n    print(3 x 4)\n          ^^^^^\nSyntaxError: invalid syntax. Perhaps you forgot a comma?\n' }), /별표/);
  assert.match(explain({ type: 'SyntaxError', message: "invalid character '×' (U+00D7)" }), /별표/);
  assert.match(explain({ type: 'ZeroDivisionError', message: 'division by zero' }), /0으로/);
});
