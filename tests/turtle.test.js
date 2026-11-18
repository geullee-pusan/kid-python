// 그림판 점검: 파이썬의 turtle 명령(public/py-worker.js)이 남기는 그리기 명령과, 그림 견주기(src/core/drawing.js).
// 화면 없이, 앱과 같은 파이썬 실행기(Pyodide)로 돌려 본다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';

import { compareDrawing, fills, strokes } from '../src/core/drawing.js';
import { explain } from '../src/core/errors-ko.js';

let pyodide;
let scripted;

before(async () => {
  pyodide = await loadPyodide({ env: { PYTHONHASHSEED: '0' } });
  const worker = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'py-worker.js'), 'utf8');
  const body = /const RUNNER_SOURCE = `([\s\S]*?)`;/.exec(worker)[1];
  pyodide.runPython(new Function(`return \`${body}\`;`)());
  const call = pyodide.globals.get('__kidpy_scripted');
  scripted = (code, trace = false, { keys = [], frames = 0 } = {}) => JSON.parse(call(code, '[]', trace, 300, '[]', JSON.stringify(keys), frames));
});

const SQUARE = 'import turtle\nfor i in range(4):\n    turtle.forward(100)\n    turtle.left(90)';
const draw = (code) => {
  const ran = scripted(code);
  assert.equal(ran.error, null, `${code} → ${ran.error?.message}`);
  return ran.draw;
};
const lines = (cmds) => cmds.filter((cmd) => cmd.k === 'line');

test('turtle: 앞으로 가고 돌면 선이 남는다', () => {
  const cmds = draw(SQUARE);
  assert.deepEqual(
    lines(cmds).map((l) => [l.x1, l.y1, l.x2, l.y2]),
    [[0, 0, 100, 0], [100, 0, 100, 100], [100, 100, 0, 100], [0, 100, 0, 0]],
  );
  // 처음 자리와 방향: 가운데, 오른쪽을 본다
  assert.deepEqual(cmds[0], { k: 'pose', t: 0, x: 0, y: 0, h: 0, v: true, s: 'classic', z: [1, 1], c: '#000000', f: '#000000' });
});

test('turtle: 실행할 때마다 처음 상태에서 다시 시작한다', () => {
  draw('import turtle\nturtle.forward(50)\nturtle.left(90)\nturtle.color("red")');
  const again = scripted('import turtle\nprint(turtle.pos(), turtle.heading(), turtle.pencolor())');
  assert.equal(again.output.trim(), '(0.0, 0.0) 0.0 #000000');
  assert.equal(lines(again.draw).length, 0);
});

test('turtle: 펜을 들면 선이 남지 않고, 색과 굵기가 선에 적힌다', () => {
  const cmds = draw('import turtle\nturtle.color("red")\nturtle.pensize(5)\nturtle.forward(30)\nturtle.penup()\nturtle.forward(30)\nturtle.pendown()\nturtle.forward(30)');
  assert.deepEqual(
    lines(cmds).map((l) => [l.x1, l.x2, l.c, l.w]),
    [[0, 30, '#e03131', 5], [60, 90, '#e03131', 5]],
  );
});

test('turtle: goto, 색칠, 원, 점, 글자, 거북이 여러 마리', () => {
  const cmds = draw(
    'from turtle import *\ngoto(10, 20)\nbegin_fill()\nfor i in range(3):\n    forward(60)\n    left(120)\nend_fill()\ndot(10, "blue")\nwrite("안녕")\nt = Turtle()\nt.circle(40)\nprint(round(t.xcor()), round(t.ycor()))\ndone()',
  );
  assert.deepEqual(lines(cmds)[0], { k: 'line', t: 0, x1: 0, y1: 0, x2: 10, y2: 20, c: '#000000', w: 1 });
  const fill = cmds.find((cmd) => cmd.k === 'fill');
  assert.equal(fill.p.length, 4); // 시작한 자리 + 세 번 움직인 자리
  assert.ok(cmds.findIndex((cmd) => cmd.k === 'fill-begin') < cmds.findIndex((cmd) => cmd.k === 'line' && cmd.x1 === 10));
  assert.deepEqual(cmds.find((cmd) => cmd.k === 'dot'), { k: 'dot', t: 0, x: 10, y: 20, r: 5, c: '#1971c2' });
  assert.equal(cmds.find((cmd) => cmd.k === 'text').s, '안녕');
  // 둘째 거북이가 원을 한 바퀴 그리면 제자리로 돌아온다
  assert.ok(lines(cmds).filter((l) => l.t === 1).length >= 12);
  const last = cmds.filter((cmd) => cmd.k === 'pose' && cmd.t === 1).pop();
  assert.ok(Math.abs(last.x) < 0.01 && Math.abs(last.y) < 0.01 && last.h === 0, JSON.stringify(last));
});

test('turtle: 한 줄씩 보기에서 줄마다 그린 것이 따로 온다', () => {
  const ran = scripted(SQUARE, true);
  const byLine = ran.steps.map((step) => [step.line, (step.draw ?? []).map((cmd) => cmd.k).join(' ')]);
  assert.deepEqual(byLine.slice(0, 4), [[1, ''], [2, ''], [3, 'pose line pose'], [4, 'pose']]);
  assert.equal(ran.steps.flatMap((step) => step.draw ?? []).length, ran.draw.length);
});

test('turtle: 그냥 실행에서는 그리는 대로 화면으로 보낸다', () => {
  const sent = [];
  pyodide.globals.set('_kidpy_draw_hook', (text) => sent.push(JSON.parse(text)));
  const result = JSON.parse(pyodide.globals.get('__kidpy_run')('import turtle\nturtle.forward(10)'));
  pyodide.globals.set('_kidpy_draw_hook', undefined);
  assert.equal(result.error, null);
  assert.deepEqual(sent.map((cmd) => cmd.k), ['pose', 'line', 'pose']);
});

test('turtle: 오류를 우리 설명이 알아듣는다', () => {
  const knows = { variables: true, loops: true, functions: true };
  // [코드, 오류 종류, 설명에 들어 있어야 하는 말]
  const cases = [
    ['import turtle\nturtle.color("빨강")', 'TurtleGraphicsError', /색은 영어로/],
    ['import turtle\nwhile True:\n    turtle.forward(1)', 'TurtleGraphicsError', /끝나지 않는/],
    ['import turtle\nturtle.pensize(0)', 'TurtleGraphicsError', /굵기/],
    ['import turtle\nturtle.shape("cat")', 'TurtleGraphicsError', /모양/],
    ['import turtle\nturtle.foward(10)', 'AttributeError', /철자/],
    ['import turtle\nturtle.Forward(10)', 'AttributeError', /작은 글자/],
    ['import turtle\nturtle.stamp()', 'AttributeError', /아직 쓸 수 없는/],
    ['import turtle\ndef 왼쪽():\n    turtle.left(90)\nturtle.onkey(왼쪽(), "Left")', 'TurtleGraphicsError', /괄호를 지워요/],
    ['import turtle\nturtle.onkey(3, "Left")', 'TurtleGraphicsError', /함수의 이름/],
    ['import turtle\ndef 왼쪽():\n    turtle.left(90)\nturtle.onkey(왼쪽, "left")', 'TurtleGraphicsError', /키 이름/],
    ['import turtle\nturtle.shapesize(0)', 'TurtleGraphicsError', /크기/],
    ['import turtle\nturtle.forward()', 'TypeError', /괄호 안에 값을/],
    ['import turtle\nturtle.right(90, 3)', 'TypeError', /개수/],
    ['import turtle\nturtle.goto(10)', 'TypeError', /두 개/],
    ['import turtle\nturtle.forward("100")', 'TypeError', /int\( \)/],
    ['forward(100)', 'NameError', /turtle\.forward/],
    ['turtle.forward(100)', 'NameError', /import turtle/],
  ];
  for (const [code, type, pattern] of cases) {
    const ran = scripted(code);
    assert.equal(ran.error?.type, type, code);
    assert.match(explain(ran.error, knows), pattern, `${code.replace(/\n/g, ' ⏎ ')} → ${ran.error.message}`);
  }
});

test('그림 견주기: 선을 나눠 긋거나 다른 차례로 그어도 같은 그림이다', () => {
  const want = draw(SQUARE);
  // 한 변을 두 번에 나눠 긋기
  assert.equal(compareDrawing(draw('import turtle\nfor i in range(4):\n    turtle.forward(50)\n    turtle.forward(50)\n    turtle.left(90)'), want).kind, 'draw-correct');
  // 반대쪽 모서리에서 시작해서 거꾸로 돌기
  assert.equal(compareDrawing(draw('import turtle\nturtle.penup()\nturtle.goto(100, 100)\nturtle.pendown()\nturtle.left(180)\nfor i in range(4):\n    turtle.forward(100)\n    turtle.left(90)'), want).kind, 'draw-correct');
  // 같은 선을 두 번 긋기
  assert.equal(compareDrawing(draw('import turtle\nfor i in range(8):\n    turtle.forward(100)\n    turtle.left(90)'), want).kind, 'draw-correct');
  assert.equal(strokes(want).length, 4);
});

test('그림 견주기: 어떻게 다른지 가려낸다', () => {
  const want = draw(SQUARE);
  const kind = (code, options) => compareDrawing(draw(code), want, options).kind;
  assert.equal(kind('import turtle\nprint("네모")'), 'draw-none');
  // 왼쪽 대신 오른쪽으로 돌았다(위아래가 뒤집힌 그림)
  assert.equal(kind('import turtle\nfor i in range(4):\n    turtle.forward(100)\n    turtle.right(90)'), 'draw-mirror');
  assert.equal(kind('import turtle\nfor i in range(4):\n    turtle.backward(100)\n    turtle.right(90)'), 'draw-flip');
  assert.equal(kind('import turtle\nfor i in range(3):\n    turtle.forward(100)\n    turtle.left(90)'), 'draw-missing');
  assert.equal(kind('import turtle\nfor i in range(4):\n    turtle.forward(100)\n    turtle.left(90)\nturtle.goto(100, 100)'), 'draw-extra');
  assert.deepEqual(compareDrawing(draw('import turtle\nfor i in range(4):\n    turtle.forward(60)\n    turtle.left(90)'), want), { kind: 'draw-size', vars: { bigger: false } });
  assert.equal(kind('import turtle\nturtle.penup()\nturtle.goto(30, -40)\nturtle.pendown()\nfor i in range(4):\n    turtle.forward(100)\n    turtle.left(90)'), 'draw-moved');
  assert.equal(kind('import turtle\nfor i in range(3):\n    turtle.forward(100)\n    turtle.left(120)'), 'draw-diff');
  // 색은 따로 말했을 때만 견준다
  const red = 'import turtle\nturtle.color("red")\nfor i in range(4):\n    turtle.forward(100)\n    turtle.left(90)';
  assert.equal(kind(red), 'draw-correct');
  assert.equal(kind(red, { color: true }), 'draw-color');
});

test('그림 견주기: 색칠한 도형과 지우기', () => {
  const filled = 'import turtle\nturtle.begin_fill()\nfor i in range(4):\n    turtle.forward(100)\n    turtle.left(90)\nturtle.end_fill()';
  const want = draw(filled);
  assert.deepEqual(fills(want).map((f) => [Math.round(f.area), Math.round(f.x), Math.round(f.y)]), [[10000, 50, 50]]);
  assert.equal(compareDrawing(draw(SQUARE), want).kind, 'draw-fill');
  assert.equal(compareDrawing(draw(filled), want).kind, 'draw-correct');
  assert.equal(compareDrawing(draw(SQUARE), want, { fill: false }).kind, 'draw-correct');
  // clear 앞에 그린 것은 견주지 않는다
  assert.equal(compareDrawing(draw(`import turtle\nturtle.goto(-50, -50)\nturtle.home()\nturtle.clear()\n${filled.replace('import turtle\n', '')}`), want).kind, 'draw-correct');
});

// ---- 움직이는 그림과 게임 ----
const KEYS = 'import turtle\ndef 오른쪽():\n    turtle.forward(20)\ndef 위():\n    turtle.left(90)\nturtle.onkey(오른쪽, "Right")\nturtle.onkey(위, "Up")\n';
const lastPose = (cmds, id = 0) => cmds.filter((cmd) => cmd.k === 'pose' && cmd.t === id).pop();

test('게임: 정해 둔 키를 차례로 넣으면 그 키에 붙여 둔 함수가 불린다', () => {
  const ran = scripted(`${KEYS}turtle.listen()`, false, { keys: ['Right', 'Right', 'Up', 'Right'], frames: 10 });
  assert.equal(ran.error, null, ran.error?.message);
  const pose = lastPose(ran.draw);
  assert.deepEqual([pose.x, pose.y, pose.h], [40, 20, 90]);
  assert.ok(ran.draw.some((cmd) => cmd.k === 'listen'));
});

test('게임: listen을 부르지 않으면 키를 받지 않는다', () => {
  const ran = scripted(KEYS, false, { keys: ['Right', 'Right'], frames: 10 });
  assert.equal(ran.error, null);
  // 함수가 한 번도 불리지 않아서 거북이가 나오지도 않았다.
  assert.equal(lastPose(ran.draw), undefined);
});

test('게임: 끝없이 도는 반복은 정해 둔 장면 수만큼 돌고 끝난다(오류가 아니다)', () => {
  const code = 'import turtle\nimport time\n공 = turtle.Turtle()\n공.shape("circle")\n공.penup()\nturtle.tracer(0)\ndx = 10\nwhile True:\n    공.setx(공.xcor() + dx)\n    if 공.xcor() >= 50 or 공.xcor() <= -50:\n        dx = -dx\n    turtle.update()\n    time.sleep(0.05)';
  const ran = scripted(code, false, { frames: 12 });
  assert.equal(ran.error, null, ran.error?.message);
  // update와 sleep이 장면을 하나씩 센다: 여섯 바퀴를 다 돌고, 일곱째 바퀴에서 움직인 뒤에 끝난다(10, 20, 30, 40, 50, 40, 30).
  assert.equal(lastPose(ran.draw).x, 30);
  assert.equal(lastPose(ran.draw).s, 'circle');
  assert.equal(lines(ran.draw).length, 0);
  assert.deepEqual(ran.draw.find((cmd) => cmd.k === 'tracer'), { k: 'tracer', n: 0 });
  assert.ok(ran.draw.filter((cmd) => cmd.k === 'frame').length >= 6);
  // 장면 수를 정하지 않으면, 전처럼 줄 수를 세다가 멈춘다.
  assert.equal(scripted(code).error?.type, 'TraceLimit');
});

test('게임: 타이머로 되풀이하는 프로그램', () => {
  const ran = scripted('import turtle\ndef 가기():\n    turtle.forward(10)\n    turtle.ontimer(가기, 100)\n가기()\nturtle.mainloop()', false, { frames: 20 });
  assert.equal(ran.error, null, ran.error?.message);
  // 0.02초씩 스무 장면 = 0.4초쯤: 처음 한 번에, 0.1초마다 서너 번을 더 간다.
  assert.ok([40, 50].includes(lastPose(ran.draw).x), String(lastPose(ran.draw).x));
});

test('게임: 모양의 크기와 색, 거북이 사이의 거리, 거북이마다 따로 지우기', () => {
  const ran = scripted(
    'import turtle\n공 = turtle.Turtle()\n공.shape("square")\n공.shapesize(2, 3)\n공.color("red", "yellow")\n공.penup()\n공.goto(30, 40)\n판 = turtle.Turtle()\n판.write("점수: 1")\n판.clear()\n판.write("점수: 2", align="center", font=("Arial", 20, "normal"))\nturtle.forward(50)\nprint(round(공.distance(판)), round(판.distance(공)), round(공.distance(30, 0)))',
  );
  assert.equal(ran.error, null, ran.error?.message);
  assert.equal(ran.output.trim(), '50 50 40');
  const pose = lastPose(ran.draw, 0);
  assert.deepEqual([pose.s, pose.z, pose.c, pose.f], ['square', [2, 3], '#e03131', '#fcc419']);
  // 판이 글자를 지워도 다른 거북이가 그은 선은 남는다.
  assert.equal(strokes(ran.draw).length, 1);
  const texts = ran.draw.filter((cmd) => cmd.k === 'text');
  assert.deepEqual([texts[1].s, texts[1].a, texts[1].z], ['점수: 2', 'center', 20]);
});

test('게임: 그냥 실행에서는 화면이 넘겨준 키를 받는다', () => {
  const sent = [];
  let asked = 0;
  pyodide.globals.set('_kidpy_draw_hook', (text) => sent.push(JSON.parse(text)));
  // 처음 물을 때 오른쪽 키 두 번을 넘기고, 그다음에는 멈춘다(멈춤 버튼을 누른 것처럼).
  pyodide.globals.set('_kidpy_keys_hook', () => {
    asked += 1;
    if (asked > 1) throw new Error('stop');
    return JSON.stringify([['press', 'Right'], ['release', 'Right'], ['release', 'Right'], ['release', 'q']]);
  });
  const result = JSON.parse(pyodide.globals.get('__kidpy_run')(`${KEYS}turtle.listen()`));
  pyodide.globals.set('_kidpy_draw_hook', undefined);
  pyodide.globals.set('_kidpy_keys_hook', undefined);
  assert.ok(result.error, '멈출 때까지 키를 기다려야 해요');
  // onkey는 키를 뗄 때 불린다(진짜 turtle과 같다). 두 번 뗐으니 40을 갔다.
  assert.equal(lastPose(sent).x, 40);
});

test('게임: 끝없이 움직여도 그림 한도에 걸리지 않고, 선을 끝없이 그으면 걸린다', () => {
  const moving = scripted('import turtle\nturtle.penup()\nfor i in range(30000):\n    turtle.forward(1)\n    turtle.backward(1)');
  assert.equal(moving.error, null, moving.error?.message);
  const drawing = scripted('import turtle\nfor i in range(30000):\n    turtle.forward(1)');
  assert.equal(drawing.error?.type, 'TurtleGraphicsError');
});
