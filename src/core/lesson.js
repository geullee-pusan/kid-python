// 수업 대본(src/content/missions/*.json)을 화면이 재생할 "장면" 목록으로 바꾼다. 순수 함수다.
// 틀은 주산 앱 JUSAN의 lesson.js를 따랐다: 대본(데이터) → 장면(이 파일) → 재생기(src/ui/player.js).
//
// 장면 종류
//  say          대사 { text(자막), speech(읽을 말), pose }
//  board-pair   칠판에 엔트리 블록과 파이썬 문장을 나란히 { entry, python, note }
//  board-card   칠판에 글 카드 { title, items, code }
//  board-clear  칠판 지우기
//  code-type    편집기에 코드를 한 글자씩 친다 { code }
//  trace        편집기의 코드를 한 줄씩 실행해 보인다 { code }
//  follow       아이가 따라 치고 실행한 뒤 "다 했어요"를 누를 때까지 기다린다 { code, expect, say }
//  check        강의 중에 묻는 확인 문제 { title, ask, choices, answer, right, teach }
//               맞히면 right 장면만, 틀리면 teach 장면(설명)을 재생한다. 이미 아는 것은 설명을 건너뛰게 하려는 것이다.
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

/** 수업 대본에 함께 쓰는 대사(common.json)를 합친다. 수업에 같은 열쇠가 있으면 수업 것이 이긴다. */
export function mergeScript(script, common) {
  return { ...script, lines: { ...common.lines, ...script.lines } };
}

/** 대사 한 줄. 같은 상황의 말이 여러 개면 시드로 고른다(같은 수업은 같은 말을 한다). */
export function line(script, key, seed = 0, vars = {}, pose = 'talk') {
  const list = script.lines[key];
  if (!list) throw new Error(`대사가 없어요: ${script.id} / ${key}`);
  const pick = list[Math.floor(createRng(seedFrom(script.id, key, seed))() * list.length)];
  const { caption, speech } = splitSpoken(fill(pick, { title: script.titleSay ?? script.title, ...vars }));
  return { kind: 'say', key, text: caption, speech, pose };
}

/** 대본에 적힌 장면 표시 하나를 장면으로 바꾼다. */
function toScene(script, spec, seed) {
  if (spec.say) return line(script, spec.say, seed, spec.vars, spec.pose);
  if (spec.pair) return { kind: 'board-pair', ...spec.pair };
  if (spec.card) return { kind: 'board-card', ...spec.card };
  if (spec.clearBoard) return { kind: 'board-clear' };
  if (spec.type !== undefined) return { kind: 'code-type', code: spec.type };
  // limit: 끝나지 않는 반복을 시연할 때 보여 줄 줄 수. randoms: 무작위 수를 정해 둘 때.
  if (spec.trace !== undefined) return { kind: 'trace', code: spec.trace, inputs: spec.inputs ?? [], limit: spec.limit, randoms: spec.randoms };
  // 따라 하기: say는 아이가 치는 동안 선생님이 하는 말이다(말이 끝나기를 기다리지 않고 바로 칠 수 있다).
  if (spec.follow) return { kind: 'follow', ...spec.follow, say: (spec.follow.say ?? []).map((key) => line(script, key, seed)) };
  if (spec.check) {
    return {
      kind: 'check',
      ...spec.check,
      ask: line(script, spec.check.ask, seed),
      right: (spec.check.right ?? []).map((s) => toScene(script, s, seed)),
      teach: (spec.check.teach ?? []).map((s) => toScene(script, s, seed)),
    };
  }
  if (spec.nod) return { kind: 'nod' };
  throw new Error(`모르는 장면 표시예요: ${JSON.stringify(spec)}`);
}

/** 강의: 부분들의 목록. 부분 하나는 장면 목록이다. */
export function lectureParts(script, seed = 0) {
  return (script.lecture ?? []).map((part) => part.map((spec) => toScene(script, spec, seed)));
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
  return [line(script, 'predict-run', seed), { kind: 'trace', code: question.code, inputs: question.inputs ?? [], limit: question.limit, randoms: question.randoms }];
}

/** 쓰기 문제: 채점 뒤 선생님 말. diagnosis는 src/core/diagnose.js의 결과다. */
export function taskFeedback(script, task, diagnosis, seed = 0) {
  if (diagnosis.kind === 'correct') {
    // 칭찬은 구체적으로: 문제에 praise가 있으면 무엇을 잘했는지 이어서 말한다.
    const scenes = [{ kind: 'nod' }, line(script, diagnosis.first ? 'task-correct-first' : 'task-correct', seed)];
    if (task.praise) scenes.push(line(script, task.praise, seed));
    return scenes;
  }
  // 정해진 입력으로 채점했을 때는 어떤 입력에서 틀렸는지 먼저 알려 준다.
  const scenes = diagnosis.inputs?.length ? [line(script, 'task-case', seed, { inputs: diagnosis.inputs.join(', ') })] : [];
  if (diagnosis.kind === 'error') scenes.push({ kind: 'say', key: 'task-error', text: diagnosis.text, speech: diagnosis.text, pose: 'talk' });
  else if (diagnosis.kind === 'mistake') scenes.push(line(script, diagnosis.say, seed));
  else scenes.push(line(script, `task-${diagnosis.kind}`, seed, diagnosis.vars));
  return scenes;
}

/**
 * 한 줄씩 보기의 빠르기. 긴 반복은 앞의 몇 줄만 제 속도(1)로 보여 주고, 나머지는 빠르게 넘긴다.
 * 줄마다 1.2초쯤 걸리므로, 그대로 두면 80줄짜리 시연은 1분 반이 넘는다. 뒤쪽을 합쳐 12초쯤에 맞춘다.
 * @param {number} index 지금 보여 주는 줄의 차례(0부터)
 * @param {number} total 보여 줄 줄의 수
 * @returns {number} 쉬는 시간에 곱할 값(1이면 제 속도, 작을수록 빠르다)
 */
export function tracePace(index, total) {
  const CALM = 14;
  const rest = total - CALM;
  if (index < CALM || rest <= 0) return 1;
  return Math.max(0.2, Math.min(1, 12000 / (rest * 1200)));
}

/** 수업에 든 쓰기 문제 전부(심화 포함). 점검과 테스트에서 쓴다. */
export function allTasks(script) {
  return [...(script.tasks ?? []), ...(script.challenge ? [script.challenge] : [])];
}

/** 대본 점검: 장면과 문제가 가리키는 대사가 모두 있는가. 테스트에서 쓴다. */
export function missingLines(script) {
  const used = new Set([
    'intro-ask', 'intro-solve', 'follow-different', 'follow-not-run', 'follow-not-stopped', 'follow-show', 'predict-ask', 'predict-run',
    'task-intro', 'task-next', 'task-how', 'task-correct-first', 'task-correct', 'skip-ok', 'lecture-back', 'done-bye',
    'challenge-ask', 'challenge-intro', 'challenge-skip',
  ]);
  for (const kind of ['not-computed', 'quoted-calc', 'order', 'count', 'spacing', 'line-diff', 'no-output', 'input-few', 'input-many', 'case', 'endless']) used.add(`task-${kind}`);
  const walk = (spec) => {
    if (spec.say) used.add(spec.say);
    for (const key of spec.follow?.say ?? []) used.add(key);
    if (spec.check) {
      used.add(spec.check.ask);
      for (const s of [...(spec.check.right ?? []), ...(spec.check.teach ?? [])]) walk(s);
    }
  };
  for (const part of script.lecture ?? []) for (const spec of part) walk(spec);
  for (const question of script.predict ?? []) {
    used.add(question.explain);
    for (const choice of question.choices) used.add(choice.say);
  }
  for (const task of allTasks(script)) {
    if (task.praise) used.add(task.praise);
    for (const hint of task.hints ?? []) used.add(hint.say);
    for (const mistake of task.mistakes ?? []) used.add(mistake.say);
    for (const rule of task.checks ?? []) used.add(rule.say);
  }
  for (const key of script.done ?? []) used.add(key);
  return [...used].filter((key) => !script.lines[key]);
}
