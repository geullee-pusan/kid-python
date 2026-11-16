// 미션 대본(src/content/missions/*.json)을 화면이 재생할 "장면" 목록으로 바꾼다. 순수 함수다.
// 틀은 주산 앱 JUSAN의 lesson.js를 따랐다: 대본(데이터) → 장면(이 파일) → 재생기(src/ui/player.js).
//
// 장면 종류
//  say          대사 { text(자막), speech(읽을 말), pose }
//  board-pair   칠판에 엔트리 블록과 파이썬 문장을 나란히 { entry, python, note }
//  board-card   칠판에 글 카드 { title, items }
//  board-clear  칠판 지우기
//  code-type    편집기에 코드를 한 글자씩 친다 { code }
//  trace        편집기의 코드를 한 줄씩 실행해 보인다 { code }
//  follow       아이가 따라 치고 실행한 뒤 "다 했어요"를 누를 때까지 기다린다 { code, expect }
//  nod          끄덕이기
import { hasBatchim } from './korean.js';
import { createRng, seedFrom } from './rng.js';

/**
 * 대사 틀을 채운다. {이름}은 값, {이름은}처럼 조사를 붙이면 받침에 맞춰 고른다.
 * 쓸 수 있는 조사: 은/는, 을/를, 이/가, 이에요/예요.
 */
export function fill(template, vars = {}) {
  return template.replace(/\{(\w+)(은|는|을|를|이에요|예요|이|가)?\}/g, (_, name, particle) => {
    if (!(name in vars)) throw new Error(`대사 틀에 없는 값이에요: ${name}`);
    const value = String(vars[name]);
    if (!particle) return value;
    const pick = { 은: ['은', '는'], 는: ['은', '는'], 을: ['을', '를'], 를: ['을', '를'], 이에요: ['이에요', '예요'], 예요: ['이에요', '예요'], 이: ['이', '가'], 가: ['이', '가'] }[particle];
    return value + (hasBatchim(value) ? pick[0] : pick[1]);
  });
}

/**
 * 자막과 읽을 말을 가른다. "[print|프린트]"는 자막에 print, 목소리로는 프린트.
 * 코드 낱말과 기호를 한국어 목소리가 엉뚱하게 읽지 않게 하려는 것이다.
 */
export function splitSpoken(text) {
  const pattern = /\[([^\]|]*)\|([^\]]*)\]/g;
  return { caption: text.replace(pattern, '$1'), speech: text.replace(pattern, '$2') };
}

/** 대사 한 줄. 같은 상황의 말이 여러 개면 시드로 고른다(같은 수업은 같은 말을 한다). */
export function line(script, key, seed = 0, vars = {}, pose = 'talk') {
  const list = script.lines[key];
  if (!list) throw new Error(`대사가 없어요: ${key}`);
  const pick = list[Math.floor(createRng(seedFrom(script.id, key, seed))() * list.length)];
  const { caption, speech } = splitSpoken(fill(pick, vars));
  return { kind: 'say', key, text: caption, speech, pose };
}

/** 대본에 적힌 장면 표시 하나를 장면으로 바꾼다. */
function toScene(script, spec, seed) {
  if (spec.say) return line(script, spec.say, seed, spec.vars, spec.pose);
  if (spec.pair) return { kind: 'board-pair', ...spec.pair };
  if (spec.card) return { kind: 'board-card', ...spec.card };
  if (spec.clearBoard) return { kind: 'board-clear' };
  if (spec.type !== undefined) return { kind: 'code-type', code: spec.type };
  if (spec.trace !== undefined) return { kind: 'trace', code: spec.trace };
  if (spec.follow) return { kind: 'follow', ...spec.follow };
  if (spec.nod) return { kind: 'nod' };
  throw new Error(`모르는 장면 표시예요: ${JSON.stringify(spec)}`);
}

/** 강의: 부분들의 목록. 부분 하나는 장면 목록이다. */
export function lectureParts(script, seed = 0) {
  return script.lecture.map((part) => part.map((spec) => toScene(script, spec, seed)));
}

/** 따라 하기에서 출력이 선생님 것과 다를 때 */
export function followRetryScenes(script, seed = 0) {
  return [line(script, 'follow-different', seed)];
}

/** 예측 문제: 묻는 장면 */
export function predictAskScenes(script, question, seed = 0) {
  return [line(script, 'predict-ask', seed)];
}

/** 예측 문제: 고른 뒤. 무엇을 골랐는지에 따라 다른 말을 한다(왜 그런지 알려 준다). */
export function predictFeedback(script, question, choiceIndex, seed = 0) {
  const correct = choiceIndex === question.answer;
  const choice = question.choices[choiceIndex];
  const scenes = [];
  if (correct) scenes.push({ kind: 'nod' });
  scenes.push(line(script, choice.say, seed));
  return { correct, scenes };
}

/** 예측 문제: 실행해서 확인하는 장면 */
export function predictRevealScenes(script, question, seed = 0) {
  return [line(script, 'predict-run', seed), { kind: 'trace', code: question.code }];
}

/** 쓰기 문제: 채점 뒤 선생님 말. diagnosis는 src/core/diagnose.js의 결과다. */
export function taskFeedback(script, diagnosis, seed = 0) {
  if (diagnosis.kind === 'correct') return [{ kind: 'nod' }, line(script, diagnosis.first ? 'task-correct-first' : 'task-correct', seed)];
  if (diagnosis.kind === 'error') return [{ kind: 'say', key: 'task-error', text: diagnosis.text, speech: diagnosis.text, pose: 'talk' }];
  return [line(script, `task-${diagnosis.kind}`, seed, diagnosis.vars)];
}

/** 힌트: 단계가 올라갈수록 자세해진다. 마지막 단계도 정답은 아니고 비슷한 예제다. */
export function hintScenes(script, level, seed = 0) {
  const hint = script.hints[Math.min(level, script.hints.length - 1)];
  const scenes = [line(script, hint.say, seed)];
  if (hint.card) scenes.unshift({ kind: 'board-card', ...hint.card });
  return scenes;
}

/** 대본 점검: 장면이 가리키는 대사가 모두 있는가. 테스트에서 쓴다. */
export function missingLines(script) {
  const used = new Set([
    'follow-different', 'follow-not-run', 'follow-show', 'predict-ask', 'predict-run',
    'task-intro', 'task-how', 'task-correct-first', 'task-correct', 'skip-ok', 'lecture-back', 'done-1', 'done-2', 'done-bye',
  ]);
  for (const part of script.lecture) for (const spec of part) if (spec.say) used.add(spec.say);
  for (const question of script.predict) {
    used.add(question.explain);
    for (const choice of question.choices) used.add(choice.say);
  }
  for (const hint of script.hints) used.add(hint.say);
  for (const kind of ['not-computed', 'quoted-calc', 'order', 'count', 'spacing', 'line-diff', 'no-output']) used.add(`task-${kind}`);
  return [...used].filter((key) => !script.lines[key]);
}
