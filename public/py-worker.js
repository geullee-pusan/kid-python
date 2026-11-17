// 파이썬을 돌리는 일꾼(웹 워커).
// 화면과 따로 돌기 때문에 프로그램이 끝나지 않아도 화면은 멈추지 않는다.
// 이 파일은 묶지 않고 그대로 배포한다(실행기 파일과 같은 자리에 있어야 주소가 맞는다).
import { loadPyodide } from './pyodide/pyodide.mjs';

let pyodide = null;
let runUser = null;
let runScripted = null;
let interruptView = null; // 화면이 2를 써 넣으면 파이썬에 KeyboardInterrupt가 난다
let inputCtl = null; // [상태, 길이]. 상태 0 = 기다림, 1 = 입력 있음, 2 = 그만
let inputBytes = null; // 입력 글자(UTF-8)

// ---- 출력 모으기 ----
// print를 끝없이 하는 프로그램이 화면을 얼리지 않게 세 가지를 한다.
// 1. 50ms에 한 번만 보낸다.
// 2. 화면이 앞에 보낸 것을 아직 못 그렸으면 보내지 않고 기다린다(flow: 화면이 그린 횟수를 적어 주는 함께 쓰는 메모리).
// 3. 기다리는 동안 너무 많이 쌓이면 앞을 버린다.
const MAX_QUEUED = 20000;
const FLUSH_EVERY_MS = 50;
let queue = [];
let queued = 0;
let dropped = 0;
let lastFlush = 0;
let flow = null;
let sent = 0;

function flush(force = false) {
  if (!queue.length && !dropped) return;
  if (!force && flow && sent - Atomics.load(flow, 0) >= 2) return;
  postMessage({ type: 'out', chunks: queue, dropped });
  sent += 1;
  queue = [];
  queued = 0;
  dropped = 0;
  lastFlush = performance.now();
}

function emit(stream, text) {
  if (!text) return;
  const last = queue[queue.length - 1];
  if (last && last.s === stream) last.t += text;
  else queue.push({ s: stream, t: text });
  queued += text.length;
  while (queued > MAX_QUEUED && queue.length > 1) {
    const gone = queue.shift();
    queued -= gone.t.length;
    dropped += gone.t.length;
  }
  if (queued > MAX_QUEUED) {
    const only = queue[0];
    const cut = only.t.length - MAX_QUEUED;
    only.t = only.t.slice(cut);
    queued -= cut;
    dropped += cut;
  }
  if (performance.now() - lastFlush >= FLUSH_EVERY_MS) flush();
}

function makeWriter(stream) {
  const decoder = new TextDecoder();
  return {
    // 터미널처럼 보이게 해서 파이썬이 줄마다 바로 내보내게 한다.
    isatty: true,
    write(buffer) {
      emit(stream, decoder.decode(buffer, { stream: true }));
      return buffer.length;
    },
  };
}

// ---- 입력 받기 ----
// 파이썬의 input()은 답이 올 때까지 그 자리에서 멈춰 있어야 한다.
// 화면에 "입력이 필요해요"라고 알리고, 함께 쓰는 메모리에 답이 적힐 때까지 잠든다.
function readLine() {
  flush(true); // 질문 글이 먼저 보여야 한다
  if (!inputCtl) return null; // 함께 쓰는 메모리가 없으면 입력을 받을 수 없다(EOFError)
  postMessage({ type: 'input' });
  Atomics.wait(inputCtl, 0, 0);
  const state = Atomics.load(inputCtl, 0);
  if (state !== 1) return null; // 멈춤
  const length = Atomics.load(inputCtl, 1);
  const text = new TextDecoder().decode(inputBytes.slice(0, length));
  Atomics.store(inputCtl, 0, 0);
  return text + '\n';
}

// ---- 파이썬 쪽 실행 함수 ----
// 실행할 때마다 새 이름 공간을 쓴다(앞에서 만든 변수가 남지 않는다).
// 오류가 나면 종류, 한 줄 설명, 줄 번호, 파이썬이 원래 보여 주는 글을 돌려준다.
// 돌리는 방법은 세 가지다.
//  - 그냥 실행(__kidpy_run): 아이가 실행 버튼을 눌렀을 때. 출력은 바로 화면으로 가고, input()은 아이의 답을 기다린다.
//  - 한 줄씩 보기(__kidpy_scripted, trace=True): 강의 시연과 예측 문제 확인. 줄마다 출력과 변수 값을 적어 둔다.
//    input()에는 대본에 적힌 답을 넣고, 질문과 답이 출력에 함께 보이게 한다.
//  - 채점(__kidpy_scripted, trace=False): 쓰기 문제를 정해진 입력으로 돌린다. 질문 글은 출력에 넣지 않는다.
const RUNNER_SOURCE = `
import sys, json, traceback, linecache, io
import random as __kidpy_random

def __kidpy_error(e, name):
    line = None
    col = None
    message = str(e)
    if isinstance(e, SyntaxError) and e.filename == name:
        line, col, message = e.lineno, e.offset, e.msg
        text = "".join(traceback.format_exception_only(type(e), e))
    else:
        tb = e.__traceback__.tb_next if e.__traceback__ else None
        for frame in traceback.extract_tb(tb):
            if frame.filename == name:
                line = frame.lineno
        text = "".join(traceback.format_exception(type(e), e, tb))
    return {"type": type(e).__name__, "message": message, "line": line, "col": col, "text": text}

# 변수 표에 보여 줄 값들. 글자는 따옴표를 붙여서(큰따옴표로) 숫자와 구분되게 한다.
def __kidpy_vars(scope):
    out = {}
    for key, value in list(scope.items()):
        if key.startswith("__") or callable(value) or isinstance(value, type(sys)):
            continue
        try:
            # 글자와 리스트는 아이가 치는 모양 그대로(큰따옴표로) 보여 준다. 리스트 안에 True 같은 값이 있으면 파이썬 모양으로.
            if isinstance(value, str):
                text = json.dumps(value, ensure_ascii=False)
            elif isinstance(value, list) and all(isinstance(x, (str, int, float)) and not isinstance(x, bool) for x in value):
                text = json.dumps(value, ensure_ascii=False)
            else:
                text = repr(value)
        except Exception:
            text = "?"
        if len(text) > 48:
            text = text[:45] + "..."
        out[key] = text
    return out

def __kidpy_run(code):
    name = "main.py"
    linecache.cache[name] = (len(code), None, code.splitlines(True), name)
    scope = {"__name__": "__main__"}
    error = None
    try:
        exec(compile(code, name, "exec"), scope)
    except SystemExit:
        pass
    except BaseException as e:
        error = __kidpy_error(e, name)
    finally:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except BaseException:
            pass
    return json.dumps({"error": error, "vars": __kidpy_vars(scope)})

class __KidpyTraceLimit(Exception):
    pass

# limit: 한 줄씩 보기에서 보여 줄 줄 수의 한도. 넘으면 TraceLimit(끝나지 않는 반복을 시연할 때는 작게 준다).
# randoms_json: 무작위 수를 정해 둘 때 쓴다. 비어 있지 않으면 random.randint가 이 값들을 차례로 돌려준다(채점과 시연이 늘 같게).
# 채점(trace=False)에서도 줄 수를 세어, 너무 많으면(끝나지 않는 반복) TraceLimit으로 멈춘다.
def __kidpy_scripted(code, inputs_json, trace, limit=300, randoms_json="[]"):
    name = "main.py"
    linecache.cache[name] = (len(code), None, code.splitlines(True), name)
    scope = {"__name__": "__main__"}
    inputs = [str(x) for x in json.loads(inputs_json)]
    randoms = list(json.loads(randoms_json))
    asked = [0]
    buf = io.StringIO()
    marks = []
    lines_run = [0]
    picked = [0]
    def scripted_randint(a, b):
        value = randoms[picked[0] % len(randoms)]
        picked[0] += 1
        return value
    def counter(frame, event, arg):
        if frame.f_code.co_filename != name:
            return None
        if event == "line":
            lines_run[0] += 1
            if lines_run[0] > 200000:
                raise __KidpyTraceLimit()
        return counter
    # input() 대신 쓰는 함수. 한 줄씩 보기에서는 질문과 답을 출력에 남긴다(답은 \\x01 ... \\x02 로 감싸 표시한다).
    def scripted_input(prompt=""):
        asked[0] += 1
        if not inputs:
            raise EOFError("no more input")
        value = inputs.pop(0)
        if trace:
            buf.write(str(prompt))
            buf.write(chr(1) + value + chr(2) + chr(10))
        return value
    scope["input"] = scripted_input
    def tracer(frame, event, arg):
        if frame.f_code.co_filename != name:
            return None
        if event == "line":
            if len(marks) >= limit:
                raise __KidpyTraceLimit()
            marks.append((frame.f_lineno, len(buf.getvalue()), __kidpy_vars(frame.f_globals)))
        return tracer
    error = None
    old = sys.stdout
    sys.stdout = buf
    old_randint = __kidpy_random.randint
    if randoms:
        __kidpy_random.randint = scripted_randint
    try:
        compiled = compile(code, name, "exec")
        sys.settrace(tracer if trace else counter)
        try:
            exec(compiled, scope)
        finally:
            sys.settrace(None)
    except SystemExit:
        pass
    except __KidpyTraceLimit:
        error = {"type": "TraceLimit", "message": "too many steps", "line": None, "col": None, "text": ""}
    except BaseException as e:
        error = __kidpy_error(e, name)
    finally:
        sys.stdout = old
        __kidpy_random.randint = old_randint
    total = buf.getvalue()
    final = __kidpy_vars(scope)
    steps = []
    for i, (line, pos, _) in enumerate(marks):
        end = marks[i + 1][1] if i + 1 < len(marks) else len(total)
        # 이 줄을 실행한 뒤의 변수 값 = 다음 줄을 실행하기 직전의 값(마지막 줄이면 끝났을 때의 값)
        after = marks[i + 1][2] if i + 1 < len(marks) else final
        steps.append({"line": line, "out": total[pos:end], "vars": after})
    return json.dumps({"steps": steps, "output": total, "error": error, "vars": final, "asked": asked[0], "unused": len(inputs)})
`;

async function init(message) {
  const started = performance.now();
  if (message.interrupt) interruptView = new Uint8Array(message.interrupt);
  if (message.inputCtl) {
    inputCtl = new Int32Array(message.inputCtl);
    inputBytes = new Uint8Array(message.inputBytes);
  }
  if (message.flow) flow = new Int32Array(message.flow);
  pyodide = await loadPyodide({ indexURL: new URL('./pyodide/', self.location.href).href });
  pyodide.setStdout(makeWriter('out'));
  pyodide.setStderr(makeWriter('err'));
  pyodide.setStdin({ stdin: readLine, isatty: false });
  if (interruptView) pyodide.setInterruptBuffer(interruptView);
  pyodide.runPython(RUNNER_SOURCE);
  runUser = pyodide.globals.get('__kidpy_run');
  runScripted = pyodide.globals.get('__kidpy_scripted');
  const python = pyodide.runPython('import sys; sys.version.split()[0]');
  postMessage({
    type: 'ready',
    ms: Math.round(performance.now() - started),
    pyodide: pyodide.version,
    python,
    shared: Boolean(interruptView && inputCtl),
  });
}

// message.mode: 'run'(그냥 실행), 'trace'(한 줄씩 보기), 'check'(채점). trace와 check는 message.inputs를 input()의 답으로 쓴다.
// message.limit(한 줄씩 보기의 줄 수 한도)와 message.randoms(정해 둔 무작위 수)는 없어도 된다.
function run(message) {
  const started = performance.now();
  if (interruptView) interruptView[0] = 0;
  if (inputCtl) Atomics.store(inputCtl, 0, 0);
  let result = { error: null };
  try {
    if (message.mode === 'trace' || message.mode === 'check') {
      result = JSON.parse(
        runScripted(message.code, JSON.stringify(message.inputs ?? []), message.mode === 'trace', message.limit ?? 300, JSON.stringify(message.randoms ?? [])),
      );
    } else {
      result = JSON.parse(runUser(message.code));
    }
  } catch (e) {
    // 여기로 오면 파이썬 안에서 잡지 못한 오류다(실행기 자체의 문제일 수 있다).
    result = { error: { type: e && e.type ? e.type : 'InternalError', message: String(e && e.message ? e.message : e), line: null, col: null, text: String(e) } };
  }
  if (interruptView) interruptView[0] = 0;
  flush(true); // 마지막 출력은 꼭 보낸다
  postMessage({
    type: 'done',
    id: message.id,
    error: result.error ?? null,
    steps: result.steps ?? null,
    output: result.output ?? null,
    vars: result.vars ?? {},
    unused: result.unused ?? 0,
    ms: Math.round(performance.now() - started),
  });
}

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    init(message).catch((e) => postMessage({ type: 'failed', message: String(e && e.stack ? e.stack : e) }));
  } else if (message.type === 'run') {
    run(message);
  }
};
