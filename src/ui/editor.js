// 코드 편집기. 실물 키보드로 쓰는 것을 전제로 한다.
// 돕는 것: 줄 번호, 색 입히기, 콜론 뒤 자동 들여쓰기, 괄호와 따옴표 짝 맞춤.
// 돕지 않는 것: 자동 완성(낱말을 대신 써 주면 타자 연습이 빠진다. 전략 3절 6번).
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { bracketMatching, defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';

// 줄 표시 두 가지: 오류가 난 줄, 지금 실행하는 줄. 코드를 고치면 사라진다.
function lineMark(className) {
  const effect = StateEffect.define();
  const field = StateField.define({
    create: () => Decoration.none,
    update(marks, tr) {
      let next = tr.docChanged ? Decoration.none : marks;
      for (const e of tr.effects) {
        if (!e.is(effect)) continue;
        if (e.value == null) {
          next = Decoration.none;
        } else {
          const number = Math.max(1, Math.min(tr.state.doc.lines, e.value));
          next = Decoration.set([Decoration.line({ class: className }).range(tr.state.doc.line(number).from)]);
        }
      }
      return next;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return { effect, field };
}

export const MAIN = 'main.py';

/**
 * 파일 탭: main.py 옆에 아이가 import할 .py 파일(모듈)의 탭이 생긴다(단원 19).
 * 탭마다 편집기의 상태(글, 되돌리기, 줄 표시)를 따로 둔다. getCode/setCode는 늘 main.py의 것이다.
 * @param {{ parent: HTMLElement, doc: string, onChange: (code: string) => void, onRun: () => void,
 *   tabs?: HTMLElement, onModuleChange?: (name: string, code: string) => void, onAddModule?: () => void }} options
 */
export function createEditor({ parent, doc, onChange, onRun, tabs, onModuleChange, onAddModule }) {
  const errorLine = lineMark('cm-error-line');
  const runLine = lineMark('cm-run-line');
  const locked = new Compartment();
  const fileLock = new Compartment(); // 고칠 수 없게 준 모듈(남이 만든 것을 보여 줄 때)
  let typing = 0;
  let lockedAll = false;
  let active = MAIN;
  const states = new Map(); // 보이지 않는 탭의 상태
  const readOnly = new Set(); // 고칠 수 없는 모듈 이름

  const extensions = [
      // 실행 단축키는 다른 단축키보다 먼저 본다.
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onRun();
              return true;
            },
          },
        ]),
      ),
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      indentUnit.of('    '),
      python(),
      errorLine.field,
      runLine.field,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        if (active === MAIN) onChange(update.state.doc.toString());
        else onModuleChange?.(active, update.state.doc.toString());
      }),
  ];
  const lockExt = (on) => (on ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []);
  // 탭마다 상태를 새로 만든다. 잠금(선생님 시연 중)과 보기만 하는 파일은 칸(Compartment)으로 넣어 두고 나중에 바꾼다.
  const makeState = (text, name) =>
    EditorState.create({ doc: text, extensions: [...extensions, locked.of(lockExt(lockedAll)), fileLock.of(lockExt(readOnly.has(name)))] });

  const view = new EditorView({ parent, state: makeState(doc, MAIN) });

  /** 이름의 탭에 있는 글(보이는 탭이면 편집기에서) */
  const textOf = (name) => (name === active ? view.state.doc.toString() : states.get(name)?.doc.toString() ?? null);
  const names = () => [MAIN, ...[...states.keys(), active].filter((name, i, all) => name !== MAIN && all.indexOf(name) === i).sort((a, b) => a.localeCompare(b, 'ko'))];

  function renderTabs() {
    if (!tabs) return;
    tabs.replaceChildren();
    const list = names();
    for (const name of list) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'file file-tab' + (name === active ? ' active' : '') + (readOnly.has(name) ? ' readonly' : '');
      tab.textContent = name;
      tab.setAttribute('aria-pressed', String(name === active));
      if (readOnly.has(name)) tab.title = '보기만 하는 파일이에요';
      // 탭이 하나(main.py)뿐이면 전처럼 이름표로만 보인다
      tab.disabled = list.length === 1 && !onAddModule;
      tab.addEventListener('click', () => show(name));
      tabs.append(tab);
    }
    if (onAddModule) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'file-add btn small';
      add.textContent = '＋ 도구 파일';
      add.addEventListener('click', () => onAddModule());
      tabs.append(add);
    }
  }

  /** 다른 탭을 보인다. 지금 탭의 상태는 남겨 둔다. 지금 실행하는 줄 표시는 옮겨 가지 않는다. */
  function show(name) {
    if (name === active || (name !== MAIN && !states.has(name))) return;
    view.dispatch({ effects: runLine.effect.of(null) });
    states.set(active, view.state);
    const next = states.get(name);
    states.delete(name);
    active = name;
    view.setState(next);
    view.dispatch({ effects: [locked.reconfigure(lockExt(lockedAll)), fileLock.reconfigure(lockExt(readOnly.has(name)))] });
    renderTabs();
  }

  const setCode = (code) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
  renderTabs();

  return {
    view,
    /** main.py의 코드 */
    getCode: () => textOf(MAIN),
    setCode(code) {
      typing++;
      show(MAIN);
      setCode(code);
    },
    /** 지금 보이는 탭의 이름 */
    activeFile: () => active,
    show,
    /** 모듈 탭들 { "도구.py": 코드 } */
    getModules() {
      const out = {};
      for (const name of names()) if (name !== MAIN) out[name] = textOf(name);
      return out;
    },
    /**
     * 모듈 탭을 통째로 바꾼다. 없는 이름의 탭은 닫는다. lockedNames의 탭은 고칠 수 없다.
     * 보이던 탭이 없어지면 main.py로 돌아간다.
     */
    setModules(modules = {}, lockedNames = []) {
      typing++;
      readOnly.clear();
      for (const name of lockedNames) readOnly.add(name);
      if (active !== MAIN && !(active in modules)) show(MAIN);
      for (const name of [...states.keys()]) if (name !== MAIN && !(name in modules)) states.delete(name);
      for (const [name, code] of Object.entries(modules)) {
        if (name === active) {
          if (view.state.doc.toString() !== code) setCode(code);
          view.dispatch({ effects: fileLock.reconfigure(lockExt(readOnly.has(name))) });
        } else if (states.get(name)?.doc.toString() !== code) {
          states.set(name, makeState(code, name));
        }
      }
      renderTabs();
    },
    /** 모듈 탭 하나를 고친다(없으면 만든다). */
    setModule(name, code) {
      if (name === active) setCode(code);
      else states.set(name, makeState(code, name));
      renderTabs();
    },
    /** 한 글자씩 친다(선생님 시연). 다 치면 끝난다. 도중에 setCode나 다른 typeCode가 오면 그만둔다. file: 칠 탭 */
    typeCode(code, charMs = 55, file = MAIN) {
      const my = ++typing;
      show(file);
      setCode('');
      const chars = [...code];
      return new Promise((resolve) => {
        let n = 0;
        const step = () => {
          if (my !== typing) return resolve(false);
          if (n >= chars.length) return resolve(true);
          if (active !== file) show(file);
          const at = view.state.doc.length;
          view.dispatch({ changes: { from: at, insert: chars[n] } });
          n += 1;
          // 줄을 바꾼 뒤에는 조금 쉰다.
          setTimeout(step, chars[n - 1] === '\n' ? charMs * 5 : charMs);
        };
        step();
      });
    },
    /** 아이가 고치지 못하게 잠그거나 푼다(선생님이 시연하는 동안). */
    setLocked(on) {
      lockedAll = on;
      view.dispatch({ effects: locked.reconfigure(lockExt(on)) });
    },
    /** 오류가 난 줄. file이 다른 탭이면 그 탭을 연다. null이면 지운다. */
    markErrorLine(number, file = MAIN) {
      if (number != null && (file === MAIN || states.has(file) || file === active)) show(file);
      view.dispatch({ effects: errorLine.effect.of(number) });
    },
    /** 지금 실행하는 줄(한 줄씩 보기). file이 다른 탭이면 그 탭으로 넘어간다(도구의 함수를 부르면 도구.py로 갔다 온다). */
    markRunLine(number, file = MAIN) {
      if (number != null) show(file);
      view.dispatch({ effects: runLine.effect.of(number) });
    },
    focus: () => view.focus(),
  };
}
