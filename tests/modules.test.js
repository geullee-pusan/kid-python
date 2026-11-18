// 단원 19 "파일 나눠 쓰기와 import"를 위한 점검: 아이가 만든 .py(도구.py)를 import할 때
// 실행마다 새로 불러오는지, 파이썬 모듈과 이름이 겹치는 파일을 알려 주는지, 한 줄씩 보기에서 어느 파일의 줄인지 적는지,
// 모듈 안에서 난 오류의 자리를 그 파일로 잡는지, 오류를 우리말로 알려 주는지. 앱과 같은 실행기(Pyodide)로 돌려 본다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';

import { explain } from '../src/core/errors-ko.js';

let scripted;
let runUser;

before(async () => {
  const pyodide = await loadPyodide({ env: { PYTHONHASHSEED: '0' } });
  const worker = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'py-worker.js'), 'utf8');
  pyodide.runPython(new Function(`return \`${/const RUNNER_SOURCE = `([\s\S]*?)`;/.exec(worker)[1]}\`;`)());
  const call = pyodide.globals.get('__kidpy_scripted');
  const run = pyodide.globals.get('__kidpy_run');
  scripted = (code, files = null, trace = false) => JSON.parse(call(code, '[]', trace, 300, '[]', '[]', 0, JSON.stringify(files)));
  runUser = (code, files = null) => JSON.parse(run(code, JSON.stringify(files)));
});

const KNOWS = { variables: true, loops: true, functions: true, classes: true, tries: true };
const say = (code, files = null) => {
  const ran = scripted(code, files);
  assert.ok(ran.error, `${code} → 오류가 나야 한다`);
  return explain(ran.error, KNOWS);
};
const TOOL = { '도구.py': 'def 두배(x):\n    return x * 2\n' };

test('도구.py를 import해서 쓴다. 한글 이름도 된다', () => {
  const ran = scripted('import 도구\nprint(도구.두배(4))', TOOL);
  assert.equal(ran.error, null);
  assert.equal(ran.output, '8\n');
  assert.equal(scripted('from 도구 import 두배\nprint(두배(5))', TOOL).output, '10\n');
  assert.equal(scripted('import 도구 as 도\nprint(도.두배(1))', TOOL).output, '2\n');
});

test('실행마다 새로 불러온다: 고친 도구, 지운 도구', () => {
  scripted('import 도구\nprint(도구.두배(4))', TOOL);
  assert.equal(scripted('import 도구\nprint(도구.두배(4))', { '도구.py': 'def 두배(x):\n    return x * 3\n' }).output, '12\n');
  assert.equal(scripted('import 도구', null).error?.type, 'ModuleNotFoundError');
  // 그냥 실행(만들기)도 같다
  runUser('import 도구', TOOL);
  assert.equal(runUser('import 도구', null).error?.type, 'ModuleNotFoundError');
});

test('불러올 때 모듈이 한 번 실행되고, __name__으로 가른다', () => {
  const tool = { '도구.py': 'print("불러옴")\nif __name__ == "__main__":\n    print("시험")\n' };
  assert.equal(scripted('import 도구\nimport 도구\nprint("끝")', tool).output, '불러옴\n끝\n');
});

test('모듈 안의 리스트는 main.py에서 바꾼 것이 모듈에도 보인다', () => {
  const ran = scripted('import 자료\n자료.낱말들.append("배")\nprint(자료.개수())', { '자료.py': '낱말들 = ["감"]\ndef 개수():\n    return len(낱말들)\n' });
  assert.equal(ran.output, '2\n');
});

test('파이썬 모듈과 이름이 같은 파일은 실행 전에 알려 준다', () => {
  for (const name of ['random.py', 'math.py', 'turtle.py', 'json.py']) {
    const ran = scripted('print(1)', { [name]: 'x = 1\n' });
    assert.equal(ran.error?.type, 'ModuleNameError', name);
    assert.equal(ran.output, '');
    assert.match(explain(ran.error, KNOWS), /이미 있는 모듈의 이름/);
  }
  assert.equal(runUser('print(1)', { 'random.py': '' }).error?.type, 'ModuleNameError');
});

test('한 줄씩 보기: 도구.py의 줄도 적고, 어느 파일인지 적는다', () => {
  const ran = scripted('import 도구\n값 = 도구.두배(3)\nprint(값)', TOOL, true);
  assert.deepEqual(ran.steps.map((s) => [s.file ?? 'main.py', s.line]), [
    ['main.py', 1],
    ['도구.py', 1],
    ['main.py', 2],
    ['도구.py', 2],
    ['main.py', 3],
  ]);
  // 도구의 함수 안에서는 넘겨받은 x가 보인다
  assert.ok(ran.steps.some((s) => s.vars.x === '3'));
});

test('모듈 안의 끝나지 않는 반복도 멈춘다', () => {
  const ran = scripted('import 도구\n도구.돌기()', { '도구.py': 'def 돌기():\n    while True:\n        pass\n' });
  assert.equal(ran.error?.type, 'TraceLimit');
});

test('오류의 자리: 도구.py 안에서 나면 그 파일과 줄', () => {
  const ran = scripted('import 도구\n도구.나눔(1)', { '도구.py': 'def 나눔(x):\n    return x / 0\n' });
  assert.equal(ran.error.type, 'ZeroDivisionError');
  assert.equal(ran.error.file, '도구.py');
  assert.equal(ran.error.line, 2);
  assert.match(ran.error.text, /File "도구\.py", line 2/);
  assert.doesNotMatch(ran.error.text, /home/);
  // 문법 오류가 도구.py에 있을 때
  const bad = scripted('import 도구', { '도구.py': 'def 두배(x)\n    return x\n' });
  assert.equal(bad.error.type, 'SyntaxError');
  assert.equal(bad.error.file, '도구.py');
  assert.equal(bad.error.line, 1);
  // main.py에서 난 오류에는 file이 없다(전과 같다)
  assert.equal(scripted('print(1 / 0)').error.file, null);
});

test('모듈 오류를 우리말로 알려 준다', () => {
  assert.match(say('import 도구'), /도구\.py라는 파일이 없어요/);
  assert.match(say('import 도구.py', TOOL), /\.py를 빼고/);
  assert.match(say('import 도구\n도구.세배(2)', TOOL), /도구\.py 안에 "세배"라는 이름이 없어요/);
  assert.match(say('from 도구 import 세배', TOOL), /도구에는 "세배"라는 이름이 없어요/);
  assert.match(say('import 도구\n두배(2)', TOOL), /도구\.두배 처럼 앞에 도구와 점을/);
  assert.match(say('import math\nprint(sqrt(16))'), /math\.sqrt 처럼 앞에 math와 점을/);
  assert.match(say('print(math.pi)'), /import math 를 먼저/);
  assert.match(say('import math\nprint(math.squrt(4))'), /math 뒤의 이름이 달라요/);
  assert.match(say('import math\nprint(math.sqrt(-1))'), /음수의 제곱근/);
  assert.match(say('import Math'), /모두 작은 글자/);
  // import하지 않은 프로그램의 이름 e는 math.e로 짐작하지 않는다
  assert.doesNotMatch(say('print(e)'), /math/);
});

// ---- 순수 함수: 모듈과 파일 가르기, 탭마다 보는 채점 ----
import { diagnoseTask } from '../src/core/diagnose.js';
import { errorAt, splitFiles, validModuleName, withModules } from '../src/core/modules.js';

test('모듈과 파일을 합치고 가른다', () => {
  assert.equal(withModules(null, {}), null);
  assert.deepEqual(withModules(null, { '도구.py': 'x' }), { '도구.py': 'x' });
  assert.deepEqual(withModules({}, {}), {});
  assert.deepEqual(withModules({ 'a.txt': '1' }, { '도구.py': 'x' }), { 'a.txt': '1', '도구.py': 'x' });
  assert.deepEqual(splitFiles({ 'a.txt': '1', '도구.py': 'x' }), { data: { 'a.txt': '1' }, modules: { '도구.py': 'x' } });
  assert.equal(errorAt({ line: 2, file: '도구.py' }), ' (도구.py 2번 줄)');
  assert.equal(errorAt({ line: 3, file: null }), ' (3번 줄)');
  assert.equal(errorAt({ line: null }), '');
  for (const ok of ['도구.py', 'my_tools.py', '도구2.py']) assert.ok(validModuleName(ok), ok);
  for (const bad of ['2도구.py', '내 도구.py', '도구', '도-구.py', '.py']) assert.ok(!validModuleName(bad), bad);
});

test('채점: checks와 mistakes의 in으로 탭을 골라 본다', () => {
  const task = {
    expect: ['8'],
    checks: [{ in: '도구.py', pattern: String.raw`def\s+두배`, say: 'need-def-tool' }, { pattern: String.raw`도구\.`, say: 'need-dot' }],
    mistakes: [{ in: '도구.py', code: String.raw`x \* 3`, say: 'times-three' }],
  };
  const run = (output) => ({ error: null, output });
  assert.deepEqual(diagnoseTask(task, 'import 도구\nprint(도구.두배(4))', run('8\n'), { '도구.py': 'def 두배(x):\n    return x * 2' }), { kind: 'correct' });
  assert.equal(diagnoseTask(task, 'print(8)', run('8\n'), { '도구.py': 'def 두배(x):\n    return x * 2' }).say, 'need-dot');
  assert.equal(diagnoseTask(task, 'import 도구\nprint(도구.셋(4))', run('8\n'), { '도구.py': 'def 셋(x):\n    return 8' }).say, 'need-def-tool');
  assert.equal(diagnoseTask(task, 'import 도구\nprint(도구.두배(4))', run('12\n'), { '도구.py': 'def 두배(x):\n    return x * 3' }).say, 'times-three');
});
