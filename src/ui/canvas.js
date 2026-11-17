// 그림판. 파이썬의 turtle 명령이 남긴 그리기 명령(public/py-worker.js)을 받아서 그린다.
// - 좌표는 가운데가 (0, 0), 위쪽이 y의 +. 그림판의 크기는 가로 480, 세로 360(화면에서는 늘려서 보여 준다).
// - 선은 거북이가 움직이는 것처럼 차례로 그어진다. 빠르기는 turtle.speed( )로 정하고, 그릴 것이 많이 밀리면 저절로 빨라진다.
// - 다 그린 것은 따로 둔 종이(ink)에 남기고, 화면에는 종이 + 지금 긋는 선 + 거북이를 겹쳐 보여 준다.

export const VIEW = { w: 480, h: 360 };
const SCALE = 2; // 그림판 안쪽의 실제 점 수(선이 흐릿하지 않게)
const X = (x) => VIEW.w / 2 + x;
const Y = (y) => VIEW.h / 2 - y;
// 밀린 그림을 다 그리는 데 걸리는 시간의 한도. 넘을 것 같으면 선 하나에 쓰는 시간을 줄인다.
const DRAIN_MS = 9000;

/** 다 그려진 것 하나를 종이에 그린다. */
function paintItem(ctx, item) {
  if (item.k === 'line') {
    ctx.strokeStyle = item.c;
    ctx.lineWidth = item.w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(X(item.x1), Y(item.y1));
    ctx.lineTo(X(item.x2), Y(item.y2));
    ctx.stroke();
  } else if (item.k === 'fill') {
    if (!item.p || item.p.length < 3) return;
    ctx.fillStyle = item.c;
    ctx.beginPath();
    item.p.forEach(([x, y], index) => (index ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath();
    ctx.fill();
  } else if (item.k === 'dot') {
    ctx.fillStyle = item.c;
    ctx.beginPath();
    ctx.arc(X(item.x), Y(item.y), item.r, 0, Math.PI * 2);
    ctx.fill();
  } else if (item.k === 'text') {
    ctx.fillStyle = item.c;
    ctx.font = '16px system-ui, "Noto Sans KR", sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(item.s, X(item.x), Y(item.y));
  }
}

/** 거북이(또는 화살표)를 그린다. */
function paintTurtle(ctx, t) {
  if (!t.v) return;
  ctx.save();
  ctx.translate(X(t.x), Y(t.y));
  ctx.rotate((-t.h * Math.PI) / 180);
  if (t.s === 'turtle') {
    ctx.fillStyle = '#2f9e44';
    ctx.strokeStyle = '#1b6e2d';
    ctx.lineWidth = 1;
    for (const [lx, ly] of [[5, -7], [5, 7], [-5, -7], [-5, 7]]) {
      ctx.beginPath();
      ctx.arc(lx, ly, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(10, 0, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, 8.5, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = '#1f2937';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** 명령 목록을 그림 목록(그릴 차례대로)으로 바꾼다. 색칠은 시작한 자리에 끼워 넣어, 그 뒤에 그은 선이 위에 오게 한다. */
function build(cmds) {
  const state = { items: [], bg: '#ffffff', turtles: new Map() };
  for (const cmd of cmds) apply(state, cmd);
  return state;
}

function apply(state, cmd) {
  if (cmd.k === 'line' || cmd.k === 'dot' || cmd.k === 'text') state.items.push(cmd);
  else if (cmd.k === 'fill-begin') state.items.push({ k: 'fill', n: cmd.n, p: null, c: '#000000' });
  else if (cmd.k === 'fill') {
    const slot = state.items.find((item) => item.k === 'fill' && item.n === cmd.n && !item.p);
    if (slot) Object.assign(slot, { p: cmd.p, c: cmd.c });
    else state.items.push(cmd);
  } else if (cmd.k === 'clear') state.items = [];
  else if (cmd.k === 'bg') state.bg = cmd.c;
  else if (cmd.k === 'pose') state.turtles.set(cmd.t, { x: cmd.x, y: cmd.y, h: cmd.h, v: cmd.v, s: cmd.s });
}

/**
 * 명령 목록을 한 번에 그린다(문제의 본보기 그림처럼 움직임이 필요 없을 때).
 * @param {HTMLCanvasElement} canvas
 * @param {object[]} cmds
 * @param {{turtle?: boolean}} options turtle: 거북이도 그릴지
 */
export function paintDrawing(canvas, cmds, { turtle = false } = {}) {
  canvas.width = VIEW.w * SCALE;
  canvas.height = VIEW.h * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  const state = build(cmds);
  ctx.fillStyle = state.bg;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  for (const item of state.items) paintItem(ctx, item);
  if (turtle) for (const t of state.turtles.values()) paintTurtle(ctx, t);
}

/**
 * @param {HTMLElement} root 그림판을 넣을 자리
 * @param {{rate?: number}} options rate: 빨리 돌려 보기(?fast)일 때 움직임을 몇 배로 빠르게 할지
 */
export function createCanvas(root, { rate = 1 } = {}) {
  root.classList.add('canvas-pane');
  const canvas = document.createElement('canvas');
  canvas.width = VIEW.w * SCALE;
  canvas.height = VIEW.h * SCALE;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '그림판');
  root.append(canvas);
  const ctx = canvas.getContext('2d');
  const ink = document.createElement('canvas');
  ink.width = canvas.width;
  ink.height = canvas.height;
  const inkCtx = ink.getContext('2d');

  let state = { items: [], bg: '#ffffff', turtles: new Map() };
  let queue = [];
  let linesWaiting = 0; // 그을 차례를 기다리는 선의 수
  let deadline = 0; // 밀린 것을 이때까지는 다 그린다
  let speedNow = 3;
  let current = null; // 지금 긋는 선 { cmd, started, ms }
  let frame = null;
  let timer = null;
  let waiters = [];

  function redrawInk() {
    inkCtx.setTransform(1, 0, 0, 1, 0, 0);
    inkCtx.clearRect(0, 0, ink.width, ink.height);
    inkCtx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    for (const item of state.items) paintItem(inkCtx, item);
  }

  function show(part) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(ink, 0, 0);
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    if (part) paintItem(ctx, part);
    for (const t of state.turtles.values()) paintTurtle(ctx, t);
  }

  /** 명령 하나를 바로 끝낸다. */
  function finish(cmd) {
    const before = state.items;
    apply(state, cmd);
    if (cmd.k === 'line' || cmd.k === 'dot' || cmd.k === 'text') {
      inkCtx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      paintItem(inkCtx, cmd);
    } else if (cmd.k === 'fill' || cmd.k === 'clear' || state.items !== before) redrawInk();
    else if (cmd.k === 'speed') speedNow = cmd.v;
  }

  /** 선 하나를 긋는 데 쓸 시간(ms). 빠르기 0은 바로, 밀린 것이 많으면 줄인다. */
  function duration(cmd, cap, at) {
    if (speedNow === 0) return 0;
    const length = Math.hypot(cmd.x2 - cmd.x1, cmd.y2 - cmd.y1);
    const perSecond = 40 * speedNow ** 1.6 * rate;
    // 남은 시간을 남은 선의 수로 나눈 것보다 오래 끌지 않는다.
    return Math.min((length / perSecond) * 1000, Math.max(0, deadline - at) / (linesWaiting + 1), cap ?? Infinity);
  }

  function tick() {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = null;
    timer = null;
    const now = performance.now();
    let part = null;
    let carry = null;
    const budget = performance.now() + 10; // 한 번에 너무 오래 그리지 않는다
    for (;;) {
      if (current) {
        const done = current.ms <= 0 ? 1 : Math.min(1, (now - current.started) / current.ms);
        const { cmd } = current;
        if (done < 1) {
          const x = cmd.x1 + (cmd.x2 - cmd.x1) * done;
          const y = cmd.y1 + (cmd.y2 - cmd.y1) * done;
          part = { ...cmd, x2: x, y2: y };
          const t = state.turtles.get(cmd.t);
          if (t) Object.assign(t, { x, y });
          break;
        }
        finish(cmd);
        // 짧은 선이 많을 때는 한 화면에 여러 개를 긋는다: 다음 선은 이 선이 끝난 때부터 시작한 것으로 친다.
        carry = current.started + current.ms;
        current = null;
        if (performance.now() > budget) break;
      }
      const next = queue.shift();
      if (!next) break;
      if (next.cmd.k === 'line') {
        linesWaiting -= 1;
        const started = carry !== null && now - carry < 200 ? carry : now;
        const ms = duration(next.cmd, next.cap, started);
        if (ms > 0) {
          current = { cmd: next.cmd, started, ms };
          continue;
        }
      }
      finish(next.cmd);
      if (performance.now() > budget) break;
    }
    show(part);
    if (current || queue.length) wake();
    else {
      const resolve = waiters;
      waiters = [];
      for (const done of resolve) done();
    }
  }

  // 화면이 가려져 있으면 브라우저가 화면 그리기 신호를 보내지 않는다. 그때도 그림이 멈추지 않게 타이머를 함께 건다.
  function wake() {
    if (frame || timer) return;
    frame = requestAnimationFrame(tick);
    timer = setTimeout(tick, 60);
  }

  function drain() {
    if (current) finish(current.cmd);
    current = null;
    for (const next of queue) finish(next.cmd);
    queue = [];
    linesWaiting = 0;
  }

  show();

  return {
    /** 새 프로그램을 돌리기 전에: 그림과 거북이를 모두 지운다. */
    reset() {
      queue = [];
      linesWaiting = 0;
      current = null;
      speedNow = 3;
      state = { items: [], bg: '#ffffff', turtles: new Map() };
      redrawInk();
      show();
    },
    /**
     * 그리기 명령을 받는다. 차례로 움직이며 그린다.
     * @param {object[]} cmds
     * @param {{maxMs?: number}} options maxMs: 선 하나에 쓸 시간의 한도(한 줄씩 보기에서 줄마다 끝나게)
     */
    push(cmds, { maxMs } = {}) {
      for (const cmd of cmds) {
        queue.push({ cmd, cap: maxMs });
        if (cmd.k === 'line') linesWaiting += 1;
      }
      deadline = performance.now() + DRAIN_MS / rate;
      wake();
    },
    /** 밀린 것을 움직임 없이 바로 다 그린다. */
    flush() {
      drain();
      show();
    },
    /** 명령 목록을 움직임 없이 한 번에 그린다(채점한 결과를 보여 줄 때). */
    showAll(cmds) {
      this.reset();
      for (const cmd of cmds) finish(cmd);
      show();
    },
    /** 멈춤: 아직 안 그린 것은 버린다. */
    stop() {
      queue = [];
      linesWaiting = 0;
      if (current) finish(current.cmd);
      current = null;
      show();
    },
    /** 밀린 것을 다 그리면 끝나는 약속 */
    idle() {
      if (!current && !queue.length) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    /** 지금까지 무엇을 그렸는가(점검용) */
    snapshot: () => ({ items: state.items.length, waiting: queue.length + (current ? 1 : 0), turtles: [...state.turtles.values()] }),
  };
}

/** 이 코드가 그림판을 쓰는가(실행하기 전에 그림판을 미리 보여 주려고) */
export function usesTurtle(code) {
  return /^\s*(import\s+turtle\b|from\s+turtle\s+import\b)/m.test(code);
}
