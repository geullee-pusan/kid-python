// 출력 창. 끝없이 출력하는 프로그램을 돌려도 화면이 굳지 않게 한다(0단계에서 실제로 겪은 문제).
// - 일꾼이 보낸 출력은 바로 그리지 않고 모았다가 60ms에 한 번 그린다.
// - 그린 뒤에야 일꾼에게 "받았다"고 알려서, 화면이 밀리면 일꾼이 보내기를 쉬게 한다.
// - 창에 남겨 두는 글자 수와 한 번에 그리는 글자 수에 한도를 둔다.

const MAX_OUTPUT_CHARS = 60000;
const MAX_RENDER_CHARS = 30000;
const RENDER_EVERY_MS = 60;

/**
 * @param {HTMLElement} pre 출력을 보여 줄 <pre>
 * @param {() => {ack: (count: number) => void}} getRunner 일꾼 관리자(나중에 만들어지므로 함수로 받는다)
 */
export function createOutput(pre, getRunner) {
  let chars = 0;
  let pending = [];
  let timer = null;

  function append(text, className) {
    if (!text) return;
    const span = document.createElement('span');
    if (className) span.className = className;
    span.textContent = text;
    pre.append(span);
    chars += text.length;
    while (chars > MAX_OUTPUT_CHARS && pre.firstChild && pre.firstChild !== span) {
      chars -= pre.firstChild.textContent.length;
      pre.firstChild.remove();
    }
  }

  function scroll() {
    pre.scrollTop = pre.scrollHeight;
  }

  /** 모아 둔 출력을 지금 그린다 */
  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    let skipped = 0;
    const pieces = [];
    for (const message of batch) {
      skipped += message.dropped;
      pieces.push(...message.chunks);
    }
    let total = pieces.reduce((sum, piece) => sum + piece.t.length, 0);
    while (total > MAX_RENDER_CHARS && pieces.length > 1) {
      const gone = pieces.shift();
      total -= gone.t.length;
      skipped += gone.t.length;
    }
    if (total > MAX_RENDER_CHARS) {
      const cut = pieces[0].t.length - MAX_RENDER_CHARS;
      pieces[0] = { s: pieces[0].s, t: pieces[0].t.slice(cut) };
      skipped += cut;
    }
    if (skipped) append(`\n… (출력이 너무 많아서 ${skipped.toLocaleString()}글자를 건너뛰었어요) …\n`, 'note');
    for (const piece of pieces) append(piece.t, piece.s === 'err' ? 'err' : '');
    scroll();
    getRunner().ack(batch.length);
  }

  return {
    /** 일꾼이 보낸 출력 묶음을 받는다 */
    queue(chunks, dropped) {
      pending.push({ chunks, dropped });
      if (!timer) timer = setTimeout(flush, RENDER_EVERY_MS);
    },
    flush,
    /** 화면 쪽에서 직접 한 줄을 더한다(설명 글, 한 줄씩 실행 보기) */
    append(text, className) {
      append(text, className);
      scroll();
    },
    clear() {
      pre.textContent = '';
      chars = 0;
    },
    text: () => pre.textContent,
  };
}
