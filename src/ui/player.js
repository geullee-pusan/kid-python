// 장면 재생기. src/core/lesson.js가 만든 장면을 차례로 보여 주고 읽는다.
// 틀은 주산 앱 JUSAN의 player.js를 따랐다. 주판 대신 편집기와 출력 창을 움직인다.
// - 말할 때는 대화창에 글자가 한 글자씩 나타난다. 자막은 늘 보인다(목소리가 없어도 수업이 된다).
// - 선생님은 아이가 버튼을 누를 때까지 기다린다. 재촉하지 않는다.
import { explain } from '../core/errors-ko.js';
import { speak as speakLine, stopSpeaking, wait } from './speech.js';

/**
 * @param {{teacher, board, editor, output: {clear: () => void, append: (text: string, className?: string) => void},
 *          runner, caption: HTMLElement, voice: {pitch: number, rate: number}, speed?: number,
 *          ui: {follow: (scene) => Promise<'done'|'stop'>}}} ctx
 */
export function createPlayer(ctx) {
  const { teacher, board, editor, output, caption } = ctx;
  const speed = ctx.speed ?? 1; // 개발할 때 빨리 돌려 보기(?fast)
  const pause = (ms) => wait(ms / speed);
  let stopped = false;
  let slow = 1; // "천천히요"를 누를 때마다 줄어든다
  let lastLine = null;
  let typing = 0;

  /** 대화창에 글자를 한 글자씩 쓴다 */
  function typeText(text) {
    const my = ++typing;
    const chars = [...text];
    let n = 0;
    const step = () => {
      if (my !== typing) return;
      n = Math.min(chars.length, n + 2);
      caption.textContent = chars.slice(0, n).join('');
      if (n < chars.length) setTimeout(step, 28);
    };
    step();
  }

  let sayTurn = 0;

  async function say(text, speech = text, pose = 'talk') {
    if (stopped) return;
    const my = ++sayTurn;
    lastLine = { text, speech, pose };
    typeText(text);
    teacher.pose(pose);
    let started = false;
    const begin = () => {
      if (started) return;
      started = true;
      teacher.talking(true);
    };
    const early = setTimeout(begin, 300); // 소리가 늦게 시작해도 입은 곧 움직인다
    await speakLine(speech, { pitch: ctx.voice.pitch, rate: ctx.voice.rate * slow }, { onStart: begin });
    clearTimeout(early);
    if (my !== sayTurn) return; // 그사이 다른 말이 시작됐거나 말을 끊었다
    teacher.talking(false);
    typing++;
    caption.textContent = text;
    await pause(220 / slow);
  }

  /** 하던 말을 끊는다(아이가 버튼을 눌렀을 때). 재생은 그만두지 않는다. 자막은 끝까지 채워 둔다. */
  function hush() {
    sayTurn++;
    typing++;
    stopSpeaking();
    teacher.talking(false);
    if (lastLine) caption.textContent = lastLine.text;
  }

  /** 코드를 한 줄씩 실행해 보인다: 실행하는 줄을 표시하고, 그 줄이 내보낸 글자를 출력 창에 더한다. */
  async function trace(code, inputs = []) {
    if (editor.getCode() !== code) editor.setCode(code);
    output.clear();
    ctx.ui.vars?.({});
    const result = await ctx.runner.run(code, { trace: true, inputs });
    for (const step of result.steps ?? []) {
      if (stopped) break;
      editor.markRunLine(step.line);
      await pause(650 / slow);
      // input()에 넣은 답은 표시가 붙어 온다. 아이가 친 것처럼 다른 색으로 보여 준다.
      for (const piece of step.out.split(/(\x01[^\x02]*\x02)/)) {
        if (piece.startsWith('\x01')) output.append(piece.slice(1, -1), 'typed');
        else if (piece) output.append(piece);
      }
      ctx.ui.vars?.(step.vars ?? {});
      await pause(550 / slow);
    }
    editor.markRunLine(null);
    // 오류가 나는 코드도 그대로 보여 준다(오류 읽기 수업, 오류가 답인 예측 문제).
    if (result.error && !stopped) {
      const at = result.error.line ? ` (${result.error.line}번 줄)` : '';
      output.append(`\n${explain(result.error, ctx.knows?.())}${at}\n`, 'ko');
      output.append(result.error.text, 'err');
      if (result.error.line) editor.markErrorLine(result.error.line);
      await pause(900 / slow);
    }
    return result;
  }

  /** 장면 목록을 재생한다. 그만하면 false를 돌려준다. */
  async function play(scenes) {
    for (const scene of scenes) {
      if (stopped) return false;
      switch (scene.kind) {
        case 'say':
          await say(scene.text, scene.speech, scene.pose);
          teacher.pose('idle');
          break;
        case 'board-pair':
          board.pair(scene);
          break;
        case 'board-card':
          board.card(scene);
          break;
        case 'board-clear':
          board.clear();
          break;
        case 'code-type':
          teacher.pose('demo');
          output.clear();
          ctx.ui.vars?.({}); // 새 코드를 치기 시작하면 앞 예제의 이름표는 지운다
          editor.setLocked(true);
          await editor.typeCode(scene.code, 55 / slow / speed);
          teacher.pose('idle');
          break;
        case 'trace':
          teacher.pose('point');
          editor.setLocked(true);
          await trace(scene.code, scene.inputs);
          teacher.pose('idle');
          break;
        case 'follow': {
          teacher.pose('idle');
          const answer = await ctx.ui.follow(scene);
          if (answer === 'stop') stopped = true;
          break;
        }
        case 'check': {
          // 강의 중 확인 문제: 맞히면 설명을 건너뛰고, 틀리면 설명한다.
          teacher.pose('idle');
          const picked = await ctx.ui.check(scene);
          if (picked === 'stop') {
            stopped = true;
            break;
          }
          if (!(await play(picked === scene.answer ? scene.right : scene.teach))) return false;
          break;
        }
        case 'nod':
          await teacher.nod();
          break;
        default:
          throw new Error(`모르는 장면이에요: ${scene.kind}`);
      }
    }
    return !stopped;
  }

  return {
    play,
    say,
    hush,
    trace,
    /** 방금 한 말을 다시 한다 */
    async again() {
      if (lastLine) await say(lastLine.text, lastLine.speech, lastLine.pose);
    },
    slower() {
      slow = Math.max(0.6, slow * 0.85);
      return slow;
    },
    /** 재생을 그만둔다(강의 건너뛰기, 처음으로) */
    stop() {
      stopped = true;
      typing++;
      stopSpeaking();
    },
    get stopped() {
      return stopped;
    },
    reset() {
      stopped = false;
    },
  };
}
