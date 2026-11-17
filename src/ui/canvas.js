// 그림판. 파이썬의 turtle 명령이 남긴 그리기 명령(public/py-worker.js)을 받아서 그린다.
// - 좌표는 가운데가 (0, 0), 위쪽이 y의 +. 그림판의 크기는 가로 480, 세로 360(화면에서는 늘려서 보여 준다).
// - 선은 거북이가 움직이는 것처럼 차례로 그어진다. 빠르기는 turtle.speed( )로 정하고, 그릴 것이 많이 밀리면 저절로 빨라진다.
// - turtle.tracer(0)을 쓴 프로그램(게임)은 움직임을 하나하나 보여 주지 않고, turtle.update()마다 한 장면을 한꺼번에 바꾼다.
// - 다 그린 것은 따로 둔 종이(ink)에 남기고, 화면에는 종이 + 지금 긋는 선 + 거북이를 겹쳐 보여 준다.
// - 프로그램이 turtle.listen()을 부르면 그림판이 키를 받는다. 화면에 누를 수 있는 화살표 단추도 나온다.

export const VIEW = { w: 480, h: 360 };
const SCALE = 2; // 그림판 안쪽의 실제 점 수(선이 흐릿하지 않게)
const X = (x) => VIEW.w / 2 + x;
const Y = (y) => VIEW.h / 2 - y;
// 밀린 그림을 다 그리는 데 걸리는 시간의 한도. 넘을 것 같으면 선 하나에 쓰는 시간을 줄인다.
const DRAIN_MS = 9000;

/** 브라우저의 키 이름을 turtle의 키 이름으로. 모르는 키는 null. */
export function turtleKey(event) {
  const names = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'space', Spacebar: 'space', Enter: 'Return' };
  if (names[event.key]) return names[event.key];
  if (/^[a-zA-Z0-9]$/.test(event.key)) return event.key.toLowerCase();
  return null;
}

/** 다 그려진 것 하나를 종이에 그린다. */
function paintItem(ctx, item, minText = 0) {
  if (item.k === 'line') {
    ctx.strokeStyle = item.c;
    // 그림판을 줄여서 보여 주므로, 굵기 1인 선이 흐려지지 않게 조금 굵게 긋는다(보이는 굵기만 다르다).
    ctx.lineWidth = Math.max(item.w, 1.6);
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
    ctx.font = `${Math.max(item.z ?? 16, minText)}px system-ui, "Noto Sans KR", sans-serif`;
    ctx.textAlign = ['left', 'center', 'right'].includes(item.a) ? item.a : 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(item.s, X(item.x), Y(item.y));
    ctx.textAlign = 'left';
  }
}

/** 거북이를 그 모양(화살표, 거북이, 동그라미, 네모, 세모)과 색, 크기로 그린다. */
function paintTurtle(ctx, t) {
  if (!t.v) return;
  const [wid, len] = t.z ?? [1, 1];
  const plain = (t.f ?? '#000000') === '#000000' && (t.c ?? '#000000') === '#000000';
  ctx.save();
  ctx.translate(X(t.x), Y(t.y));
  ctx.rotate((-t.h * Math.PI) / 180);
  ctx.scale(len, wid); // 가는 방향이 가로(len), 가로지르는 쪽이 세로(wid)
  ctx.lineWidth = 1 / Math.max(len, wid);
  ctx.fillStyle = t.f ?? '#000000';
  ctx.strokeStyle = t.c ?? '#000000';
  ctx.beginPath();
  if (t.s === 'turtle') {
    // 색을 정하지 않은 거북이는 초록색으로 보여 준다.
    if (plain) {
      ctx.fillStyle = '#2f9e44';
      ctx.strokeStyle = '#1b6e2d';
    }
    for (const [lx, ly] of [[5, -7], [5, 7], [-5, -7], [-5, 7]]) {
      ctx.moveTo(lx + 2.6, ly);
      ctx.arc(lx, ly, 2.6, 0, Math.PI * 2);
    }
    ctx.moveTo(13.6, 0);
    ctx.arc(10, 0, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, 8.5, 6.5, 0, 0, Math.PI * 2);
  } else if (t.s === 'circle') {
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
  } else if (t.s === 'square') {
    ctx.rect(-10, -10, 20, 20);
  } else if (t.s === 'triangle') {
    ctx.moveTo(11.5, 0);
    ctx.lineTo(-5.8, 10);
    ctx.lineTo(-5.8, -10);
    ctx.closePath();
  } else {
    // 화살표: 선 위에서도 보이게 흰 테두리를 두른다.
    if (plain) ctx.strokeStyle = '#ffffff';
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -6);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
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
  else if (cmd.k === 'fill-begin') state.items.push({ k: 'fill', t: cmd.t, n: cmd.n, p: null, c: '#000000' });
  else if (cmd.k === 'fill') {
    const slot = state.items.find((item) => item.k === 'fill' && item.n === cmd.n && !item.p);
    if (slot) Object.assign(slot, { p: cmd.p, c: cmd.c });
    else state.items.push(cmd);
  } else if (cmd.k === 'clear') {
    // 지우기는 그 거북이가 그린 것만 지운다(점수판 거북이가 글자를 지워도 다른 그림은 남는다).
    state.items = state.items.filter((item) => item.t !== cmd.t);
  } else if (cmd.k === 'bg') state.bg = cmd.c;
  else if (cmd.k === 'pose') state.turtles.set(cmd.t, { x: cmd.x, y: cmd.y, h: cmd.h, v: cmd.v, s: cmd.s, z: cmd.z, c: cmd.c, f: cmd.f });
}

/**
 * 명령 목록을 한 번에 그린다(문제의 본보기 그림처럼 움직임이 필요 없을 때).
 * @param {HTMLCanvasElement} canvas
 * @param {object[]} cmds
 * @param {{turtle?: boolean, origin?: boolean, fit?: boolean}} options turtle: 거북이도 그릴지. origin: 가운데 (0, 0)에 옅은 십자.
 * minText: 글자의 가장 작은 크기(작은 본보기 그림에서도 점수판 글자가 읽히게).
 * fit: 그림이 작으면 그림과 가운데 (0, 0)이 함께 보이는 만큼 키워서 보여 준다(칠판의 작은 본보기 그림에서 쓴다).
 */
export function paintDrawing(canvas, cmds, { turtle = false, origin = false, fit = false, minText = 0 } = {}) {
  canvas.width = VIEW.w * SCALE;
  canvas.height = VIEW.h * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  const state = build(cmds);
  ctx.fillStyle = state.bg;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  if (fit) {
    const xs = [0];
    const ys = [0];
    for (const item of state.items) {
      if (item.k === 'line') xs.push(item.x1, item.x2), ys.push(item.y1, item.y2);
      else if (item.k === 'fill' && item.p) for (const [x, y] of item.p) xs.push(x), ys.push(y);
      else if (item.k === 'dot') xs.push(item.x - item.r, item.x + item.r), ys.push(item.y - item.r, item.y + item.r);
    }
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const zoom = Math.max(1, Math.min(2.5, (VIEW.w - 50) / Math.max(x1 - x0, 1), (VIEW.h - 50) / Math.max(y1 - y0, 1)));
    ctx.translate(VIEW.w / 2, VIEW.h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-VIEW.w / 2 - (x0 + x1) / 2, -VIEW.h / 2 + (y0 + y1) / 2);
  }
  if (origin) {
    // 가운데 (0, 0)을 옅은 십자로 표시한다(그림이 어디에 놓이는지 보이게).
    ctx.strokeStyle = '#ced4da';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(-8), Y(0));
    ctx.lineTo(X(8), Y(0));
    ctx.moveTo(X(0), Y(-8));
    ctx.lineTo(X(0), Y(8));
    ctx.stroke();
  }
  for (const item of state.items) paintItem(ctx, item, minText);
  if (turtle) for (const t of state.turtles.values()) paintTurtle(ctx, t);
}

/**
 * @param {HTMLElement} root 그림판을 넣을 자리
 * @param {{rate?: number, onKey?: (kind: 'press'|'release', name: string) => void, onListen?: (on: boolean) => void, onEscape?: () => void}} options
 *   rate: 빨리 돌려 보기(?fast)일 때 움직임을 몇 배로 빠르게 할지
 *   onKey: 그림판이 키를 받았을 때(프로그램이 turtle.listen()을 부른 뒤에만)
 *   onListen: 프로그램이 키를 받기 시작했을 때(true)와 끝났을 때(false)
 *   onEscape: 키를 받는 동안 Esc를 눌렀을 때(프로그램을 멈추는 데 쓴다)
 */
export function createCanvas(root, { rate = 1, onKey, onListen, onEscape } = {}) {
  root.classList.add('canvas-pane');
  root.tabIndex = -1;
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

  // 화면의 화살표 단추(키보드가 없거나 그림판을 누르지 않았을 때도 조종할 수 있게). 그림을 가리지 않게 그림판 아래에 둔다.
  const pad = document.createElement('div');
  pad.className = 'canvas-pad';
  pad.hidden = true;
  for (const [name, label, text] of [['Left', '왼쪽', '◀'], ['Up', '위', '▲'], ['Down', '아래', '▼'], ['Right', '오른쪽', '▶'], ['space', '스페이스', '␣']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'canvas-key';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      onKey?.('press', name);
    });
    for (const type of ['pointerup', 'pointercancel']) button.addEventListener(type, () => onKey?.('release', name));
    pad.append(button);
  }
  root.after(pad);

  let state = { items: [], bg: '#ffffff', turtles: new Map() };
  let queue = [];
  let linesWaiting = 0; // 그을 차례를 기다리는 선의 수
  let deadline = 0; // 밀린 것을 이때까지는 다 그린다
  let speedNow = 3;
  let current = null; // 지금 긋는 선 { cmd, started, ms }
  let frame = null;
  let timer = null;
  let waiters = [];
  let instant = false; // turtle.tracer(0): 한 장면씩 그린다
  let held = []; // 한 장면이 다 올 때까지 모아 두는 명령
  let listening = false;

  function setListening(on) {
    if (listening === on) return;
    listening = on;
    pad.hidden = !on;
    onListen?.(on);
  }

  root.addEventListener('keydown', (event) => {
    if (!listening) return;
    if (event.key === 'Escape') {
      onEscape?.();
      return;
    }
    const name = turtleKey(event);
    if (!name || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault(); // 화살표와 스페이스가 화면을 밀지 않게
    onKey?.('press', name);
  });
  root.addEventListener('keyup', (event) => {
    if (!listening) return;
    const name = turtleKey(event);
    if (name) onKey?.('release', name);
  });
  root.addEventListener('pointerdown', () => {
    if (listening) root.focus();
  });

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
    if (cmd.k === 'line' || cmd.k === 'dot' || cmd.k === 'text') {
      apply(state, cmd);
      inkCtx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      paintItem(inkCtx, cmd);
    } else if (cmd.k === 'fill' || cmd.k === 'clear') {
      const before = state.items.length;
      apply(state, cmd);
      // 지울 것이 없었으면 다시 그리지 않는다(게임은 장면마다 지운다).
      if (cmd.k === 'fill' || state.items.length !== before) redrawInk();
    } else if (cmd.k === 'speed') speedNow = cmd.v;
    else if (cmd.k === 'listen') setListening(true);
    else apply(state, cmd);
  }

  /** 선 하나를 긋는 데 쓸 시간(ms). 빠르기 0은 바로, 밀린 것이 많으면 줄인다. */
  function duration(cmd, cap, at) {
    if (speedNow === 0) return 0;
    const length = Math.hypot(cmd.x2 - cmd.x1, cmd.y2 - cmd.y1);
    const perSecond = 40 * speedNow ** 1.6 * rate;
    // 남은 시간을 남은 선의 수로 나눈 것보다 오래 끌지 않는다.
    return Math.min((length / perSecond) * 1000, Math.max(0, deadline - at) / (linesWaiting + 1), cap ?? Infinity);
  }

  /** 모아 둔 한 장면을 한꺼번에 그림에 넣는다. */
  function release() {
    for (const cmd of held) finish(cmd);
    held = [];
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
      const { cmd } = next;
      if (cmd.k === 'line') linesWaiting -= 1;
      if (cmd.k === 'tracer') {
        // 한 장면씩 그리기를 켜거나 끈다. 끌 때는 모아 둔 것을 내보낸다.
        instant = cmd.n === 0;
        if (!instant) release();
        continue;
      }
      if (instant) {
        // 한 장면이 다 올 때까지 모아 두었다가, update()가 오면 한꺼번에 바꾼다(지우고 다시 쓰는 사이가 보이지 않게).
        if (cmd.k === 'frame') release();
        else if (cmd.k === 'listen') finish(cmd);
        else held.push(cmd);
        if (performance.now() > budget) break;
        continue;
      }
      if (cmd.k === 'frame') continue;
      if (cmd.k === 'line') {
        const started = carry !== null && now - carry < 200 ? carry : now;
        const ms = duration(cmd, next.cap, started);
        if (ms > 0) {
          current = { cmd, started, ms };
          continue;
        }
      }
      finish(cmd);
      if (performance.now() > budget) break;
    }
    show(part);
    if (current || queue.length) wake();
    else settle();
  }

  function settle() {
    const resolve = waiters;
    waiters = [];
    for (const done of resolve) done();
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
    for (const next of queue) {
      if (next.cmd.k === 'tracer') instant = next.cmd.n === 0;
      else if (next.cmd.k !== 'frame') finish(next.cmd);
    }
    queue = [];
    linesWaiting = 0;
    release();
  }

  show();

  return {
    /** 새 프로그램을 돌리기 전에: 그림과 거북이를 모두 지운다. */
    reset() {
      queue = [];
      held = [];
      instant = false;
      linesWaiting = 0;
      current = null;
      speedNow = 3;
      state = { items: [], bg: '#ffffff', turtles: new Map() };
      setListening(false);
      redrawInk();
      show();
      settle();
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
      settle();
    },
    /** 명령 목록을 움직임 없이 한 번에 그린다(채점한 결과를 보여 줄 때). */
    showAll(cmds) {
      this.reset();
      for (const cmd of cmds) if (cmd.k !== 'listen') finish(cmd);
      show();
    },
    /** 멈춤: 아직 안 그린 것은 버린다. */
    stop() {
      queue = [];
      held = [];
      linesWaiting = 0;
      if (current) finish(current.cmd);
      current = null;
      setListening(false);
      show();
      settle();
    },
    /** 프로그램이 끝났을 때: 키를 그만 받는다. 아직 못 그린 것은 마저 그린다(한 장면씩 그리던 것은 바로). */
    endRun() {
      if (instant) {
        drain();
        show();
        settle();
      }
      setListening(false);
    },
    /** 그림판이 키를 받게 한다. */
    focus() {
      root.focus({ preventScroll: true });
    },
    /** 밀린 것을 다 그리면 끝나는 약속 */
    idle() {
      if (!current && !queue.length) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    /** 지금까지 무엇을 그렸는가(점검용) */
    snapshot: () => ({ items: state.items.length, waiting: queue.length + (current ? 1 : 0), turtles: [...state.turtles.values()], listening, instant }),
  };
}

/** 이 코드가 그림판을 쓰는가(실행하기 전에 그림판을 미리 보여 주려고) */
export function usesTurtle(code) {
  return /^\s*(import\s+turtle\b|from\s+turtle\s+import\b)/m.test(code);
}
