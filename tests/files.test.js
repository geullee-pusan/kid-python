// 파일 점검: 프로그램이 읽고 쓰는 파일을 실행마다 어떻게 넣고 모으는지, 이름표 칸에 열린 파일이 어떻게 보이는지,
// 파일에서 흔히 나는 오류를 우리말로 어떻게 알려 주는지, 파일로 채점할 때 무엇을 짚는지.
// 앱과 같은 파이썬 실행기(Pyodide)로 돌려 본다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';

import { diagnoseTask, fileProblem } from '../src/core/diagnose.js';
import { explain } from '../src/core/errors-ko.js';

let scripted;
let runUser;

before(async () => {
  const pyodide = await loadPyodide();
  const worker = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'py-worker.js'), 'utf8');
  const body = /const RUNNER_SOURCE = `([\s\S]*?)`;/.exec(worker)[1];
  pyodide.runPython(new Function(`return \`${body}\`;`)());
  const call = pyodide.globals.get('__kidpy_scripted');
  const run = pyodide.globals.get('__kidpy_run');
  scripted = (code, { files = null, trace = false, inputs = [] } = {}) => JSON.parse(call(code, JSON.stringify(inputs), trace, 300, '[]', '[]', 0, JSON.stringify(files)));
  runUser = (code, files = null) => JSON.parse(run(code, JSON.stringify(files)));
});

const KNOWS = { variables: true, loops: true, functions: true, classes: true };
const say = (code, files = null, knows = KNOWS) => {
  const ran = scripted(code, { files });
  assert.ok(ran.error, `${code} → 오류가 나야 한다`);
  return explain(ran.error, knows);
};

test('쓴 파일이 결과에 온다. print(..., file=)과 write 모두', () => {
  const ran = scripted('with open("2단.txt", "w") as 파일:\n    for i in range(1, 4):\n        print(2, "x", i, "=", 2 * i, file=파일)\n    파일.write("끝")');
  assert.equal(ran.error, null);
  assert.equal(ran.output, '');
  assert.deepEqual(ran.files, { '2단.txt': '2 x 1 = 2\n2 x 2 = 4\n2 x 3 = 6\n끝' });
});

test('준 파일을 읽는다. 한글도 그대로', () => {
  const ran = scripted('합 = 0\nwith open("점수.txt") as 파일:\n    for 줄 in 파일:\n        합 += int(줄)\nprint(합)', { files: { '점수.txt': '90\n85\n70\n' } });
  assert.equal(ran.error, null);
  assert.equal(ran.output, '245\n');
});

test('실행할 때마다 폴더를 비운다: 앞 실행에서 쓴 파일이 남지 않는다', () => {
  scripted('open("남은.txt", "w").write("1")');
  const ran = scripted('import os\nprint(os.listdir("."))');
  assert.equal(ran.output, '[]\n');
  runUser('open("남은.txt", "w").write("1")');
  assert.equal(runUser('import os\nprint(os.listdir("."))').files, null);
});

test('파일을 쓰지도 받지도 않은 프로그램은 files가 null이다', () => {
  assert.equal(scripted('print(1)').files, null);
  assert.equal(runUser('print(1)').files, null);
  // 받은 파일이 있으면 그대로 돌려준다(만들기의 "내 파일").
  assert.deepEqual(runUser('print(1)', { '가.txt': '가' }).files, { '가.txt': '가' });
});

test('"a"는 뒤에 붙이고 "w"는 처음부터 다시 쓴다', () => {
  const start = { '방명록.txt': '민수\n' };
  assert.equal(scripted('with open("방명록.txt", "a") as f:\n    print("지아", file=f)', { files: start }).files['방명록.txt'], '민수\n지아\n');
  assert.equal(scripted('with open("방명록.txt", "w") as f:\n    print("지아", file=f)', { files: start }).files['방명록.txt'], '지아\n');
});

test('닫지 않은 파일도 끝나면 닫혀서 내용이 남는다', () => {
  const ran = runUser('f = open("메모.txt", "w")\nprint("안녕", file=f)');
  assert.equal(ran.error, null);
  assert.deepEqual(ran.files, { '메모.txt': '안녕\n' });
});

test('이름표 칸: 열린 파일은 <이름, 쓰기로 열림>, with가 끝나면 <이름, 닫힘>', () => {
  const ran = scripted('with open("가.txt", "w") as 파일:\n    print("하나", file=파일)\nprint("끝")', { trace: true });
  const views = ran.steps.map((step) => step.vars['파일']);
  assert.equal(views[0], '<가.txt, 쓰기로 열림>');
  assert.equal(views.at(-1), '<가.txt, 닫힘>');
  assert.equal(scripted('f = open("가.txt", "a")', { trace: true }).vars.f, '<가.txt, 이어 쓰기로 열림>');
  assert.equal(scripted('f = open("가.txt")', { trace: true, files: { '가.txt': '' } }).vars.f, '<가.txt, 읽기로 열림>');
});

test('한 줄씩 보기: 파일이 바뀐 줄에만 그때의 파일이 붙는다', () => {
  const ran = scripted('with open("가.txt", "w") as 파일:\n    print("하나", file=파일)\n    print("둘", file=파일)\nprint("끝")\nwith open("가.txt", "a") as 파일:\n    print("셋", file=파일)', { trace: true });
  const changes = ran.steps.filter((step) => step.files).map((step) => step.files['가.txt']);
  // 처음 열 때 빈 파일이 생기고, with가 끝날 때 쓴 것이 들어간다(그 전에는 아직 파일에 들어가지 않았다).
  assert.deepEqual(changes, ['', '하나\n둘\n', '하나\n둘\n셋\n']);
  assert.deepEqual(ran.files, { '가.txt': '하나\n둘\n셋\n' });
});

test('폴더를 거쳐 가는 이름은 쓸 수 없다', () => {
  for (const name of ['../x.txt', '/lib/x.txt', 'a/b.txt', '..']) {
    const ran = scripted(`open(${JSON.stringify(name)}, "w")`);
    assert.equal(ran.error?.type, 'PermissionError', name);
    assert.match(explain(ran.error, KNOWS), /폴더 길/);
  }
});

test('끝없이 쓰는 반복은 멈춘다', () => {
  const ran = runUser('f = open("가.txt", "w")\nwhile True:\n    f.write("가나다라마바사아자차카타파하" * 10)');
  assert.equal(ran.error?.type, 'OSError');
  assert.match(explain(ran.error, KNOWS), /너무 많이 써서/);
});

test('파일 오류를 우리말로 알려 준다', () => {
  assert.match(say('open("없는.txt")'), /"없는\.txt"라는 파일이 없어요\. 파일 칸에서/);
  assert.match(say('open("없는.txt")', null, { ...KNOWS, tries: true }), /try와 except FileNotFoundError/);
  assert.match(say('with open("a.txt", "w") as f:\n    f.read()'), /쓰려고 연 파일은 읽을 수 없어요/);
  assert.match(say('with open("a.txt") as f:\n    f.write("x")', { 'a.txt': '' }), /읽으려고 연 파일에는 쓸 수 없어요/);
  assert.match(say('with open("a.txt") as f:\n    pass\nprint(f.read())', { 'a.txt': '' }), /닫힌 파일이에요/);
  assert.match(say('with open("a.txt", "w") as f:\n    f.write(5)'), /write\( \) 안에는 글자만/);
  assert.match(say('open("a.txt", "k")'), /"r"\(읽기\), "w"\(쓰기\), "a"\(이어 쓰기\)/);
  assert.match(say('open("a.txt", "rw")'), /"r"\(읽기\)/);
  assert.match(say('open(점수.txt)'), /따옴표로 감싸요/);
  assert.match(say('with open("a.txt") as f:\n    for 줄 in f:\n        print(int(줄))', { 'a.txt': '1\n\n' }), /빈 줄은 숫자로 바꿀 수 없어요/);
  assert.match(say('open("a.txt", "x")', { 'a.txt': '' }), /"x"는 없는 파일을 새로 만들 때만/);
  assert.match(say('open(3)'), /파일 이름은 글자로/);
});

// ---- 파일로 채점(순수 함수) ----
const want = { '2단.txt': ['2 x 1 = 2', '2 x 2 = 4'] };

test('fileProblem: 맞으면 null, 줄 끝 빈칸과 맨 끝 빈 줄은 보지 않는다', () => {
  assert.equal(fileProblem(want, { '2단.txt': '2 x 1 = 2 \n2 x 2 = 4\n\n' }), null);
});

test('fileProblem: 파일이 없을 때, 이름이 다를 때, 비었을 때, 줄 수와 줄이 다를 때', () => {
  assert.equal(fileProblem(want, {}).kind, 'file-none');
  assert.deepEqual(fileProblem(want, { '2단.text': 'x' }), { kind: 'file-missing', vars: { name: '2단.txt', got: '2단.text' } });
  assert.equal(fileProblem(want, { '2단.txt': '' }).kind, 'file-empty');
  assert.deepEqual(fileProblem(want, { '2단.txt': '2 x 1 = 2\n' }), { kind: 'file-count', vars: { name: '2단.txt', want: 2, got: 1 } });
  assert.deepEqual(fileProblem(want, { '2단.txt': '2 x 1 = 2\n2 x 2 = 5\n' }).vars, { name: '2단.txt', no: '둘째', want: '2 x 2 = 4', got: '2 x 2 = 5' });
  // 쓸 것이 출력 칸에 다 나왔고 파일은 비었다: print에 file= 을 빼먹었다.
  assert.equal(fileProblem(want, { '2단.txt': '' }, ['2 x 1 = 2', '2 x 2 = 4']).kind, 'file-printed');
});

test('diagnoseTask: 출력과 파일이 모두 맞아야 통과하고, 파일 실수도 짚는다', () => {
  const task = {
    expect: [],
    expectFiles: want,
    mistakes: [{ file: '2단.txt', content: '2 x 2 = 4\\n2 x 1 = 2', say: 'reversed' }, { file: '2단.txt', say: 'no-file-here' }],
  };
  const code = 'with open("2단.txt", "w") as f:\n    pass';
  assert.deepEqual(diagnoseTask(task, code, { error: null, output: '', files: { '2단.txt': '2 x 1 = 2\n2 x 2 = 4\n' } }), { kind: 'correct' });
  assert.equal(diagnoseTask(task, code, { error: null, output: '', files: { '2단.txt': '2 x 2 = 4\n2 x 1 = 2\n' } }).say, 'reversed');
  assert.equal(diagnoseTask(task, code, { error: null, output: '', files: {} }).say, 'no-file-here');
  assert.equal(diagnoseTask({ ...task, mistakes: [] }, code, { error: null, output: '2 x 1 = 2\n2 x 2 = 4\n', files: { '2단.txt': '' } }).kind, 'file-printed');
  assert.equal(diagnoseTask({ ...task, mistakes: [] }, code, { error: null, output: '', files: { '2단.txt': '2 x 1 = 2\n' } }).kind, 'file-count');
  // 파일이 맞아도 출력이 다르면 출력부터 짚는다.
  assert.equal(diagnoseTask({ ...task, expect: ['다 썼어요'] }, code, { error: null, output: '', files: { '2단.txt': '2 x 1 = 2\n2 x 2 = 4\n' } }).kind, 'no-output');
});
