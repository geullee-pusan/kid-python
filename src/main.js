// 앱의 뼈대: 처음 화면(배우기 / 만들기 / 찾아보기), 수업 화면, 만들기 화면.
// - 수업에서 할 말과 장면은 src/core/lesson.js가 대본(src/content/missions/)으로 정한다. 여기서는 재생하고 버튼을 받는다.
// - 문제 풀기가 중심이다. 강의는 건너뛸 수 있고, 풀다가 "강의 보기"로 다시 볼 수 있다.
// - 선생님은 아이가 버튼을 누를 때까지 기다린다.
import './app.css';
import curriculum from './content/curriculum.json';
import look from './content/teacher-look.json';
import teacherVoice from './content/teacher.json';
import { diagnoseTask, outputLines } from './core/diagnose.js';
import { explain } from './core/errors-ko.js';
import { hasBatchim } from './core/korean.js';
import { lectureParts, line, mergeScript, predictAskScenes, predictFeedback, predictRevealScenes, taskFeedback } from './core/lesson.js';
import { createBoard } from './ui/board.js';
import { createConsole } from './ui/console.js';
import { createEditor } from './ui/editor.js';
import { flushLog, log, setBuild } from './ui/log.js';
import { setupOffline } from './ui/offline.js';
import { createPlayer } from './ui/player.js';
import { Runner } from './ui/runner.js';
import { setMuted, stopSpeaking, voicesReady } from './ui/speech.js';
import { createTeacher } from './ui/teacher-view.js';

// 수업 대본을 모두 읽어 둔다.
const missionFiles = import.meta.glob('./content/missions/*.json', { eager: true, import: 'default' });
// common.json은 여러 수업이 함께 쓰는 대사다.
const common = missionFiles['./content/missions/common.json'];
const MISSIONS = Object.fromEntries(
  Object.entries(missionFiles)
    .filter(([path]) => !path.endsWith('common.json'))
    .map(([, mission]) => [mission.id, mergeScript(mission, common)]),
);
/** 지금 열려 있는 수업들을 단원 순서대로 */
const LESSONS = curriculum.units.flatMap((unit) => (unit.lessons ?? []).map((id) => MISSIONS[id]));

const $ = (id) => document.getElementById(id);
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

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

/** 답 목록을 말로: ["하늘", "수학"] → "하늘, 수학이라고", ["9"] → "9라고" */
function asAnswer(inputs) {
  return `${inputs.join(', ')}${hasBatchim(inputs[inputs.length - 1]) ? '이라고' : '라고'}`;
}

/** "처음으로"를 눌러 수업을 그만둘 때 흐름을 한 번에 빠져나오려고 던진다. */
class Stop extends Error {}

const params = new URLSearchParams(location.search);
// 개발 서버에서 ?fast를 붙이면 소리를 끄고 수업을 빨리 돌려 볼 수 있다(빌드에는 들어가지 않는다).
const speed = import.meta.env.DEV && params.has('fast') ? 8 : 1;
const MAX_WORKS = 60;

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

  // ---- 함께 쓰는 것: 파이썬 일꾼, 선생님 ----
  let runner = null;
  let activeConsole = null; // 지금 출력을 받을 칸(수업 화면 또는 만들기 화면)
  let screen = 'home';
  const getRunner = () => runner;

  const homeTeacher = createTeacher($('home-teacher'), look, { unit: 2.5 });
  homeTeacher.pose('talk');
  const teacher = createTeacher($('teacher'), look, { unit: 3.3 });
  const board = createBoard($('board'));
  const caption = $('caption');
  const lessonConsole = createConsole($('console'), getRunner);
  const studioConsole = createConsole($('studio-console'), getRunner);

  runner = new Runner({
    onOut(chunks, dropped) {
      if (activeConsole) activeConsole.queue(chunks, dropped);
      else runner.ack(1);
    },
    onInput: () => {},
    onState(state, info) {
      if (state === 'loading') $('home-status').textContent = '파이썬 준비 중…';
      else if (state === 'ready') $('home-status').textContent = '';
      else if (state === 'failed') $('home-status').textContent = `파이썬을 켜지 못했어요: ${info.message}`;
      refreshHomeButtons();
      refreshRun();
      refreshStudio();
    },
  });
  const isReady = () => runner.state === 'ready';
  const isRunning = () => runner.state === 'running' || runner.state === 'waiting-input';

  /**
   * 편집기의 코드를 실행해 출력 칸에 보여 준다.
   * 오류가 나면 한국어 한 문장과 파이썬의 원래 글을 함께 보여 주고, 그 줄을 표시한다.
   */
  async function runCode(editor, out, where) {
    if (!isReady()) return null;
    const code = editor.getCode();
    activeConsole = out;
    out.clear();
    editor.markErrorLine(null);
    const result = await runner.run(code);
    out.flush();
    if (result.stopped) {
      out.append('\n■ 멈췄어요\n', 'note');
    } else if (result.error) {
      const at = result.error.line ? ` (${result.error.line}번 줄)` : '';
      out.append(`\n${explain(result.error, knows())}${at}\n`, 'ko');
      out.append(result.error.text, 'err');
      if (result.error.line) editor.markErrorLine(result.error.line);
    }
    log('run', { ...where, code, ok: result.ok, error: result.error ? { type: result.error.type, line: result.error.line, message: result.error.message } : null, ms: result.ms });
    return { code, output: result.output, error: result.error, stopped: result.stopped, vars: result.vars };
  }

  function showScreen(name) {
    screen = name;
    for (const id of ['home', 'play', 'studio']) $(id).hidden = id !== name;
  }

  // =====================================================================
  // 처음 화면
  // =====================================================================
  function refreshHomeButtons() {
    const ready = runner && (isReady() || isRunning());
    for (const button of document.querySelectorAll('#home [data-needs-python]')) button.disabled = !ready;
    $('new-work').disabled = !ready;
  }

  function renderHome() {
    const progress = store.get('kidpy.progress', {});
    const works = store.get('kidpy.works', []);
    const next = LESSONS.find((mission) => !progress[mission.id]);
    const startedBefore = Object.keys(progress).length > 0 || works.length > 0;

    // 선생님 한마디(목소리 없이 글로만: 아직 아무것도 누르지 않아서 브라우저가 소리를 막는다)
    $('home-caption').textContent = !startedBefore
      ? '안녕하세요. 파이썬을 같이 배워요. 아래에서 첫 수업을 시작해요.'
      : next
        ? '다시 왔네요. 이어서 배울까요, 아니면 무엇을 만들어 볼까요?'
        : '지금 있는 수업을 모두 끝냈어요. 만들기에서 마음대로 써 봐요.';

    // 배우기: 이어서 하기
    const cont = $('continue');
    cont.replaceChildren();
    if (next) {
      const button = el('button', 'btn primary continue');
      button.type = 'button';
      button.dataset.needsPython = '';
      button.append(el('span', 'continue-label', startedBefore ? '▶ 이어서 하기' : '▶ 첫 수업 시작하기'), el('span', 'continue-sub', `${next.unit} · ${next.no}. ${next.title}`));
      button.addEventListener('click', () => startMission(next.id));
      cont.append(button);
    } else {
      cont.append(el('p', 'panel-desc', '새 수업을 준비하고 있어요. 끝낸 수업은 다시 해도 돼요.'));
    }

    // 배우기: 단원별 수업 목록(아직 없는 단원도 이름은 보인다)
    const list = $('lessons');
    list.replaceChildren();
    for (const unit of curriculum.units.filter((u) => u.lessons)) {
      // 수업을 모두 끝낸 단원은 접어 둔다(누르면 펼쳐진다). 목록이 길어져도 지금 할 단원이 바로 보이게 하려는 것이다.
      const allDone = unit.lessons.every((id) => progress[id]);
      const box = el('details', 'unit');
      box.open = !allDone;
      const head = el('summary', 'unit-head');
      head.append(el('h3', '', unit.title), el('span', 'unit-note', allDone ? `✓ ${unit.lessons.length}편 모두 끝냄` : ''));
      box.append(head);
      const items = el('ul', 'unit-lessons');
      for (const id of unit.lessons ?? []) {
        const mission = MISSIONS[id];
        const done = Boolean(progress[id]);
        const button = el('button', `lesson${done ? ' done' : ''}`);
        button.type = 'button';
        button.dataset.needsPython = '';
        button.append(el('span', 'lesson-mark', done ? '✓' : '·'), el('span', 'lesson-title', `${mission.no}. ${mission.title}`), el('span', 'lesson-note', done ? '끝냄 · 다시 하기' : `${mission.minutes}분쯤`));
        button.addEventListener('click', () => startMission(id));
        const item = el('li');
        item.append(button);
        items.append(item);
      }
      if (unit.more) items.append(el('li', 'soon', '다음 수업 준비 중'));
      box.append(items);
      list.append(box);
    }
    // 아직 수업이 없는 단원은 이름만 한데 모아 보여 준다(앞으로 무엇을 배우는지 전체가 보이게).
    const upcoming = curriculum.units.filter((u) => !u.lessons);
    if (upcoming.length) {
      const box = el('div', 'unit');
      box.append(el('h3', '', '앞으로 배울 것 (준비 중)'));
      const items = el('ol', 'upcoming');
      for (const unit of upcoming) items.append(el('li', '', unit.title));
      box.append(items);
      list.append(box);
    }

    // 만들기: 최근에 만든 것
    const workList = $('works');
    workList.replaceChildren();
    if (works.length === 0) workList.append(el('li', 'empty', '아직 없어요. 새로 만들어 봐요.'));
    for (const work of [...works].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12)) {
      const open = el('button', 'work');
      open.type = 'button';
      open.dataset.needsPython = '';
      const lines = work.code.split('\n').filter((text) => text.trim()).length;
      const when = new Date(work.updatedAt); // 저장은 세계 표준시로, 보여 줄 때는 이 기기의 날짜로
      open.append(el('span', 'work-title', work.name), el('span', 'work-note', `${lines}줄 · ${when.getMonth() + 1}월 ${when.getDate()}일`));
      open.addEventListener('click', () => openStudio(work.id));
      // 지우기는 두 번 눌러야 된다(한 번 누르면 "정말 지워요?"로 바뀐다).
      const remove = el('button', 'btn small work-remove', '지우기');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        if (remove.dataset.sure) {
          store.set('kidpy.works', store.get('kidpy.works', []).filter((w) => w.id !== work.id));
          log('work-delete', { work: work.id });
          renderHome();
        } else {
          remove.dataset.sure = '1';
          remove.textContent = '정말 지워요?';
          setTimeout(() => {
            delete remove.dataset.sure;
            remove.textContent = '지우기';
          }, 4000);
        }
      });
      const item = el('li');
      item.append(open, remove);
      workList.append(item);
    }

    // 찾아보기: 끝낸 수업에서 배운 것만 모은다
    const reference = $('reference');
    reference.replaceChildren();
    const learnedFrom = LESSONS.filter((mission) => progress[mission.id] && mission.learned?.length);
    if (learnedFrom.length === 0) reference.append(el('p', 'empty', '수업을 끝내면 배운 것이 여기에 쌓여요.'));
    for (const mission of learnedFrom) {
      const box = el('div', 'ref-group');
      box.append(el('h3', '', `${mission.no}. ${mission.title}`));
      for (const item of mission.learned ?? []) {
        const row = el('div', 'ref-item');
        row.append(el('p', '', item.rule));
        if (item.code) row.append(el('pre', 'board-code', item.code));
        box.append(row);
      }
      reference.append(box);
    }
    refreshHomeButtons();
  }

  function goHome() {
    stopSpeaking();
    activeConsole = null;
    renderHome();
    showScreen('home');
    flushLog();
  }

  $('sound').checked = store.get('kidpy.sound', true);
  $('sound').addEventListener('change', () => {
    store.set('kidpy.sound', $('sound').checked);
    setMuted(!$('sound').checked || speed > 1);
  });

  // =====================================================================
  // 수업 화면
  // =====================================================================
  let mission = null;
  let seed = 0;
  let aborted = false;
  let skipping = false;
  let currentPhase = 'home';
  let canRun = false; // 아이가 실행해도 되는 때(따라 하기, 쓰기 문제)
  let lastRun = null; // 아이가 마지막으로 실행한 결과
  let draftSaving = null; // 지금 쓰는 코드를 저장할 자리(문제마다 따로). null이면 저장하지 않는다
  const draftKey = () => `kidpy.draft.${mission.id}`;

  /** 지금 아이가 무엇을 배웠는지. 오류 설명의 말을 고르는 데 쓴다(변수를 배우기 전에는 "이름표"라는 말을 쓰지 않는다). */
  function knows() {
    if (screen === 'play' && mission) return { variables: Boolean(mission.knows?.includes('variables')) };
    const progress = store.get('kidpy.progress', {});
    return { variables: LESSONS.some((m) => m.knows?.includes('variables') && progress[m.id]) };
  }

  // 이름표 칸: 지금 어떤 이름에 어떤 값이 붙어 있는지 보여 준다. 변수를 배우는 수업부터 보인다.
  let shownVars = {};
  function showVars(vars) {
    const panel = $('vars');
    panel.hidden = !mission?.showVars;
    if (panel.hidden) return;
    const list = $('vars-list');
    list.replaceChildren();
    const names = Object.keys(vars);
    if (names.length === 0) list.append(el('span', 'vars-empty', '아직 없어요'));
    for (const name of names) {
      // 새로 생겼거나 값이 바뀐 이름표는 잠깐 눈에 띄게 한다.
      const chip = el('span', `var${shownVars[name] !== vars[name] ? ' changed' : ''}`);
      chip.append(el('b', '', name), el('span', 'var-arrow', '→'), el('code', '', vars[name]));
      list.append(chip);
    }
    shownVars = vars;
  }

  // 버튼 누르기를 기다리는 틀
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
  /**
   * 다른 일(보기 고르기)과 버튼 누르기 가운데 먼저 일어난 것을 돌려준다: { value } 또는 { pressed }.
   * 수업을 그만두면 Stop을 던진다.
   */
  function firstOf(promise, ...ids) {
    return new Promise((resolve, reject) => {
      const onPress = (event) => {
        const id = event.detail;
        if (id !== 'abort' && !ids.includes(id)) return;
        clicks.removeEventListener('press', onPress);
        if (id === 'abort') reject(new Stop());
        else resolve({ pressed: id });
      };
      clicks.addEventListener('press', onPress);
      promise.then((value) => {
        clicks.removeEventListener('press', onPress);
        resolve({ value });
      });
    });
  }
  const orAbort = (promise) => firstOf(promise).then((result) => result.value);
  const PRESSABLE = ['with-lecture', 'solve-now', 'challenge-yes', 'challenge-no', 'give-up', 'done', 'submit', 'next', 'hint', 'finish', 'lecture-again'];
  for (const id of PRESSABLE) $(id).addEventListener('click', () => press(id));

  const FOOTER = ['with-lecture', 'solve-now', 'challenge-yes', 'challenge-no', 'give-up', 'done', 'submit', 'next', 'hint', 'finish', 'skip'];
  /** 아래 줄과 위 줄에서 지금 쓸 버튼만 보인다 */
  function show(...ids) {
    for (const id of FOOTER) $(id).hidden = !ids.includes(id);
    $('lecture-again').hidden = !ids.includes('lecture-again');
  }

  function setPhase(name) {
    for (const item of $('phases').children) item.classList.toggle('now', item.dataset.phase === name);
  }

  function refreshRun() {
    if (!runner) return;
    const running = isRunning() && screen === 'play';
    $('run').disabled = !canRun || !isReady();
    $('stop').disabled = !canRun || !running;
    for (const id of ['submit', 'hint', 'done', 'lecture-again', 'give-up']) $(id).disabled = running && canRun;
    lessonConsole.askInput(runner.state === 'waiting-input' && canRun && screen === 'play');
    $('lock-note').textContent = canRun ? '' : '선생님이 쓰는 중이에요';
  }

  const editor = createEditor({
    parent: $('editor'),
    doc: '',
    onChange(code) {
      if (draftSaving) store.set(draftSaving, code);
    },
    onRun: () => runUser(),
  });

  function allowRun(on) {
    canRun = on;
    editor.setLocked(!on);
    refreshRun();
    if (on) editor.focus();
  }

  async function runUser() {
    if (!canRun) return null;
    const ran = await runCode(editor, lessonConsole, { mission: mission.id, phase: currentPhase });
    if (ran) {
      lastRun = ran;
      showVars(ran.vars ?? {});
    }
    if (canRun) editor.focus();
    return ran;
  }

  $('run').addEventListener('click', () => runUser());
  $('stop').addEventListener('click', () => runner.stop());

  const player = createPlayer({
    teacher,
    board,
    editor,
    output: lessonConsole,
    runner,
    caption,
    voice: teacherVoice.voice,
    speed,
    ui: { follow, check, vars: showVars },
    knows,
  });
  const say = (key, vars) => player.play([line(mission, key, seed, vars)]);

  // 아이가 바로 움직일 수 있는 자리에서는 선생님 말이 끝나기를 기다리게 하지 않는다.
  // 말은 뒤에서 이어 하고, 아이가 버튼을 누르면 hush()로 끊는다.
  let chatter = 0;
  function background(scenes) {
    const my = ++chatter;
    (async () => {
      for (const scene of scenes) {
        if (my !== chatter || aborted || player.stopped) return;
        await player.say(scene.text, scene.speech, scene.pose);
      }
      if (my === chatter) teacher.pose('idle');
    })();
  }
  function hush() {
    chatter++;
    player.hush();
  }

  /** 재생이 끝난 뒤, 그만둔 것이면 흐름을 빠져나온다 */
  function checkAbort() {
    if (aborted) throw new Stop();
  }

  /** 따라 하기: 아이가 칠판의 코드를 치고 실행한 뒤 "다 했어요"를 누를 때까지 기다린다. */
  async function follow(scene) {
    lastRun = null;
    editor.setCode('');
    lessonConsole.clear();
    showVars({});
    allowRun(true);
    show('done', 'skip');
    background(scene.say ?? []);
    let tries = 0;
    try {
      for (;;) {
        const pressed = await nextPress('done', 'skip');
        hush();
        if (pressed === 'skip') return 'stop';
        const ran = lastRun;
        const same = ran && !ran.error && (scene.match ? new RegExp(scene.match).test(ran.output) : outputLines(ran.output).join('\n') === scene.expect.join('\n'));
        log('follow', { mission: mission.id, ok: Boolean(same), tries, code: editor.getCode() });
        if (same) return 'done';
        tries += 1;
        allowRun(false);
        if (tries >= 3) {
          // 막다른 길을 만들지 않는다. 세 번째에는 선생님이 다시 보여 주고 넘어간다.
          await say('follow-show');
          await player.play([{ kind: 'code-type', code: scene.code }, { kind: 'trace', code: scene.code, inputs: scene.inputs ?? [] }]);
          return 'done';
        }
        if (!ran) await say('follow-not-run');
        else if (ran.error) await player.say(explain(ran.error, knows()));
        else await say('follow-different');
        if (player.stopped) return 'stop';
        allowRun(true);
      }
    } finally {
      hush();
      allowRun(false);
      show('skip');
    }
  }

  /** 강의 중 확인 문제: 고른 보기 번호를 돌려준다. 강의를 건너뛰면 'stop'. */
  async function check(scene) {
    let pick;
    const picked = new Promise((resolve) => (pick = resolve));
    const marks = board.choice({ title: scene.title, ask: scene.text, choices: scene.choices.map((text) => ({ text })), onPick: pick });
    show('skip');
    background([scene.ask]);
    const result = await firstOf(picked, 'skip');
    hush();
    if (result.pressed) return 'stop';
    marks.mark(result.value, result.value === scene.answer);
    log('check', { mission: mission.id, title: scene.title, choice: result.value, correct: result.value === scene.answer });
    return result.value;
  }

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
      lessonConsole.clear();
      let pick;
      const picked = new Promise((resolve) => (pick = resolve));
      showVars({});
      const marks = board.predict({ no: index + 1, total, code: question.code, choices: question.choices, ask: question.ask, onPick: pick });
      // 묻는 말이 끝나기를 기다리지 않고 바로 고를 수 있다.
      background(predictAskScenes(mission, question, seed));
      const choice = await orAbort(picked);
      hush();
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

  /** 제출한 코드를 채점한다. 입력을 받는 문제(cases)는 정해진 입력들로 하나씩 돌려 본다. 도중에 멈췄으면 null. */
  async function grade(task) {
    if (!task.cases) {
      const ran = await runUser();
      if (!ran || ran.stopped) return null;
      const diagnosis = diagnoseTask(task, ran.code, ran);
      if (diagnosis.kind === 'error') diagnosis.text = explain(ran.error, knows());
      return { ran, diagnosis };
    }
    if (!isReady()) return null;
    const code = editor.getCode();
    activeConsole = lessonConsole;
    lessonConsole.clear();
    editor.markErrorLine(null);
    let diagnosis = { kind: 'correct' };
    for (const one of task.cases) {
      const result = await runner.run(code, { check: true, inputs: one.inputs });
      if (result.stopped) return null;
      // 무엇을 넣어 돌려 봤는지 아이가 볼 수 있게 출력 칸에 남긴다.
      lessonConsole.append(`▶ ${asAnswer(one.inputs)} 답해 봤어요\n`, 'note');
      lessonConsole.append(result.output ?? '');
      showVars(result.vars ?? {});
      if (result.error?.type === 'EOFError') {
        diagnosis = { kind: 'input-many', vars: { want: one.inputs.length } };
      } else if (result.error) {
        const at = result.error.line ? ` (${result.error.line}번 줄)` : '';
        lessonConsole.append(`\n${explain(result.error, knows())}${at}\n`, 'ko');
        lessonConsole.append(result.error.text, 'err');
        if (result.error.line) editor.markErrorLine(result.error.line);
        diagnosis = { kind: 'error', text: explain(result.error, knows()) };
      } else if (result.unused > 0) {
        diagnosis = { kind: 'input-few', vars: { want: one.inputs.length, got: one.inputs.length - result.unused } };
      } else {
        diagnosis = diagnoseTask({ ...task, expect: one.expect, inputs: one.inputs }, code, result);
      }
      if (diagnosis.kind !== 'correct') {
        diagnosis.inputs = one.inputs;
        break;
      }
      lessonConsole.append('\n');
    }
    return { ran: { code }, diagnosis };
  }

  /** 쓰기 문제 하나. 통과하면 { attempts, hints, first, code }, 심화 문제를 그만두면 null을 돌려준다. */
  async function runTask(task, { index = 0, total = 1, optional = false } = {}) {
    const key = `${draftKey()}.${task.id}`;
    const hasLecture = Boolean(mission.lecture?.length);
    const sample = task.cases?.[0];
    // showCases: 답에 따라 출력이 달라지는 문제(조건)는 앞의 몇 가지 경우를 나란히 보여 준다.
    const several = task.show && task.cases && (task.showCases ?? 1) > 1 ? task.cases.slice(0, task.showCases) : null;
    const showTask = () =>
      board.task({
        ...task,
        title: total > 1 ? `${task.title} (${index + 1} / ${total})` : task.title,
        want: task.show ? (sample ? sample.expect : task.expect) : null,
        wantNote: task.show && sample ? `${asAnswer(sample.inputs)} 답했을 때 이렇게 나와야 해요` : null,
        wants: several ? several.map((one) => ({ note: `${asAnswer(one.inputs)} 답하면`, lines: one.expect })) : null,
      });
    showTask();
    // 쓰던 것이 있으면 이어서, 없으면 문제에 딸린 시작 코드(고치기 문제)로 시작한다.
    editor.setCode(store.get(key, '') || task.start || '');
    lessonConsole.clear();
    editor.markErrorLine(null);
    showVars({});
    draftSaving = key;
    lastRun = null;
    // 선생님이 설명하는 동안에도 바로 쓰기 시작할 수 있다.
    allowRun(true);
    const opening = optional ? ['challenge-intro'] : index === 0 ? ['task-intro', 'task-how'] : ['task-next'];
    background(opening.map((k) => line(mission, k, seed)));
    const hints = task.hints ?? [];
    const buttons = ['submit'];
    if (hints.length) buttons.push('hint');
    if (optional) buttons.push('give-up');
    else if (hasLecture) buttons.push('lecture-again');
    let attempts = 0;
    let hintLevel = 0;
    for (;;) {
      show(...buttons);
      refreshRun();
      const pressed = await nextPress(...buttons);
      hush();
      if (pressed === 'give-up') {
        log('challenge-give-up', { mission: mission.id, task: task.id, attempts, code: editor.getCode() });
        draftSaving = null;
        allowRun(false);
        return null;
      }
      if (pressed === 'hint') {
        const level = Math.min(hintLevel, hints.length - 1);
        const hint = hints[level];
        log('hint', { mission: mission.id, task: task.id, level, code: editor.getCode() });
        if (hint.card) board.appendHint(hint.card);
        await say(hint.say);
        checkAbort();
        hintLevel += 1;
        editor.focus();
        continue;
      }
      if (pressed === 'lecture-again') {
        const draft = editor.getCode();
        draftSaving = null;
        await lecture();
        showTask();
        editor.setCode(draft);
        lessonConsole.clear();
        draftSaving = key;
        currentPhase = 'task';
        setPhase('task');
        await say('lecture-back');
        checkAbort();
        allowRun(true);
        continue;
      }
      // 제출: 지금 코드를 새로 실행해서 채점한다.
      attempts += 1;
      const graded = await grade(task);
      if (!graded) continue;
      const { ran, diagnosis } = graded;
      if (diagnosis.kind === 'correct') diagnosis.first = attempts === 1 && hintLevel === 0;
      log('submit', { mission: mission.id, task: task.id, attempt: attempts, hints: hintLevel, kind: diagnosis.kind, say: diagnosis.say, code: ran.code });
      allowRun(false);
      show();
      await player.play(taskFeedback(mission, task, diagnosis, seed));
      checkAbort();
      if (diagnosis.kind === 'correct') {
        draftSaving = null;
        store.set(key, '');
        return { attempts, hints: hintLevel, first: diagnosis.first, code: ran.code };
      }
      allowRun(true);
    }
  }

  async function tasks() {
    currentPhase = 'task';
    setPhase('task');
    const results = [];
    for (const [index, task] of mission.tasks.entries()) results.push(await runTask(task, { index, total: mission.tasks.length }));
    return results;
  }

  /** 심화 문제: 풀지 말지는 아이가 고른다. 풀다가 그만둬도 된다. */
  async function challenge() {
    if (!mission.challenge) return null;
    allowRun(false);
    show('challenge-yes', 'challenge-no');
    background([line(mission, 'challenge-ask', seed)]);
    const pressed = await nextPress('challenge-yes', 'challenge-no');
    hush();
    log('challenge-choice', { mission: mission.id, yes: pressed === 'challenge-yes' });
    if (pressed === 'challenge-no') {
      show();
      await say('challenge-skip');
      checkAbort();
      return null;
    }
    return runTask(mission.challenge, { optional: true });
  }

  async function finish(results, extra) {
    currentPhase = 'done';
    setPhase('');
    allowRun(false);
    show();
    const learned = mission.learned ?? [];
    board.done(
      mission.doneCard ?? { title: '오늘 배운 것', items: learned.map((item) => (item.code ? `${item.rule}  ${item.code}` : item.rule)) },
    );
    const first = results.every((r) => r.first);
    const summary = { attempts: results.reduce((n, r) => n + r.attempts, 0), hints: results.reduce((n, r) => n + r.hints, 0), first, challenge: Boolean(extra) };
    const progress = store.get('kidpy.progress', {});
    progress[mission.id] = { doneAt: new Date().toISOString(), ...summary };
    store.set('kidpy.progress', progress);
    // 만들기 과제로 쓴 프로그램은 "만들기"에 넣어 둔다(같은 이름이 있으면 그대로 둔다).
    if (mission.saveAs) {
      const works = store.get('kidpy.works', []);
      if (!works.some((w) => w.name === mission.saveAs)) {
        works.push({ id: `w-${Date.now().toString(36)}`, name: mission.saveAs, code: results[results.length - 1].code, updatedAt: new Date().toISOString() });
        store.set('kidpy.works', works);
      }
    }
    log('mission-done', { mission: mission.id, ...summary });
    if (first) await teacher.jump(); // 크게 기뻐하는 건 한 번에 해낸 순간뿐이다
    for (const key of mission.done ?? ['done-bye']) await say(key);
    checkAbort();
    flushLog();
    show('finish');
    await nextPress('finish');
  }

  async function startMission(id) {
    if (screen !== 'home' || !isReady()) return;
    mission = MISSIONS[id];
    seed = Math.floor(Date.now() / 86400000); // 날마다 인사말이 조금 다르다
    aborted = false;
    player.reset();
    setMuted(!$('sound').checked || speed > 1);
    $('where-line').textContent = mission.unit;
    $('where-title').textContent = `${mission.no}. ${mission.title}`;
    const hasLecture = Boolean(mission.lecture?.length);
    for (const item of $('phases').children) {
      if (item.dataset.phase === 'lecture') item.hidden = !hasLecture;
      if (item.dataset.phase === 'predict') item.hidden = !mission.predict?.length;
    }
    showScreen('play');
    activeConsole = lessonConsole;
    setPhase('');
    currentPhase = 'intro';
    shownVars = {};
    showVars({});
    const about = [mission.desc, `${mission.minutes}분쯤 걸려요.`];
    if (hasLecture) about.push('강의는 언제든 건너뛸 수 있어요.');
    board.card({ title: `${mission.no}. ${mission.title}`, items: about });
    caption.textContent = '';
    editor.setCode('');
    lessonConsole.clear();
    allowRun(false);
    show();
    log('mission-start', { mission: mission.id, sound: $('sound').checked });
    try {
      await voicesReady();
      checkAbort();
      if (hasLecture) {
        // 버튼을 먼저 보여 주고, 선생님은 그동안 묻는다.
        show('with-lecture', 'solve-now');
        background([line(mission, 'intro-ask', seed)]);
        const choice = await nextPress('with-lecture', 'solve-now');
        hush();
        log('mission-choice', { mission: mission.id, withLecture: choice === 'with-lecture' });
        show();
        if (choice === 'with-lecture') await lecture();
      } else {
        await say('intro-solve');
        checkAbort();
      }
      if (mission.predict?.length) await predict();
      const results = await tasks();
      const extra = await challenge();
      await finish(results, extra);
    } catch (error) {
      if (!(error instanceof Stop)) throw error;
      log('mission-abort', { mission: mission.id, phase: currentPhase });
    }
    allowRun(false);
    draftSaving = null;
    currentPhase = 'home';
    goHome();
  }

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

  // =====================================================================
  // 만들기 화면: 마음대로 쓰고 돌려 보는 곳. 쓰는 대로 저절로 저장된다.
  // =====================================================================
  let work = null;
  let saveTimer = null;

  function saveWork() {
    clearTimeout(saveTimer);
    if (!work) return;
    const all = store.get('kidpy.works', []);
    const savedBefore = all.some((w) => w.id === work.id);
    const works = all.filter((w) => w.id !== work.id);
    // 한 글자도 안 쓴 새 프로그램은 목록에 남기지 않는다. 저장했던 것은 비워도 지우지 않는다(지우기는 처음 화면에서만).
    if (work.code.trim() || savedBefore) works.push(work);
    store.set('kidpy.works', works.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_WORKS));
    $('work-saved').textContent = work.code.trim() ? '저장됨' : '';
  }

  function touchWork(change) {
    if (!work) return;
    Object.assign(work, change, { updatedAt: new Date().toISOString() });
    $('work-saved').textContent = '저장하는 중…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWork, 400);
  }

  const studioEditor = createEditor({
    parent: $('studio-editor'),
    doc: '',
    onChange(code) {
      if (work && code !== work.code) touchWork({ code });
    },
    onRun: () => runStudio(),
  });

  function refreshStudio() {
    if (!runner) return;
    const here = screen === 'studio';
    $('studio-run').disabled = !isReady();
    $('studio-stop').disabled = !(here && isRunning());
    studioConsole.askInput(here && runner.state === 'waiting-input');
  }

  async function runStudio() {
    if (screen !== 'studio') return;
    saveWork();
    await runCode(studioEditor, studioConsole, { where: 'studio', work: work.id });
    refreshStudio();
    if (runner.state !== 'waiting-input') studioEditor.focus();
  }

  function openStudio(id) {
    if (screen !== 'home' || !isReady()) return;
    const works = store.get('kidpy.works', []);
    const found = works.find((w) => w.id === id);
    const numbers = works.map((w) => Number(/^내 프로그램 (\d+)$/.exec(w.name)?.[1] ?? 0));
    work = found ? { ...found } : { id: `w-${Date.now().toString(36)}`, name: `내 프로그램 ${Math.max(0, ...numbers) + 1}`, code: '', updatedAt: new Date().toISOString() };
    studioEditor.setCode(work.code);
    $('work-name').value = work.name;
    $('work-saved').textContent = found ? '저장됨' : '';
    studioConsole.clear();
    showScreen('studio');
    activeConsole = studioConsole;
    refreshStudio();
    studioEditor.focus();
    log('studio-open', { work: work.id, isNew: !found });
  }

  $('new-work').addEventListener('click', () => openStudio(null));
  $('studio-run').addEventListener('click', () => runStudio());
  $('studio-stop').addEventListener('click', () => runner.stop());
  $('work-name').addEventListener('input', () => touchWork({ name: $('work-name').value.trim() || work.name }));
  $('studio-home').addEventListener('click', () => {
    runner.stop();
    saveWork();
    if (work) log('studio-close', { work: work.id, code: work.code });
    work = null;
    goHome();
  });

  // 닫기 직전에 저장하고 기록을 올린다.
  const beforeLeave = () => {
    saveWork();
    flushLog();
  };
  addEventListener('pagehide', beforeLeave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') beforeLeave();
  });

  // 개발 서버에서만: 수업을 자동으로 돌려 보는 점검에서 편집기에 코드를 넣을 수 있게 한다(빌드에는 들어가지 않는다).
  if (import.meta.env.DEV) window.__kidpy = { editor, studioEditor, runner };

  // ---- 시작 ----
  show();
  renderHome();
  try {
    const info = await runner.start();
    log('app-open', { loadMs: info.ms, python: info.python, screen: `${innerWidth}x${innerHeight}`, standalone: matchMedia('(display-mode: standalone)').matches });
  } catch {
    // 상태 줄에 이유가 이미 표시된다.
  }
}

main();
