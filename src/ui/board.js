// 칠판. 엔트리 블록과 파이썬 문장을 나란히 보여 주고, 글 카드, 예측 문제, 쓰기 문제를 적는다.
// 엔트리 블록은 우리가 그린 단순한 그림이다(엔트리의 그림 파일을 쓰지 않는다). 색만으로 뜻을 전하지 않게 글자를 함께 쓴다.
import { paintDrawing } from './canvas.js';

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 블록 안의 조각들. 글자, { in: '안녕!' }(값 칸), { drop: '말하기' }(목록 칸), { judge: [조각들] }(끼워 넣은 판단 블록) */
function entryParts(row, parts) {
  for (const part of parts) {
    if (typeof part === 'string') row.append(el('span', 'eb-text', part));
    else if (part.in !== undefined) row.append(el('span', 'eb-in', part.in));
    else if (part.drop !== undefined) row.append(el('span', 'eb-drop', `${part.drop} ▾`));
    else if (part.judge) {
      // 만일 블록의 조건 칸에 끼운 판단 블록(엔트리에서는 육각형이다)
      const inner = el('span', 'eb-cond');
      entryParts(inner, part.judge);
      row.append(inner);
    }
  }
}

/** 엔트리 블록 한 줄. */
function entryBlock(block) {
  const row = el('div', `eb eb-${block.cat}`);
  // indent: 반복하기나 만일 블록이 감싼 블록은 안쪽으로 들여서 보여 준다.
  if (block.indent) row.style.marginLeft = `${block.indent * 26}px`;
  entryParts(row, block.parts);
  return row;
}

function codeBlock(code) {
  const pre = el('pre', 'board-code');
  pre.textContent = code;
  return pre;
}

export function createBoard(root) {
  root.classList.add('board');

  function show(...children) {
    root.replaceChildren(...children);
  }

  return {
    clear() {
      show();
    },
    /** 엔트리 블록 ↔ 파이썬 문장 */
    pair({ entry, python, note, layout }) {
      const left = el('div', 'pair-side');
      left.append(el('div', 'pair-label', '엔트리'));
      const stack = el('div', 'eb-stack');
      for (const block of entry) stack.append(entryBlock(block));
      left.append(stack);
      const right = el('div', 'pair-side');
      right.append(el('div', 'pair-label', '파이썬'), codeBlock(python));
      // layout: 'stack'은 블록이 길어서 나란히 놓을 수 없을 때 위아래로, 'compact'는 블록이 많을 때 작게 나란히.
      const pair = el('div', layout ? `pair pair-${layout}` : 'pair');
      pair.append(left, el('div', 'pair-arrow', layout === 'stack' ? '↓' : '→'), right);
      const children = [pair];
      if (note) children.push(el('p', 'board-note', note));
      show(...children);
    },
    /** 글 카드: 제목과 줄 목록, 또는 코드 */
    card({ title, items, code }) {
      const children = [el('h3', 'board-title', title)];
      if (items) {
        const list = el('ul', 'board-items');
        for (const item of items) list.append(el('li', '', item));
        children.push(list);
      }
      if (code) children.push(codeBlock(code));
      show(...children);
    },
    /**
     * 예측 문제: 코드와 보기. 고르면 onPick(번호)를 부른다.
     * 돌려주는 mark(번호, 맞음)로 고른 보기에 ○ 또는 △를 붙이고 더 못 고르게 한다.
     */
    predict({ no, total, code, choices, onPick, ask }) {
      return this.choice({ title: `예측 ${no} / ${total}`, ask: ask ?? '실행하면 출력 칸에 무엇이 나올까요?', code, choices, onPick });
    },
    /** 보기 가운데 하나를 고르는 문제(예측 문제, 강의 중 확인 문제). code는 없어도 된다. */
    choice({ title, ask, code, choices, onPick }) {
      const heading = el('h3', 'board-title', title);
      const grid = el('div', 'choices');
      const buttons = choices.map((choice, index) => {
        const button = el('button', 'choice');
        button.type = 'button';
        button.append(el('span', 'choice-key', String(index + 1)), el('pre', 'choice-text', choice.text), el('span', 'choice-mark'));
        button.addEventListener('click', () => onPick(index));
        grid.append(button);
        return button;
      });
      const children = [heading, el('p', 'board-ask', ask)];
      if (code) children.push(codeBlock(code));
      children.push(grid);
      show(...children);
      return {
        mark(index, correct) {
          for (const button of buttons) button.disabled = true;
          buttons[index].classList.add(correct ? 'ok' : 'retry');
          buttons[index].querySelector('.choice-mark').textContent = correct ? '○ 맞음' : '△ 다시 보기';
        },
        showAnswer(index) {
          buttons[index].classList.add('answer');
          if (!buttons[index].querySelector('.choice-mark').textContent) buttons[index].querySelector('.choice-mark').textContent = '← 실제 출력';
        },
      };
    },
    /** 쓰기 문제: 할 일 목록 */
    task({ title, story, steps, want, wantNote, wants, pictures }) {
      const list = el('ol', 'board-steps');
      for (const step of steps) list.append(el('li', '', step));
      const children = [el('h3', 'board-title', title)];
      if (story) children.push(el('p', 'board-story', story));
      children.push(list);
      // want: 나와야 하는 출력을 그대로 보여 줄 때(띄어쓰기까지 맞춰야 하는 문제)
      // wants: 답에 따라 출력이 달라지는 문제는 여러 경우를 나란히 보여 준다 [{ note, lines }]
      const samples = wants ?? (want ? [{ note: wantNote ?? '이렇게 나와야 해요', lines: want }] : []);
      if (samples.length) {
        const row = el('div', 'board-wants');
        for (const sample of samples) {
          const box = el('div', 'board-want');
          box.append(el('div', 'pair-label', sample.note), codeBlock(sample.lines.length ? sample.lines.join('\n') : '(아무것도 안 나와요)'));
          row.append(box);
        }
        children.push(row);
      }
      // pictures: 그리기 문제의 본보기 그림 [{ note, cmds }]. 가운데 (0, 0)에 옅은 십자가 있다.
      if (pictures?.length) {
        const row = el('div', 'board-wants');
        for (const picture of pictures) {
          const box = el('div', 'board-want');
          const canvas = document.createElement('canvas');
          canvas.className = 'board-picture';
          paintDrawing(canvas, picture.cmds, { origin: true, fit: true });
          box.append(el('div', 'pair-label', picture.note), canvas);
          row.append(box);
        }
        children.push(row);
      }
      show(...children);
    },
    /** 쓰기 문제 아래에 힌트 카드를 덧붙인다 */
    appendHint({ title, code }) {
      const box = el('div', 'board-hint');
      box.append(el('h4', '', title), codeBlock(code));
      root.append(box);
      box.scrollIntoView({ block: 'nearest' });
    },
    /** 마지막 화면 */
    done({ title, items }) {
      const list = el('ul', 'board-items');
      for (const item of items) list.append(el('li', '', item));
      show(el('h3', 'board-title', title), list);
    },
  };
}
