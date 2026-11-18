// 단원 18 "더 짧고 편하게 쓰기"를 위한 점검: 집합의 차례가 실행마다 같은지, 이름표 칸에 튜플과 집합이 아이가 치는 모양으로
// 보이는지, 한 줄로 만드는 리스트를 한 줄씩 볼 때 어떻게 보이는지, f를 빼먹은 것을 알아보는지, 오류를 우리말로 알려 주는지.
// 앱과 같은 파이썬 실행기(Pyodide)로, 앱과 같은 해시 값(PYTHONHASHSEED=0)으로 돌려 본다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';

import { diagnoseTask, missingF } from '../src/core/diagnose.js';
import { explain } from '../src/core/errors-ko.js';

const WORKER = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'py-worker.js'), 'utf8');
const RUNNER = new Function(`return \`${/const RUNNER_SOURCE = `([\s\S]*?)`;/.exec(WORKER)[1]}\`;`)();

async function runner() {
  const pyodide = await loadPyodide({ env: { PYTHONHASHSEED: '0' } });
  pyodide.runPython(RUNNER);
  const call = pyodide.globals.get('__kidpy_scripted');
  return (code, trace = false) => JSON.parse(call(code, '[]', trace, 300, '[]', '[]', 0, 'null'));
}

let scripted;
before(async () => {
  scripted = await runner();
});

const KNOWS = { variables: true, loops: true, functions: true, classes: true };
const say = (code) => {
  const ran = scripted(code);
  assert.ok(ran.error, `${code} → 오류가 나야 한다`);
  return explain(ran.error, KNOWS);
};

test('앱의 실행기는 해시를 고정해서 띄운다', () => {
  assert.match(WORKER, /loadPyodide\(\{[^}]*env: \{ PYTHONHASHSEED: '0' \}/);
});

test('집합의 차례는 실행기를 새로 띄워도 같다', async () => {
  const code = 'print({"감", "배", "사과", "귤", "딸기", "포도", "수박"})';
  const first = scripted(code).output;
  const again = (await runner())(code).output;
  assert.equal(again, first);
});

test('이름표 칸: 튜플과 집합, 튜플의 리스트를 큰따옴표로', () => {
  const ran = scripted('점 = ("하늘", 90)\n집 = {"감"}\n빈 = set()\n하나 = (1,)\n표 = [(1, 2), (3, 4)]\n짝 = list(zip(["가", "나"], [1, 2]))\n사 = {1: "a", "b": [True, None]}\n실 = 2.5');
  assert.equal(ran.error, null);
  assert.deepEqual(ran.vars, {
    점: '("하늘", 90)',
    집: '{"감"}',
    빈: 'set()',
    하나: '(1,)',
    표: '[(1, 2), (3, 4)]',
    짝: '[("가", 1), ("나", 2)]',
    사: '{1: "a", "b": [True, None]}',
    실: '2.5',
  });
});

test('이름표 칸: 전에 보이던 모양은 그대로다', () => {
  const ran = scripted('가 = "하나"\n나 = [1, "둘"]\n다 = [[1, 2], [3]]\n라 = {"사과": 1000, "배": [1, 2]}\n마 = True\n바 = None');
  assert.deepEqual(ran.vars, { 가: '"하나"', 나: '[1, "둘"]', 다: '[[1, 2], [3]]', 라: '{"사과": 1000, "배": [1, 2]}', 마: 'True', 바: 'None' });
});

test('한 줄씩 보기: 한 줄로 만드는 리스트는 그 줄에서 x가 바뀌고, 끝나면 x가 사라진다', () => {
  const ran = scripted('수들 = [1, 2, 3]\n두배 = [x * 2 for x in 수들]\nprint(두배)', true);
  assert.deepEqual(ran.steps.map((step) => [step.line, step.vars.x ?? null, step.vars['두배'] ?? null]), [
    [1, null, null],
    [2, '1', null],
    [2, '2', null],
    [2, '3', null],
    [2, null, '[2, 4, 6]'],
    [3, null, '[2, 4, 6]'],
  ]);
});

test('바꿔 넣기와 return 두 값', () => {
  const ran = scripted('가, 나 = 1, 2\n가, 나 = 나, 가\ndef 나누기(a, b):\n    return a // b, a % b\n몫, 나머지 = 나누기(7, 2)\n둘 = 나누기(9, 4)\nprint(가, 나, 몫, 나머지, 둘)');
  assert.equal(ran.output, '2 1 3 1 (2, 1)\n');
  assert.equal(ran.vars['둘'], '(2, 1)');
});

test('f를 빼먹은 것을 알아본다', () => {
  assert.equal(missingF('이름 = "하늘"\nprint("{이름} 님")', '{이름} 님', '하늘 님'), '{이름}');
  assert.equal(missingF("print('{가로 * 세로}')", '{가로 * 세로}', '12'), '{가로 * 세로}');
  // f가 붙어 있거나, 나와야 하는 것에도 중괄호가 있으면 아니다
  assert.equal(missingF('print(f"{이름}")', '{이름}', ''), null);
  assert.equal(missingF('print("{이름}")', '{이름}', '{이름}'), null);
  // 딕셔너리를 그대로 print한 것은 아니다
  assert.equal(missingF('print({"a": 1})', "{'a': 1}", ''), null);
  const task = { expect: ['하늘 님은 3번째'] };
  assert.deepEqual(diagnoseTask(task, '이름 = "하늘"\n수 = 3\nprint("{이름} 님은 {수}번째")', { error: null, output: '{이름} 님은 {수}번째\n' }), { kind: 'missing-f', vars: { piece: '{이름}' } });
  // 파일에 쓴 것도 본다
  const fileTask = { expect: [], expectFiles: { '성적.txt': ['하늘 90'] } };
  assert.equal(diagnoseTask(fileTask, 'with open("성적.txt", "w") as f:\n    print("{이름} {점수}", file=f)', { error: null, output: '', files: { '성적.txt': '{이름} {점수}\n' } }).kind, 'missing-f');
});

test('단원 18의 오류를 우리말로 알려 준다', () => {
  assert.match(say('가, 나 = 1, 2, 3'), /받는 이름표는 2개인데 값은 3개예요/);
  assert.match(say('가, 나, 다 = 1, 2'), /받는 이름표는 3개인데 값은 2개예요/);
  assert.match(say('가, 나 = 5'), /값 하나를 이름표 여러 개에/);
  assert.match(say('for a, b in [1, 2]:\n    pass'), /zip\( \)이나 enumerate\( \)/);
  assert.match(say('for a, b in [(1, 2, 3)]:\n    pass'), /for에서 받는 이름표는 2개인데, 한 번에 나오는 값은 3개예요/);
  assert.match(say('t = (1, 2)\nt[0] = 3'), /튜플은 바꿀 수 없는 리스트/);
  assert.match(say('t = (1, 2)\nt.append(3)'), /튜플은 바꿀 수 없는 리스트/);
  assert.match(say('s = {1}\nprint(s[0])'), /집합에는 차례가 없어서 번호로/);
  assert.match(say('s = {1}\ns.append(2)'), /add\( \)를 써요/);
  assert.match(say('s = {[1, 2]}'), /집합에는 리스트를 넣을 수 없어요/);
  assert.match(say('s = set()\ns.add([1])'), /집합에는 리스트를 넣을 수 없어요/);
  assert.match(say('d = {[1]: 2}'), /딕셔너리의 키로 쓸 수 없어요/);
  assert.match(say('이름 = "a"\nprint(f"{이름")'), /여는 중괄호 \{ 를 닫지 않았어요/);
  assert.match(say('print(f"{}")'), /중괄호 \{ \} 안이 비었어요/);
  assert.match(say('print(f"이름}")'), /닫는 중괄호 \} 만 있어요/);
  assert.match(say('print(round("3.5", 1))'), /round\( \) 안에는 숫자를/);
});
