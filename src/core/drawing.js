// 그림판에 그린 그림을 견준다. 순수 함수다(화면 없이 테스트할 수 있다).
// 파이썬의 turtle 명령은 "무엇을 그렸는지"를 명령 목록으로 남긴다(public/py-worker.js).
//   { k: 'line', x1, y1, x2, y2, c, w }   선
//   { k: 'fill', p: [[x, y], …], c }       색칠한 도형
//   { k: 'dot', x, y, r, c }               점
//   { k: 'clear' }                         지금까지 그린 것을 지움
// 그린 순서나 방향, 한 선을 몇 번에 나눠 그었는지는 달라도 된다. 다 그린 그림이 같으면 같은 그림이다.

const ANGLE_TOL = 0.4; // 도
const OFFSET_TOL = 0.75;
const GAP_TOL = 0.75;

/** 명령 목록에서 마지막 clear 뒤의 것만 남긴다. */
function afterClear(cmds) {
  let from = 0;
  cmds.forEach((cmd, index) => {
    if (cmd.k === 'clear') from = index + 1;
  });
  return cmds.slice(from);
}

/**
 * 선분들을 모아, 한 직선 위에서 이어지거나 겹치는 것을 하나로 합친다.
 * useColor가 true면 색이 다른 선은 합치지 않는다.
 * @returns {{x1: number, y1: number, x2: number, y2: number, c: string}[]}
 */
export function strokes(cmds, useColor = false) {
  const groups = [];
  for (const cmd of afterClear(cmds)) {
    if (cmd.k !== 'line') continue;
    const dx = cmd.x2 - cmd.x1;
    const dy = cmd.y2 - cmd.y1;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) continue;
    // 방향을 0도 이상 180도 미만으로 맞춘다(거꾸로 그은 선도 같은 직선이다).
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle < 0) angle += 180;
    if (angle >= 180 - ANGLE_TOL / 2) angle -= 180;
    const rad = (angle * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    const offset = cmd.x1 * uy - cmd.y1 * ux; // 원점에서 직선까지의 거리(부호 있음)
    const a = cmd.x1 * ux + cmd.y1 * uy;
    const b = cmd.x2 * ux + cmd.y2 * uy;
    const color = useColor ? cmd.c : '';
    let group = groups.find((g) => g.color === color && Math.abs(g.angle - angle) < ANGLE_TOL && Math.abs(g.offset - offset) < OFFSET_TOL);
    if (!group) {
      group = { angle, offset, ux, uy, color, c: cmd.c, spans: [] };
      groups.push(group);
    }
    group.spans.push([Math.min(a, b), Math.max(a, b)]);
  }
  const out = [];
  for (const group of groups) {
    const spans = group.spans.sort((p, q) => p[0] - q[0]);
    let [from, to] = spans[0];
    const flush = () => {
      // 직선 위의 자리(from, to)를 다시 좌표로 바꾼다.
      const px = group.offset * group.uy;
      const py = -group.offset * group.ux;
      out.push({ x1: px + from * group.ux, y1: py + from * group.uy, x2: px + to * group.ux, y2: py + to * group.uy, c: group.c });
    };
    for (const [a, b] of spans.slice(1)) {
      if (a <= to + GAP_TOL) to = Math.max(to, b);
      else {
        flush();
        [from, to] = [a, b];
      }
    }
    flush();
  }
  return out;
}

/** 색칠한 도형들: 넓이와 가운데 자리로 견준다. */
export function fills(cmds) {
  return afterClear(cmds)
    .filter((cmd) => cmd.k === 'fill' && cmd.p.length >= 3)
    .map((cmd) => {
      let area = 0;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < cmd.p.length; i++) {
        const [x1, y1] = cmd.p[i];
        const [x2, y2] = cmd.p[(i + 1) % cmd.p.length];
        const cross = x1 * y2 - x2 * y1;
        area += cross;
        cx += (x1 + x2) * cross;
        cy += (y1 + y2) * cross;
      }
      area /= 2;
      if (Math.abs(area) < 0.01) return { area: 0, x: cmd.p[0][0], y: cmd.p[0][1], c: cmd.c };
      return { area: Math.abs(area), x: cx / (6 * area), y: cy / (6 * area), c: cmd.c };
    })
    .filter((fill) => fill.area > 0);
}

function near(ax, ay, bx, by, tol) {
  return Math.hypot(ax - bx, ay - by) <= tol;
}

/** 점 (px, py)에서 선분 s까지의 거리 */
function distance(px, py, s) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

/** 선분 small이 선분 big 위에 놓여 있는가(big이 더 길어도 된다) */
function covers(big, small, tol) {
  return distance(small.x1, small.y1, big) <= tol && distance(small.x2, small.y2, big) <= tol;
}

/**
 * 두 선분 묶음을 견준다.
 * missing: 본보기에는 있는데 그리지 않은(또는 덜 그은) 선. extra: 본보기에 없는(또는 더 길게 그은) 선.
 * 한 직선 위에서 이어진 선은 하나로 합쳐져 있으므로, 양 끝이 같은지가 아니라 "그 선 위에 놓였는지"로 본다.
 * 그래야 본보기의 두 선 사이를 잇는 선을 더 그었을 때 '더 그은 선'으로 알아본다.
 * pairs: 양쪽이 똑같은 선끼리의 짝(색을 견줄 때 쓴다).
 */
function matchStrokes(got, want, tol) {
  const missing = want.filter((w) => !got.some((g) => covers(g, w, tol)));
  const extra = got.filter((g) => !want.some((w) => covers(w, g, tol)));
  const pairs = [];
  for (const w of want) {
    const g = got.find((one) => covers(one, w, tol) && covers(w, one, tol));
    if (g) pairs.push([g, w]);
  }
  return { missing, extra, pairs };
}

const moved = (list, fn) => list.map((s) => ({ ...s, ...fn(s.x1, s.y1, 1), ...fn(s.x2, s.y2, 2) }));
const point = (x, y, n) => ({ [`x${n}`]: x, [`y${n}`]: y });

/**
 * 아이가 그린 것(got)과 모범 답이 그린 것(want)을 견준다.
 * @param {object[]} got 그리기 명령 목록
 * @param {object[]} want 그리기 명령 목록
 * @param {{color?: boolean, fill?: boolean, tolerance?: number}} options color: 선의 색도 같아야 한다. fill: 색칠도 견준다.
 * @returns {{kind: string, vars?: object}}
 *   kind: draw-correct, draw-none(아무것도 안 그림), draw-mirror(위아래가 뒤집힘: 왼쪽과 오른쪽을 바꿔 돎),
 *         draw-flip(왼쪽 오른쪽이 뒤집힘), draw-moved(자리가 다름), draw-size(크기가 다름),
 *         draw-missing(덜 그림), draw-extra(더 그림), draw-diff(다른 그림), draw-color(색이 다름), draw-fill(색칠이 다름)
 */
export function compareDrawing(got, want, { color = false, fill = true, tolerance = 2 } = {}) {
  const mine = strokes(got, color);
  const theirs = strokes(want, color);
  const myFills = fills(got);
  const theirFills = fills(want);
  if (mine.length === 0 && myFills.length === 0 && (theirs.length > 0 || theirFills.length > 0)) return { kind: 'draw-none' };

  const { missing, extra, pairs } = matchStrokes(mine, theirs, tolerance);
  if (missing.length === 0 && extra.length === 0) {
    if (color && pairs.some(([g, w]) => g.c !== w.c)) return { kind: 'draw-color' };
    if (fill) {
      const left = [...myFills];
      for (const w of theirFills) {
        const at = left.findIndex((g) => Math.abs(g.area - w.area) <= w.area * 0.04 + 12 && near(g.x, g.y, w.x, w.y, tolerance * 2) && (!color || g.c === w.c));
        if (at < 0) return { kind: 'draw-fill' };
        left.splice(at, 1);
      }
      if (left.length) return { kind: 'draw-fill' };
    }
    return { kind: 'draw-correct' };
  }

  // 흔한 어긋남: 뒤집힘, 자리, 크기. 고쳐 놓고 다시 견줘서 맞으면 그것을 알려 준다.
  const same = (list) => {
    const again = matchStrokes(list, theirs, tolerance);
    return again.missing.length === 0 && again.extra.length === 0;
  };
  if (same(moved(mine, (x, y, n) => point(x, -y, n)))) return { kind: 'draw-mirror' };
  if (same(moved(mine, (x, y, n) => point(-x, y, n)))) return { kind: 'draw-flip' };
  if (mine.length === theirs.length && mine.length > 0) {
    const box = (list) => {
      const xs = list.flatMap((s) => [s.x1, s.x2]);
      const ys = list.flatMap((s) => [s.y1, s.y2]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    const a = box(mine);
    const b = box(theirs);
    if (same(moved(mine, (x, y, n) => point(x - a.x + b.x, y - a.y + b.y, n)))) return { kind: 'draw-moved' };
    const scale = Math.max(b.w, b.h) / Math.max(a.w, a.h, 0.001);
    if (Math.abs(scale - 1) > 0.02 && same(moved(mine, (x, y, n) => point((x - a.x) * scale + b.x, (y - a.y) * scale + b.y, n)))) {
      return { kind: 'draw-size', vars: { bigger: scale < 1 } };
    }
  }
  if (color && same(strokes(got, false)) && strokes(want, false).length === theirs.length) return { kind: 'draw-color' };
  if (extra.length === 0) return { kind: 'draw-missing', vars: { count: missing.length } };
  if (missing.length === 0) return { kind: 'draw-extra', vars: { count: extra.length } };
  return { kind: 'draw-diff' };
}
