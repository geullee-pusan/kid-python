// 쓰기 문제 채점과 오답 짐작. 순수 함수다.
// 틀렸을 때 "틀렸어요"만 말하지 않고, 무엇을 놓쳤는지 짐작해서 알려 주려는 것이다.
//
// 문제(task)에 적는 것
//  expect    나와야 하는 출력(줄 목록)
//  compute   파이썬이 계산해야 하는 식들 [{ literal: "12 + 30", pattern: "12\\s*\\+\\s*30" }]
//            - 출력은 맞는데 코드(따옴표 밖)에 pattern이 없으면: 답을 직접 적은 것(not-computed)
//            - 출력에 literal이 글자 그대로 나왔으면: 식을 따옴표 안에 넣은 것(quoted-calc)
//  checks    출력이 맞아도 코드(따옴표 밖)에 꼭 있어야 하는 것 [{ pattern: "정규식", say: "대사 열쇠" }]
//  cases     입력을 받는 문제의 채점용 입력과 기대 출력 [{ inputs: [...], expect: [...] }] (화면 쪽에서 하나씩 돌린다)
//  mistakes  이 문제에서 흔한 실수 [{ code: "정규식", output: "정규식", say: "대사 열쇠" }]
//            - 출력이 틀렸을 때, 코드(따옴표 밖)와 출력이 정규식에 맞으면 그 대사로 알려 준다
//            - want: 나와야 하는 출력이 이 정규식에 맞을 때만 본다(입력이 여러 가지인 문제에서 어느 입력 때의 실수인지 가리려고)
//            - inputs: 채점할 때 넣은 답(쉼표로 이은 것)이 이 정규식에 맞을 때만 본다. 예: "^130$"
//            - output을 "^$"로 적으면 아무것도 나오지 않은 경우를 가리킨다
//            - again: true면, 준 답을 다 쓰고도 프로그램이 또 물었을 때만 본다(그때까지의 출력으로 견준다)
//            - file, content: 프로그램이 끝난 뒤 그 파일의 내용(줄을 \n으로 이은 것)이 content 정규식에 맞을 때만 본다.
//              content 없이 file만 적으면 그 파일이 없을 때를 가리킨다.
//  in        checks와 mistakes에서: code 정규식을 볼 탭(단원 19, "도구.py"). 없으면 main.py
//  modules      편집기의 모듈 탭과 시작 코드 { "도구.py": 코드 }(화면 쪽). lockModules: 고칠 수 없게 둘 탭
//  solutionModules  모범 답의 모듈 탭들(테스트와 "풀이 보기"에서 쓴다)
//  files        프로그램이 시작할 때 폴더에 있을 파일 { 이름: 내용 } (cases의 것이 있으면 그것을 쓴다. 화면 쪽에서 넣어 준다)
//  expectFiles  프로그램이 끝난 뒤 있어야 하는 파일 { 이름: [줄 목록] } (cases의 것이 있으면 그것을 쓴다)
//               출력과 파일이 모두 맞아야 통과한다. 적지 않은 파일은 보지 않는다.

import { compareDrawing } from './drawing.js';
import { compareScene } from './scene.js';

/** 출력을 줄 목록으로. 줄 끝 빈칸과 맨 끝 빈 줄은 뺀다. */
export function outputLines(output) {
  const lines = String(output ?? '').replace(/\r/g, '').split('\n').map((line) => line.replace(/\s+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * 코드에서 따옴표 안의 글자와 주석을 지운다(따옴표 밖에 무엇을 썼는지 보려고).
 * f-string의 중괄호 안은 코드라서 남긴다: f"둘레 {도구.둘레(3)}" → f"" (도구.둘레(3))
 */
export function stripStrings(code) {
  const plain = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;
  return String(code)
    .replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, '""')
    .replace(new RegExp(`(?:(?<![\\w])([fF][rR]?|[rR][fF]))?(${plain.source})`, 'g'), (_, prefix, quoted) => {
      if (!prefix || !/f/i.test(prefix)) return `${prefix ?? ''}""`;
      const inside = quoted.slice(1, -1).replace(/\{\{|\}\}/g, '');
      const parts = [...inside.matchAll(/\{([^{}]*)\}/g)].map(([, expr]) => ` (${expr.replace(plain, '""')})`);
      return `${prefix}""${parts.join('')}`;
    })
    .replace(/#.*$/gm, '');
}

const squeeze = (text) => text.replace(/\s+/g, '');
const ORDINAL = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째'];

/**
 * @param {{expect: string[], compute?: {literal: string, pattern: string}[], mistakes?: {code?: string, output?: string, say: string}[]}} task
 * @param {string} code 아이가 쓴 코드
 * @param {{error: object|null, output: string}} run 실행 결과
 * @returns {{kind: string, vars?: object, say?: string}}
 *   kind: correct, error, no-output, not-computed, quoted-calc, mistake(say에 대사 열쇠), order, count, spacing, line-diff
 */
export function diagnoseTask(task, code, run, modules = {}) {
  if (run.error) return { kind: 'error' };
  const got = outputLines(run.output);
  const want = task.expect;
  // in: checks와 mistakes의 code를 어느 탭의 코드에서 볼지(단원 19, 예: "도구.py"). 없으면 main.py
  const mainBare = stripStrings(code);
  const bareIn = (where) => (!where || where === 'main.py' ? mainBare : stripStrings(modules[where] ?? ''));
  const bare = mainBare;
  const compute = task.compute ?? [];
  const files = run.files ?? {};
  const fileText = (name) => (name in files ? outputLines(files[name]).join('\n') : null);

  const outputSame = got.length === want.length && got.every((line, i) => line === want[i]);
  const fileWrong = task.expectFiles ? fileProblem(task.expectFiles, files, got) : null;
  const same = outputSame && !fileWrong;
  if (same && !run.again) {
    const missing = compute.find((item) => !new RegExp(item.pattern).test(bare));
    if (missing) return { kind: 'not-computed', vars: { calc: missing.literal } };
    // 출력은 맞지만 배운 방법을 쓰지 않은 경우(예: 이름표를 쓰지 않고 숫자를 바로 곱함)
    const skipped = (task.checks ?? []).find((rule) => !new RegExp(rule.pattern).test(bareIn(rule.in)));
    if (skipped) return { kind: 'mistake', say: skipped.say };
    return { kind: 'correct' };
  }
  // 이 문제에서 흔한 실수
  const text = got.join('\n');
  const wanted = want.join('\n');
  const typed = (task.inputs ?? []).join(',');
  const mistake = (task.mistakes ?? []).find(
    (m) =>
      // 아무것도 나오지 않았을 때는, 출력 조건을 따로 적어 둔 실수만 본다(나머지는 "아직 아무것도 안 나왔다"고 알려 준다).
      (got.length > 0 || m.output !== undefined || m.file !== undefined) &&
      // again: 준 답을 다 쓰고도 또 물었을 때(run.again)만 보는 실수. 예: 기회가 끝났는데도 계속 묻는다.
      Boolean(m.again) === Boolean(run.again) &&
      (!m.code || new RegExp(m.code).test(bareIn(m.in))) &&
      (m.output === undefined || new RegExp(m.output).test(text)) &&
      (!m.want || new RegExp(m.want).test(wanted)) &&
      (!m.inputs || new RegExp(m.inputs).test(typed)) &&
      (m.file === undefined || (m.content === undefined ? fileText(m.file) === null : fileText(m.file) !== null && new RegExp(m.content).test(fileText(m.file)))),
  );
  if (mistake) return { kind: 'mistake', say: mistake.say };
  // f-string에서 f를 빼먹어 {이름}이 글자 그대로 나온 경우(출력이나 파일에)
  const unfilled = missingF([code, ...Object.values(modules)].join('\n'), [text, ...Object.values(files)].join('\n'), [wanted, ...Object.values(task.expectFiles ?? {}).map((lines) => lines.join('\n'))].join('\n'));
  if (unfilled) return { kind: 'missing-f', vars: { piece: unfilled } };
  // 출력은 맞고 파일이 틀린 경우, 또는 파일에 쓸 것을 출력 칸에 내보낸 경우
  if (fileWrong && (outputSame || fileWrong.kind === 'file-printed')) return fileWrong;
  if (got.length === 0) return { kind: 'no-output' };

  // 계산할 것을 따옴표 안에 넣어 글자 그대로 나온 경우
  const quoted = compute.find((item) => got.some((line) => squeeze(line).includes(squeeze(item.literal))));
  if (quoted) return { kind: 'quoted-calc', vars: { calc: quoted.literal } };
  // 줄은 다 맞는데 순서만 다른 경우
  if (got.length === want.length && [...got].sort().join('\n') === [...want].sort().join('\n')) return { kind: 'order' };
  if (got.length !== want.length) return { kind: 'count', vars: { got: got.length, want: want.length } };

  const at = got.findIndex((line, i) => line !== want[i]);
  const vars = { no: ORDINAL[at] ?? `${at + 1}번째`, want: want[at], got: got[at] };
  if (squeeze(got[at]) === squeeze(want[at])) return { kind: 'spacing', vars };
  return { kind: 'line-diff', vars };
}

/**
 * f를 빼먹은 f-string을 찾는다: 나온 글자에 {이름} 같은 중괄호 덩어리가 그대로 있고(나와야 하는 것에는 없고),
 * 코드에서 그 덩어리가 f가 붙지 않은 따옴표 안에 있다. 찾으면 그 덩어리("{이름}"), 없으면 null.
 */
export function missingF(code, got, wanted = '') {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [piece] of String(got).matchAll(/\{[^{}[\]|\n]+\}/g)) {
    if (wanted.includes(piece)) continue;
    if (new RegExp(`(?<![fF\\w])(["'])[^"'\\n]*${escape(piece)}`).test(code)) return piece;
  }
  return null;
}

/**
 * 있어야 하는 파일들과 실제 파일들을 견줘 처음 어긋난 것을 알려 준다. 다 맞으면 null.
 * @param {Record<string, string[]>} expected 이름 → 있어야 하는 줄들
 * @param {Record<string, string>} files 프로그램이 끝난 뒤의 파일들
 * @param {string[]} printed 출력 칸에 나온 줄들(파일에 쓸 것을 출력 칸에 낸 것을 알아보려고)
 */
export function fileProblem(expected, files, printed = []) {
  for (const [name, want] of Object.entries(expected)) {
    const has = name in files;
    const got = has ? outputLines(files[name]) : [];
    if (has && got.length === want.length && got.every((line, i) => line === want[i])) continue;
    // 파일이 비었거나 없는데, 쓸 것이 출력 칸에 모두 나왔다: print에 file= 을 빼먹었다.
    if (got.length === 0 && want.length > 0 && want.every((line) => printed.includes(line))) return { kind: 'file-printed', vars: { name } };
    if (!has) {
      const others = Object.keys(files).filter((other) => !(other in expected));
      if (!others.length) return { kind: 'file-none', vars: { name } };
      return { kind: 'file-missing', vars: { name, got: others.join(', ') } };
    }
    if (got.length === 0) return { kind: 'file-empty', vars: { name } };
    if (got.length !== want.length) return { kind: 'file-count', vars: { name, want: want.length, got: got.length } };
    const at = got.findIndex((line, i) => line !== want[i]);
    return { kind: 'file-diff', vars: { name, no: ORDINAL[at] ?? `${at + 1}번째`, want: want[at], got: got[at] } };
  }
  return null;
}

/**
 * 그리기 문제 채점. 다 그린 그림을 모범 답이 그린 그림과 견준다(src/core/drawing.js).
 * @param {{draw: true|{color?: boolean, fill?: boolean}, checks?: object[], mistakes?: object[], inputs?: string[]}} task
 *   mistakes의 { draw: 'draw-mirror', say } 는 그 어긋남일 때 이 문제에 맞는 말을 하게 한다.
 * @param {string} code 아이가 쓴 코드
 * @param {object[]} got 아이의 프로그램이 그린 것(그리기 명령 목록)
 * @param {object[]} want 모범 답이 그린 것
 * @returns {{kind: string, vars?: object, say?: string}} kind: correct, mistake, draw-none, draw-mirror, … (drawing.js)
 */
export function diagnoseDrawing(task, code, got, want) {
  const result = compareDrawing(got ?? [], want ?? [], task.draw === true ? {} : task.draw);
  const bare = stripStrings(code);
  if (result.kind === 'draw-correct') {
    // 그림은 맞지만 배운 방법을 쓰지 않은 경우(예: 반복 없이 네 번 적음)
    const skipped = (task.checks ?? []).find((rule) => !new RegExp(rule.pattern).test(bare));
    return skipped ? { kind: 'mistake', say: skipped.say } : { kind: 'correct' };
  }
  const typed = (task.inputs ?? []).join(',');
  const mistake = (task.mistakes ?? []).find((m) => m.draw === result.kind && (!m.code || new RegExp(m.code).test(bare)) && (!m.inputs || new RegExp(m.inputs).test(typed)));
  return mistake ? { kind: 'mistake', say: mistake.say } : result;
}

/**
 * 게임 문제 채점. 정해 둔 키와 장면 수만큼 돌린 뒤의 모습(거북이들의 자리와 글자, 출력)을 모범 답의 것과 견준다(src/core/scene.js).
 * @param {{game: true|{heading?: boolean, look?: boolean, text?: boolean}, checks?: object[], mistakes?: object[]}} task
 *   mistakes의 { game: 'game-pos', say } 는 그 어긋남일 때 이 문제에 맞는 말을 하게 한다(code 정규식을 함께 적을 수 있다).
 * @param {string} code 아이가 쓴 코드
 * @param {{draw: object[], output: string}} got 아이의 프로그램을 돌린 결과
 * @param {{draw: object[], output: string}} want 모범 답을 돌린 결과
 * @returns {{kind: string, vars?: object, say?: string}} kind: correct, mistake, game-pos, … , game-output(출력이 다르다)
 */
export function diagnoseGame(task, code, got, want, modules = {}) {
  let result = compareScene(got.draw ?? [], want.draw ?? [], task.game === true ? {} : task.game);
  if (result.kind === 'game-correct' && outputLines(got.output).join('\n') !== outputLines(want.output).join('\n')) result = { kind: 'game-output' };
  // 파일에 남기는 게임(단원 20의 최고 기록): 장면이 맞으면 파일도 본다. 어긋남의 종류는 파일 문제와 같다(file-none 등).
  if (result.kind === 'game-correct' && task.expectFiles) result = fileProblem(task.expectFiles, got.files ?? {}, outputLines(got.output)) ?? result;
  // in: checks와 mistakes의 code를 어느 탭에서 볼지(단원 19·20). 없으면 main.py
  const mainBare = stripStrings(code);
  const bareIn = (where) => (!where || where === 'main.py' ? mainBare : stripStrings(modules[where] ?? ''));
  if (result.kind === 'game-correct') {
    const skipped = (task.checks ?? []).find((rule) => !new RegExp(rule.pattern).test(bareIn(rule.in)));
    return skipped ? { kind: 'mistake', say: skipped.say } : { kind: 'correct' };
  }
  const mistake = (task.mistakes ?? []).find((m) => (m.game === result.kind || (m.game === undefined && m.code)) && (!m.code || new RegExp(m.code).test(bareIn(m.in))));
  return mistake ? { kind: 'mistake', say: mistake.say } : result;
}
