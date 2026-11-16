// 코드 편집기. 실물 키보드로 쓰는 것을 전제로 한다.
import { EditorView, basicSetup } from 'codemirror';
import { python } from '@codemirror/lang-python';
import { Decoration, keymap } from '@codemirror/view';
import { Prec, StateEffect, StateField } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';

// 오류가 난 줄 표시. 코드를 고치면 표시가 사라진다.
const setErrorLine = StateEffect.define();
const errorLineField = StateField.define({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = tr.docChanged ? Decoration.none : marks;
    for (const effect of tr.effects) {
      if (!effect.is(setErrorLine)) continue;
      if (effect.value == null) {
        next = Decoration.none;
      } else {
        const number = Math.max(1, Math.min(tr.state.doc.lines, effect.value));
        const line = tr.state.doc.line(number);
        next = Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(line.from)]);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * @param {{ parent: HTMLElement, doc: string, onChange: (code: string) => void, onRun: () => void }} options
 */
export function createEditor({ parent, doc, onChange, onRun }) {
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
      basicSetup,
      keymap.of([indentWithTab]),
      indentUnit.of('    '),
      python(),
      errorLineField,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  });
  return {
    view,
    getCode: () => view.state.doc.toString(),
    setCode(code) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
    },
    markErrorLine(number) {
      view.dispatch({ effects: setErrorLine.of(number) });
    },
    focus: () => view.focus(),
  };
}
