// 출력 칸 + 입력 줄. 수업 화면과 만들기 화면이 함께 쓴다.
// 출력 그리기는 output.js가 한다(끝없이 출력하는 프로그램에도 화면이 굳지 않게).
import { createOutput } from './output.js';

/**
 * @param {HTMLElement} root 출력 칸을 넣을 자리
 * @param {() => object} getRunner 파이썬 일꾼 관리자
 */
export function createConsole(root, getRunner) {
  root.classList.add('console');
  const pre = document.createElement('pre');
  pre.className = 'console-out';
  pre.setAttribute('aria-live', 'polite');

  const form = document.createElement('form');
  form.className = 'console-input';
  form.hidden = true;
  const label = document.createElement('label');
  label.textContent = '입력';
  const input = document.createElement('input');
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  label.append(input);
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'btn';
  send.textContent = '보내기';
  form.append(label, send);
  root.append(pre, form);

  const output = createOutput(pre, getRunner);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value;
    input.value = '';
    output.flush();
    output.append(`${text}\n`, 'typed');
    getRunner().provideInput(text);
  });

  return {
    ...output,
    /** input()이 답을 기다리는 동안 입력 줄을 보인다 */
    askInput(on) {
      if (form.hidden === !on) return;
      form.hidden = !on;
      if (on) input.focus();
    },
  };
}
