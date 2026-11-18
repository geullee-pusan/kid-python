// 파일 칸: 프로그램이 읽고 쓰는 파일과 그 안의 내용을 보여 준다.
// 줄마다 번호를 붙여서 "몇 줄이 있는지", "몇째 줄이 다른지"를 셀 수 있게 한다.
// 이번 실행에서 새로 생긴 파일과 내용이 바뀐 파일은 표시를 붙인다.

const SHOW_LINES = 200; // 파일 하나에서 보여 줄 줄 수
const SHOW_CHARS = 200; // 한 줄에서 보여 줄 글자 수

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/**
 * @param {HTMLElement} root 파일들을 넣을 곳
 * @param {{ onDelete?: (name: string) => void }} [options] onDelete가 있으면 파일마다 지우기 단추를 단다(두 번 눌러야 지워진다).
 */
export function createFilesView(root, { onDelete } = {}) {
  root.classList.add('files');

  /**
   * @param {Record<string, string>|null} files 보여 줄 파일들
   * @param {Record<string, string>|null} [before] 실행 전의 파일들(있으면 새로 생긴 것과 바뀐 것을 표시한다)
   * @returns {boolean} 보여 줄 파일이 있는가
   */
  function show(files, before = null) {
    root.replaceChildren();
    const names = Object.keys(files ?? {}).sort();
    if (!names.length) {
      root.append(el('p', 'files-empty', '파일이 없어요'));
      return false;
    }
    for (const name of names) {
      const text = files[name];
      const card = el('section', 'file-card');
      const head = el('div', 'file-head');
      head.append(el('span', 'file-name', `📄 ${name}`));
      if (before) {
        if (!(name in before)) head.append(el('span', 'file-badge new', '새로 생김'));
        else if (before[name] !== text) head.append(el('span', 'file-badge changed', '바뀜'));
        if (!(name in before) || before[name] !== text) card.classList.add('changed');
      }
      if (onDelete) {
        const remove = el('button', 'file-delete', '지우기');
        remove.type = 'button';
        let timer = null;
        remove.addEventListener('click', () => {
          if (!remove.dataset.sure) {
            remove.dataset.sure = '1';
            remove.textContent = '정말 지워요?';
            timer = setTimeout(() => {
              delete remove.dataset.sure;
              remove.textContent = '지우기';
            }, 4000);
            return;
          }
          clearTimeout(timer);
          onDelete(name);
        });
        head.append(remove);
      }
      card.append(head);
      card.append(body(text));
      root.append(card);
    }
    return true;
  }

  function body(text) {
    const lines = String(text ?? '').replace(/\r/g, '').split('\n');
    // 맨 끝 줄바꿈 뒤의 빈 자리는 줄로 세지 않는다(파이썬이 줄을 셀 때와 같게).
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const box = el('ol', 'file-lines');
    if (!lines.length) {
      const empty = el('li', 'file-line empty', '(비어 있어요)');
      box.append(empty);
      return box;
    }
    for (const line of lines.slice(0, SHOW_LINES)) {
      const item = el('li', 'file-line');
      const shown = line.length > SHOW_CHARS ? `${line.slice(0, SHOW_CHARS)}…` : line;
      // 빈 줄도 줄로 보이게 한다.
      item.append(el('code', '', shown || ' '));
      box.append(item);
    }
    if (lines.length > SHOW_LINES) box.append(el('li', 'file-line more', `… 모두 ${lines.length}줄`));
    return box;
  }

  return {
    show,
    clear() {
      root.replaceChildren();
    },
  };
}
