// 수업 화면. 미션 하나를 강의 → 예측 → 쓰기 순서로 이끈다.
// - 할 말과 장면은 src/core/lesson.js가 대본(src/content/missions/)으로 정한다. 여기서는 재생하고 버튼을 받는다.
// - 문제 풀기가 중심이다. 강의는 건너뛸 수 있고, 풀다가 "강의 보기"로 다시 볼 수 있다.
// - 선생님은 아이가 버튼을 누를 때까지 기다린다.
import './app.css';
import mission from './content/missions/print-order.json';
import look from './content/teacher-look.json';
import teacherVoice from './content/teacher.json';
import { diagnoseTask, outputLines } from './core/diagnose.js';
import { explain } from './core/errors-ko.js';
import { lectureParts, line, predictAskScenes, predictFeedback, predictRevealScenes, taskFeedback } from './core/lesson.js';
import { createBoard } from './ui/board.js';
import { createEditor } from './ui/editor.js';
import { flushLog, log, setBuild } from './ui/log.js';
import { setupOffline } from './ui/offline.js';
import { createOutput } from './ui/output.js';
import { createPlayer } from './ui/player.js';
import { Runner } from './ui/runner.js';
import { setMuted, stopSpeaking, voicesReady } from './ui/speech.js';
import { createTeacher } from './ui/teacher-view.js';

const $ = (id) => document.getElementById(id);

// localStorage는 막혀 있을 수 있다. 값이 없어도 화면은 떠야 한다.
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 저장하지 못해도 계속 쓸 수 있다.
    }
  },
};

/** "처음으로"를 눌러 수업을 그만둘 때 흐름을 한 번에 빠져나오려고 던진다. */
class Stop extends Error {}

const params = new URLSearchParams(location.search);
// 개발 서버에서 ?fast를 붙이면 소리를 끄고 수업을 빨리 돌려 볼 수 있다(빌드에는 들어가지 않는다).
const speed = import.meta.env.DEV && params.has('fast') ? 8 : 1;
const DRAFT_KEY = `kidpy.draft.${mission.id}`;

async function main() {
  const offlineMode = await setupOffline();
  if (offlineMode === 'reloading') {
    $('home-status').textContent = '처음 준비 중… (한 번 다시 읽어요)';
    return;
  }
  let build = offlineMode;
  if (offlineMode !== 'dev') {
    try {
      build = (await (await fetch('./build.json', { cache: 'no-store' })).json()).version;
    } catch {
      build = 'unknown';
    }
  }
  setBuild(build);
  $('build').textContent = build === 'dev' ? '개발 서버' : `판 ${build}`;

  // ---- 화면 조각 ----
  $('home-line').textContent = mission.line;
  $('home-title').textContent = `${mission.no}번 역 · ${mission.title}`;
  $('where-line').textContent = mission.line;
  $('where-title').textContent = `${mission.no}번 역 · ${mission.title}`;
  if (store.get('kidpy.progress', {})[mission.id]) $('home-done').hidden = false;

  const homeTeacher = createTeacher($('home-teacher'), look, { unit: 4.2 });
  homeTeacher.pose('talk');
  const teacher = createTeacher($('teacher'), look, { unit: 3.3 });
  const board = createBoard($('board'));
  const caption = $('caption');
  let runner = null;
  const output = createOutput($('out'), () => runner);

  // ---- 버튼 누르기를 기다리는 틀 ----
  const clicks = new EventTarget();
  const press = (id) => clicks.dispatchEvent(new CustomEvent('press', { detail: id }));
  /** ids 가운데 하나가 눌릴 때까지 기다린다. 수업을 그만두면 Stop을 던진다. */
  function nextPress(...ids) {
    return new Promise((resolve, reject) => {
      const onPress = (event) => {
        const id = event.detail;
        if (id !== 'abort' && !ids.includes(id)) return;
        clicks.removeEventListener('press', onPress);
        if (id === 'abort') reject(new Stop());
        else resolve(id);
      };
      clicks.addEventListener('press', onPress);
    });
  }
  /** 다른 일(보기 고르기)을 기다리되, 수업을 그만두면 Stop을 던진다. */
  function orAbort(promise) {
    return new Promise((resolve, reject) => {
      const onPress = (event) => {
        if (event.detail !== 'abort') return;
        clicks.removeEventListener('press', onPress);
        reject(new Stop());
      };
      clicks.addEventListener('press', onPress);
      promise.then((value) => {
        clicks.removeEventListener('press', onPress);
        resolve(value);
      });
    });
  }
  for (const id of ['done', 'submit', 'next', 'hint', 'finish', 'lecture-again']) $(id).addEventListener('click', () => press(id));

  const FOOTER = ['done', 'submit', 'next', 'hint', 'finish', 'skip'];
  /** 아래 줄과 위 줄에서 지금 쓸 버튼만 보인다 */
  function show(...ids) {
    for (const id of FOOTER) $(id).hidden = !ids.includes(id);
    $('lecture-again').hidden = !ids.includes('lecture-again');
  }

  function setPhase(name) {
    for (const item of $('phases').children) item.classList.toggle('now', item.dataset.phase === name);
  }

  // ---- 파이썬 실행 ----
  let canRun = false; // 아이가 실행해도 되는 때(따라 하기, 쓰기 문제)
  let lastRun = null; // 아이가 마지막으로 실행한 결과
  let draftSaving = false;

  function refreshRun() {
    const state = runner ? runner.state : 'loading';
    const running = state === 'running' || state === 'waiting-input';
    $('run').disabled = !canRun || state !== 'ready';
    $('stop').disabled = !canRun || !running;
    for (const id of ['submit', 'hint', 'done', 'lecture-again']) $(id).disabled = running && canRun;
    $('inputform').hidden = !(state === 'waiting-input' && canRun);
    if (!$('inputform').hidden) $('inputbox').focus();
    $('lock-note').textContent = canRun ? '' : '선생님이 쓰는 중이에요';
  }

  function allowRun(on) {
    canRun = on;
    editor.setLocked(!on);
    refreshRun();
    if (on) editor.focus();
  }

  runner = new Runner({
    onOut: (chunks, dropped) => output.queue(chunks, dropped),
    onInput: () => {},
    onState(state, info) {
      if (state === 'loading') $('home-status').textContent = '파이썬 준비 중…';
      else if (state === 'ready') $('home-status').textContent = '준비됐어요.';
      else if (state === 'failed') $('home-status').textContent = `파이썬을 켜지 못했어요: ${info.message}`;
      $('start-lecture').disabled = $('start-solve').disabled = !(state === 'ready' || state === 'running' || state === 'waiting-input');
      refreshRun();
    },
  });

  const editor = createEditor({
    parent: $('editor'),
    doc: '',
    onChange(code) {
      if (draftSaving) store.set(DRAFT_KEY, code);
    },
    onRun: () => runUser(),
  });

  /** 아이가 쓴 코드를 실행한다. 오류가 나면 한국어 한 문장과 파이썬의 원래 글을 함께 보여 준다. */
  async function runUser() {
    if (!canRun || runner.state !== 'ready') return null;
    const code = editor.getCode();
    output.clear();
    editor.markErrorLine(null);
    const result = await runner.run(code);
    output.flush();
    if (result.stopped) {
      output.append('\n■ 멈췄어요\n', 'note');
    } else if (result.error) {
      const where = result.error.line ? ` (${result.error.line}번 줄)` : '';
      output.append(`\n${explain(result.error)}${where}\n`, 'ko');
      output.append(result.error.text, 'err');
      if (result.error.line) editor.markErrorLine(result.error.line);
    }
    lastRun = { code, output: result.output, error: result.error, stopped: result.stopped };
    log('run', { mission: mission.id, phase: currentPhase, code, ok: result.ok, error: result.error ? { type: result.error.type, line: result.error.line, message: result.error.message } : null, ms: result.ms });
    if (canRun) editor.focus();
    return lastRun;
  }

  $('run').addEventListener('click', () => runUser());
  $('stop').addEventListener('click', () => runner.stop());
  $('inputform').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = $('inputbox').value;
    $('inputbox').value = '';
    output.flush();
    output.append(`${text}\n`, 'typed');
    runner.provideInput(text);
  });

  // ---- 재생기 ----
  let skipping = false;
  const player = createPlayer({
    teacher,
    board,
    editor,
    output,
    runner,
    caption,
    voice: teacherVoice.voice,
    speed,
    ui: { follow },
  });
  const say = (key, vars) => player.play([line(mission, key, seed, vars)]);
  const seed = Math.floor(Date.now() / 86400000); // 날마다 인사말이 조금 다르다

  /** 재생이 끝난 뒤, 그만둔 것이면 흐름을 빠져나온다 */
  function checkAbort() {
    if (aborted) throw new Stop();
  }

  /** 따라 하기: 아이가 칠판의 코드를 치고 실행한 뒤 "다 했어요"를 누를 때까지 기다린다. */
  async function follow(scene) {
    lastRun = null;
    editor.setCode('');
    output.clear();
    allowRun(true);
    show('done', 'skip');
    let tries = 0;
    try {
      for (;;) {
        const pressed = await nextPress('done', 'skip');
        if (pressed === 'skip') return 'stop';
        const ran = lastRun;
        const same = ran && !ran.error && outputLines(ran.output).join('\n') === scene.expect.join('\n');
        log('follow', { mission: mission.id, ok: Boolean(same), tries, code: editor.getCode() });
        if (same) return 'done';
        tries += 1;
        allowRun(false);
        if (tries >= 3) {
          // 막다른 길을 만들지 않는다. 세 번째에는 선생님이 다시 보여 주고 넘어간다.
          await say('follow-show');
          await player.play([{ kind: 'code-type', code: scene.code }, { kind: 'trace', code: scene.code }]);
          return 'done';
        }
        if (!ran) await say('follow-not-run');
        else if (ran.error) await player.say(explain(ran.error));
        else await say('follow-different');
        if (player.stopped) return 'stop';
        allowRun(true);
      }
    } finally {
      allowRun(false);
      show('skip');
    }
  }

  // ---- 수업 흐름 ----
  let aborted = false;
  let currentPhase = 'home';

  async function lecture() {
    currentPhase = 'lecture';
    setPhase('lecture');
    log('lecture-start', { mission: mission.id });
    skipping = false;
    allowRun(false);
    show('skip');
    for (const part of lectureParts(mission, seed)) {
      const finished = await player.play(part);
      checkAbort();
      if (!finished) break;
    }
    show();
    log('lecture-end', { mission: mission.id, skipped: skipping });
    if (skipping) {
      player.reset();
      skipping = false;
      await say('skip-ok');
    }
  }

  async function predict() {
    currentPhase = 'predict';
    setPhase('predict');
    allowRun(false);
    const total = mission.predict.length;
    for (const [index, question] of mission.predict.entries()) {
      show();
      editor.setCode(question.code);
      output.clear();
      let pick;
      const picked = new Promise((resolve) => (pick = resolve));
      const marks = board.predict({ no: index + 1, total, code: question.code, choices: question.choices, onPick: pick });
      await player.play(predictAskScenes(mission, question, seed));
      checkAbort();
      const choice = await orAbort(picked);
      const feedback = predictFeedback(mission, question, choice, seed);
      marks.mark(choice, feedback.correct);
      log('predict', { mission: mission.id, question: question.id, choice, correct: feedback.correct });
      await player.play(feedback.scenes);
      checkAbort();
      await player.play(predictRevealScenes(mission, question, seed));
      checkAbort();
      marks.showAnswer(question.answer);
      // 틀렸으면, 실제 출력을 본 뒤에 왜 그런지 한 번 더 말해 준다.
      if (!feedback.correct) await say(question.explain);
      checkAbort();
      show('next');
      await nextPress('next');
    }
  }

  async function task() {
    currentPhase = 'task';
    setPhase('task');
    board.task(mission.task);
    editor.setCode(store.get(DRAFT_KEY, ''));
    output.clear();
    draftSaving = true;
    lastRun = null;
    show();
    await say('task-intro');
    await say('task-how');
    checkAbort();
    allowRun(true);
    let attempts = 0;
    let hintLevel = 0;
    for (;;) {
      show('submit', 'hint', 'lecture-again');
      refreshRun();
      const pressed = await nextPress('submit', 'hint', 'lecture-again');
      if (pressed === 'hint') {
        const level = Math.min(hintLevel, mission.hints.length - 1);
        const hint = mission.hints[level];
        log('hint', { mission: mission.id, level, code: editor.getCode() });
        if (hint.card) board.appendHint(hint.card);
        await say(hint.say);
        checkAbort();
        hintLevel += 1;
        editor.focus();
        continue;
      }
      if (pressed === 'lecture-again') {
        const draft = editor.getCode();
        draftSaving = false;
        await lecture();
        board.task(mission.task);
        editor.setCode(draft);
        output.clear();
        draftSaving = true;
        currentPhase = 'task';
        setPhase('task');
        await say('lecture-back');
        checkAbort();
        allowRun(true);
        continue;
      }
      // 제출: 지금 코드를 새로 실행해서 채점한다.
      attempts += 1;
      const ran = await runUser();
      if (!ran || ran.stopped) continue;
      const diagnosis = diagnoseTask(mission.task, ran.code, ran);
      if (diagnosis.kind === 'error') diagnosis.text = explain(ran.error);
      if (diagnosis.kind === 'correct') diagnosis.first = attempts === 1 && hintLevel === 0;
      log('submit', { mission: mission.id, attempt: attempts, hints: hintLevel, kind: diagnosis.kind, code: ran.code });
      allowRun(false);
      show();
      await player.play(taskFeedback(mission, diagnosis, seed));
      checkAbort();
      if (diagnosis.kind === 'correct') {
        draftSaving = false;
        return { attempts, hints: hintLevel, first: diagnosis.first };
      }
      allowRun(true);
    }
  }

  async function finish(result) {
    currentPhase = 'done';
    setPhase('');
    allowRun(false);
    show();
    board.done({ title: '오늘 배운 것', items: ['글자는 따옴표 안에:  print("노포")', '계산은 따옴표 없이:  print(12 + 30)', '순서는 위에서 아래로, 한 줄씩'] });
    const progress = store.get('kidpy.progress', {});
    progress[mission.id] = { doneAt: new Date().toISOString(), ...result };
    store.set('kidpy.progress', progress);
    store.set(DRAFT_KEY, '');
    log('mission-done', { mission: mission.id, ...result });
    if (result.first) await teacher.jump(); // 크게 기뻐하는 건 한 번에 해낸 순간뿐이다
    await say('done-1');
    await say('done-2');
    await say('done-bye');
    checkAbort();
    flushLog();
    show('finish');
    await nextPress('finish');
  }

  async function startMission(withLecture) {
    aborted = false;
    player.reset();
    setMuted(!$('sound').checked || speed > 1);
    await voicesReady();
    $('home').hidden = true;
    $('play').hidden = false;
    board.clear();
    caption.textContent = '';
    editor.setCode('');
    output.clear();
    log('mission-start', { mission: mission.id, withLecture, sound: $('sound').checked });
    try {
      if (withLecture) await lecture();
      await predict();
      const result = await task();
      await finish(result);
    } catch (error) {
      if (!(error instanceof Stop)) throw error;
      log('mission-abort', { mission: mission.id, phase: currentPhase });
    }
    goHome();
  }

  function goHome() {
    stopSpeaking();
    allowRun(false);
    draftSaving = false;
    currentPhase = 'home';
    $('play').hidden = true;
    $('home').hidden = false;
    if (store.get('kidpy.progress', {})[mission.id]) $('home-done').hidden = false;
    flushLog();
  }

  $('start-lecture').addEventListener('click', () => startMission(true));
  $('start-solve').addEventListener('click', () => startMission(false));
  $('to-home').addEventListener('click', () => {
    aborted = true;
    player.stop();
    runner.stop();
    press('abort');
  });
  $('skip').addEventListener('click', () => {
    skipping = true;
    player.stop();
    press('skip');
  });
  $('again').addEventListener('click', () => player.again());
  $('slower').addEventListener('click', () => {
    player.slower();
    player.again();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushLog();
  });

  // 개발 서버에서만: 수업을 자동으로 돌려 보는 점검에서 편집기에 코드를 넣을 수 있게 한다(빌드에는 들어가지 않는다).
  if (import.meta.env.DEV) window.__kidpy = { editor, runner };

  show();
  refreshRun();
  try {
    const info = await runner.start();
    log('app-open', { loadMs: info.ms, python: info.python, screen: `${innerWidth}x${innerHeight}`, standalone: matchMedia('(display-mode: standalone)').matches });
  } catch {
    // 상태 줄에 이유가 이미 표시된다.
  }
}

main();
