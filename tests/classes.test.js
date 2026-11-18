// 클래스 점검: 아이가 만든 클래스의 객체를 이름표 칸에 어떻게 보여 주는지, 한 줄씩 볼 때 self가 누구인지,
// 클래스에서 흔히 나는 오류를 우리말로 어떻게 알려 주는지. 앱과 같은 파이썬 실행기(Pyodide)로 돌려 본다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';

import { explain } from '../src/core/errors-ko.js';

let scripted;

before(async () => {
  const pyodide = await loadPyodide({ env: { PYTHONHASHSEED: '0' } });
  const worker = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'py-worker.js'), 'utf8');
  const body = /const RUNNER_SOURCE = `([\s\S]*?)`;/.exec(worker)[1];
  pyodide.runPython(new Function(`return \`${body}\`;`)());
  const call = pyodide.globals.get('__kidpy_scripted');
  scripted = (code, trace = false) => JSON.parse(call(code, '[]', trace, 300, '[]', '[]', 0));
});

const STUDENT = 'class 학생:\n    def __init__(self, 이름, 점수):\n        self.이름 = 이름\n        self.점수 = 점수\n    def 소개(self):\n        print(self.이름, self.점수)\n';
const KNOWS = { variables: true, loops: true, functions: true, classes: true };
const say = (code) => {
  const ran = scripted(code);
  assert.ok(ran.error, `${code} → 오류가 나야 한다`);
  return explain(ran.error, KNOWS);
};

test('이름표 칸: 객체는 클래스 이름과 안에 든 값으로 보인다', () => {
  const ran = scripted(`${STUDENT}가 = 학생("민수", 90)\n가.점수 += 5`);
  assert.equal(ran.error, null);
  assert.equal(ran.vars['가'], '학생(이름="민수", 점수=95)');
  // 클래스 자체는 이름표 칸에 나오지 않는다(함수처럼)
  assert.equal('학생' in ran.vars, false);
});

test('이름표 칸: 값이 없는 객체, 점으로 나중에 넣은 값', () => {
  const ran = scripted('class 공:\n    pass\n가 = 공()\n나 = 공()\n나.dx = 3\n나.색 = "red"');
  assert.equal(ran.vars['가'], '공()');
  assert.equal(ran.vars['나'], '공(dx=3, 색="red")');
});

test('이름표 칸: 객체의 리스트, 객체 안의 리스트·거북이·다른 객체', () => {
  const list = scripted(`${STUDENT}들 = [학생("민수", 90), 학생("지아", 85)]`);
  assert.equal(list.vars['들'], '[학생(이름="민수", 점수=90), 학생(이름="지아", 점수=85)]');
  const inside = scripted('import turtle\nclass 공:\n    def __init__(self):\n        self.몸 = turtle.Turtle()\n        self.점수들 = [1, 2]\n        self.짝 = None\n가 = 공()\n나 = 공()\n가.짝 = 나');
  assert.equal(inside.vars['가'], '공(몸=<거북이 1>, 점수들=[1, 2], 짝=<공>)');
  assert.equal(inside.vars['나'], '공(몸=<거북이 2>, 점수들=[1, 2], 짝=None)');
});

test('이름표 칸: 너무 길면 줄인다. 보여 줄 모양을 스스로 정한 클래스는 그 모양대로', () => {
  const long = scripted(`${STUDENT}들 = []\nfor i in range(6):\n    들.append(학생("이름이 긴 학생", i))`);
  assert.ok(long.vars['들'].length <= 80);
  assert.match(long.vars['들'], /\.\.\.$/);
  const own = scripted('class 점:\n    def __repr__(self):\n        return "점!"\n가 = 점()');
  assert.equal(own.vars['가'], '점!');
});

test('한 줄씩 보기: __init__ 안에서는 만들어지는 객체가 차례로 채워지고, 메서드 안에서는 self가 누구인지 보인다', () => {
  const ran = scripted(`${STUDENT}가 = 학생("민수", 90)\n나 = 학생("지아", 85)\n나.소개()`, true);
  assert.equal(ran.error, null);
  const selves = ran.steps.map((step) => step.vars.self).filter(Boolean);
  // 가를 만드는 동안: 빈 객체 → 이름이 들어간 객체. 그 뒤 나를 만드는 동안도 같다. 나.소개() 안에서는 self가 나다.
  assert.deepEqual(selves, ['학생()', '학생(이름="민수")', '학생()', '학생(이름="지아")', '나']);
  // 메서드가 끝나면 self는 사라진다
  assert.equal('self' in ran.vars, false);
});

test('오류 설명: self를 빼먹은 경우들', () => {
  assert.match(say('class 학생:\n    def 소개():\n        print("안녕")\n가 = 학생()\n가.소개()'), /맨 앞에 self.*def 소개\(self\)/);
  assert.match(say(`${STUDENT}가 = 학생("민수", 90)\nprint(self.이름)`), /클래스 안의 함수에서만/);
  const C = 'class 학생:\n    def __init__(self, 점수):\n        self.점수 = 점수\n';
  assert.match(say(`${C}    def 보기(self):\n        print(점수)\n가 = 학생(3)\n가.보기()`), /self\.점수 라고/);
  assert.match(say(`${C}    def 올리기(self):\n        점수 += 1\n가 = 학생(3)\n가.올리기()`), /self\.점수 라고/);
  // 클래스와 상관없는 함수 안의 이름 오류는 전과 같다
  assert.doesNotMatch(say('def 보기():\n    print(점수)\n보기()'), /self/);
});

test('오류 설명: 만들 때와 부를 때 값의 개수(self는 세지 않는다)', () => {
  assert.match(say(`${STUDENT}가 = 학생()`), /학생\( \)로 만들 때 넣을 값이 모자라요. 빠진 것: 이름, 점수/);
  assert.match(say(`${STUDENT}가 = 학생("민수")`), /빠진 것: 점수/);
  assert.match(say(`${STUDENT}가 = 학생("민수", 90, 3)`), /값을 3개 넣었는데, 받기로 한 것은 2개/);
  assert.match(say(`${STUDENT}가 = 학생("민수", 90)\n가.소개(3)`), /소개\( \)를 부를 때 값을 1개 넣었는데, 받기로 한 것은 0개/);
  assert.match(say('class 통:\n    def __init__(self):\n        self.돈 = 0\n    def 넣기(self, 얼마):\n        self.돈 += 얼마\n가 = 통()\n가.넣기()'), /넣기\( \)를 부를 때 넣을 값이 모자라요. 빠진 것: 얼마/);
  // 그냥 함수의 안내는 전과 같다
  assert.match(say('def 더하기(a, b):\n    return a + b\n더하기(1)'), /함수가 받기로 한 값/);
});

test('오류 설명: __init__의 밑줄, 괄호 없이 만든 객체, 없는 이름', () => {
  assert.match(say('class 학생:\n    def _init_(self, 이름):\n        self.이름 = 이름\n가 = 학생("민수")'), /__init__.*밑줄/);
  assert.match(say(`${STUDENT}가 = 학생\nprint(가.이름)`), /학생은 클래스의 이름이에요.*괄호/);
  assert.match(say(`${STUDENT}가 = 학생\n가.소개()`), /학생은 클래스의 이름이에요/);
  assert.match(say(`${STUDENT}가 = 학생("민수", 90)\nprint(가.점슈)`), /"점슈"라는 이름이 없어요/);
  assert.match(say(`${STUDENT}가 = 학생("민수", 90)\n가.이름()`), /괄호 없이/);
  assert.match(say(`${STUDENT}가 = 학생("민수", 90)\nprint("이름: " + 가)`), /객체를 그대로 이을 수 없어요/);
  assert.match(say(`${STUDENT}가 = 학셍("민수", 90)`), /함수나 클래스가 아직 없어요/);
  // 거북이와 글자의 안내는 전과 같다
  assert.match(say('import turtle\n공 = turtle.Turtle()\n공.foward(10)'), /turtle 뒤의 이름/);
  assert.match(say('글 = "abc"\n글.appned("d")'), /글자 뒤의 점/);
});
