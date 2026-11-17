// 파이썬 오류를 한국어 한 문장으로 풀어 준다. 순수 함수다.
// 이미 배운 낱말만 쓴다. 짐작일 때는 "~한 것 같아요"라고 밝힌다.
// 파이썬이 원래 보여 주는 영어 글은 출력 창에 그대로 함께 보여 준다(화면 쪽에서).
//
// knows: 아이가 배운 것. { variables: true }면 변수(이름표)를 배운 뒤다.
// 변수를 배우기 전에는 모르는 이름이 나왔을 때 "따옴표가 빠진 것 같다"고만 말한다.
// { loops: true }면 반복과 값 쌓기를 배운 뒤다(대본에 "knows": ["variables", "loops"]).

import { hasBatchim } from './korean.js';

const HANGUL = /[ㄱ-ㆎ가-힣]/;
/** 그림판(turtle)에서 쓸 수 있는 명령. 앞에 turtle. 을 빼먹었을 때와 철자가 틀렸을 때 알려 주려고 적어 둔다. */
const TURTLE_WORDS = new Set([
  'forward', 'backward', 'left', 'right', 'penup', 'pendown', 'color', 'pencolor', 'fillcolor', 'pensize', 'goto', 'setheading',
  'home', 'circle', 'dot', 'write', 'begin_fill', 'end_fill', 'speed', 'hideturtle', 'showturtle', 'shape', 'clear', 'bgcolor',
]);
/** 진짜 turtle에는 있지만 이 앱의 그림판에는 아직 없는 명령 */
const TURTLE_LATER = /^(onclick|onscreenclick|ondrag|onrelease|stamp|clearstamp|clearstamps|undo|towards|shapesize|turtlesize|tilt|register_shape|addshape|textinput|numinput|colormode|getscreen|clone|begin_poly|end_poly|degrees|radians|teleport)$/;
/** "키" → "키"라는, "점수" → "점수"라는, "값" → "값"이라는 */
const called = (name) => `"${name}"${hasBatchim(name) ? '이라는' : '라는'}`;
const topic = (name) => `${name}${hasBatchim(name) ? '은' : '는'}`;

// 파이썬에 처음부터 있는 종류의 이름. 여기에 없으면 아이가 만든 클래스로 본다.
const BUILTIN_TYPES = new Set(['str', 'int', 'float', 'bool', 'list', 'dict', 'tuple', 'set', 'NoneType', 'range', 'function', 'module', 'Turtle', 'method', 'builtin_function_or_method', 'type']);

export function explain(error, knows = {}) {
  const { type, message } = error;
  const text = error.text ?? '';
  if (type === 'SyntaxError') {
    // 곱하기를 x나 ×로, 나누기를 ÷로 쓴 경우. 파이썬의 글만으로는 알 수 없어서 오류가 난 줄(text)도 본다.
    if (/invalid character '×'/.test(message) || (/forgot a comma|invalid syntax/.test(message) && /\d\s*[xX]\s*\d/.test(text))) {
      return '곱하기는 x가 아니라 별표(*)로 써요.';
    }
    if (/invalid character '÷'/.test(message)) return '나누기는 빗금(/)으로 써요.';
    if (/invalid character '[≥≤]'/.test(message)) return '≥는 >= 로, ≤는 <= 로 써요. 기호 두 개를 이어 써요.';
    if (/invalid character '≠'/.test(message)) return '다르다는 != 로 써요. 느낌표와 등호를 이어 써요.';
    // 줄여 쓰는 기호를 띄어 쓴 경우: "점수 + = 1"
    if (/[-+*]\s+=/.test(text.replace(/"[^"]*"|'[^']*'/g, ''))) return '+= 처럼 줄여 쓰는 기호는 붙여 써요. 사이에 빈칸을 넣지 않아요.';
    // 등호를 앞에 쓴 경우: "if 키 => 130:"
    if (/=[><]/.test(text.replace(/"[^"]*"|'[^']*'/g, ''))) return '크거나 같다는 >= 로, 작거나 같다는 <= 로 써요. 등호가 뒤에 와요.';
    // else 뒤에 조건을 쓴 경우: "else if 수 > 3:", "else 수 > 3:"
    if (/^\s*else\s+if\b/m.test(text)) return '파이썬에서는 else if를 줄여서 elif라고 써요.';
    if (/^\s*else\s+[^:\s]/m.test(text)) return 'else 뒤에는 조건을 쓰지 않아요. else: 라고만 써요. 조건이 더 필요하면 elif를 써요.';
    // print 안의 end= 를 잘못 쓴 경우: end 뒤에 등호가 없다, 등호 뒤가 비었다, 맨 뒤가 아니다, 앞에 쉼표가 없다.
    const bare = text.replace(/"[^"]*"|'[^']*'/g, '""');
    if (/[,(]\s*end\s*""/.test(bare)) return 'end 뒤에 등호(=)가 빠졌어요. end="" 처럼 써요.';
    if (/expected argument value expression/.test(message)) return '등호(=) 뒤에 값이 빠졌어요. end="" 처럼 따옴표를 써요.';
    if (/positional argument follows keyword argument/.test(message)) return 'end= 은 괄호 안의 맨 뒤에 써요. 내보낼 값을 먼저 쓰고, 그 뒤에 쉼표와 end= 을 써요.';
    if (/forgot a comma/.test(message) && /[^,(\s]\s+end\s*=/.test(bare)) return 'end 앞에 쉼표가 빠졌어요. 내보낼 값 뒤에 쉼표를 찍고 end= 을 써요.';
    if (/expected ':'/.test(message)) return '줄 끝에 콜론(:)이 빠졌어요.';
    if (/'\{' was never closed/.test(message)) return '여는 중괄호 { 를 닫지 않았어요. 닫는 중괄호 } 를 써요.';
    if (/unmatched '\}'/.test(message)) return '닫는 중괄호 } 가 하나 더 많아요.';
    // 딕셔너리에서 키와 값 사이의 콜론을 빼거나 등호로 쓴 경우: {"사과" 1000}, {"사과" = 1000}
    if (/\{\s*""\s*=[^=]/.test(bare)) return '딕셔너리에서 키와 값 사이에는 등호가 아니라 콜론(:)을 써요.';
    if (/forgot a comma/.test(message) && /[{,]\s*""\s+[^\s:,}]/.test(bare)) return '딕셔너리에서 키와 값 사이에는 콜론(:)을 써요. "사과": 1000 처럼 써요.';
    if (/forgot a comma/.test(message) && /\{[^}]*:\s*[^\s,}]+\s+""\s*:/.test(bare)) return '딕셔너리의 짝과 짝 사이에 쉼표가 빠졌어요.';
    // 키와 값의 짝을 대괄호 안에 쓴 경우: ["사과": 1000]
    if (/\[\s*""\s*:\s*[^\]]/.test(bare) && /=\s*\[/.test(bare)) return '키와 값의 짝은 대괄호가 아니라 중괄호 { } 안에 써요.';
    if (/'\[' was never closed/.test(message)) return '여는 대괄호 [ 를 닫지 않았어요. 닫는 대괄호 ] 를 써요.';
    if (/was never closed/.test(message)) return '여는 괄호를 닫지 않았어요. 닫는 괄호 )를 써요.';
    if (/unmatched '\]'/.test(message)) return '닫는 대괄호 ] 가 하나 더 많아요.';
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
    // for를 큰 글자로 시작한 경우: "For i in range(3):"
    if (/^\s*F[oO][rR]\s/m.test(text) || /^\s*fOR\s|^\s*FOR\s/m.test(text)) return 'for는 모두 작은 글자로 써요.';
    if (/'break' outside loop/.test(message)) return 'break는 반복 안에서만 쓸 수 있어요. 반복 안에 들여썼는지 봐요.';
    if (/'continue' not properly in loop/.test(message)) return 'continue는 반복 안에서만 쓸 수 있어요. 반복 안에 들여썼는지 봐요.';
    if (/'return' outside function/.test(message)) return 'return은 함수 안에서만 쓸 수 있어요. def 아래에 들여썼는지 봐요.';
    // if, else, elif, while, def를 큰 글자로 쓴 경우
    const shouted = /^\s*(If|IF|Else|ELSE|Elif|ELIF|While|WHILE|Def|DEF)\b/m.exec(text);
    if (shouted) return `${shouted[1].toLowerCase()}는 모두 작은 글자로 써요.`;
    // else나 elif가 짝이 되는 if와 줄이 맞지 않는 경우
    if (/^\s*(else\s*:|elif\b)/m.test(text)) return 'else와 elif는 짝이 되는 if와 줄의 앞을 맞춰 써요. if가 위에 있는지도 봐요.';
    if (/forgot a comma/.test(message)) return '따옴표로 감싸지 않은 글자가 있거나, 쉼표가 빠진 것 같아요.';
    return '파이썬이 읽을 수 없는 문장이에요. 괄호와 따옴표를 확인해 봐요.';
  }
  if (type === 'IndentationError' || type === 'TabError') {
    if (/expected an indented block/.test(message)) return '콜론(:) 다음 줄은 들여써야 해요. 줄 앞에 빈칸 4개를 넣어요.';
    if (/unindent does not match/.test(message)) return '들여쓰기의 빈칸 수가 위의 줄과 맞지 않아요. 같은 묶음은 같은 만큼 들여써요.';
    if (/unexpected indent/.test(message)) return '줄 앞에 빈칸이 있어요. 들여쓸 줄이 아니면 줄의 맨 앞에서 시작해요.';
    return '들여쓰기가 맞지 않아요.';
  }
  if (type === 'NameError') {
    const found = /name '(.+?)' is not defined/.exec(message);
    const name = found ? found[1] : '';
    if (name && name !== 'print' && name.toLowerCase() === 'print') return 'print는 모두 작은 글자로 써요.';
    if (name && name !== 'input' && name.toLowerCase() === 'input') return 'input은 모두 작은 글자로 써요.';
    if (name && /^(true|false|TRUE|FALSE)$/.test(name)) return 'True와 False는 첫 글자만 큰 글자로 써요.';
    if (name === 'self') return 'self는 클래스 안의 함수에서만 써요. 그 함수의 괄호 안 맨 앞에 self가 있는지 봐요. 클래스 밖에서는 가.이름 처럼 객체의 이름표를 써요.';
    // 클래스 안의 함수에서 self. 을 빼먹은 경우(실행기가 hint로 알려 준다)
    if (error.hint) return `클래스 안에서 객체가 가진 값을 쓸 때는 앞에 self와 점을 붙여요. ${error.hint} 라고 써요.`;
    if (name === 'turtle') return 'turtle을 쓰려면, 맨 윗줄에 import turtle 을 먼저 써요.';
    // 그림판 명령을 turtle. 없이 부른 경우: forward(100)
    if (TURTLE_WORDS.has(name) && text.replace(/\s+\(/g, '(').includes(`${name}(`)) return `${name}는 앞에 turtle과 점을 붙여 써요. turtle.${name}( ) 처럼 써요. 맨 윗줄에 import turtle 도 있어야 해요.`;
    if (name === 'random') return 'random을 쓰려면, 맨 윗줄에 import random 을 먼저 써요.';
    if (name === 'randint') return 'randint는 random.randint( ) 처럼, 앞에 random과 점을 붙여 써요.';
    // 함수를 부르려던 경우: 오류가 난 줄에 "이름(" 꼴이 있다.
    if (name && knows.functions && new RegExp(`(^|[^\\w가-힣])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'm').test(text)) {
      if (knows.classes) return `${called(name)} 함수나 클래스가 아직 없어요. 쓰기 전에 def나 class로 먼저 만들었는지, 철자가 같은지 봐요.`;
      return `${called(name)} 함수가 아직 없어요. 부르기 전에 def로 먼저 만들었는지, 철자가 같은지 봐요.`;
    }
    // 대괄호 안에 따옴표 없이 한글을 쓴 경우: 가격[사과]
    if (name && HANGUL.test(name) && knows.functions && new RegExp(`\\[\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]`).test(text)) {
      return `${called(name)} 이름표가 없어요. 대괄호 안에 키를 글자로 쓰려던 거라면 따옴표로 감싸요. 이름표라면 값을 넣었는지, 철자가 같은지 봐요.`;
    }
    if (name && knows.functions) return `${called(name)} 이름표가 여기서는 보이지 않아요. 함수 안에서 만든 이름은 함수 밖에서 쓸 수 없어요. 값을 넣었는지, 철자가 같은지도 봐요.`;
    if (name && knows.variables) return `${called(name)} 이름표가 아직 없어요. 먼저 값을 넣었는지, 철자가 같은지 봐요. 글자를 쓰려던 거라면 따옴표로 감싸요.`;
    if (name && HANGUL.test(name)) return `"${name}"에 따옴표가 없는 것 같아요. 글자는 따옴표로 감싸요.`;
    if (name) return `${called(name)} 이름을 파이썬이 몰라요. 글자라면 따옴표로 감싸고, 명령이라면 철자를 확인해요.`;
    return '파이썬이 모르는 이름을 썼어요.';
  }
  if (type === 'UnboundLocalError' && error.hint) return `클래스 안에서 객체가 가진 값을 바꿀 때는 앞에 self와 점을 붙여요. ${error.hint} 라고 써요.`;
  if (type === 'UnboundLocalError') return '함수 안에서 값을 넣는 이름은 함수 안의 새 이름표예요. 밖의 값을 쓰려면 괄호로 넘겨받고, 바꾼 값은 return으로 돌려줘요.';
  if (type === 'TypeError') {
    const keyword = /print\(\) got an unexpected keyword argument '(.+?)'/.exec(message);
    if (keyword && keyword[1].toLowerCase() === 'end') return 'end는 모두 작은 글자로 써요. end="" 처럼 써요.';
    if (keyword) return 'print( ) 안에서 등호(=)와 함께 쓰는 이름은 end예요. 철자를 확인해요.';
    if (/(end|sep) must be None or a string/.test(message)) return 'end= 뒤에는 글자를 써요. 따옴표로 감싸요.';
    // 그림판 명령에 값을 빼먹거나 너무 많이 넣은 경우
    if (/Turtle\.\w+\(\) missing \d+ required positional argument/.test(message)) return '이 명령의 괄호 안에 값을 넣어야 해요. 얼마나 움직일지, 얼마나 돌지를 숫자로 넣어요.';
    if (/Turtle\.\w+\(\) takes \d+ positional arguments? but \d+ (was|were) given/.test(message)) return '이 명령의 괄호 안에 넣은 값의 개수가 맞지 않아요.';
    if (/cannot unpack non-iterable/.test(message) && /goto|setpos/.test(text)) return 'goto( ) 안에는 가로 위치와 세로 위치, 숫자 두 개를 쉼표로 넣어요.';
    if (/as a dict key|unhashable type/.test(message)) return '리스트는 딕셔너리의 키로 쓸 수 없어요. 키는 글자나 숫자로 써요.';
    if (/'(str|int|float|bool|list)' object is not callable/.test(message)) return '둥근 괄호는 함수나 클래스 뒤에만 붙여요. 값을 꺼내 쓸 때는 괄호 없이 이름만 써요.';
    if (/'dict' object is not callable/.test(message)) return '딕셔너리에서 꺼낼 때는 둥근 괄호가 아니라 대괄호를 써요. 값["사과"] 처럼 써요.';
    if (/'dict_(keys|values|items)' object is not subscriptable/.test(message)) return '여기에는 번호를 쓸 수 없어요. 딕셔너리는 키로 꺼내요. 차례로 보려면 for로 돌아요.';
    if (/indices must be integers or slices, not tuple/.test(message)) return '대괄호 하나에 번호 두 개를 쉼표로 쓸 수 없어요. 표[0][1] 처럼 대괄호를 따로 써요. 표를 만드는 중이라면, 줄과 줄 사이에 쉼표가 빠졌는지 봐요.';
    if (/for \+: 'int' and 'list'|for \+=: 'int' and 'list'/.test(message)) return '숫자에 리스트를 더할 수 없어요. 표의 한 줄은 리스트예요. 줄 안의 값을 하나씩 꺼내서 더하거나, sum( )에 한 줄을 넣어요.';
    if (/NoneType/.test(message)) return '값을 돌려주지 않는 함수의 결과(None)로 계산하려고 했어요. 함수 안에서 return으로 값을 돌려줘요.';
    if (/'str' object does not support item assignment/.test(message)) return '글자는 한 글자만 바꿀 수 없어요. 새 글자를 만들어서 이름표에 다시 넣어요.';
    if (/for -: 'str' and 'str'/.test(message)) return '글자에서 글자를 뺄 수는 없어요. 지우려면 replace( )로 빈 글자("")로 바꿔요.';
    if (/replace\(\) takes at least 2/.test(message)) return 'replace( ) 안에는 바꿀 글자와 새 글자, 두 개를 넣어요.';
    if (/expected at least 1 argument, got 0/.test(message)) return '괄호 안에 찾을 글자를 넣어요.';
    if (/must be str, not int|requires string as left operand/.test(message)) return '글자 안에서 찾을 때는 글자로 물어요. 숫자라면 따옴표로 감싸거나 str( )로 글자로 바꿔요.';
    if (/expected str instance/.test(message)) return 'join( )은 글자만 이을 수 있어요. 숫자는 str( )로 글자로 바꿔요.';
    if (/has no len\(\)/.test(message)) return 'len( )은 글자나 리스트에 써요. 숫자라면 str( )로 글자로 바꿔요.';
    if (/indices must be integers.*'float'|slice indices must be integers/.test(message)) return '대괄호 안의 번호는 소수점이 없는 숫자여야 해요. 나눌 때는 몫(//)을 쓰고, 글자라면 int( )로 바꿔요.';
    const joined = /can only concatenate str \(not "(.+?)"\) to str/.exec(message);
    if (joined && !BUILTIN_TYPES.has(joined[1])) return '글자에 객체를 그대로 이을 수 없어요. 가.이름 처럼 점을 찍어서 안에 든 값을 꺼내 이어요.';
    if (/can only concatenate str|unsupported operand type\(s\) for \+/.test(message)) return '글자와 숫자는 더하기(+)로 이을 수 없어요. 숫자로 계산하려면 int( )로, 글자로 이으려면 str( )로 바꿔요.';
    if (/unsupported operand type\(s\) for [-/*%]|can't multiply sequence/.test(message)) return '글자로는 이 계산을 할 수 없어요. int( )로 숫자로 바꿔요.';
    if (/(list|string) indices must be integers/.test(message)) return '대괄호 안의 번호는 숫자여야 해요. 글자라면 int( )로 숫자로 바꿔요.';
    if (/object is not iterable/.test(message)) return 'for … in 뒤에는 리스트나 range( ), 글자를 써요. 숫자 하나는 차례로 돌 수 없어요. 숫자를 한 자리씩 돌려면 str( )로 글자로 바꿔요.';
    if (/object is not subscriptable/.test(message)) return '대괄호로 꺼낼 수 있는 것은 리스트와 글자예요. 숫자에는 쓸 수 없어요. 이름표에 무엇이 들어 있는지 봐요. input의 답을 int( )로 바꿨다면 글자가 아니라 숫자예요.';
    if (/can only concatenate list/.test(message)) return '리스트에 값 하나를 더할 때는 append( )를 써요.';
    if (/not supported between instances of/.test(message)) return '글자와 숫자는 크기를 견줄 수 없어요. input의 답이라면 int( )로 숫자로 바꿔요.';
    if (/cannot be interpreted as an integer/.test(message)) return 'range( ) 안에는 숫자를 넣어요. 글자라면 int( )로 숫자로 바꿔요.';
    // 클래스: 파이썬은 "학생.소개()"처럼 클래스 이름과 함께 알려 주고, 값의 개수에 self도 넣어서 센다.
    const noInit = /^(.+?)\(\) takes no arguments/.exec(message);
    if (noInit) return `${noInit[1]}에 값을 넣어서 만들려면, 클래스 안에 __init__ 이 있어야 해요. 밑줄이 앞에 두 개, 뒤에 두 개인지 봐요.`;
    const method = /^([^\s.()]+)\.([^\s.()]+)\(\) (missing|takes) /.exec(message);
    if (method) {
      const [, cls, fn] = method;
      const what = fn === '__init__' ? `${cls}( )로 만들 때` : `${fn}( )를 부를 때`;
      const missing = /missing \d+ required positional arguments?: (.+)$/.exec(message);
      if (missing && missing[1] === "'self'") return `${topic(cls)} 클래스의 이름이에요. ${fn}( )는 만들어 둔 객체에 점을 찍어 불러요. ${cls}( ) 처럼 괄호를 붙여서 객체를 만들었는지 봐요.`;
      if (missing) return `${what} 넣을 값이 모자라요. 빠진 것: ${missing[1].replace(/'/g, '').replace(/,? and /, ', ')}`;
      const counts = /takes (\d+) positional arguments? but (\d+) (?:was|were) given/.exec(message);
      if (counts && counts[1] === '0') return `클래스 안의 함수는 괄호 안의 맨 앞에 self를 써야 해요. def ${fn}(self): 처럼 써요.`;
      if (counts) return `${what} 값을 ${counts[2] - 1}개 넣었는데, 받기로 한 것은 ${counts[1] - 1}개예요. def ${fn} 줄의 괄호 안을 봐요. 맨 앞의 self는 세지 않아요.`;
    }
    if (knows.functions && /missing \d+ required positional argument/.test(message)) return '함수가 받기로 한 값을 다 넘기지 않았어요. 부를 때 괄호 안에 값을 넣어요.';
    if (knows.functions && /takes \d+ positional arguments? but \d+ (was|were) given/.test(message)) return '함수가 받기로 한 것보다 값을 많이 넘겼어요. def 줄의 괄호 안과 개수를 맞춰요.';
    if (/missing \d+ required positional argument|takes \d+ positional argument/.test(message)) return '괄호 안에 넣은 값의 개수가 맞지 않아요.';
    return '종류가 맞지 않는 값끼리 계산하려고 했어요.';
  }
  if (type === 'AttributeError') {
    const turtleName = /module 'turtle' has no attribute '(.+?)'/.exec(message) ?? /'Turtle' object has no attribute '(.+?)'/.exec(message);
    if (turtleName && TURTLE_LATER.test(turtleName[1])) return `${turtleName[1]}는 이 앱의 그림판에서는 아직 쓸 수 없는 명령이에요.`;
    if (turtleName && turtleName[1] !== turtleName[1].toLowerCase() && turtleName[1] !== 'Turtle') return '점(.) 뒤의 명령은 모두 작은 글자로 써요.';
    if (turtleName) return 'turtle 뒤의 이름을 파이썬이 몰라요. 철자를 확인해요. forward, backward, left, right, penup, pendown, color, goto 같은 이름을 써요.';
    if (/module 'random' has no attribute/.test(message)) return 'random 뒤의 이름이 달라요. random.randint 의 철자를 확인해요.';
    if (/'str' object has no attribute '(append|add|push)'/.test(message)) return '글자에는 append( )를 쓸 수 없어요. 글자를 이으려면 더하기(+)를 써요.';
    if (/'str' object has no attribute '(remove|pop)'/.test(message)) return '글자에서는 한 글자를 지울 수 없어요. replace( )로 빈 글자("")로 바꾼 새 글자를 만들어요.';
    const strName = /'str' object has no attribute '(.+?)'/.exec(message);
    if (strName && strName[1] !== strName[1].toLowerCase()) return '점(.) 뒤의 명령은 모두 작은 글자로 써요.';
    if (strName) return '글자 뒤의 점(.) 다음 이름을 파이썬이 몰라요. replace, count, find, split 의 철자를 확인해요.';
    if (/'list' object has no attribute '(replace|find|split|join|upper|lower)'/.test(message)) return '글자에 쓰는 명령을 리스트에 썼어요. 리스트에서 글자를 하나 꺼내서 써요.';
    if (/'int' object has no attribute/.test(message)) return '숫자 뒤에는 점(.) 명령을 쓸 수 없어요. 글자로 다루려면 str( )로 바꿔요.';
    if (/'dict' object has no attribute '(append|add|push|insert)'/.test(message)) return '딕셔너리에는 append( )를 쓰지 않아요. 이름[키] = 값 으로 넣어요.';
    if (/'dict' object has no attribute '(remove|delete)'/.test(message)) return '딕셔너리에서 지울 때는 pop(키)를 써요.';
    const dictName = /'dict' object has no attribute '(.+?)'/.exec(message);
    if (dictName && /^[a-zA-Z_]+$/.test(dictName[1]) && dictName[1] !== dictName[1].toLowerCase()) return '점(.) 뒤의 명령은 모두 작은 글자로 써요.';
    if (dictName && !/^[a-zA-Z_]+$/.test(dictName[1])) return '딕셔너리에서 꺼낼 때는 점(.)이 아니라 대괄호를 써요. 값["사과"] 처럼, 키를 따옴표로 감싸서 대괄호 안에 넣어요.';
    if (dictName) return '딕셔너리 뒤의 점(.) 다음 이름을 파이썬이 몰라요. pop 의 철자를 확인해요. 넣을 때는 이름[키] = 값 이라고 써요.';
    if (/'list' object has no attribute '(add|push|insert_end|appned|apend)'/.test(message)) return '리스트에 값을 더할 때는 append 라고 써요. 철자를 확인해요.';
    if (/'list' object has no attribute/.test(message)) return '리스트 뒤의 점(.) 다음 이름을 파이썬이 몰라요. append, remove, index 의 철자를 확인해요.';
    const classAttr = /type object '(.+?)' has no attribute '(.+?)'/.exec(message);
    if (classAttr) return `${topic(classAttr[1])} 클래스의 이름이에요. ${classAttr[1]}( ) 처럼 괄호를 붙여야 객체가 만들어져요.`;
    const objectAttr = /^'(.+?)' object has no attribute '(.+?)'/.exec(message);
    if (objectAttr && !BUILTIN_TYPES.has(objectAttr[1])) return `이 객체에는 ${called(objectAttr[2])} 이름이 없어요. 철자를 확인해요. 값이라면 __init__ 안에서 self.${objectAttr[2]} 에 넣었는지, 할 일이라면 클래스 안에 def로 만들었는지 봐요.`;
    return '점(.) 뒤에 쓴 이름을 파이썬이 몰라요. 철자를 확인해요.';
  }
  if (type === 'ModuleNotFoundError' || type === 'ImportError') return 'import 뒤의 이름을 파이썬이 몰라요. random 은 모두 작은 글자로 써요.';
  if (type === 'ValueError') {
    const bad = /invalid literal for int\(\) with base 10: (.+)$/.exec(message);
    if (bad) return `${bad[1]}은(는) 숫자로 바꿀 수 없어요. int( ) 안에는 숫자로 된 글자만 넣어요.`;
    if (/substring not found/.test(message)) return '찾는 글자가 없어요. 먼저 in으로 있는지 물어봐요. find( )는 없을 때 -1을 알려 줘요.';
    if (/empty separator/.test(message)) return 'split( ) 안에 빈 글자는 넣을 수 없어요. 빈칸에서 자르려면 괄호 안을 비워요.';
    if (/empty range/.test(message)) return 'randint( ) 안에는 작은 수를 먼저, 큰 수를 나중에 써요.';
    if (/list\.remove\(x\): x not in list/.test(message)) return '리스트에 없는 값은 지울 수 없어요. 철자를 확인하거나, 먼저 in으로 있는지 물어봐요.';
    if (/list\.index\(x\): x not in list/.test(message)) return '찾는 값이 리스트에 없어요. 철자를 확인하거나, 먼저 in으로 있는지 물어봐요.';
    const missing = /^(.+) is not in list$/.exec(message);
    if (missing) return `${missing[1]}은(는) 리스트에 없어요. 철자를 확인하거나, 먼저 in으로 있는지 물어봐요.`;
    // 끝나지 않는 반복에서 수가 끝없이 커지면, 파이썬이 그 수를 글자로 바꾸다가 멈춘다.
    if (/Exceeds the limit/.test(message)) return '수가 끝없이 커졌어요. 반복이 끝나지 않는 것 같아요. 조건이 언젠가 거짓이 되는지 봐요.';
    return '값의 모양이 맞지 않아요.';
  }
  if (type === 'ZeroDivisionError') {
    // 반복을 배운 뒤에는 range가 0부터 세어서 생기는 일이 많다: "for i in range(수): 수 % i"
    if (knows.loops) return '0으로 나눌 수 없어요. range는 0부터 세요. 나누는 수가 0이 되지 않게 1부터 시작해요.';
    return '0으로 나눌 수 없어요.';
  }
  if (type === 'IndexError') {
    if (/pop from empty list/.test(message)) return '빈 리스트에서는 꺼낼 것이 없어요.';
    if (/string index/.test(message)) return '없는 번호를 썼어요. 번호는 0부터 세어서, 마지막 번호는 글자 수보다 하나 작아요.';
    return '없는 번호를 썼어요. 번호는 0부터 세어서, 마지막 번호는 항목 수보다 하나 작아요.';
  }
  if (type === 'KeyError') {
    // 파이썬은 없는 키를 그대로 보여 준다: '수박' 또는 0
    const key = /^'(.*)'$/.exec(message);
    if (key && key[1] !== key[1].trim()) return `"${key[1]}"에는 앞이나 뒤에 빈칸이 있어요. 딕셔너리의 키와 한 글자도 다르지 않아야 해요.`;
    if (key) return `${called(key[1])} 키가 딕셔너리에 없어요. 철자가 같은지 봐요. 없을 수도 있으면 먼저 in으로 물어봐요. 처음 넣을 때는 += 가 아니라 = 로 넣어요.`;
    if (/^-?\d+$/.test(message)) return `딕셔너리에는 ${message}이라는 키가 없어요. 딕셔너리는 번호가 아니라 키로 꺼내요.`;
    return '그 키가 딕셔너리에 없어요. 먼저 in으로 있는지 물어봐요.';
  }
  if (type === 'RuntimeError' && /dictionary changed size during iteration/.test(message)) return '딕셔너리를 for로 도는 동안에는 키를 넣거나 지울 수 없어요. 반복이 끝난 뒤에 바꿔요.';
  if (type === 'TurtleGraphicsError') {
    const color = /bad color string: (.*)$/.exec(message);
    if (color) return `"${color[1]}"은(는) 쓸 수 없는 색 이름이에요. 색은 영어로 써요. red, orange, yellow, green, blue, purple, pink, brown, black, white 같은 이름을 쓸 수 있어요.`;
    if (/too many drawing commands/.test(message)) return '그림을 너무 많이 그려서 멈췄어요. 반복이 끝나지 않는 것 같아요.';
    if (/bad pen size/.test(message)) return '펜의 굵기는 0보다 큰 숫자로 써요.';
    if (/key handler is None/.test(message)) return '첫째 칸에는 함수의 이름만 써요. 이름 뒤에 괄호를 붙이면 함수가 그 자리에서 바로 실행돼 버려요. 괄호를 지워요.';
    if (/key handler must be a function/.test(message)) return '첫째 칸에는 def로 만든 함수의 이름을 써요.';
    const badKey = /bad key name: (.*)$/.exec(message);
    if (badKey) return `"${badKey[1]}"은(는) 쓸 수 없는 키 이름이에요. 화살표는 "Left", "Right", "Up", "Down", 스페이스는 "space", 글자는 "a"처럼 작은 글자 하나를 써요.`;
    if (/bad shape size/.test(message)) return '모양의 크기는 0보다 큰 숫자로 써요.';
    if (/no shape named/.test(message)) return '그런 모양은 없어요. "turtle", "arrow", "circle", "square", "triangle" 가운데에서 골라요.';
    return '그림판 명령을 실행할 수 없었어요.';
  }
  if (type === 'EOFError') return '입력을 받을 수 없었어요.';
  return `${type} 오류가 났어요.`;
}
