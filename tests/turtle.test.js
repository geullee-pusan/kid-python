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
  pyodide = await loadPyodide();
  const worker = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'py-worker.js'), 'utf8');
  const body = /const RUNNER_SOURCE = `([\s\S]*?)`;/.exec(worker)[1];
  pyodide.runPython(new Function(`return \`${body}\`;`)());
  const call = pyodide.globals.get('__kidpy_scripted');
  scripted = (code, trace = false) => JSON.parse(call(code, '[]', trace, 300, '[]'));
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
  assert.deepEqual(cmds[0], { k: 'pose', t: 0, x: 0, y: 0, h: 0, v: true, s: 'classic' });
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
    ['import turtle\nturtle.onkey(print, "a")', 'AttributeError', /아직 쓸 수 없는/],
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
