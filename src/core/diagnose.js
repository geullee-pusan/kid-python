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

/** 출력을 줄 목록으로. 줄 끝 빈칸과 맨 끝 빈 줄은 뺀다. */
export function outputLines(output) {
  const lines = String(output ?? '').replace(/\r/g, '').split('\n').map((line) => line.replace(/\s+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 코드에서 따옴표 안의 글자와 주석을 지운다(따옴표 밖에 무엇을 썼는지 보려고). */
export function stripStrings(code) {
  return String(code)
    .replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""')
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
export function diagnoseTask(task, code, run) {
  if (run.error) return { kind: 'error' };
  const got = outputLines(run.output);
  const want = task.expect;
  const bare = stripStrings(code);
  const compute = task.compute ?? [];

  const same = got.length === want.length && got.every((line, i) => line === want[i]);
  if (same) {
    const missing = compute.find((item) => !new RegExp(item.pattern).test(bare));
    if (missing) return { kind: 'not-computed', vars: { calc: missing.literal } };
    // 출력은 맞지만 배운 방법을 쓰지 않은 경우(예: 이름표를 쓰지 않고 숫자를 바로 곱함)
    const skipped = (task.checks ?? []).find((rule) => !new RegExp(rule.pattern).test(bare));
    if (skipped) return { kind: 'mistake', say: skipped.say };
    return { kind: 'correct' };
  }
  if (got.length === 0) return { kind: 'no-output' };

  // 이 문제에서 흔한 실수
  const text = got.join('\n');
  const mistake = (task.mistakes ?? []).find((m) => (!m.code || new RegExp(m.code).test(bare)) && (!m.output || new RegExp(m.output).test(text)));
  if (mistake) return { kind: 'mistake', say: mistake.say };

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
