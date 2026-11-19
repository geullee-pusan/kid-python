// 큰 만들기 단원(단원 20)에서 쓰는 것들.
// - 앞 수업에서 통과한 코드를 이어 받기(src/main.js가 저장하고 꺼낸다)
// - 채점하지 않는 쓰기(free)에서, 시작할 때의 코드와 견줘 아이가 무엇을 더했는지 찾아 말로 만든다
import { hasBatchim } from './korean.js';

const ID = '[\\p{L}_][\\p{L}\\p{N}_]*';

/** 이어 받을 코드: continues에 적은 앞 문제("수업id/문제id")들 가운데 가장 나중에 통과한 것. 없으면 null. */
export function pickInherited(task, saved) {
  if (!task.continues) return null;
  return task.continues.map((id) => saved?.[id]).filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0] ?? null;
}

/** 이어 받은 코드를 문제의 시작 코드(start, modules) 자리에 넣은 문제. 고칠 수 없게 준 탭은 늘 문제의 것. */
export function withInherited(task, mine) {
  if (!mine) return task;
  const locked = task.lockModules ?? [];
  const modules = { ...(task.modules ?? {}) };
  for (const [name, code] of Object.entries(mine.modules ?? {})) if (!locked.includes(name)) modules[name] = code;
  return { ...task, start: mine.main, modules };
}

const eul = (word) => (hasBatchim(word) ? '을' : '를');
/** 으로/로: 받침이 없거나 ㄹ 받침이면 '로' */
function ro(word) {
  const last = [...String(word).trim()].at(-1) ?? '';
  if ('178'.includes(last) && /[0-9]/.test(last)) return '로';
  const code = last.codePointAt(0);
  if (code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8) return '로';
  return hasBatchim(word) ? '으로' : '로';
}

const KEY_NAMES = { Left: '왼쪽 화살표', Right: '오른쪽 화살표', Up: '위 화살표', Down: '아래 화살표', space: '스페이스', Return: '엔터' };

/** 코드에서 찾아 두는 것: 클래스, 메서드(들여쓴 def), 함수(맨 앞 def), 키, 맨 앞의 "이름 = 값" 줄 */
function parts(code) {
  const text = String(code ?? '');
  const grab = (re) => [...text.matchAll(re)].map((m) => m[1]);
  return {
    classes: grab(new RegExp(`^class\\s+(${ID})`, 'gmu')),
    methods: grab(new RegExp(`^[ \\t]+def\\s+(${ID})`, 'gmu')).filter((name) => !name.startsWith('__')),
    functions: grab(new RegExp(`^def\\s+(${ID})`, 'gmu')),
    keys: grab(/onkey(?:press|release)?\s*\(\s*[^,()]+,\s*["']([^"']+)["']/gu),
    values: new Map([...text.matchAll(new RegExp(`^(${ID})\\s*=\\s*(.+?)\\s*$`, 'gmu'))].map((m) => [m[1], m[2]])),
  };
}

const list = (names) => names.join(', ');

/**
 * 시작할 때의 코드와 지금 코드를 견줘 더한 것을 짚는 문장들(많아야 max개).
 * @param {{main: string, modules?: Record<string, string>}} before
 * @param {{main: string, modules?: Record<string, string>}} after
 * @returns {string[]}
 */
export function describeAdded(before, after, max = 4) {
  const out = [];
  const files = [['main.py', after.main, before.main], ...Object.entries(after.modules ?? {}).map(([name, code]) => [name, code, before.modules?.[name]])];
  // 새로 만든 파일
  for (const [name, , old] of files) if (name !== 'main.py' && old === undefined) out.push(`${name} 파일을 새로 만들었어요.`);
  for (const [name, code, old] of files) {
    const now = parts(code);
    const was = parts(old ?? '');
    const fresh = (key) => now[key].filter((item) => !was[key].includes(item));
    const classes = fresh('classes');
    if (classes.length) out.push(`${name}에 ${list(classes)} 클래스를 새로 만들었어요.`);
    const methods = fresh('methods');
    if (methods.length) out.push(`${name}에 메서드 ${list(methods)}${eul(methods.at(-1))} 새로 만들었어요.`);
    const functions = fresh('functions');
    if (functions.length) out.push(`${name}에 함수 ${list(functions)}${eul(functions.at(-1))} 새로 만들었어요.`);
    const keys = fresh('keys').map((key) => KEY_NAMES[key] ?? key);
    if (keys.length) out.push(`${list(keys)} 키에 할 일을 붙였어요.`);
    // 바꾼 값: 원래 있던 이름의 값이 달라진 것만(새 이름표는 세지 않는다)
    for (const [label, value] of now.values) {
      const oldValue = was.values.get(label);
      if (oldValue !== undefined && oldValue !== value) out.push(`${name}의 ${label}${eul(label)} ${oldValue}에서 ${value}${ro(value)} 바꿨어요.`);
    }
  }
  return out.slice(0, max);
}
