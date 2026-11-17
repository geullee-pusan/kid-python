// 게임 문제 채점: 정해 둔 키와 장면 수만큼 돌린 뒤의 모습을 견준다. 순수 함수다.
// 그림 문제(drawing.js)는 그은 선을 보지만, 게임은 거북이들이 마지막에 어디에 어떤 모습으로 있는지와 써 놓은 글자를 본다.
// 거북이를 만든 차례는 달라도 된다(자리와 모습이 같은 거북이끼리 짝짓는다).
import { afterClear } from './drawing.js';

/** 그리기 명령 목록에서 마지막 모습을 뽑는다: 보이는 거북이들과, 지우지 않고 남은 글자들. */
export function finalScene(cmds) {
  const turtles = new Map();
  for (const cmd of cmds) if (cmd.k === 'pose') turtles.set(cmd.t, cmd);
  return {
    turtles: [...turtles.values()].filter((t) => t.v),
    hidden: [...turtles.values()].filter((t) => !t.v).length,
    texts: afterClear(cmds).filter((cmd) => cmd.k === 'text').map((cmd) => cmd.s),
  };
}

const near = (a, b, tol) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
const sameHeading = (a, b) => Math.abs(((a.h - b.h + 540) % 360) - 180) < 1;

/**
 * @param {object[]} got 아이의 프로그램이 남긴 그리기 명령
 * @param {object[]} want 모범 답이 남긴 그리기 명령
 * @param {{heading?: boolean, look?: boolean, text?: boolean, tolerance?: number}} options
 *   heading: 보는 방향도 같아야 한다. look: 모양과 색도 같아야 한다. text: 써 놓은 글자도 견준다(기본값 true).
 * @returns {{kind: string, vars?: object}}
 *   kind: game-correct, game-none(거북이가 하나도 없다), game-count(보이는 거북이의 수가 다르다),
 *         game-pos(자리가 다른 거북이가 있다), game-heading(보는 방향이 다르다), game-look(모양이나 색이 다르다), game-text(글자가 다르다)
 */
export function compareScene(got, want, { heading = false, look = false, text = true, tolerance = 3 } = {}) {
  const mine = finalScene(got);
  const theirs = finalScene(want);
  if (mine.turtles.length === 0 && mine.hidden === 0 && theirs.turtles.length > 0) return { kind: 'game-none' };
  if (mine.turtles.length !== theirs.turtles.length) return { kind: 'game-count', vars: { got: mine.turtles.length, want: theirs.turtles.length } };

  // 자리(와 모습)가 같은 거북이끼리 짝짓는다. 조건을 하나씩 풀어 가며 무엇이 다른지 가린다.
  const match = (test) => {
    const left = [...mine.turtles];
    for (const w of theirs.turtles) {
      const at = left.findIndex((g) => test(g, w));
      if (at < 0) return false;
      left.splice(at, 1);
    }
    return true;
  };
  const samePlace = (g, w) => near(g, w, tolerance);
  const sameLook = (g, w) => g.s === w.s && g.f === w.f && g.z[0] === w.z[0] && g.z[1] === w.z[1];
  if (!match(samePlace)) return { kind: 'game-pos' };
  if (heading && !match((g, w) => samePlace(g, w) && sameHeading(g, w))) return { kind: 'game-heading' };
  if (look && !match((g, w) => samePlace(g, w) && (!heading || sameHeading(g, w)) && sameLook(g, w))) return { kind: 'game-look' };
  if (text && [...mine.texts].sort().join('\n') !== [...theirs.texts].sort().join('\n')) return { kind: 'game-text', vars: { got: mine.texts.join(', ') || '(없음)', want: theirs.texts.join(', ') || '(없음)' } };
  return { kind: 'game-correct' };
}
