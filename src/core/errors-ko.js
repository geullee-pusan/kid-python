// 파이썬 오류를 한국어 한 문장으로 풀어 준다. 순수 함수다.
// 이미 배운 낱말만 쓴다. 짐작일 때는 "~한 것 같아요"라고 밝힌다.
// 파이썬이 원래 보여 주는 영어 글은 출력 창에 그대로 함께 보여 준다(화면 쪽에서).

const HANGUL = /[ㄱ-ㆎ가-힣]/;

export function explain(error) {
  const { type, message } = error;
  if (type === 'SyntaxError') {
    if (/expected ':'/.test(message)) return '줄 끝에 콜론(:)이 빠졌어요.';
    if (/was never closed/.test(message)) return '여는 괄호를 닫지 않았어요. 닫는 괄호 )를 써요.';
    if (/unmatched '\)'/.test(message)) return '닫는 괄호가 하나 더 많아요.';
    if (/unterminated string/.test(message)) return '따옴표를 닫지 않았어요. 글자 끝에도 따옴표를 써요.';
    if (/invalid character/.test(message)) return '코드 자리에 쓸 수 없는 글자가 있어요. 한/영 키를 확인해 봐요.';
    if (/Missing parentheses in call to 'print'/.test(message)) return 'print 뒤에 괄호가 있어야 해요. print( ) 안에 넣어요.';
    if (/forgot a comma/.test(message)) return '따옴표로 감싸지 않은 글자가 있는 것 같아요. 글자는 따옴표 안에 넣어요.';
    return '파이썬이 읽을 수 없는 문장이에요. 괄호와 따옴표를 확인해 봐요.';
  }
  if (type === 'IndentationError' || type === 'TabError') {
    if (/unexpected indent/.test(message)) return '줄 앞에 빈칸이 있어요. 줄의 맨 앞에서 시작해요.';
    return '들여쓰기가 맞지 않아요.';
  }
  if (type === 'NameError') {
    const found = /name '(.+?)' is not defined/.exec(message);
    const name = found ? found[1] : '';
    if (name && name !== 'print' && name.toLowerCase() === 'print') return 'print는 모두 작은 글자로 써요.';
    if (name && HANGUL.test(name)) return `"${name}"에 따옴표가 없는 것 같아요. 글자는 따옴표로 감싸요.`;
    if (name) return `"${name}"라는 이름을 파이썬이 몰라요. 글자라면 따옴표로 감싸고, 명령이라면 철자를 확인해요.`;
    return '파이썬이 모르는 이름을 썼어요.';
  }
  if (type === 'TypeError') return '종류가 맞지 않는 값끼리 계산하려고 했어요.';
  if (type === 'ZeroDivisionError') return '0으로 나눌 수 없어요.';
  if (type === 'ValueError') return '값의 모양이 맞지 않아요.';
  if (type === 'IndexError') return '없는 자리 번호를 썼어요.';
  if (type === 'EOFError') return '입력을 받을 수 없었어요.';
  return `${type} 오류가 났어요.`;
}
