// 파이썬 오류를 한국어 한 문장으로 풀어 준다. 순수 함수다.
// 이미 배운 낱말만 쓴다. 짐작일 때는 "~한 것 같아요"라고 밝힌다.
// 파이썬이 원래 보여 주는 영어 글은 출력 창에 그대로 함께 보여 준다(화면 쪽에서).
//
// knows: 아이가 배운 것. { variables: true }면 변수(이름표)를 배운 뒤다.
// 변수를 배우기 전에는 모르는 이름이 나왔을 때 "따옴표가 빠진 것 같다"고만 말한다.

import { hasBatchim } from './korean.js';

const HANGUL = /[ㄱ-ㆎ가-힣]/;
/** "키" → "키"라는, "점수" → "점수"라는, "값" → "값"이라는 */
const called = (name) => `"${name}"${hasBatchim(name) ? '이라는' : '라는'}`;

export function explain(error, knows = {}) {
  const { type, message } = error;
  const text = error.text ?? '';
  if (type === 'SyntaxError') {
    // 곱하기를 x나 ×로, 나누기를 ÷로 쓴 경우. 파이썬의 글만으로는 알 수 없어서 오류가 난 줄(text)도 본다.
    if (/invalid character '×'/.test(message) || (/forgot a comma|invalid syntax/.test(message) && /\d\s*[xX]\s*\d/.test(text))) {
      return '곱하기는 x가 아니라 별표(*)로 써요.';
    }
    if (/invalid character '÷'/.test(message)) return '나누기는 빗금(/)으로 써요.';
    if (/expected ':'/.test(message)) return '줄 끝에 콜론(:)이 빠졌어요.';
    if (/was never closed/.test(message)) return '여는 괄호를 닫지 않았어요. 닫는 괄호 )를 써요.';
    if (/unmatched '\)'/.test(message)) return '닫는 괄호가 하나 더 많아요.';
    if (/unterminated string/.test(message)) return '따옴표를 닫지 않았어요. 글자 끝에도 따옴표를 써요.';
    if (/invalid character/.test(message)) return '코드 자리에 쓸 수 없는 글자가 있어요. 한/영 키를 확인해 봐요.';
    if (/Missing parentheses in call to 'print'/.test(message)) return 'print 뒤에 괄호가 있어야 해요. print( ) 안에 넣어요.';
    if (/cannot assign to literal/.test(message)) return '이름이 왼쪽, 값이 오른쪽이에요. 숫자나 글자에는 값을 넣을 수 없어요.';
    if (/cannot assign to expression/.test(message)) return '등호의 왼쪽에는 이름 하나만 써요. 계산은 오른쪽에 써요.';
    if (/invalid decimal literal/.test(message)) return '이름은 숫자로 시작할 수 없어요. 글자로 시작하게 바꿔요.';
    if (/Maybe you meant '=='/.test(message)) return '같은지 물을 때는 등호 두 개(==)를 써요.';
    // 이름이 숫자로 시작하는 경우: "2반 = 3" (한글이 이어지면 파이썬은 그냥 invalid syntax라고만 한다)
    if (knows.variables && /^\s*\d+[^\s\d=()+\-*/%.,"'#]+\s*=[^=]/m.test(text)) return '이름은 숫자로 시작할 수 없어요. 글자로 시작하게 바꿔요.';
    // 이름에 빈칸을 넣은 경우: "내 나이 = 9"
    if (knows.variables && /^\s*[^\s=()"'#]+\s+[^\s=()"'#]+\s*=[^=]/m.test(text)) return '이름에는 빈칸을 쓸 수 없어요. 붙여 쓰거나 밑줄(_)로 이어요.';
    if (/forgot a comma/.test(message)) return '따옴표로 감싸지 않은 글자가 있거나, 쉼표가 빠진 것 같아요.';
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
    if (name && name !== 'input' && name.toLowerCase() === 'input') return 'input은 모두 작은 글자로 써요.';
    if (name && knows.variables) return `${called(name)} 이름표가 아직 없어요. 먼저 값을 넣었는지, 철자가 같은지 봐요. 글자를 쓰려던 거라면 따옴표로 감싸요.`;
    if (name && HANGUL.test(name)) return `"${name}"에 따옴표가 없는 것 같아요. 글자는 따옴표로 감싸요.`;
    if (name) return `${called(name)} 이름을 파이썬이 몰라요. 글자라면 따옴표로 감싸고, 명령이라면 철자를 확인해요.`;
    return '파이썬이 모르는 이름을 썼어요.';
  }
  if (type === 'TypeError') {
    if (/can only concatenate str|unsupported operand type\(s\) for \+/.test(message)) return '글자와 숫자는 더하기(+)로 이을 수 없어요. 숫자로 계산하려면 int( )로, 글자로 이으려면 str( )로 바꿔요.';
    if (/unsupported operand type\(s\) for [-/*%]|can't multiply sequence/.test(message)) return '글자로는 이 계산을 할 수 없어요. int( )로 숫자로 바꿔요.';
    if (/missing \d+ required positional argument|takes \d+ positional argument/.test(message)) return '괄호 안에 넣은 값의 개수가 맞지 않아요.';
    return '종류가 맞지 않는 값끼리 계산하려고 했어요.';
  }
  if (type === 'ValueError') {
    const bad = /invalid literal for int\(\) with base 10: (.+)$/.exec(message);
    if (bad) return `${bad[1]}은(는) 숫자로 바꿀 수 없어요. int( ) 안에는 숫자로 된 글자만 넣어요.`;
    return '값의 모양이 맞지 않아요.';
  }
  if (type === 'ZeroDivisionError') return '0으로 나눌 수 없어요.';
  if (type === 'IndexError') return '없는 자리 번호를 썼어요.';
  if (type === 'EOFError') return '입력을 받을 수 없었어요.';
  return `${type} 오류가 났어요.`;
}
