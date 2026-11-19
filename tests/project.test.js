// 단원 20 "큰 게임 만들기"를 위한 점검: 앞 수업의 코드 이어 받기, 채점하지 않는 쓰기가 더한 것을 짚는 말,
// 모듈 탭이 있는 게임 채점과 파일을 남기는 게임 채점. 게임은 앱과 같은 실행기(Pyodide)로 돌려 본다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';

import { diagnoseGame } from '../src/core/diagnose.js';
import { describeAdded, pickInherited, withInherited } from '../src/core/project.js';
import { SCRIPTS } from './missions.js';

const SCRIPT_LIST = Object.values(SCRIPTS);

let scripted;

before(async () => {
  const pyodide = await loadPyodide({ env: { PYTHONHASHSEED: '0' } });
  const worker = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'py-worker.js'), 'utf8');
  pyodide.runPython(new Function(`return \`${/const RUNNER_SOURCE = `([\s\S]*?)`;/.exec(worker)[1]}\`;`)());
  const call = pyodide.globals.get('__kidpy_scripted');
  scripted = (code, { keys = [], frames = 0, files = null } = {}) => JSON.parse(call(code, '[]', false, 300, '[]', JSON.stringify(keys), frames, JSON.stringify(files)));
});

test('큰 만들기 단원: 이어 받는 문제의 선생님 코드는 앞 문제의 모범 답이다', () => {
  const all = SCRIPT_LIST.flatMap((m) => [...(m.tasks ?? []), ...(m.challenge ? [m.challenge] : [])].map((t) => [`${m.id}/${t.id}`, { mission: m, task: t }]));
  const byId = new Map(all);
  let count = 0;
  for (const [id, { mission, task }] of all) {
    if (!task.continues) continue;
    count += 1;
    assert.ok(mission.project, `${id}: continues가 있으면 수업에 project가 있어야 해요`);
    for (const from of task.continues) assert.ok(byId.has(from), `${id}: 없는 문제를 이어 받아요 (${from})`);
    // 선생님 코드(이어 받을 것이 없을 때)는 첫째로 적은 문제의 모범 답과 같아야 한다. 고칠 수 없게 준 탭은 수업마다 다를 수 있다.
    const prev = byId.get(task.continues[0]).task;
    assert.equal(task.start, prev.solution, `${id}: start가 ${task.continues[0]}의 모범 답과 달라요`);
    for (const [name, code] of Object.entries(prev.solutionModules ?? {})) {
      if ((task.lockModules ?? []).includes(name)) continue;
      assert.equal(task.modules?.[name], code, `${id}: ${name}이 ${task.continues[0]}의 모범 답과 달라요`);
    }
  }
  assert.ok(count >= 10, '단원 20의 이어 받는 문제');
});

test('이어 받기: continues에 적은 앞 문제 가운데 가장 나중에 통과한 코드', () => {
  const saved = {
    'a/walk': { main: 'A', modules: { '섬캐릭터.py': 'a' }, at: '2026-11-19T01:00:00Z' },
    'a/wall': { main: 'B', modules: { '섬캐릭터.py': 'b' }, at: '2026-11-19T02:00:00Z' },
    'z/other': { main: 'Z', at: '2026-11-19T03:00:00Z' },
  };
  assert.equal(pickInherited({ continues: ['a/walk', 'a/wall'] }, saved).main, 'B');
  assert.equal(pickInherited({ continues: ['a/walk'] }, saved).main, 'A');
  assert.equal(pickInherited({ continues: ['b/none'] }, saved), null);
  assert.equal(pickInherited({}, saved), null);
});

test('이어 받기: 시작 코드 자리에 내 코드를 넣고, 고칠 수 없게 준 탭은 문제의 것을 둔다', () => {
  const task = { start: '선생님', modules: { '섬설정.py': '걸음 = 20', '섬캐릭터.py': '선생님 클래스' }, lockModules: ['섬설정.py'] };
  const mine = { main: '내 main', modules: { '섬설정.py': '걸음 = 99', '섬캐릭터.py': '내 클래스' } };
  const begin = withInherited(task, mine);
  assert.equal(begin.start, '내 main');
  assert.deepEqual(begin.modules, { '섬설정.py': '걸음 = 20', '섬캐릭터.py': '내 클래스' });
  assert.equal(withInherited(task, null), task);
});

test('채점하지 않는 쓰기: 더한 클래스, 메서드, 키, 바꾼 설정 값을 짚는다', () => {
  const before = {
    main: 'import turtle\nturtle.onkeypress(왼쪽, "Left")\n',
    modules: { '섬캐릭터.py': 'class 탐험가:\n    def __init__(self):\n        pass\n    def 왼쪽(self):\n        pass\n', '섬설정.py': '걸음 = 20\n목숨 = 3\n' },
  };
  const after = {
    main: 'import turtle\nturtle.onkeypress(왼쪽, "Left")\nturtle.onkeypress(멈춤, "p")\nturtle.onkeypress(뛰기, "space")\n',
    modules: {
      '섬캐릭터.py': `${before.modules['섬캐릭터.py']}\nclass 상어:\n    def __init__(self):\n        pass\n    def 헤엄(self):\n        pass\n`,
      '섬설정.py': '걸음 = 30\n목숨 = 3\n색 = "red"\n',
      '꽃.py': 'def 피기():\n    pass\n',
    },
  };
  assert.deepEqual(describeAdded(before, after, 10), [
    '꽃.py 파일을 새로 만들었어요.',
    'p, 스페이스 키에 할 일을 붙였어요.',
    '섬캐릭터.py에 상어 클래스를 새로 만들었어요.',
    '섬캐릭터.py에 메서드 헤엄을 새로 만들었어요.',
    '섬설정.py의 걸음을 20에서 30으로 바꿨어요.',
    '꽃.py에 함수 피기를 새로 만들었어요.',
  ]);
  // 조사: 받침 없는 이름은 를, ㄹ 받침과 1·7·8로 끝나는 값은 로
  assert.deepEqual(describeAdded({ main: '빠르기 = 3\n높이 = 2\n' }, { main: '빠르기 = 1\n높이 = 8\n' }), ['main.py의 빠르기를 3에서 1로 바꿨어요.', 'main.py의 높이를 2에서 8로 바꿨어요.']);
  // 바꾼 것이 없으면 아무 말도 하지 않는다. 많으면 앞의 넷만.
  assert.deepEqual(describeAdded(before, before), []);
  assert.equal(describeAdded(before, after).length, 4);
});

// 모듈 탭에 클래스를 두고, main.py는 장면을 돌다가 끝나면 기록 파일을 쓴다.
const CHAR = 'import turtle\n\nclass 탐험가:\n    def __init__(self):\n        self.몸 = turtle.Turtle()\n        self.몸.penup()\n    def 오른쪽(self):\n        self.몸.setx(self.몸.xcor() + 20)\n';
const MAIN = (written) =>
  `import turtle\nimport time\nfrom 섬캐릭터 import 탐험가\nturtle.tracer(0)\n나 = 탐험가()\nturtle.onkeypress(나.오른쪽, "Right")\nturtle.listen()\n장면 = 0\nwhile 장면 < 4:\n    장면 += 1\n    turtle.update()\n    time.sleep(0.02)\nwith open("기록.txt", "w") as 파일:\n    print(${written}, file=파일)\n`;

test('게임 채점: 모듈 탭과 함께 돌리고, 장면이 맞으면 남긴 파일도 본다', () => {
  const options = { keys: ['Right', 'Right'], frames: 10, files: { '섬캐릭터.py': CHAR } };
  const want = scripted(MAIN('나.몸.xcor()'), options);
  assert.equal(want.error, null, want.error?.message);
  assert.ok(want.draw.some((cmd) => cmd.k === 'pose' && cmd.x === 40), '오른쪽으로 두 번 갔다');
  const task = { game: true, expectFiles: { '기록.txt': ['40.0'] } };
  assert.deepEqual(diagnoseGame(task, MAIN('나.몸.xcor()'), want, want), { kind: 'correct' });
  const wrong = scripted(MAIN('0'), options);
  assert.equal(diagnoseGame(task, MAIN('0'), wrong, want).kind, 'file-diff');
  // 모듈 탭이 없으면 import부터 안 된다
  assert.equal(scripted(MAIN('0'), { ...options, files: null }).error.type, 'ModuleNotFoundError');
});

test('게임 채점: checks와 mistakes의 in으로 모듈 탭의 코드를 본다', () => {
  const ran = { draw: [], output: '' };
  const task = { game: true, checks: [{ pattern: 'class\\s+게', in: '섬캐릭터.py', say: 'need-crab' }], mistakes: [{ code: '목숨\\s*-=', in: 'main.py', say: 'crab-drain' }] };
  assert.deepEqual(diagnoseGame(task, '', ran, ran, { '섬캐릭터.py': 'class 게:\n    pass' }), { kind: 'correct' });
  assert.deepEqual(diagnoseGame(task, '', ran, ran, { '섬캐릭터.py': '' }), { kind: 'mistake', say: 'need-crab' });
  // 장면이 다를 때, game 종류를 적지 않고 code만 적은 실수도 짚는다
  const moved = { draw: [{ k: 'pose', t: 1, x: 10, y: 0, h: 0, v: true }], output: '' };
  const still = { draw: [{ k: 'pose', t: 1, x: 0, y: 0, h: 0, v: true }], output: '' };
  assert.deepEqual(diagnoseGame(task, '목숨 -= 1', moved, still, {}), { kind: 'mistake', say: 'crab-drain' });
});
