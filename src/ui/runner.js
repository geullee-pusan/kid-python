// 파이썬 일꾼을 켜고, 코드를 보내고, 멈추고, 입력을 넘겨 준다.

const STOP_GRACE_MS = 1500;
const INPUT_BYTES = 64 * 1024;

export class Runner {
  /**
   * @param {{ onOut: (chunks: {s: 'out'|'err', t: string}[], dropped: number) => void,
   *           onInput: () => void,
   *           onState: (state: 'loading'|'ready'|'running'|'waiting-input'|'failed', info?: object) => void }} hooks
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.worker = null;
    this.state = 'loading';
    this.ready = null;
    this.info = null;
    this.current = null;
    this.nextId = 1;
    this.hardStops = 0;
    // 함께 쓰는 메모리는 "교차 출처 격리"가 된 페이지에서만 쓸 수 있다.
    this.shared = typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
  }

  start() {
    this.setState('loading');
    this.interrupt = this.shared ? new SharedArrayBuffer(1) : null;
    this.inputCtlBuffer = this.shared ? new SharedArrayBuffer(8) : null;
    this.inputBytesBuffer = this.shared ? new SharedArrayBuffer(INPUT_BYTES) : null;
    this.interruptView = this.interrupt ? new Uint8Array(this.interrupt) : null;
    this.inputCtl = this.inputCtlBuffer ? new Int32Array(this.inputCtlBuffer) : null;
    this.inputBytes = this.inputBytesBuffer ? new Uint8Array(this.inputBytesBuffer) : null;
    // 화면이 출력을 몇 번 그렸는지 일꾼에게 알려 주는 칸. 일꾼은 화면이 밀리면 보내기를 쉰다.
    this.flowBuffer = this.shared ? new SharedArrayBuffer(4) : null;
    this.flow = this.flowBuffer ? new Int32Array(this.flowBuffer) : null;

    const worker = new Worker(new URL('py-worker.js', document.baseURI), { type: 'module' });
    this.worker = worker;
    this.ready = new Promise((resolve, reject) => {
      worker.onmessage = (event) => this.onMessage(event.data, resolve, reject);
      worker.onerror = (event) => {
        const message = event.message || '일꾼을 켜지 못했어요';
        this.setState('failed', { message });
        reject(new Error(message));
      };
    });
    worker.postMessage({
      type: 'init',
      interrupt: this.interrupt,
      inputCtl: this.inputCtlBuffer,
      inputBytes: this.inputBytesBuffer,
      flow: this.flowBuffer,
    });
    return this.ready;
  }

  /** 화면이 출력 묶음을 count개 그렸다고 일꾼에게 알린다. */
  ack(count) {
    if (this.flow && count > 0) Atomics.add(this.flow, 0, count);
  }

  onMessage(message, resolveReady, rejectReady) {
    if (message.type === 'ready') {
      this.info = message;
      this.setState('ready', message);
      resolveReady(message);
    } else if (message.type === 'failed') {
      this.setState('failed', message);
      rejectReady(new Error(message.message));
    } else if (message.type === 'out') {
      if (this.current) {
        for (const chunk of message.chunks) this.current.output += chunk.t;
      }
      // onOut을 받은 쪽은 다 그린 뒤 ack()를 불러야 한다.
      // 그리기 명령은 출력과 같은 묶음에 실려 온다. 그림판이 받아서 차례로 그린다.
      if (message.draws?.length) {
        const cmds = message.draws.map((text) => JSON.parse(text));
        if (this.current) this.current.draws.push(...cmds);
        this.hooks.onDraw?.(cmds);
      }
      this.hooks.onOut(message.chunks, message.dropped);
    } else if (message.type === 'input') {
      this.setState('waiting-input');
      this.hooks.onInput();
    } else if (message.type === 'done') {
      const current = this.current;
      if (!current || current.id !== message.id) return;
      this.finish({ error: message.error, ms: message.ms, hardStop: false, steps: message.steps, output: message.output, vars: message.vars, unused: message.unused, draw: message.draw });
    }
  }

  setState(state, info) {
    this.state = state;
    this.hooks.onState(state, info);
  }

  /**
   * 코드를 돌린다. 끝나면 { ok, stopped, hardStop, error, ms, output }을 돌려준다.
   * trace: true면 화면에 내보내지 않고, 줄마다 무엇이 나왔는지와 변수 값을 steps: [{ line, out, vars }]로 함께 돌려준다.
   * check: true면 채점용으로 돌린다(화면에 내보내지 않고, 질문 글은 출력에 넣지 않는다).
   * inputs: trace와 check에서 input()이 받을 답들. 다 쓰고도 또 물으면 EOFError가 난다. 남으면 unused에 개수가 온다.
   * limit: trace에서 보여 줄 줄 수의 한도(넘으면 오류 종류가 TraceLimit). 끝나지 않는 반복을 시연할 때 작게 준다.
   * randoms: trace와 check에서 random.randint가 차례로 돌려줄 값들(무작위 수를 쓰는 프로그램을 늘 같게 돌리려고).
   * check에서 프로그램이 끝나지 않으면(줄을 20만 번 넘게 실행하면) 오류 종류가 TraceLimit으로 온다.
   */
  async run(code, { trace = false, check = false, inputs = [], limit, randoms } = {}) {
    await this.ready;
    if (this.current) throw new Error('이미 돌아가는 프로그램이 있어요');
    const id = this.nextId++;
    this.setState('running');
    return new Promise((resolve) => {
      this.current = { id, resolve, output: '', draws: [], stopRequested: false, stopTimer: null, started: performance.now() };
      this.worker.postMessage({ type: 'run', id, code, mode: trace ? 'trace' : check ? 'check' : 'run', inputs, limit, randoms });
    });
  }

  finish({ error, ms, hardStop, steps = null, output = null, vars = {}, unused = 0, draw = null }) {
    const current = this.current;
    this.current = null;
    if (current.stopTimer) clearTimeout(current.stopTimer);
    const stopped = current.stopRequested;
    if (!hardStop) this.setState('ready', this.info);
    current.resolve({
      ok: !error && !stopped,
      stopped,
      hardStop,
      // 멈춤을 눌러서 난 오류(KeyboardInterrupt, EOFError)는 오류로 보여 주지 않는다.
      error: stopped ? null : error,
      ms,
      output: output ?? current.output,
      steps,
      vars,
      unused,
      // 프로그램이 그린 것 전부(그림판 명령 목록). 그냥 실행에서는 화면으로 보낸 것을 모아 둔 것이다.
      draw: draw ?? current.draws,
    });
  }

  /** 돌아가는 프로그램을 멈춘다. 부드럽게 안 멈추면 일꾼을 껐다 켠다. */
  stop() {
    const current = this.current;
    if (!current || current.stopRequested) return;
    current.stopRequested = true;
    if (this.shared) {
      this.interruptView[0] = 2; // SIGINT
      Atomics.store(this.inputCtl, 0, 2); // 입력을 기다리는 중이면 깨운다
      Atomics.notify(this.inputCtl, 0);
      current.stopTimer = setTimeout(() => this.hardStop(), STOP_GRACE_MS);
    } else {
      this.hardStop();
    }
  }

  hardStop() {
    const current = this.current;
    if (!current) return;
    this.hardStops += 1;
    this.worker.terminate();
    const ms = Math.round(performance.now() - current.started);
    this.finish({ error: null, ms, hardStop: true });
    this.start().catch(() => {});
  }

  /** input()에 답을 넘긴다. */
  provideInput(text) {
    if (!this.shared || this.state !== 'waiting-input') return false;
    const bytes = new TextEncoder().encode(text).slice(0, INPUT_BYTES);
    this.inputBytes.set(bytes);
    Atomics.store(this.inputCtl, 1, bytes.length);
    Atomics.store(this.inputCtl, 0, 1);
    Atomics.notify(this.inputCtl, 0);
    this.setState('running');
    return true;
  }
}
