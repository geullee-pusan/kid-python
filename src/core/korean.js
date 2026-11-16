// 한국어 말 다듬기: 조사 고르기. 순수 함수다. (주산 앱 JUSAN의 korean.js에서 가져왔다.)

/** 마지막 글자에 받침이 있는가(한글이 아니면 숫자 읽기로 본다) */
export function hasBatchim(word) {
  const last = [...String(word).trim()].at(-1);
  if (!last) return false;
  const code = last.codePointAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  // 숫자로 끝나면 숫자 읽기의 받침: 0(영) 1(일) 3(삼) 6(육) 7(칠) 8(팔)은 받침, 2 4 5 9는 없음
  if (/[0-9]/.test(last)) return '013678'.includes(last);
  return false;
}
