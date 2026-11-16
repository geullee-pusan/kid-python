// 파이썬 오류를 한국어 한 문장으로 풀어 준다.
// 시험판이라 자주 나오는 것 몇 가지만 있다. 실제 문구는 첫 판을 만들 때 다시 쓴다.

export function explain(error) {
  const { type, message } = error;
  if (type === 'SyntaxError') {
    if (/expected ':'/.test(message)) return '줄 끝에 콜론(:)이 빠졌어요.';
    if (/was never closed/.test(message)) return '여는 괄호의 짝이 없어요.';
    if (/unterminated string/.test(message)) return '따옴표를 닫지 않았어요.';
    if (/invalid character/.test(message)) return '코드 자리에 쓸 수 없는 글자가 있어요. 한/영 키를 확인해 보세요.';
    return '파이썬이 읽을 수 없는 문장이에요.';
  }
  if (type === 'IndentationError' || type === 'TabError') return '들여쓰기가 맞지 않아요.';
  if (type === 'NameError') {
    const name = /name '(.+?)' is not defined/.exec(message);
    return name ? `"${name[1]}"라는 이름을 아직 만들지 않았어요.` : '아직 만들지 않은 이름을 썼어요.';
  }
  if (type === 'TypeError') return '종류가 맞지 않는 값끼리 계산하려고 했어요.';
  if (type === 'ZeroDivisionError') return '0으로 나눌 수 없어요.';
  if (type === 'ValueError') return '값의 모양이 맞지 않아요.';
  if (type === 'IndexError') return '없는 자리 번호를 썼어요.';
  if (type === 'EOFError') return '입력을 받을 수 없었어요.';
  return `${type} 오류가 났어요.`;
}
