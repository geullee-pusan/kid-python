// 앱의 뼈대: 처음 화면(배우기 / 만들기 / 찾아보기), 수업 화면, 연습 문제 화면, 만들기 화면.
// - 수업에서 할 말과 장면은 src/core/lesson.js가 대본(src/content/missions/)으로 정한다. 여기서는 재생하고 버튼을 받는다.
// - 문제 풀기가 중심이다. 강의는 건너뛸 수 있고, 풀다가 "강의 보기"로 다시 볼 수 있다.
// - 선생님은 아이가 버튼을 누를 때까지 기다린다.
import './app.css';
import curriculum from './content/curriculum.json';
import look from './content/teacher-look.json';
import teacherVoice from './content/teacher.json';
import { diagnoseDrawing, diagnoseGame, diagnoseTask, fileProblem, outputLines } from './core/diagnose.js';
import { compareScene } from './core/scene.js';
import { compareDrawing } from './core/drawing.js';
import { explain } from './core/errors-ko.js';
import { hasBatchim } from './core/korean.js';
import { lectureParts, line, mergeScript, predictAskScenes, predictFeedback, predictRevealScenes, taskFeedback } from './core/lesson.js';
import { errorAt, splitFiles, validModuleName, withFileNames, withModules } from './core/modules.js';
import { createBoard } from './ui/board.js';
import { createCanvas, usesTurtle } from './ui/canvas.js';
import { createConsole } from './ui/console.js';
import { createEditor } from './ui/editor.js';
import { createFilesView } from './ui/files.js';
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

// 연습 문제 묶음(단원마다 하나)을 단원 순서대로. 수업 대본과 같은 틀이라서 쓰기 문제의 흐름을 그대로 쓴다.
const practiceFiles = Object.values(import.meta.glob('./content/practice/*.json', { eager: true, import: 'default' }));
const PRACTICE = curriculum.units
  .map((unit) => practiceFiles.find((set) => set.unit === unit.title))
  .filter(Boolean)
  .map((set) => mergeScript(set, common));
const PROBLEM_COUNT = PRACTICE.reduce((n, set) => n + set.tasks.length, 0);

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

/** 무작위 수를 쓰는 문제는 채점할 때 고를 수를 정해 둔다. 그 수를 말로: { randoms: [62] } → "고른 수가 62일 때, " */
function picked(one) {
  // pickedSay: 여러 번 고르는 문제(주사위를 여러 번 굴린다)는 대본에 말을 적어 둔다. 예: "주사위가 차례로 3, 5, 6, 2, 2, 1"
  if (one.pickedSay) return `${one.pickedSay}일 때, `;
  return one.randoms?.length ? `고른 수가 ${one.randoms[0]}일 때, ` : '';
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

  // 파일 칸: 파일을 읽거나 쓰는 프로그램일 때만 보인다.
  // 수업에서는 그 문제(또는 따라 하기, 예측 문제)에 딸린 파일(givenFiles)을 넣고 시작한다.
  // 만들기에서는 "내 파일"을 이 기기에 남겨 두고, 실행할 때마다 넣어 준다(프로그램끼리 같이 쓴다).
  const lessonFilesView = createFilesView($('files'));
  let givenFiles = null;
  /** 수업 화면의 파일 칸. files가 비었으면 감춘다. before가 있으면 새로 생긴 것과 바뀐 것을 표시한다. */
  function showLessonFiles(files, before = null) {
    // 모듈(.py)은 파일 칸이 아니라 편집기의 탭으로 보인다
    const shown = lessonFilesView.show(files && splitFiles(files).data, before && splitFiles(before).data);
    $('files-col').hidden = !shown;
  }
  const FILES_KEY = 'kidpy.files';
  const MAX_FILE_CHARS = 50000; // "내 파일" 하나에 남기는 글자 수
  const MAX_FILES_CHARS = 300000; // "내 파일"을 모두 합한 글자 수
  const studioFilesView = createFilesView($('studio-files'), {
    onDelete(name) {
      const files = { ...store.get(FILES_KEY, {}) };
      delete files[name];
      store.set(FILES_KEY, files);
      log('file-delete', { name });
      showStudioFiles(files);
      // 도구 파일을 지웠으면 그 탭도 닫는다
      if (/\.py$/.test(name)) studioEditor.setModules(splitFiles(files).modules);
    },
  });
  function showStudioFiles(files, before = null) {
    // 만들기에서는 도구 파일(.py)도 내 파일 칸에 보인다(지우기는 여기서 한다). 고치기는 편집기의 탭에서 한다.
    $('studio-files-col').hidden = !studioFilesView.show(files, before);
  }
  /** 만들기에서 돌린 프로그램이 남긴 파일을 "내 파일"로 저장한다. 너무 크면 앞부분만 남기고 알려 준다. */
  function keepStudioFiles(files) {
    const kept = {};
    let total = 0;
    let cut = false;
    for (const [name, text] of Object.entries(files)) {
      let value = text.length > MAX_FILE_CHARS ? ((cut = true), text.slice(0, MAX_FILE_CHARS)) : text;
      if (total + value.length > MAX_FILES_CHARS) {
        cut = true;
        value = value.slice(0, Math.max(0, MAX_FILES_CHARS - total));
      }
      total += value.length;
      kept[name] = value;
    }
    store.set(FILES_KEY, kept);
    return { kept, cut };
  }

  // 그림판: turtle을 쓰는 프로그램일 때만 보인다. 수업 화면에서는 출력 칸 왼쪽에, 만들기 화면에서는 출력 칸 위에 놓인다.
  // 키를 받는 프로그램(turtle.listen())이 돌면: 그림판이 키를 받아 프로그램에 넘기고, 수업 화면에서는 그림판을 크게 보여 준다.
  const canvasHooks = (which) => ({
    rate: speed,
    onKey: (kind, name) => runner?.sendKey(kind, name),
    onEscape: () => runner?.stop(),
    onListen(on) {
      const canvas = which === 'lesson' ? lessonCanvas : studioCanvas;
      if (which === 'lesson') {
        $('draw-col').closest('.right').classList.toggle('playing', on);
        fitCanvas();
      }
      if (on) canvas.focus();
    },
  });
  const lessonCanvas = createCanvas($('canvas'), canvasHooks('lesson'));
  const studioCanvas = createCanvas($('studio-canvas'), canvasHooks('studio'));
  let activeCanvas = null; // 지금 그림을 받을 그림판
  /** 그림판을 보이거나 감춘다. 수업 화면에서는 그림판의 가로를 세로에 맞춰(4:3) 잡는다. */
  function showCanvas(canvas, on) {
    const column = canvas === lessonCanvas ? $('draw-col') : $('studio-draw-col');
    if (column.hidden === !on) return;
    column.hidden = !on;
    if (canvas !== lessonCanvas) return;
    column.closest('.right').classList.toggle('drawing', on);
    if (on) fitCanvas();
  }
  function fitCanvas() {
    const column = $('draw-col');
    if (column.hidden) return;
    // 크게 보여 줄 때는 칸의 가로를 넘지 않게 한다.
    const playing = column.closest('.right').classList.contains('playing');
    column.style.width = '';
    const height = $('canvas').clientHeight;
    const room = column.closest('.right').clientWidth;
    column.style.width = `${Math.round(playing ? Math.min(room, (height * 4) / 3) : (height * 4) / 3)}px`;
  }
  addEventListener('resize', fitCanvas);

  runner = new Runner({
    onDraw(cmds) {
      if (!activeCanvas) return;
      showCanvas(activeCanvas, true);
      activeCanvas.push(cmds);
    },
    onOut(chunks, dropped) {
      // 글자가 없는 묶음(그림만 온 것)은 바로 받았다고 알린다. 게임은 장면마다 보내므로 기다리게 하면 느려진다.
      if (activeConsole && (chunks.length || dropped)) activeConsole.queue(chunks, dropped);
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
  // files: 프로그램이 시작할 때 폴더에 있을 파일. 결과의 files에 끝난 뒤의 파일들이 온다(파일을 안 쓰면 null).
  async function runCode(editor, out, where, canvas, files = null) {
    if (!isReady()) return null;
    const code = editor.getCode();
    activeConsole = out;
    activeCanvas = canvas;
    canvas.reset();
    // 그리는 프로그램이면 그림판을 먼저 보여 준다(그리기 시작한 뒤에 화면이 밀리지 않게).
    showCanvas(canvas, usesTurtle(code) || (canvas === lessonCanvas && Boolean(mission?.canvas)));
    out.clear();
    editor.markErrorLine(null);
    // 모듈 탭(도구.py)은 파일과 함께 폴더에 넣는다. 그래야 import 도구가 된다.
    const result = await runner.run(code, { files: withModules(files, editor.getModules()) });
    out.flush();
    canvas.endRun();
    if (result.stopped) {
      canvas.stop();
      out.append('\n■ 멈췄어요\n', 'note');
    } else if (result.error) {
      out.append(`\n${explain(result.error, knows())}${errorAt(result.error)}\n`, 'ko');
      out.append(result.error.text, 'err');
      if (result.error.line) editor.markErrorLine(result.error.line, result.error.file ?? undefined);
    }
    log('run', { ...where, code, ok: result.ok, error: result.error ? { type: result.error.type, line: result.error.line, message: result.error.message } : null, ms: result.ms });
    return { code, output: result.output, error: result.error, stopped: result.stopped, vars: result.vars, draw: result.draw, files: result.files };
  }

  // 그리기 문제: 모범 답이 그리는 그림. 문제를 보여 줄 때와 채점할 때 쓴다(한 번 구하면 적어 둔다).
  const wanted = new Map();
  async function wantDrawing(code, inputs = []) {
    const key = JSON.stringify([code, inputs]);
    if (!wanted.has(key)) wanted.set(key, (await runner.run(code, { check: true, inputs })).draw ?? []);
    return wanted.get(key);
  }
  // 게임 문제: 모범 답을 정해 둔 키와 장면 수로 돌린 결과(그린 것과 출력).
  async function wantGame(code, one) {
    const key = JSON.stringify([code, one]);
    if (!wanted.has(key)) {
      const ran = await runner.run(code, { check: true, inputs: one.inputs ?? [], randoms: one.randoms, keys: one.keys, frames: one.frames });
      wanted.set(key, { draw: ran.draw ?? [], output: ran.output ?? '' });
    }
    return wanted.get(key);
  }
  const KEY_WORDS = { Left: '왼쪽', Right: '오른쪽', Up: '위', Down: '아래', space: '스페이스', Return: '엔터' };
  /** 눌러 본 키를 말로: ["Right", "Right", null, "Up"] → "오른쪽 2번, 위". 같은 키를 이어 누른 것은 몇 번인지로 줄인다. */
  const keyWords = (keys) => {
    const runs = [];
    for (const name of (keys ?? []).filter(Boolean)) {
      if (runs.at(-1)?.name === name) runs.at(-1).n += 1;
      else runs.push({ name, n: 1 });
    }
    return runs.map(({ name, n }) => (KEY_WORDS[name] ?? name) + (n > 1 ? ` ${n}번` : '')).join(', ');
  };

  function showScreen(name) {
    screen = name;
    for (const id of ['home', 'practice', 'play', 'studio']) $(id).hidden = id !== name;
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
        : '수업을 모두 끝냈어요. 연습 문제를 풀거나, 만들기에서 나만의 프로그램을 만들어 봐요.';

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
      cont.append(el('p', 'panel-desc', '수업을 모두 끝냈어요. 끝낸 수업은 다시 해도 돼요.'));
    }

    // 배우기: 연습 문제로 가는 길(점수가 아니라, 푼 문제 수만 알려 준다)
    const entry = $('practice-entry');
    entry.replaceChildren();
    const solved = store.get('kidpy.practice', {});
    const solvedCount = PRACTICE.reduce((n, set) => n + set.tasks.filter((task) => solved[task.id]).length, 0);
    const toPractice = el('button', 'btn practice-entry');
    toPractice.type = 'button';
    toPractice.dataset.needsPython = '';
    toPractice.append(
      el('span', 'practice-entry-label', '✏ 연습 문제'),
      el('span', 'practice-entry-sub', solvedCount ? `${PROBLEM_COUNT}문제 가운데 ${solvedCount}문제를 풀었어요` : `배운 것으로 푸는 문제 ${PROBLEM_COUNT}개`),
    );
    toPractice.addEventListener('click', () => openPractice());
    entry.append(toPractice);

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
    activeCanvas = null;
    lessonCanvas.stop();
    studioCanvas.stop();
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
    // tries: try와 except를 배운 뒤(단원 17)
    const KINDS = ['variables', 'loops', 'functions', 'classes', 'tries'];
    const has = (what) => Boolean(mission.knows?.includes(what));
    if (screen === 'play' && mission) return Object.fromEntries(KINDS.map((k) => [k, has(k)]));
    const progress = store.get('kidpy.progress', {});
    const learned = (what) => LESSONS.some((m) => m.knows?.includes(what) && progress[m.id]);
    return Object.fromEntries(KINDS.map((k) => [k, learned(k)]));
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
  const PRESSABLE = ['with-lecture', 'solve-now', 'challenge-yes', 'challenge-no', 'give-up', 'done', 'submit', 'next', 'hint', 'finish', 'lecture-again', 'to-list', 'next-problem'];
  for (const id of PRESSABLE) $(id).addEventListener('click', () => press(id));

  const FOOTER = ['with-lecture', 'solve-now', 'challenge-yes', 'challenge-no', 'give-up', 'done', 'submit', 'next', 'hint', 'finish', 'skip', 'to-list', 'next-problem', 'reset-code'];
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
    for (const id of ['submit', 'hint', 'done', 'lecture-again', 'give-up', 'reset-code']) $(id).disabled = running && canRun;
    lessonConsole.askInput(runner.state === 'waiting-input' && canRun && screen === 'play');
    $('lock-note').textContent = canRun ? '' : '선생님이 쓰는 중이에요';
  }

  const editor = createEditor({
    parent: $('editor'),
    doc: '',
    tabs: $('editor-tabs'),
    onChange(code) {
      if (draftSaving) store.set(draftSaving, code);
    },
    // 모듈 탭(도구.py)에 쓰던 것도 문제마다 남겨 둔다
    onModuleChange() {
      if (draftSaving) store.set(`${draftSaving}.modules`, editor.getModules());
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
    const ran = await runCode(editor, lessonConsole, { mission: mission.id, phase: currentPhase }, lessonCanvas, givenFiles);
    if (ran) {
      lastRun = ran;
      showVars(ran.vars ?? {});
      // 파일을 읽거나 쓴 프로그램: 끝난 뒤의 파일을 보여 준다(새로 생긴 것과 바뀐 것을 표시한다).
      if (ran.files) showLessonFiles(ran.files, givenFiles ?? {});
    }
    if (canRun) editor.focus();
    return ran;
  }

  // 처음 코드로: 시작 코드가 있는 문제(고치기 등)에서, 고치다가 엉킨 코드를 처음 것으로 되돌린다.
  // 쓰던 코드가 사라지므로 두 번 눌러야 된다(한 번 누르면 "정말 되돌려요?"로 바뀐다).
  let resetTo = null; // 지금 문제의 시작 코드. 없으면 null
  let resetModules = null; // 지금 문제의 모듈 탭 시작 코드 { modules, locked }. 없으면 null
  let resetTimer = null;
  function calmReset() {
    clearTimeout(resetTimer);
    delete $('reset-code').dataset.sure;
    $('reset-code').textContent = '↺ 처음 코드로';
  }
  $('reset-code').addEventListener('click', () => {
    if (resetTo == null || !canRun) return;
    const button = $('reset-code');
    if (!button.dataset.sure) {
      button.dataset.sure = '1';
      button.textContent = '정말 되돌려요?';
      resetTimer = setTimeout(calmReset, 4000);
      return;
    }
    calmReset();
    log('reset-code', { mission: mission.id, code: editor.getCode() });
    editor.setCode(resetTo);
    if (draftSaving) store.set(draftSaving, resetTo);
    // 모듈 탭도 처음으로
    if (resetModules) {
      editor.setModules(resetModules.modules, resetModules.locked);
      if (draftSaving) store.set(`${draftSaving}.modules`, resetModules.modules);
    }
    editor.markErrorLine(null);
    lessonConsole.clear();
    lessonCanvas.reset();
    showVars({});
    editor.focus();
  });

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
    ui: {
      follow,
      check,
      vars: showVars,
      // 한 줄씩 보기: 시작할 때 그림판을 비우고(그리는 코드일 때만 보인다), 줄마다 그 줄이 그린 것을 넘겨받는다.
      drawStart(code) {
        activeCanvas = lessonCanvas;
        lessonCanvas.reset();
        showCanvas(lessonCanvas, usesTurtle(code) || Boolean(mission?.canvas));
      },
      draw: (cmds, maxMs) => lessonCanvas.push(cmds, { maxMs }),
      drawEnd: () => lessonCanvas.endRun(),
      files: showLessonFiles,
    },
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
    // 모듈도 따라 치는 경우(scene.modules): 그 탭들을 빈 채로 연다. givenModules는 채워서 보기만 하게 준다.
    const given = scene.givenModules ?? {};
    editor.setModules({ ...Object.fromEntries(Object.keys(scene.modules ?? {}).map((name) => [name, ''])), ...given }, Object.keys(given));
    editor.setCode('');
    lessonConsole.clear();
    lessonCanvas.reset();
    showVars({});
    givenFiles = scene.files ?? null;
    showLessonFiles(givenFiles);
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
        // stopped: 끝나지 않는 프로그램을 돌려 보고 멈춤 버튼으로 멈추는 연습. 멈췄으면 된 것이다.
        // draw: 그리기 따라 하기는 출력이 아니라 그림을 견준다.
        const same = scene.stopped
          ? Boolean(ran?.stopped)
          : scene.game
            ? // 게임 따라 하기: 아이가 실행해 본 뒤(멈춤으로 끝내도 된다), 정해 둔 키와 장면 수로 돌려서 선생님 것과 견준다.
              ran && !ran.error && (await sameGame(editor.getCode(), scene.code, scene.game))
            : scene.draw
            ? ran && !ran.error && !ran.stopped && compareDrawing(ran.draw ?? [], await wantDrawing(scene.code)).kind === 'draw-correct'
            : ran && !ran.error && !ran.stopped && (scene.match ? new RegExp(scene.match).test(ran.output) : outputLines(ran.output).join('\n') === scene.expect.join('\n')) &&
              // 파일에 쓰는 따라 하기: 파일도 선생님 것과 같아야 한다.
              (!scene.expectFiles || !fileProblem(scene.expectFiles, ran.files ?? {}));
        log('follow', { mission: mission.id, ok: Boolean(same), tries, code: editor.getCode() });
        if (same) return 'done';
        tries += 1;
        allowRun(false);
        if (tries >= 3) {
          // 막다른 길을 만들지 않는다. 세 번째에는 선생님이 다시 보여 주고 넘어간다.
          await say('follow-show');
          const typeModules = Object.entries(scene.modules ?? {}).map(([name, code]) => ({ kind: 'code-type', code, file: name }));
          await player.play([...typeModules, { kind: 'code-type', code: scene.code, files: scene.files }, { kind: 'trace', code: scene.code, inputs: scene.inputs ?? [], limit: scene.limit, files: scene.files }]);
          return 'done';
        }
        if (!ran) await say('follow-not-run');
        else if (scene.stopped) await say('follow-not-stopped');
        else if (ran.error) await player.say(explain(ran.error, knows()));
        else if (scene.expectFiles && outputLines(ran.output).join('\n') === (scene.expect ?? []).join('\n')) await say('follow-different-file');
        else await say(scene.draw || scene.game ? 'follow-different-draw' : 'follow-different');
        if (player.stopped) return 'stop';
        allowRun(true);
      }
    } finally {
      hush();
      allowRun(false);
      show('skip');
      givenFiles = null;
    }
  }

  /** 두 프로그램을 같은 키와 장면 수로 돌렸을 때 마지막 모습이 같은가 */
  async function sameGame(mine, theirs, game) {
    const ran = await runner.run(mine, { check: true, keys: game.keys, frames: game.frames, randoms: game.randoms });
    if (ran.error) return false;
    return compareScene(ran.draw ?? [], (await wantGame(theirs, game)).draw, game).kind === 'game-correct';
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
    editor.setModules({}); // 강의에서 쓰는 모듈 탭은 대본의 modules 장면이 연다
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
      // 모듈을 쓰는 예측 문제: 그 탭들을 보기만 하게 연다
      editor.setModules(question.modules ?? {}, Object.keys(question.modules ?? {}));
      editor.setCode(question.code);
      lessonConsole.clear();
      lessonCanvas.reset();
      showCanvas(lessonCanvas, usesTurtle(question.code) || Boolean(mission.canvas));
      // 파일을 읽는 예측 문제: 파일에 무엇이 들어 있는지 먼저 보여 준다.
      showLessonFiles(question.files ?? null);
      let pick;
      const picked = new Promise((resolve) => (pick = resolve));
      showVars({});
      // 모듈이 있으면 칠판에 파일마다 이름을 붙여 함께 보인다(탭을 눌러 보지 않아도 되게)
      const boardCode = question.modules ? withFileNames(question.modules, question.code) : question.code;
      const marks = board.predict({ no: index + 1, total, code: boardCode, choices: question.choices, ask: question.ask, onPick: pick });
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
      let diagnosis;
      if (task.draw) {
        // 그리기 문제: 다 그려지기를 기다렸다가, 모범 답의 그림과 견준다.
        await lessonCanvas.idle();
        diagnosis = ran.error ? { kind: 'error' } : diagnoseDrawing(task, ran.code, ran.draw, await wantDrawing(task.solution));
      } else diagnosis = diagnoseTask(task, ran.code, ran, editor.getModules());
      if (diagnosis.kind === 'error') diagnosis.text = explain(ran.error, knows());
      return { ran, diagnosis };
    }
    if (!isReady()) return null;
    const code = editor.getCode();
    activeConsole = lessonConsole;
    activeCanvas = lessonCanvas;
    lessonConsole.clear();
    lessonCanvas.reset();
    showCanvas(lessonCanvas, usesTurtle(code) || Boolean(mission.canvas));
    editor.markErrorLine(null);
    let diagnosis = { kind: 'correct' };
    const modules = editor.getModules();
    for (const one of task.cases) {
      // randoms: 무작위 수를 쓰는 문제는 채점할 때 나올 수를 정해 둔다.
      // files: 경우마다 처음 파일이 다를 수 있다(예: 파일이 있을 때와 없을 때). 모듈 탭은 늘 함께 넣는다.
      const startFiles = one.files ?? task.files ?? null;
      const result = await runner.run(code, { check: true, inputs: one.inputs ?? [], randoms: one.randoms, keys: one.keys, frames: one.frames, files: withModules(startFiles, modules) });
      if (result.stopped) return null;
      if (result.files || startFiles) showLessonFiles(result.files ?? startFiles, startFiles ?? {});
      // 게임 문제: 어떤 키를 눌러 봤는지 남긴다.
      if (task.game) lessonConsole.append(keyWords(one.keys) ? `▶ ${keyWords(one.keys)} 키를 눌러 봤어요\n` : '▶ 잠깐 돌려 봤어요\n', 'note');
      // 무엇을 넣어 돌려 봤는지 아이가 볼 수 있게 출력 칸에 남긴다(묻지 않는 문제는 적을 것이 없다).
      if (one.inputs?.length) lessonConsole.append(`▶ ${picked(one)}${asAnswer(one.inputs)} 답해 봤어요\n`, 'note');
      // 끝나지 않는 반복은 출력이 수만 줄일 수 있다. 앞의 몇 줄만 보여 준다.
      const endless = result.error?.type === 'TraceLimit';
      const printed = result.output ?? '';
      lessonConsole.append(endless ? `${printed.split('\n').slice(0, 12).join('\n')}\n…\n` : printed);
      // 채점할 때는 화면으로 보내지 않고 돌리므로, 그린 것이 있으면 다 그린 모습을 한 번에 보여 준다.
      if (result.draw?.length) lessonCanvas.showAll(result.draw);
      showVars(result.vars ?? {});
      if (endless) {
        // 끝나지 않는 반복: 실행기가 줄 수를 세다가 멈춘 것이다.
        lessonConsole.append('\n■ 끝나지 않아서 멈췄어요\n', 'note');
        diagnosis = { kind: 'endless' };
      } else if (result.error?.type === 'EOFError') {
        // 준 답을 다 쓰고도 또 물었다. 이 문제에서 흔한 실수(예: break를 빼먹음)로 짚을 수 있으면 그 말을 한다.
        const guess = diagnoseTask({ ...task, expect: one.expect, inputs: one.inputs, expectFiles: one.expectFiles ?? task.expectFiles }, code, { error: null, output: result.output, files: result.files, again: true }, modules);
        diagnosis = guess.kind === 'mistake' ? guess : { kind: 'input-many', vars: { want: (one.inputs ?? []).length } };
      } else if (result.error) {
        lessonConsole.append(`\n${explain(result.error, knows())}${errorAt(result.error)}\n`, 'ko');
        lessonConsole.append(result.error.text, 'err');
        if (result.error.line) editor.markErrorLine(result.error.line, result.error.file ?? undefined);
        diagnosis = { kind: 'error', text: explain(result.error, knows()) };
      } else if (result.unused > 0) {
        diagnosis = { kind: 'input-few', vars: { want: (one.inputs ?? []).length, got: (one.inputs ?? []).length - result.unused } };
      } else if (task.game) {
        diagnosis = diagnoseGame(task, code, result, await wantGame(task.solution, one));
        if (diagnosis.kind !== 'correct' && keyWords(one.keys)) diagnosis.keys = keyWords(one.keys);
      } else if (task.draw) {
        diagnosis = diagnoseDrawing({ ...task, inputs: one.inputs }, code, result.draw, await wantDrawing(task.solution, one.inputs));
      } else {
        diagnosis = diagnoseTask({ ...task, expect: one.expect, inputs: one.inputs, expectFiles: one.expectFiles ?? task.expectFiles }, code, result, modules);
      }
      if (diagnosis.kind !== 'correct') {
        diagnosis.inputs = one.inputs ?? [];
        // 칠판에 보인 경우(첫째)와 다른 파일로 돌렸다: 파일 칸에 그때의 파일이 보인다고 알려 준다.
        if (one !== task.cases[0] && JSON.stringify(startFiles ?? {}) !== JSON.stringify(task.cases[0].files ?? task.files ?? {})) {
          // 파일이 하나도 없을 때(처음 켠 경우)는 따로 말한다. 파일 칸에 보여 줄 것이 없다.
          const none = !Object.keys(startFiles ?? {}).length;
          diagnosis.otherFiles = none ? 'none' : 'other';
          lessonConsole.append(none ? '▶ 파일이 아직 없을 때도 돌려 봤어요\n' : '▶ 처음 파일을 바꿔서 돌려 봤어요(파일 칸)\n', 'note');
        }
        break;
      }
      lessonConsole.append('\n');
    }
    return { ran: { code }, diagnosis };
  }

  /** 쓰기 문제의 모듈 탭: 쓰던 것(draft)이 있으면 그것, 없으면 문제의 시작 코드. 잠근 탭은 늘 문제의 것. */
  function taskModules(task, draft) {
    const start = task.modules ?? {};
    const out = { ...start };
    for (const name of Object.keys(start)) if (draft && name in draft && !(task.lockModules ?? []).includes(name)) out[name] = draft[name];
    return out;
  }

  /** 쓰기 문제 하나. 통과하면 { attempts, hints, first, code }, 심화 문제를 그만두면 null을 돌려준다. */
  async function runTask(task, { index = 0, total = 1, optional = false, firstWords = null } = {}) {
    const key = `${draftKey()}.${task.id}`;
    const hasLecture = Boolean(mission.lecture?.length);
    const sample = task.cases?.[0];
    // showCases: 답에 따라 출력이 달라지는 문제(조건)는 앞의 몇 가지 경우를 나란히 보여 준다.
    const several = task.show && task.cases && (task.showCases ?? 1) > 1 ? task.cases.slice(0, task.showCases) : null;
    // 그리기 문제는 글 대신 본보기 그림을 보여 준다(모범 답을 돌려서 얻는다).
    let pictures = null;
    if (task.game) {
      // 게임 문제는 정해 둔 키를 누른 뒤의 모습을 거북이와 함께 보여 준다.
      pictures = [];
      for (const one of task.cases.slice(0, task.showCases ?? 1)) {
        // 키 없이 보여 주는 장면이 둘이면 뒤의 것은 시간이 더 지난 모습이다.
        const idle = pictures.some((p) => p.idle) ? '시간이 더 지나면' : '조금 지나면';
        pictures.push({ scene: true, idle: !keyWords(one.keys), note: keyWords(one.keys) ? `${keyWords(one.keys)} 키를 누르면` : idle, cmds: (await wantGame(task.solution, one)).draw });
      }
      checkAbort();
    } else if (task.draw) {
      pictures = [];
      const shown = task.cases ? task.cases.slice(0, task.showCases ?? 1) : [null];
      for (const one of shown) {
        pictures.push({ note: one?.inputs.length ? `${asAnswer(one.inputs)} 답하면` : '이렇게 그려요', cmds: await wantDrawing(task.solution, one?.inputs ?? []) });
      }
      checkAbort();
    }
    const showTask = () =>
      board.task({
        ...task,
        pictures,
        title: total > 1 ? `${task.title} (${index + 1} / ${total})` : task.title,
        want: task.show && !task.draw && !task.game ? (sample ? sample.expect : task.expect) : null,
        wantNote: task.show && !task.draw && !task.game && sample?.inputs?.length ? `${picked(sample)}${asAnswer(sample.inputs)} 답했을 때 이렇게 나와야 해요` : null,
        wants: several && !task.draw && !task.game ? several.map((one) => ({ note: `${picked(one)}${asAnswer(one.inputs)} 답하면`, lines: one.expect })) : null,
        // 파일에 쓰는 문제: 끝난 뒤 파일에 있어야 하는 줄들(task.show일 때)
        fileWants: task.show ? Object.entries(sample?.expectFiles ?? task.expectFiles ?? {}).map(([name, lines]) => ({ note: `📄 ${name} 파일에는`, lines })) : null,
      });
    showTask();
    // 파일을 읽는 문제: 처음에 있는 파일을 파일 칸에 보여 준다.
    // (경우마다 파일이 다른 문제는, 실행 버튼으로 돌릴 때 첫째 경우의 파일을 쓴다.)
    givenFiles = task.files ?? sample?.files ?? null;
    showLessonFiles(givenFiles);
    // 쓰던 것이 있으면 이어서, 없으면 문제에 딸린 시작 코드(고치기 문제)로 시작한다.
    // 모듈 탭(도구.py)도 같다. 고칠 수 없게 준 탭(lockModules)은 늘 문제의 것을 쓴다.
    editor.setModules(taskModules(task, store.get(`${key}.modules`, null)), task.lockModules ?? []);
    editor.setCode(store.get(key, '') || task.start || '');
    lessonConsole.clear();
    lessonCanvas.reset();
    showCanvas(lessonCanvas, usesTurtle(editor.getCode()) || Boolean(mission.canvas));
    editor.markErrorLine(null);
    showVars({});
    draftSaving = key;
    lastRun = null;
    // 선생님이 설명하는 동안에도 바로 쓰기 시작할 수 있다.
    allowRun(true);
    // firstWords: 연습 문제는 수업과 다른 말로 시작한다.
    const opening = firstWords ?? (optional ? ['challenge-intro'] : index === 0 ? ['task-intro', 'task-how'] : ['task-next']);
    background(opening.map((k) => line(mission, k, seed)));
    const hints = task.hints ?? [];
    const buttons = ['submit'];
    if (hints.length) buttons.push('hint');
    // 시작 코드가 있는 문제는 처음 코드로 되돌릴 수 있다(모듈 탭이 있으면 그것도).
    resetTo = task.start ?? (task.modules ? '' : null);
    resetModules = task.modules ? { modules: task.modules, locked: task.lockModules ?? [] } : null;
    calmReset();
    if (resetTo != null) buttons.unshift('reset-code');
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
        const draftModules = editor.getModules();
        draftSaving = null;
        await lecture();
        showTask();
        givenFiles = task.files ?? sample?.files ?? null;
        showLessonFiles(givenFiles);
        editor.setModules(draftModules, task.lockModules ?? []);
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
      log('submit', { mission: mission.id, task: task.id, attempt: attempts, hints: hintLevel, kind: diagnosis.kind, say: diagnosis.say, code: ran.code, ...(task.modules ? { modules: editor.getModules() } : {}) });
      allowRun(false);
      show();
      await player.play(taskFeedback(mission, task, diagnosis, seed));
      checkAbort();
      if (diagnosis.kind === 'correct') {
        draftSaving = null;
        store.set(key, '');
        // 모듈 탭의 쓰던 것도 지운다(다시 풀 때 고치기 문제가 고친 채로 열리지 않게)
        if (task.modules) store.set(`${key}.modules`, null);
        return { attempts, hints: hintLevel, first: diagnosis.first, code: ran.code, modules: editor.getModules() };
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
      // saveFiles: 그 프로그램이 읽는 파일. 아이가 쓴 모듈 탭(내도구.py)도 함께 넣는다.
      // "내 파일"에 같은 이름이 없을 때만 넣는다(아이가 고친 파일은 그대로 둔다).
      const keep = { ...(mission.saveFiles ?? {}), ...(results[results.length - 1].modules ?? {}) };
      if (Object.keys(keep).length) {
        const files = store.get(FILES_KEY, {});
        const missing = Object.entries(keep).filter(([name]) => !(name in files));
        if (missing.length) keepStudioFiles({ ...files, ...Object.fromEntries(missing) });
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
    $('phases').hidden = false;
    $('to-home').textContent = '← 처음으로';
    const hasLecture = Boolean(mission.lecture?.length);
    for (const item of $('phases').children) {
      if (item.dataset.phase === 'lecture') item.hidden = !hasLecture;
      if (item.dataset.phase === 'predict') item.hidden = !mission.predict?.length;
    }
    showScreen('play');
    activeConsole = lessonConsole;
    activeCanvas = lessonCanvas;
    lessonCanvas.reset();
    showCanvas(lessonCanvas, Boolean(mission.canvas));
    givenFiles = null;
    showLessonFiles(null);
    setPhase('');
    currentPhase = 'intro';
    shownVars = {};
    showVars({});
    const about = [mission.desc, `${mission.minutes}분쯤 걸려요.`];
    if (hasLecture) about.push('강의는 언제든 건너뛸 수 있어요.');
    board.card({ title: `${mission.no}. ${mission.title}`, items: about });
    caption.textContent = '';
    editor.setModules({});
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

  // =====================================================================
  // 연습 문제: 단원을 고르고 문제를 골라서 푼다. 새로 배우는 것은 없고, 푼 문제에 ✓만 남긴다.
  // =====================================================================
  let practiceAt = null; // 지금 보고 있는 단원(PRACTICE의 번호)

  /** 그 단원의 수업을 모두 끝냈는가 */
  function unitLearned(set, progress) {
    const unit = curriculum.units.find((u) => u.title === set.unit);
    return (unit.lessons ?? []).every((id) => progress[id]);
  }

  function renderPractice() {
    const progress = store.get('kidpy.progress', {});
    const solved = store.get('kidpy.practice', {});
    const count = (set) => set.tasks.filter((task) => solved[task.id]).length;
    $('practice-total').textContent = `${PROBLEM_COUNT}문제 가운데 ${PRACTICE.reduce((n, set) => n + count(set), 0)}문제를 풀었어요`;

    const units = $('practice-units');
    units.replaceChildren();
    PRACTICE.forEach((set, index) => {
      const button = el('button', 'unit-pick');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(index === practiceAt));
      const all = count(set) === set.tasks.length;
      button.append(
        el('span', 'unit-pick-title', set.unit),
        el('span', `unit-pick-count${all ? ' all' : ''}`, `${all ? '✓ ' : ''}${count(set)} / ${set.tasks.length}`),
        el('span', 'unit-pick-note', unitLearned(set, progress) ? '' : '수업을 아직 다 안 했어요'),
      );
      button.addEventListener('click', () => {
        practiceAt = index;
        renderPractice();
      });
      units.append(button);
    });

    const set = PRACTICE[practiceAt];
    $('practice-unit-title').textContent = set.unit;
    $('practice-unit-note').textContent = unitLearned(set, progress)
      ? '이 단원까지 배운 것으로 풀 수 있어요. 아무 문제나 골라요.'
      : '이 단원의 수업을 아직 다 하지 않았어요. 수업을 먼저 하면 풀기 쉬워요.';
    const list = $('practice-problems');
    list.replaceChildren();
    for (const task of set.tasks) {
      const done = Boolean(solved[task.id]);
      const button = el('button', `problem${done ? ' done' : ''}`);
      button.type = 'button';
      const tags = el('span', 'problem-tags');
      tags.append(el('span', 'tag', task.level));
      if (task.kind === '고치기') tags.append(el('span', 'tag', '고치기'));
      if (done) tags.append(el('span', 'tag solved', '풀었어요 · 다시 풀기'));
      button.append(el('span', 'lesson-mark', done ? '✓' : '·'), el('span', 'problem-title', task.title), el('span', 'problem-summary', task.summary), tags);
      button.addEventListener('click', () => startPractice(set, task));
      const item = el('li');
      item.append(button);
      list.append(item);
    }
  }

  /** 연습 문제 고르기 화면을 연다. 단원을 정해 주지 않으면, 수업을 끝낸 단원 가운데 안 푼 문제가 남은 가장 뒤 단원을 보여 준다. */
  function openPractice(index = practiceAt) {
    if (index == null) {
      const progress = store.get('kidpy.progress', {});
      const solved = store.get('kidpy.practice', {});
      const open = PRACTICE.map((set, i) => (unitLearned(set, progress) && set.tasks.some((task) => !solved[task.id]) ? i : -1)).filter((i) => i >= 0);
      index = open.length ? open[open.length - 1] : 0;
    }
    practiceAt = index;
    stopSpeaking();
    activeConsole = null;
    renderPractice();
    showScreen('practice');
  }

  /** 연습 문제 하나를 푼다. 다 풀면 선생님의 풀이를 보여 주고, 다음 문제로 갈지 목록으로 갈지 고른다. */
  async function startPractice(set, task) {
    if (!isReady()) return;
    mission = set;
    seed = Math.floor(Date.now() / 86400000);
    aborted = false;
    player.reset();
    setMuted(!$('sound').checked || speed > 1);
    $('where-line').textContent = `연습 문제 · ${set.unit}`;
    $('where-title').textContent = task.title;
    $('phases').hidden = true;
    $('to-home').textContent = '← 목록으로';
    showScreen('play');
    activeConsole = lessonConsole;
    activeCanvas = lessonCanvas;
    lessonCanvas.reset();
    showCanvas(lessonCanvas, Boolean(mission.canvas));
    currentPhase = 'practice';
    shownVars = {};
    showVars({});
    caption.textContent = '';
    show();
    log('practice-start', { set: set.id, task: task.id, sound: $('sound').checked });
    let next = null;
    try {
      await voicesReady();
      checkAbort();
      const result = await runTask(task, { firstWords: [task.kind === '고치기' ? 'practice-fix' : 'practice-intro'] });
      // 처음 푼 기록을 남긴다. 다시 풀어도 처음 기록은 그대로 둔다.
      const solved = store.get('kidpy.practice', {});
      if (!solved[task.id]) {
        solved[task.id] = { doneAt: new Date().toISOString(), attempts: result.attempts, hints: result.hints, first: result.first };
        store.set('kidpy.practice', solved);
      }
      log('practice-done', { set: set.id, task: task.id, attempts: result.attempts, hints: result.hints, first: result.first });
      currentPhase = 'done';
      // 모듈 탭이 있는 문제는 파일마다 이름을 붙여 함께 보여 준다
      const shownSolution = task.solutionModules ? withFileNames(task.solutionModules, task.solution) : task.solution;
      board.card({ title: '풀었어요 · 선생님의 풀이', items: ['다르게 풀어도 맞은 거예요. 내 코드와 견줘 봐요.'], code: shownSolution });
      flushLog();
      // 이 단원에서 아직 안 푼 문제가 있으면 이어서 풀 수 있다.
      // 버튼을 먼저 보여 주고, 선생님 말은 그동안 한다(말이 끝나기를 기다리게 하지 않는다).
      const rest = set.tasks.find((other) => !solved[other.id]);
      if (rest) show('to-list', 'next-problem');
      else show('to-list');
      background([line(mission, 'practice-done', seed)]);
      const pressed = await nextPress('to-list', 'next-problem');
      hush();
      if (pressed === 'next-problem') next = rest;
    } catch (error) {
      if (!(error instanceof Stop)) throw error;
      log('practice-abort', { set: set.id, task: task.id });
    }
    allowRun(false);
    draftSaving = null;
    currentPhase = 'home';
    if (next) await startPractice(set, next);
    else openPractice(PRACTICE.indexOf(set));
  }

  $('practice-home').addEventListener('click', () => goHome());

  $('to-home').addEventListener('click', () => {
    aborted = true;
    player.stop();
    runner.stop();
    lessonCanvas.stop();
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
    tabs: $('studio-editor-tabs'),
    onChange(code) {
      if (work && code !== work.code) touchWork({ code });
    },
    // 도구 파일(.py)은 내 파일에 있다. 모든 작품이 함께 쓴다(한 작품에서 고치면 다른 작품에서도 바뀐다).
    onModuleChange(name, code) {
      const files = { ...store.get(FILES_KEY, {}) };
      if (files[name] === code) return;
      files[name] = code;
      keepStudioFiles(files);
    },
    onAddModule: () => addStudioModule(),
    onRun: () => runStudio(),
  });

  /** "＋ 도구 파일": 이름을 물어서 빈 .py를 내 파일에 만들고 그 탭을 연다. */
  function addStudioModule() {
    const files = store.get(FILES_KEY, {});
    let suggestion = '도구.py';
    for (let n = 2; suggestion in files; n++) suggestion = `도구${n}.py`;
    const typed = prompt('도구 파일의 이름을 정해요. (글자로 시작하고, 빈칸 없이)', suggestion);
    if (typed == null) return;
    const name = /\.py$/.test(typed.trim()) ? typed.trim() : `${typed.trim()}.py`;
    if (!validModuleName(name)) {
      studioConsole.append(`\n"${typed}"는 도구 파일 이름으로 쓸 수 없어요. 글자로 시작하고, 빈칸이나 기호 없이 써요. 예: 도구.py\n`, 'ko');
      return;
    }
    if (name in files) {
      studioEditor.show(name);
      return;
    }
    keepStudioFiles({ ...files, [name]: '' });
    studioEditor.setModule(name, '');
    studioEditor.show(name);
    showStudioFiles(store.get(FILES_KEY, {}));
    log('studio-add-module', { name });
    studioEditor.focus();
  }

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
    const before = store.get(FILES_KEY, {});
    const ran = await runCode(studioEditor, studioConsole, { where: 'studio', work: work.id }, studioCanvas, Object.keys(before).length ? before : null);
    // 파일을 쓴 프로그램이면 남은 파일을 "내 파일"로 저장한다. 일꾼을 껐다 켰으면(files가 undefined) 앞의 것을 그대로 둔다.
    if (ran?.files) {
      const { kept, cut } = keepStudioFiles(ran.files);
      showStudioFiles(kept, before);
      // 프로그램이 .py 파일을 쓰거나 지웠으면 탭도 맞춘다
      const shownModules = studioEditor.getModules();
      const keptModules = splitFiles(kept).modules;
      if (JSON.stringify(Object.keys(shownModules).sort()) !== JSON.stringify(Object.keys(keptModules).sort())) studioEditor.setModules(keptModules);
      if (cut) studioConsole.append('\n■ 파일이 너무 커서 앞부분만 남겼어요\n', 'note');
    }
    refreshStudio();
    if (runner.state !== 'waiting-input') studioEditor.focus();
  }

  function openStudio(id) {
    if (screen !== 'home' || !isReady()) return;
    const works = store.get('kidpy.works', []);
    const found = works.find((w) => w.id === id);
    const numbers = works.map((w) => Number(/^내 프로그램 (\d+)$/.exec(w.name)?.[1] ?? 0));
    work = found ? { ...found } : { id: `w-${Date.now().toString(36)}`, name: `내 프로그램 ${Math.max(0, ...numbers) + 1}`, code: '', updatedAt: new Date().toISOString() };
    studioEditor.setModules(splitFiles(store.get(FILES_KEY, {})).modules);
    studioEditor.setCode(work.code);
    $('work-name').value = work.name;
    $('work-saved').textContent = found ? '저장됨' : '';
    studioConsole.clear();
    studioCanvas.reset();
    showCanvas(studioCanvas, usesTurtle(work.code));
    showStudioFiles(store.get(FILES_KEY, {}));
    showScreen('studio');
    activeConsole = studioConsole;
    activeCanvas = studioCanvas;
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
  if (import.meta.env.DEV) window.__kidpy = { editor, studioEditor, runner, player, lessonCanvas, studioCanvas };

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
