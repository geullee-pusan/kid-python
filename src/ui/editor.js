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

/**
 * @param {{ parent: HTMLElement, doc: string, onChange: (code: string) => void, onRun: () => void }} options
 */
export function createEditor({ parent, doc, onChange, onRun }) {
  const errorLine = lineMark('cm-error-line');
  const runLine = lineMark('cm-run-line');
  const locked = new Compartment();
  let typing = 0;

  const view = new EditorView({
    parent,
    doc,
    extensions: [
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
      locked.of([]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  });

  const setCode = (code) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });

  return {
    view,
    getCode: () => view.state.doc.toString(),
    setCode(code) {
      typing++;
      setCode(code);
    },
    /** 한 글자씩 친다(선생님 시연). 다 치면 끝난다. 도중에 setCode나 다른 typeCode가 오면 그만둔다. */
    typeCode(code, charMs = 55) {
      const my = ++typing;
      setCode('');
      const chars = [...code];
      return new Promise((resolve) => {
        let n = 0;
        const step = () => {
          if (my !== typing) return resolve(false);
          if (n >= chars.length) return resolve(true);
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
      view.dispatch({ effects: locked.reconfigure(on ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []) });
    },
    markErrorLine: (number) => view.dispatch({ effects: errorLine.effect.of(number) }),
    markRunLine: (number) => view.dispatch({ effects: runLine.effect.of(number) }),
    focus: () => view.focus(),
  };
}
