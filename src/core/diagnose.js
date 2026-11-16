// 쓰기 문제 채점과 오답 짐작. 순수 함수다.
// 틀렸을 때 "틀렸어요"만 말하지 않고, 무엇을 놓쳤는지 짐작해서 알려 주려는 것이다.

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
 * @param {{expect: string[], mustCompute?: {pattern: string, literal: string}}} task
 * @param {string} code 아이가 쓴 코드
 * @param {{error: object|null, output: string}} run 실행 결과
 * @returns {{kind: string, vars?: object}} kind: correct, error, no-output, not-computed, quoted-calc, order, count, spacing, line-diff
 */
export function diagnoseTask(task, code, run) {
  if (run.error) return { kind: 'error' };
  const got = outputLines(run.output);
  const want = task.expect;
  if (got.length === 0) return { kind: 'no-output' };

  const same = got.length === want.length && got.every((line, i) => line === want[i]);
  if (same) {
    if (task.mustCompute && !new RegExp(task.mustCompute.pattern).test(stripStrings(code))) {
      return { kind: 'not-computed', vars: { calc: task.mustCompute.literal } };
    }
    return { kind: 'correct' };
  }

  // 계산할 것을 따옴표 안에 넣어 글자 그대로 나온 경우
  if (task.mustCompute && got.some((line) => squeeze(line) === squeeze(task.mustCompute.literal))) {
    return { kind: 'quoted-calc', vars: { calc: task.mustCompute.literal } };
  }
  // 줄은 다 맞는데 순서만 다른 경우
  if (got.length === want.length && [...got].sort().join('\n') === [...want].sort().join('\n')) return { kind: 'order' };
  if (got.length !== want.length) return { kind: 'count', vars: { got: got.length, want: want.length } };

  const at = got.findIndex((line, i) => line !== want[i]);
  const vars = { no: ORDINAL[at] ?? `${at + 1}번째`, want: want[at], got: got[at] };
  if (squeeze(got[at]) === squeeze(want[at])) return { kind: 'spacing', vars };
  return { kind: 'line-diff', vars };
}
