// 0단계 기술 확인용 시험판.
// 아이에게 보여 줄 화면이 아니다. 탭에서 실행·입력·멈춤·오프라인·기록 전송이 되는지 확인하려는 것이다.
import './style.css';
import { Runner } from './runner.js';
import { createEditor } from './editor.js';
import { AUTO_CHECKS, MANUAL_CHECKS } from './checks.js';
import { setupOffline } from './offline.js';
import { explain } from './errors-ko.js';
import { loadSync, saveSync, putFile, logPath } from './sync.js';

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

const EXAMPLES = {
  basic: '# 실행: Ctrl+Enter 또는 실행 버튼\n역 = ["노포", "범어사", "남산"]\nfor 번호, 이름 in enumerate(역, start=1):\n    print(번호, 이름)\n',
  input: '이름 = input("이름이 뭐예요? ")\n나이 = int(input("몇 살이에요? "))\nprint(이름, "님은 내년에", 나이 + 1, "살이에요")\n',
  forever: '# 끝나지 않는 프로그램. 멈춤 버튼으로 멈춰 보세요.\n수 = 0\nwhile True:\n    수 = 수 + 1\n    print(수)\n',
  error: '역 = ["노포", "범어사", "남산"]\nfor 이름 in 역\n    print(이름)\n',
};

// 출력 창에 남겨 두는 글자 수와, 한 번에 그리는 글자 수의 한도.
// 끝없이 출력하는 프로그램을 돌려도 화면이 굳지 않게 하려는 값이다.
const MAX_OUTPUT_CHARS = 60000;
const MAX_RENDER_CHARS = 30000;
const RENDER_EVERY_MS = 60;

async function main() {
  const statusEl = $('status');
  const out = $('out');
  const runButton = $('run');
  const stopButton = $('stop');
  const autoButton = $('autorun');
  const inputForm = $('inputform');
  const inputBox = $('inputbox');

  const offlineMode = await setupOffline();
  if (offlineMode === 'reloading') {
    statusEl.textContent = '처음 준비 중… (한 번 다시 읽어요)';
    return;
  }

  let build = null;
  if (offlineMode !== 'dev') {
    try {
      build = await (await fetch('./build.json', { cache: 'no-store' })).json();
    } catch {
      build = null;
    }
  }
  $('build').textContent = build ? `판 ${build.version}` : offlineMode === 'dev' ? '개발 서버' : '';

  // ---- 출력 창 ----
  let outputChars = 0;
  function appendOut(text, className) {
    if (!text) return;
    const span = document.createElement('span');
    if (className) span.className = className;
    span.textContent = text;
    out.append(span);
    outputChars += text.length;
    while (outputChars > MAX_OUTPUT_CHARS && out.firstChild && out.firstChild !== span) {
      outputChars -= out.firstChild.textContent.length;
      out.firstChild.remove();
    }
  }
  function scrollOut() {
    out.scrollTop = out.scrollHeight;
  }
  function clearOut() {
    out.textContent = '';
    outputChars = 0;
  }

  // 일꾼이 보낸 출력은 바로 그리지 않고 모았다가 60ms에 한 번 그린다.
  // 그린 뒤에야 일꾼에게 "받았다"고 알려서, 화면이 밀리면 일꾼이 보내기를 쉬게 한다.
  let pending = [];
  let renderTimer = null;
  function queueOut(chunks, dropped) {
    pending.push({ chunks, dropped });
    if (!renderTimer) renderTimer = setTimeout(renderOut, RENDER_EVERY_MS);
  }
  function renderOut() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = null;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    let skipped = 0;
    const pieces = [];
    for (const message of batch) {
      skipped += message.dropped;
      pieces.push(...message.chunks);
    }
    let total = pieces.reduce((sum, piece) => sum + piece.t.length, 0);
    while (total > MAX_RENDER_CHARS && pieces.length > 1) {
      const gone = pieces.shift();
      total -= gone.t.length;
      skipped += gone.t.length;
    }
    if (total > MAX_RENDER_CHARS) {
      const cut = pieces[0].t.length - MAX_RENDER_CHARS;
      pieces[0] = { s: pieces[0].s, t: pieces[0].t.slice(cut) };
      skipped += cut;
    }
    if (skipped) appendOut(`\n… (출력이 너무 많아서 ${skipped.toLocaleString()}글자를 건너뛰었어요) …\n`, 'note');
    for (const piece of pieces) appendOut(piece.t, piece.s === 'err' ? 'err' : '');
    scrollOut();
    runner.ack(batch.length);
  }

  // ---- 파이썬 일꾼 ----
  let capture = null; // 자동 점검 중이면 { inputs: [...] }
  let busy = false; // 자동 점검 중

  function refreshButtons() {
    const state = runner.state;
    runButton.disabled = busy || state !== 'ready';
    stopButton.disabled = busy || !(state === 'running' || state === 'waiting-input');
    autoButton.disabled = busy || state !== 'ready';
    const asking = state === 'waiting-input' && !capture;
    inputForm.hidden = !asking;
    if (asking) inputBox.focus();
  }

  const runner = new Runner({
    onOut(chunks, dropped) {
      // 자동 점검은 보통 화면에 그리지 않는다(바로 "받았다"고 알린다).
      if (capture && !capture.show) runner.ack(1);
      else queueOut(chunks, dropped);
    },
    onInput() {
      if (capture && capture.inputs.length) runner.provideInput(capture.inputs.shift());
    },
    onState(state, info) {
      if (state === 'loading') statusEl.textContent = '파이썬 준비 중…';
      else if (state === 'ready') statusEl.textContent = `준비됨 (준비 ${info.ms}ms)`;
      else if (state === 'running') statusEl.textContent = '실행 중';
      else if (state === 'waiting-input') statusEl.textContent = '입력을 기다리는 중';
      else if (state === 'failed') statusEl.textContent = `파이썬을 켜지 못했어요: ${info.message}`;
      refreshButtons();
    },
  });

  // ---- 편집기 ----
  let saveTimer = null;
  const editor = createEditor({
    parent: $('editor'),
    doc: store.get('kidpy.spike.code', EXAMPLES.basic),
    onChange(code) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => store.set('kidpy.spike.code', code), 300);
    },
    onRun: () => runFromEditor(),
  });
  // 닫기 직전에 한 번 더 저장한다(300ms를 기다리는 사이에 닫힐 수 있다).
  addEventListener('pagehide', () => store.set('kidpy.spike.code', editor.getCode()));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.set('kidpy.spike.code', editor.getCode());
  });

  async function runFromEditor() {
    if (busy || runner.state !== 'ready') return;
    clearOut();
    editor.markErrorLine(null);
    $('runinfo').textContent = '';
    const result = await runner.run(editor.getCode());
    renderOut(); // 아직 안 그린 출력을 먼저 그린다
    if (result.stopped) {
      appendOut(`\n■ 멈췄어요${result.hardStop ? ' (실행기를 다시 켜는 중)' : ''}\n`, 'note');
    } else if (result.error) {
      const where = result.error.line ? ` (${result.error.line}번 줄)` : '';
      appendOut(`\n${explain(result.error)}${where}\n`, 'ko');
      appendOut(result.error.text, 'err');
      if (result.error.line) editor.markErrorLine(result.error.line);
    }
    scrollOut();
    $('runinfo').textContent = `${result.ms}ms`;
    editor.focus();
  }

  runButton.addEventListener('click', runFromEditor);
  stopButton.addEventListener('click', () => runner.stop());
  inputForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = inputBox.value;
    inputBox.value = '';
    renderOut();
    appendOut(`${text}\n`, 'typed');
    scrollOut();
    runner.provideInput(text);
  });
  for (const button of document.querySelectorAll('[data-example]')) {
    button.addEventListener('click', () => {
      editor.setCode(EXAMPLES[button.dataset.example]);
      editor.focus();
    });
  }

  // ---- 자동 점검 ----
  const autoResults = new Map();
  const autoList = $('autolist');
  const autoRows = new Map();
  for (const check of AUTO_CHECKS) {
    const item = document.createElement('li');
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = '·';
    const title = document.createElement('span');
    title.textContent = check.title;
    const detail = document.createElement('span');
    detail.className = 'detail';
    item.append(mark, title, detail);
    autoList.append(item);
    autoRows.set(check.id, { mark, detail });
  }

  function showAuto(id, result) {
    const row = autoRows.get(id);
    row.mark.className = `mark ${result.pass === true ? 'pass' : result.pass === false ? 'fail' : ''}`;
    row.mark.textContent = result.pass === true ? '✓' : result.pass === false ? '✗' : '–';
    row.detail.textContent = result.detail;
  }

  // show: true면 실제 사용 때처럼 출력 창에 그린다(화면이 굳는지 보려는 점검에 쓴다).
  async function exec(code, { inputs = [], stopAfterMs = null, show = false } = {}) {
    capture = { inputs: [...inputs], show };
    if (show) clearOut();
    const started = performance.now();
    const timer = stopAfterMs == null ? null : setTimeout(() => runner.stop(), stopAfterMs);
    try {
      const result = await runner.run(code);
      result.wallMs = Math.round(performance.now() - started);
      if (show) {
        renderOut();
        result.shownChars = out.textContent.length;
        clearOut();
      }
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      capture = null;
    }
  }

  const context = {
    runner,
    exec,
    offlineMode,
    loadHistory: () => store.get('kidpy.spike.loads', []),
  };

  autoButton.addEventListener('click', async () => {
    busy = true;
    refreshButtons();
    for (const check of AUTO_CHECKS) {
      autoRows.get(check.id).mark.textContent = '…';
      let result;
      try {
        result = await check.run(context);
      } catch (error) {
        result = { pass: false, detail: `점검 중 오류: ${error.message}` };
      }
      autoResults.set(check.id, result);
      showAuto(check.id, result);
    }
    busy = false;
    refreshButtons();
    renderSummary();
  });

  // ---- 직접 해 보는 점검 ----
  const manual = store.get('kidpy.spike.manual', {});
  const manualList = $('manuallist');
  for (const check of MANUAL_CHECKS) {
    const item = document.createElement('li');
    const mark = document.createElement('span');
    mark.className = 'mark';
    const title = document.createElement('span');
    title.textContent = check.title;
    const hint = document.createElement('span');
    hint.className = 'detail';
    hint.textContent = check.hint;
    const choices = document.createElement('span');
    choices.className = 'choices';
    const buttons = [];
    const paint = () => {
      const value = manual[check.id];
      mark.className = `mark ${value === 'yes' ? 'pass' : value === 'no' ? 'fail' : ''}`;
      mark.textContent = value === 'yes' ? '✓' : value === 'no' ? '✗' : '·';
      for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.value === value));
    };
    for (const [value, label] of [['yes', '됨'], ['no', '안 됨']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.value = value;
      button.textContent = label;
      button.addEventListener('click', () => {
        manual[check.id] = manual[check.id] === value ? undefined : value;
        store.set('kidpy.spike.manual', manual);
        paint();
        renderSummary();
      });
      buttons.push(button);
      choices.append(button);
    }
    item.append(mark, title, hint, choices);
    manualList.append(item);
    paint();
  }

  const notes = $('notes');
  notes.value = store.get('kidpy.spike.notes', '');
  notes.addEventListener('input', () => {
    store.set('kidpy.spike.notes', notes.value);
    renderSummary();
  });

  // ---- 결과 ----
  function report() {
    return {
      kind: 'kidpy-spike-report',
      at: new Date().toISOString(),
      build: build ? build.version : offlineMode,
      device: navigator.userAgent,
      loads: store.get('kidpy.spike.loads', []),
      hardStops: runner.hardStops,
      auto: AUTO_CHECKS.map((check) => ({ id: check.id, title: check.title, ...(autoResults.get(check.id) || { pass: null, detail: '아직 안 함' }) })),
      manual: MANUAL_CHECKS.map((check) => ({ id: check.id, title: check.title, result: manual[check.id] || 'not-yet' })),
      notes: notes.value,
    };
  }

  function summaryText() {
    const data = report();
    const mark = (pass) => (pass === true ? '[통과]' : pass === false ? '[실패]' : '[ -- ]');
    const lines = [
      '파이썬 시험판 점검 결과',
      `시각: ${data.at}`,
      `판: ${data.build}`,
      `기기: ${data.device}`,
      '',
      '자동 점검',
      ...data.auto.map((row) => `${mark(row.pass)} ${row.title}: ${row.detail}`),
      '',
      '직접 해 본 점검',
      ...data.manual.map((row) => `${row.result === 'yes' ? '[ 됨 ]' : row.result === 'no' ? '[안 됨]' : '[아직]'} ${row.title}`),
      '',
      `메모: ${data.notes || '(없음)'}`,
    ];
    return lines.join('\n');
  }

  function renderSummary() {
    $('summary').textContent = summaryText();
  }

  $('copy').addEventListener('click', async () => {
    const status = $('resultstatus');
    try {
      await navigator.clipboard.writeText(summaryText());
      status.textContent = '복사했어요. 대화창에 붙여 넣어 주세요.';
    } catch {
      const range = document.createRange();
      range.selectNodeContents($('summary'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      status.textContent = '아래 글을 골라 두었어요. 복사해서 붙여 넣어 주세요.';
    }
  });

  // ---- 기록 전송 시험 ----
  const sync = loadSync();
  $('repo').value = sync.repo;
  $('token').placeholder = sync.token ? '저장된 키가 있어요 (바꾸려면 새로 입력)' : '';
  const syncStatus = $('syncstatus');

  function currentSync() {
    return { repo: $('repo').value, token: $('token').value || sync.token };
  }

  $('syncform').addEventListener('submit', (event) => {
    event.preventDefault();
    const next = currentSync();
    const saved = saveSync(next);
    sync.repo = next.repo.trim();
    sync.token = next.token.trim();
    $('token').value = '';
    $('token').placeholder = sync.token ? '저장된 키가 있어요 (바꾸려면 새로 입력)' : '';
    syncStatus.textContent = saved ? '이 기기에 저장했어요.' : '저장하지 못했어요.';
  });

  $('synctest').addEventListener('click', async () => {
    syncStatus.textContent = '보내는 중…';
    const path = logPath('spike-test');
    const result = await putFile(currentSync(), path, JSON.stringify({ kind: 'kidpy-sync-test', at: new Date().toISOString() }, null, 2), '기록 전송 시험');
    syncStatus.textContent = result.ok ? `보냈어요: ${result.detail}` : `보내지 못했어요 (${result.status || '연결 안 됨'}) ${result.detail}`;
    manual.sync = result.ok ? 'yes' : 'no';
  });

  $('send').addEventListener('click', async () => {
    const status = $('resultstatus');
    status.textContent = '보내는 중…';
    const result = await putFile(currentSync(), logPath('spike-report'), JSON.stringify(report(), null, 2), '시험판 점검 결과');
    status.textContent = result.ok ? `보냈어요: ${result.detail}` : `보내지 못했어요 (${result.status || '연결 안 됨'}) ${result.detail}`;
  });

  renderSummary();
  refreshButtons();

  // ---- 시작 ----
  try {
    const info = await runner.start();
    const loads = store.get('kidpy.spike.loads', []);
    loads.push(info.ms);
    store.set('kidpy.spike.loads', loads.slice(-10));
  } catch {
    // 상태 줄에 이유가 이미 표시된다.
  }
}

main();
