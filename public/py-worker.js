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
// 눌린 키: 화면이 [0]에 지금까지 넣은 개수를, [1 + n % KEY_SLOTS]에 키 번호를 적는다(뗀 것은 1000을 더한다).
let keyView = null;
let keysRead = 0;
const KEY_SLOTS = 250;
const KEY_NAMES = ['Left', 'Right', 'Up', 'Down', 'space', 'Return', ...'abcdefghijklmnopqrstuvwxyz0123456789'];

// ---- 출력 모으기 ----
// print를 끝없이 하는 프로그램이 화면을 얼리지 않게 세 가지를 한다.
// 1. 50ms에 한 번만 보낸다.
// 2. 화면이 앞에 보낸 것을 아직 못 그렸으면 보내지 않고 기다린다(flow: 화면이 그린 횟수를 적어 주는 함께 쓰는 메모리).
// 3. 기다리는 동안 너무 많이 쌓이면 앞을 버린다.
const MAX_QUEUED = 20000;
const FLUSH_EVERY_MS = 50;
let queue = [];
let drawQueue = []; // 그리기 명령(JSON 글자). 출력과 같은 묶음에 실어 보낸다.
let queued = 0;
let dropped = 0;
let lastFlush = 0;
let flow = null;
let sent = 0;

function flush(force = false) {
  if (!queue.length && !dropped && !drawQueue.length) return;
  if (!force && flow && sent - Atomics.load(flow, 0) >= 2) return;
  postMessage({ type: 'out', chunks: queue, dropped, draws: drawQueue });
  sent += 1;
  queue = [];
  drawQueue = [];
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

/** 그사이 눌린 키들을 파이썬에 넘겨준다: [["press", "Left"], ["release", "Left"], …]의 JSON */
function pollKeys() {
  if (!keyView) return '[]';
  const written = Atomics.load(keyView, 0);
  // 너무 많이 밀렸으면(프로그램이 오래 안 받았으면) 오래된 것은 버린다.
  if (written - keysRead > KEY_SLOTS) keysRead = written - KEY_SLOTS;
  const events = [];
  for (; keysRead < written; keysRead += 1) {
    const code = Atomics.load(keyView, 1 + (keysRead % KEY_SLOTS));
    const name = KEY_NAMES[code % 1000];
    if (name) events.push([code >= 1000 ? 'release' : 'press', name]);
  }
  return JSON.stringify(events);
}

/** 파이썬의 turtle 명령이 그릴 것을 하나씩 넘겨준다(그냥 실행일 때만). */
function emitDraw(text) {
  drawQueue.push(text);
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
        mine = [frame for frame in traceback.extract_tb(tb) if frame.filename == name]
        for frame in mine:
            line = frame.lineno
        if mine:
            # 아이가 쓴 코드의 줄만 보여 준다(그림판 명령처럼 안쪽에서 난 오류의 속 줄은 감춘다).
            text = "Traceback (most recent call last):" + chr(10) + "".join(traceback.format_list(mine)) + "".join(traceback.format_exception_only(type(e), e))
        else:
            text = "".join(traceback.format_exception(type(e), e, tb))
    # 클래스 안의 함수에서 self. 을 빼먹고 이름만 쓴 경우를 알아본다(그 객체에 그 이름의 값이 있을 때): hint = "self.점수"
    hint = None
    if isinstance(e, NameError):
        last = None
        tb = e.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == name:
                last = tb.tb_frame
            tb = tb.tb_next
        parts = str(e).split("'")
        if last is not None and len(parts) > 1:
            me = last.f_locals.get("self")
            if me is not None and parts[1] in getattr(me, "__dict__", {}):
                hint = "self." + parts[1]
    return {"type": type(e).__name__, "message": message, "line": line, "col": col, "text": text, "hint": hint}

# 값을 아이가 치는 모양으로: 파이썬의 repr과 같되 글자는 큰따옴표로. 튜플 ("하늘", 90), 집합 {"감", "배"}.
# 그렇게 쓸 수 없는 값(객체, 함수 같은 것)이 들어 있으면 None.
def __kidpy_typed(value, depth=0):
    if depth > 6:
        return None
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if value is None or isinstance(value, (bool, int, float)):
        return repr(value)
    kind = type(value)
    if kind in (list, tuple, set, frozenset, dict):
        if kind is dict:
            parts = []
            for k, v in value.items():
                a, b = __kidpy_typed(k, depth + 1), __kidpy_typed(v, depth + 1)
                if a is None or b is None:
                    return None
                parts.append(a + ": " + b)
            return "{" + ", ".join(parts) + "}"
        parts = [__kidpy_typed(x, depth + 1) for x in value]
        if None in parts:
            return None
        inner = ", ".join(parts)
        if kind is list:
            return "[" + inner + "]"
        if kind is tuple:
            return "(" + inner + ("," if len(parts) == 1 else "") + ")"
        if not parts:
            return "set()" if kind is set else "frozenset()"
        return "{" + inner + "}" if kind is set else "frozenset({" + inner + "})"
    return None

# 아이가 만든 클래스의 객체인가. 파이썬은 <__main__.공 object at 0x...>라고만 보여 줘서 안에 든 값을 알 수 없다.
# (거북이처럼 보여 줄 모양을 스스로 정한 것은 그 모양대로 둔다.)
def __kidpy_is_object(value):
    cls = type(value)
    return (not isinstance(value, type)) and cls.__module__ == "__main__" and cls.__repr__ is object.__repr__ and hasattr(value, "__dict__") and not isinstance(value, BaseException)

# 객체 안에 든 값 하나를 짧게: 글자는 따옴표로, 다른 객체는 <이름>으로만.
def __kidpy_brief(value):
    if __kidpy_is_object(value):
        text = "<" + type(value).__name__ + ">"
    else:
        text = __kidpy_typed(value)
        if text is None:
            text = repr(value)
    return text if len(text) <= 24 else text[:21] + "..."

# 객체는 공(x=0, dx=3)처럼, 클래스 이름과 그 안에 든 이름·값으로 보여 준다.
def __kidpy_object(value):
    parts = [k + "=" + __kidpy_brief(v) for k, v in vars(value).items() if not k.startswith("__")]
    return type(value).__name__ + "(" + ", ".join(parts) + ")"

# local: 함수 안에서만 보이는 이름들. 그 가운데 바깥의 이름표가 가리키는 바로 그 객체가 있으면(self가 대개 그렇다)
# 안의 값을 되풀이하지 않고 그 이름표의 이름을 보여 준다: self → 가
def __kidpy_vars(scope, local=None):
    out = {}
    for key, value in list(scope.items()):
        if key.startswith("__") or callable(value) or isinstance(value, type(sys)):
            continue
        limit = 48
        try:
            # 글자와 리스트는 아이가 치는 모양 그대로(큰따옴표로) 보여 준다. 리스트 안에 True 같은 값이 있으면 파이썬 모양으로.
            if __kidpy_is_object(value):
                limit = 80
                same = [k for k, v in scope.items() if v is value and not k.startswith("__") and k not in local] if local is not None and key in local else []
                text = same[0] if same else __kidpy_object(value)
            elif isinstance(value, list) and value and all(__kidpy_is_object(x) for x in value):
                limit = 80
                text = "[" + ", ".join(__kidpy_object(x) for x in value) + "]"
            else:
                # 글자, 숫자, 리스트, 튜플, 집합, 딕셔너리(그리고 그것들이 겹친 것)는 아이가 치는 모양으로
                text = __kidpy_typed(value)
                if text is None:
                    text = repr(value)
        except Exception:
            text = "?"
        if len(text) > limit:
            text = text[:limit - 3] + "..."
        out[key] = text
    return out

# ---- 그림판: 파이썬의 turtle과 같은 이름의 명령 ----
# 진짜 turtle은 브라우저에서 돌지 않아서, 자주 쓰는 명령만 같은 이름과 같은 뜻으로 만들었다.
# 명령은 화면에 바로 그리지 않고 "무엇을 그렸는지"를 목록(_kidpy_draws)에 적는다.
#  - 그냥 실행: 적는 대로 화면으로 보낸다(_kidpy_draw_hook). 화면이 받아서 움직임을 보여 준다.
#  - 한 줄씩 보기와 채점: 목록을 결과에 담아 돌려준다(줄마다 무엇을 그렸는지도 함께).
# 좌표는 가운데가 (0, 0)이고 위쪽이 y의 +, 방향은 오른쪽이 0도이고 왼쪽으로 돌수록 커진다(turtle과 같다).
import math as _kidpy_math
import types as _kidpy_types

_kidpy_draws = []
_kidpy_draw_hook = None
_kidpy_stream = [False]
_KIDPY_DRAW_MAX = 20000
_KIDPY_COLORS = {
    "black": "#000000", "white": "#ffffff", "red": "#e03131", "orange": "#f76707", "yellow": "#fcc419",
    "green": "#2f9e44", "blue": "#1971c2", "purple": "#7048e8", "pink": "#f783ac", "brown": "#8d5524",
    "gray": "#868e96", "grey": "#868e96", "skyblue": "#74c0fc", "sky blue": "#74c0fc", "navy": "#1c3d7a",
    "gold": "#f0b400", "lime": "#82c91e", "cyan": "#15aabf", "magenta": "#d6336c", "violet": "#9775fa",
    "lightgreen": "#b2f2bb", "light green": "#b2f2bb", "lightblue": "#a5d8ff", "light blue": "#a5d8ff",
    "darkgreen": "#1b6e2d", "dark green": "#1b6e2d", "tomato": "#ff6347", "beige": "#f5e6c8",
}

class TurtleGraphicsError(Exception):
    pass

def _kidpy_r(v):
    return round(float(v), 3) + 0.0

def _kidpy_emit(cmd):
    kind = cmd["k"]
    if kind in ("line", "dot", "text", "fill"):
        # 그림판에 남는 것만 센다(끝나지 않는 반복이 선을 끝없이 긋는 것을 막으려고). 지우면 다시 0부터 센다.
        _kidpy_state["ink"] += 1
        if _kidpy_state["ink"] > _KIDPY_DRAW_MAX:
            raise TurtleGraphicsError("too many drawing commands")
    elif kind == "clear":
        _kidpy_state["ink"] = 0
    if _kidpy_stream[0]:
        # 그냥 실행: 화면으로 바로 보낸다(게임은 끝없이 보내므로 여기에 쌓아 두지 않는다).
        if _kidpy_draw_hook is not None:
            _kidpy_draw_hook(json.dumps(cmd, ensure_ascii=False))
            _kidpy_maybe_poll()
    else:
        _kidpy_draws.append(cmd)

def _kidpy_color(value):
    if isinstance(value, str):
        key = value.strip().lower()
        if key in _KIDPY_COLORS:
            return _KIDPY_COLORS[key]
        if len(key) == 7 and key[0] == "#" and all(ch in "0123456789abcdef" for ch in key[1:]):
            return key
    raise TurtleGraphicsError("bad color string: " + str(value))

class Turtle:
    def __init__(self):
        self._id = _kidpy_state["count"]
        _kidpy_state["count"] += 1
        self._x = 0.0
        self._y = 0.0
        self._h = 0.0
        self._down = True
        self._pen = "#000000"
        self._fillc = "#000000"
        self._size = 1.0
        self._path = None
        self._fill_id = None
        self._shown = True
        self._shape = "classic"
        self._stretch = [1.0, 1.0]
        self._pose()

    def __repr__(self):
        return "<거북이 " + str(self._id + 1) + ">"

    def _pose(self):
        _kidpy_emit({"k": "pose", "t": self._id, "x": _kidpy_r(self._x), "y": _kidpy_r(self._y), "h": _kidpy_r(self._h), "v": self._shown, "s": self._shape, "z": self._stretch, "c": self._pen, "f": self._fillc})

    def _go(self, x, y):
        x = float(x)
        y = float(y)
        if self._down:
            _kidpy_emit({"k": "line", "t": self._id, "x1": _kidpy_r(self._x), "y1": _kidpy_r(self._y), "x2": _kidpy_r(x), "y2": _kidpy_r(y), "c": self._pen, "w": self._size})
        if self._path is not None:
            self._path.append([_kidpy_r(x), _kidpy_r(y)])
        self._x = x
        self._y = y
        self._pose()

    def forward(self, distance):
        a = _kidpy_math.radians(self._h)
        self._go(self._x + distance * _kidpy_math.cos(a), self._y + distance * _kidpy_math.sin(a))
    fd = forward

    def backward(self, distance):
        self.forward(-distance)
    back = backward
    bk = backward

    def left(self, angle):
        self._h = (self._h + angle) % 360
        self._pose()
    lt = left

    def right(self, angle):
        self.left(-angle)
    rt = right

    def setheading(self, angle):
        self._h = float(angle) % 360
        self._pose()
    seth = setheading

    def goto(self, x, y=None):
        if y is None:
            x, y = x
        self._go(x, y)
    setpos = goto
    setposition = goto

    def setx(self, x):
        self._go(x, self._y)

    def sety(self, y):
        self._go(self._x, y)

    def home(self):
        self._go(0, 0)
        self._h = 0.0
        self._pose()

    def circle(self, radius, extent=360, steps=None):
        if steps is None:
            steps = max(12, min(72, int(abs(radius) / 2) + 12))
            steps = max(1, int(steps * abs(extent) / 360))
        part = extent / steps
        chord = 2 * radius * _kidpy_math.sin(_kidpy_math.radians(part) / 2)
        if radius < 0:
            part = -part
        self._h = (self._h + part / 2) % 360
        for i in range(steps):
            a = _kidpy_math.radians(self._h)
            self._go(self._x + chord * _kidpy_math.cos(a), self._y + chord * _kidpy_math.sin(a))
            self._h = (self._h + part) % 360
        self._h = (self._h - part / 2) % 360
        self._pose()

    def dot(self, size=None, color=None):
        if isinstance(size, str) and color is None:
            size, color = None, size
        if size is None:
            size = max(self._size + 4, self._size * 2)
        _kidpy_emit({"k": "dot", "t": self._id, "x": _kidpy_r(self._x), "y": _kidpy_r(self._y), "r": _kidpy_r(size / 2), "c": _kidpy_color(color) if color is not None else self._pen})

    def write(self, text, move=False, align="left", font=None):
        size = 16
        if isinstance(font, (tuple, list)) and len(font) >= 2:
            size = int(font[1])
        _kidpy_emit({"k": "text", "t": self._id, "x": _kidpy_r(self._x), "y": _kidpy_r(self._y), "s": str(text), "c": self._pen, "a": str(align), "z": size})

    def penup(self):
        self._down = False
    pu = penup
    up = penup

    def pendown(self):
        self._down = True
    pd = pendown
    down = pendown

    def isdown(self):
        return self._down

    def pensize(self, width=None):
        if width is None:
            return self._size
        if width <= 0:
            raise TurtleGraphicsError("bad pen size: " + str(width))
        self._size = float(width)
    width = pensize

    def pencolor(self, *args):
        if not args:
            return self._pen
        self._pen = _kidpy_color(args[0])
        self._pose()

    def fillcolor(self, *args):
        if not args:
            return self._fillc
        self._fillc = _kidpy_color(args[0])
        self._pose()

    def color(self, *args):
        if not args:
            return (self._pen, self._fillc)
        self._pen = _kidpy_color(args[0])
        self._fillc = _kidpy_color(args[-1])
        self._pose()

    def begin_fill(self):
        self._fill_id = _kidpy_state["fills"]
        _kidpy_state["fills"] += 1
        self._path = [[_kidpy_r(self._x), _kidpy_r(self._y)]]
        _kidpy_emit({"k": "fill-begin", "t": self._id, "n": self._fill_id})

    def end_fill(self):
        if self._path is not None:
            _kidpy_emit({"k": "fill", "t": self._id, "n": self._fill_id, "p": self._path, "c": self._fillc})
        self._path = None

    def filling(self):
        return self._path is not None

    def speed(self, value=None):
        if value is None:
            return _kidpy_state["speed"]
        names = {"fastest": 0, "fast": 10, "normal": 6, "slow": 3, "slowest": 1}
        if isinstance(value, str):
            value = names.get(value, 6)
        value = int(value)
        if value < 0 or value > 10:
            value = 0
        _kidpy_state["speed"] = value
        _kidpy_emit({"k": "speed", "v": value})

    def position(self):
        return (_kidpy_r(self._x), _kidpy_r(self._y))
    pos = position

    def xcor(self):
        return _kidpy_r(self._x)

    def ycor(self):
        return _kidpy_r(self._y)

    def heading(self):
        return _kidpy_r(self._h)

    def distance(self, x, y=None):
        # 다른 거북이까지의 거리도 잴 수 있다: 공.distance(바구니)
        if isinstance(x, Turtle):
            x, y = x._x, x._y
        elif y is None:
            x, y = x
        return _kidpy_math.hypot(x - self._x, y - self._y)

    def hideturtle(self):
        self._shown = False
        self._pose()
    ht = hideturtle

    def showturtle(self):
        self._shown = True
        self._pose()
    st = showturtle

    def isvisible(self):
        return self._shown

    def shape(self, name=None):
        if name is None:
            return self._shape
        if name not in ("arrow", "turtle", "circle", "square", "triangle", "classic"):
            raise TurtleGraphicsError("There is no shape named " + str(name))
        self._shape = name
        self._pose()

    def shapesize(self, stretch_wid=None, stretch_len=None, outline=None):
        # 모양의 크기: 앞의 수는 세로(가는 방향에 가로지르는 쪽), 뒤의 수는 가로(가는 방향). 1이 처음 크기(20)다.
        if stretch_wid is None and stretch_len is None:
            return (self._stretch[0], self._stretch[1], 1)
        if stretch_wid is None:
            stretch_wid = self._stretch[0]
        if stretch_len is None:
            stretch_len = stretch_wid
        if stretch_wid <= 0 or stretch_len <= 0:
            raise TurtleGraphicsError("bad shape size")
        self._stretch = [float(stretch_wid), float(stretch_len)]
        self._pose()
    turtlesize = shapesize

    def clear(self):
        _kidpy_emit({"k": "clear", "t": self._id})

    def reset(self):
        self.clear()
        self._x = 0.0
        self._y = 0.0
        self._h = 0.0
        self._down = True
        self._pen = "#000000"
        self._fillc = "#000000"
        self._size = 1.0
        self._path = None
        self._pose()

# ---- 움직이는 그림과 게임: 키 입력, 한 장면씩 그리기, 타이머 ----
# 눌린 키는 화면 쪽에서 함께 쓰는 메모리로 넘어온다(_kidpy_keys_hook이 꺼내 준다).
# 파이썬은 turtle.update(), time.sleep(), turtle.mainloop()에서, 그리고 거북이를 움직이는 사이사이에 키를 받아
# 그 키에 붙여 둔 함수를 부른다(진짜 turtle도 화면을 고칠 때 키를 처리한다).
# 채점과 점검(_kidpy_stream이 False)에서는 정해 둔 키를 차례로 하나씩 넣고, 정해 둔 장면 수가 지나면 프로그램을 끝낸다.
import time as _kidpy_time
_kidpy_real_sleep = _kidpy_time.sleep
_kidpy_keys_hook = None
_kidpy_flush_hook = None
_KIDPY_KEYS = ["Left", "Right", "Up", "Down", "space", "Return"] + list("abcdefghijklmnopqrstuvwxyz0123456789")

class _KidpyGameEnd(BaseException):
    pass

def _kidpy_call_keys(events):
    if not _kidpy_state["listening"]:
        return
    for kind, name in events:
        fn = _kidpy_state[kind].get(name)
        if fn is not None:
            fn()

def _kidpy_call_timers(now):
    due = [item for item in _kidpy_state["timers"] if item[0] <= now]
    for item in due:
        _kidpy_state["timers"].remove(item)
    for item in due:
        item[1]()

def _kidpy_poll():
    if _kidpy_stream[0]:
        _kidpy_state["polled"] = _kidpy_time.time()
        if _kidpy_keys_hook is not None:
            _kidpy_call_keys(json.loads(_kidpy_keys_hook()))
        _kidpy_call_timers(_kidpy_time.time())
    else:
        # 정해 둔 키를 장면마다 하나씩 넣는다(눌렀다 뗀 것으로 친다).
        game = _kidpy_state["game"]
        if game["frames"] and game["tick"] >= game["frames"]:
            raise _KidpyGameEnd()
        game["tick"] += 1
        if game["keys"]:
            # 빈 칸(None)은 그 장면에 아무 키도 누르지 않는다는 뜻이다.
            name = game["keys"].pop(0)
            if name:
                _kidpy_call_keys([["press", name], ["release", name]])
        _kidpy_call_timers(_kidpy_state["clock"])

def _kidpy_maybe_poll():
    # 거북이가 움직이는 사이사이에도 키를 받는다(너무 자주 묻지 않게 0.02초에 한 번만).
    if _kidpy_state["tracer"] and _kidpy_state["listening"] and not _kidpy_state["in_poll"] and _kidpy_time.time() - _kidpy_state["polled"] > 0.02:
        _kidpy_state["in_poll"] = True
        try:
            _kidpy_poll()
        finally:
            _kidpy_state["in_poll"] = False

def _kidpy_sleep(seconds):
    seconds = float(seconds)
    if _kidpy_stream[0]:
        if _kidpy_flush_hook is not None:
            _kidpy_flush_hook()
        # 길게 쉴 때도 멈춤 버튼이 바로 듣게 조금씩 나눠 쉰다.
        while seconds > 0:
            step = min(seconds, 0.05)
            _kidpy_real_sleep(step)
            seconds -= step
        _kidpy_poll()
    else:
        _kidpy_state["clock"] += seconds
        _kidpy_poll()

_kidpy_time.sleep = _kidpy_sleep

def _kidpy_key_name(key):
    if key is None:
        return None
    if key not in _KIDPY_KEYS:
        raise TurtleGraphicsError("bad key name: " + str(key))
    return key

def _kidpy_bind(table, fun, key):
    if fun is not None and not callable(fun):
        raise TurtleGraphicsError("key handler must be a function")
    if fun is None:
        # 함수 이름 뒤에 괄호를 붙이면 함수가 바로 실행되고, 돌려준 값(None)이 넘어온다.
        raise TurtleGraphicsError("key handler is None")
    _kidpy_state[table][_kidpy_key_name(key)] = fun

def _kidpy_mainloop():
    # 키와 타이머를 기다린다. 멈춤 버튼을 누를 때까지(채점에서는 정해 둔 장면 수만큼) 돈다.
    while True:
        if _kidpy_stream[0]:
            _kidpy_sleep(0.02)
        else:
            if not _kidpy_state["game"]["frames"]:
                return
            _kidpy_state["clock"] += 0.02
            _kidpy_poll()

class _KidpyScreen:
    def bgcolor(self, *args):
        if not args:
            return _kidpy_state["bg"]
        _kidpy_state["bg"] = _kidpy_color(args[0])
        _kidpy_emit({"k": "bg", "c": _kidpy_state["bg"]})
    def tracer(self, n=None, delay=None):
        # tracer(0): 움직임을 하나하나 보여 주지 않고, update()를 부를 때 한 장면을 한꺼번에 바꾼다.
        if n is None:
            return _kidpy_state["tracer"]
        _kidpy_state["tracer"] = int(n)
        _kidpy_emit({"k": "tracer", "n": int(n)})
    def update(self):
        _kidpy_emit({"k": "frame"})
        if _kidpy_stream[0] and _kidpy_flush_hook is not None:
            _kidpy_flush_hook()
        _kidpy_poll()
    def listen(self, *args):
        _kidpy_state["listening"] = True
        _kidpy_emit({"k": "listen"})
    def onkeypress(self, fun, key=None):
        _kidpy_bind("press", fun, key)
    def onkeyrelease(self, fun, key=None):
        _kidpy_bind("release", fun, key)
    onkey = onkeyrelease
    def ontimer(self, fun, t=0):
        if not callable(fun):
            raise TurtleGraphicsError("key handler is None" if fun is None else "key handler must be a function")
        now = _kidpy_time.time() if _kidpy_stream[0] else _kidpy_state["clock"]
        _kidpy_state["timers"].append([now + t / 1000, fun])
    def mainloop(self):
        _kidpy_mainloop()
    done = mainloop
    exitonclick = mainloop
    def _nothing(self, *args, **kwargs):
        return None
    title = setup = delay = bye = screensize = _nothing
    def window_width(self):
        return 480
    def window_height(self):
        return 360

_kidpy_state = {}

def _kidpy_default():
    if _kidpy_state["default"] is None:
        _kidpy_state["default"] = Turtle()
    return _kidpy_state["default"]

def _kidpy_turtle_reset(stream, keys=(), frames=0):
    del _kidpy_draws[:]
    _kidpy_stream[0] = stream
    _kidpy_state.update({
        "count": 0, "fills": 0, "speed": 3, "bg": "#ffffff", "default": None, "ink": 0,
        "tracer": 1, "listening": False, "press": {}, "release": {}, "timers": [], "polled": 0.0, "in_poll": False, "clock": 0.0,
        # 채점과 점검에서 쓰는 것: 차례로 넣을 키, 돌릴 장면 수(0이면 한도 없음), 지금까지 지난 장면 수
        "game": {"keys": list(keys), "frames": int(frames), "tick": 0},
    })

def _kidpy_after_run():
    # 키를 기다리는 프로그램(listen을 부른 프로그램)은 끝까지 가도 닫지 않고 키를 계속 받는다.
    # 진짜 turtle에서는 맨 끝에 turtle.done()을 써야 하지만, 빼먹어도 되게 해 둔다.
    if _kidpy_state["listening"] or _kidpy_state["timers"]:
        _kidpy_mainloop()

_kidpy_turtle_reset(False)

def _kidpy_turtle_module():
    module = _kidpy_types.ModuleType("turtle")
    def passing(name):
        def call(*args, **kwargs):
            return getattr(_kidpy_default(), name)(*args, **kwargs)
        call.__name__ = name
        return call
    for name in dir(Turtle):
        if not name.startswith("_"):
            setattr(module, name, passing(name))
    screen = _KidpyScreen()
    for name in ("bgcolor", "title", "setup", "tracer", "update", "delay", "mainloop", "exitonclick", "done", "bye", "listen", "screensize", "window_width", "window_height", "onkey", "onkeypress", "onkeyrelease", "ontimer"):
        setattr(module, name, getattr(screen, name))
    module.Turtle = Turtle
    module.Pen = Turtle
    module.Screen = lambda: screen
    module.TurtleGraphicsError = TurtleGraphicsError
    return module

sys.modules["turtle"] = _kidpy_turtle_module()

# ---- 파일: 프로그램이 읽고 쓰는 파일은 한 폴더(_KIDPY_HOME)에만 둔다 ----
# 실행할 때마다 폴더를 비우고, 화면이 준 파일(수업에 딸린 파일, 만들기의 "내 파일")만 넣어 둔다.
# 그래서 앞 실행이나 채점에서 쓴 파일이 섞이지 않는다. 끝나면 폴더에 남은 파일을 모아 화면에 돌려준다.
# open은 아이의 이름 공간에만 바꿔 넣는다(파이썬 자체가 쓰는 open은 건드리지 않는다).
import os as _kidpy_os
import builtins as _kidpy_builtins

_KIDPY_HOME = "/home/kidpy"
_KIDPY_FILE_SHOW = 100000   # 화면에 돌려줄 때 파일 하나의 글자 수 한도
_KIDPY_WRITE_MAX = 2000000  # 한 번 실행에서 쓸 수 있는 글자 수(끝없이 쓰는 반복이 메모리를 다 쓰지 않게)
_kidpy_file_state = {"open": [], "written": 0, "used": False}
_KIDPY_MODES = {"r": "읽기", "w": "쓰기", "a": "이어 쓰기", "x": "새로 쓰기"}

class _KidpyFile:
    # 진짜 파일을 감싼다. 하는 일은 같고, 이름표 칸에 <점수.txt, 읽기로 열림>처럼 보이게 하고, 쓰는 양을 센다.
    def __init__(self, f, name, mode):
        object.__setattr__(self, "_f", f)
        object.__setattr__(self, "_name", name)
        object.__setattr__(self, "_mode", mode)
    def __getattr__(self, key):
        return getattr(self._f, key)
    def __iter__(self):
        self._f.__iter__()
        return self
    def __next__(self):
        return self._f.__next__()
    def __enter__(self):
        self._f.__enter__()
        return self
    def __exit__(self, *args):
        return self._f.__exit__(*args)
    def write(self, text):
        if isinstance(text, (str, bytes)):
            _kidpy_file_state["written"] += len(text)
            if _kidpy_file_state["written"] > _KIDPY_WRITE_MAX:
                raise OSError("File too large")
        return self._f.write(text)
    def __repr__(self):
        if self._f.closed:
            return "<" + self._name + ", 닫힘>"
        kind = "읽고 쓰기" if "+" in self._mode else _KIDPY_MODES.get(self._mode.replace("b", "").replace("t", ""), self._mode)
        return "<" + self._name + ", " + kind + "로 열림>"

def _kidpy_open(file, mode="r", *args, **kwargs):
    # 폴더를 거쳐 가는 이름(/, .., 앞 폴더)은 막는다. 파이썬이 쓰는 파일을 건드리지 않게 하려는 것이다.
    if not isinstance(file, str):
        raise TypeError("file name must be str, not " + type(file).__name__)
    if "/" in file or chr(92) in file or file.strip() in ("", ".", ".."):
        raise PermissionError(13, "Permission denied (only a file name, no folders)", file)
    if "b" not in mode and "encoding" not in kwargs and len(args) < 2:
        kwargs["encoding"] = "utf-8"
    f = _kidpy_builtins.open(file, mode, *args, **kwargs)
    _kidpy_file_state["used"] = True
    wrapped = _KidpyFile(f, file, mode)
    _kidpy_file_state["open"].append(f)
    return wrapped

def _kidpy_files_setup(files_json, scope):
    _kidpy_os.makedirs(_KIDPY_HOME, exist_ok=True)
    _kidpy_os.chdir(_KIDPY_HOME)
    for name in _kidpy_os.listdir(_KIDPY_HOME):
        path = _KIDPY_HOME + "/" + name
        if _kidpy_os.path.isdir(path):
            import shutil
            shutil.rmtree(path, ignore_errors=True)
        else:
            _kidpy_os.remove(path)
    files = json.loads(files_json or "null") or {}
    for name, text in files.items():
        if "/" in name or name in (".", ".."):
            continue
        with _kidpy_builtins.open(_KIDPY_HOME + "/" + name, "w", encoding="utf-8", newline="") as f:
            f.write(str(text))
    _kidpy_file_state["open"] = []
    _kidpy_file_state["written"] = 0
    _kidpy_file_state["used"] = bool(files)
    scope["open"] = _kidpy_open

# 폴더의 파일들: {이름: 내용}. close=True면 닫지 않은 파일을 먼저 닫는다(파이썬도 끝날 때 닫으며 남은 것을 쓴다).
def _kidpy_files_collect(close=True):
    if close:
        for f in _kidpy_file_state["open"]:
            try:
                f.close()
            except BaseException:
                pass
        _kidpy_file_state["open"] = []
    out = {}
    try:
        names = sorted(_kidpy_os.listdir(_KIDPY_HOME))
    except BaseException:
        return out
    for name in names:
        path = _KIDPY_HOME + "/" + name
        if not _kidpy_os.path.isfile(path):
            continue
        try:
            with _kidpy_builtins.open(path, "r", encoding="utf-8", errors="replace", newline="") as f:
                out[name] = f.read(_KIDPY_FILE_SHOW + 1)
        except BaseException:
            out[name] = ""
    return out

def __kidpy_run(code, files_json="null"):
    _kidpy_turtle_reset(True)
    name = "main.py"
    linecache.cache[name] = (len(code), None, code.splitlines(True), name)
    scope = {"__name__": "__main__"}
    _kidpy_files_setup(files_json, scope)
    error = None
    try:
        exec(compile(code, name, "exec"), scope)
        _kidpy_after_run()
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
    vars_now = __kidpy_vars(scope)
    files = _kidpy_files_collect() if _kidpy_file_state["used"] else None
    return json.dumps({"error": error, "vars": vars_now, "files": files})

class __KidpyTraceLimit(Exception):
    pass

# limit: 한 줄씩 보기에서 보여 줄 줄 수의 한도. 넘으면 TraceLimit(끝나지 않는 반복을 시연할 때는 작게 준다).
# randoms_json: 무작위 수를 정해 둘 때 쓴다. 비어 있지 않으면 random.randint가 이 값들을 차례로 돌려준다(채점과 시연이 늘 같게).
# 채점(trace=False)에서도 줄 수를 세어, 너무 많으면(끝나지 않는 반복) TraceLimit으로 멈춘다.
# keys_json: 차례로 넣을 키 이름들(장면마다 하나씩). frames: 돌릴 장면 수. 0이 아니면 그만큼 돈 뒤에 프로그램을 끝낸다(오류가 아니다).
# files_json: 프로그램이 시작할 때 폴더에 있을 파일 {이름: 내용}. 한 줄씩 보기에서는 파일이 바뀐 줄에 그때의 파일들을 함께 적는다.
def __kidpy_scripted(code, inputs_json, trace, limit=300, randoms_json="[]", keys_json="[]", frames=0, files_json="null"):
    _kidpy_turtle_reset(False, json.loads(keys_json), frames)
    name = "main.py"
    linecache.cache[name] = (len(code), None, code.splitlines(True), name)
    scope = {"__name__": "__main__"}
    _kidpy_files_setup(files_json, scope)
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
            # 함수 안을 실행하는 동안에는 함수 안의 이름(넘겨받은 값 포함)도 함께 보여 준다. 함수가 끝나면 사라진다.
            inside = frame.f_locals is not frame.f_globals
            seen = {**frame.f_globals, **frame.f_locals} if inside else frame.f_globals
            marks.append((frame.f_lineno, len(buf.getvalue()), __kidpy_vars(seen, frame.f_locals if inside else None), len(_kidpy_draws), _kidpy_files_collect(False) if _kidpy_file_state["used"] else None))
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
            _kidpy_after_run()
        finally:
            sys.settrace(None)
    except (SystemExit, _KidpyGameEnd):
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
    files = _kidpy_files_collect() if _kidpy_file_state["used"] else None
    steps = []
    draws = list(_kidpy_draws)
    shown_files = None
    for i, (line, pos, _, drawn, _files) in enumerate(marks):
        end = marks[i + 1][1] if i + 1 < len(marks) else len(total)
        # 이 줄을 실행한 뒤의 변수 값 = 다음 줄을 실행하기 직전의 값(마지막 줄이면 끝났을 때의 값)
        after = marks[i + 1][2] if i + 1 < len(marks) else final
        step = {"line": line, "out": total[pos:end], "vars": after}
        # 이 줄이 그린 것(그림판을 쓰는 프로그램일 때만)
        drawn_end = marks[i + 1][3] if i + 1 < len(marks) else len(draws)
        if drawn_end > drawn:
            step["draw"] = draws[drawn:drawn_end]
        # 이 줄을 실행한 뒤의 파일들(앞 줄 뒤와 달라졌을 때만 적는다)
        after_files = marks[i + 1][4] if i + 1 < len(marks) else files
        if after_files is not None and after_files != shown_files:
            step["files"] = after_files
            shown_files = after_files
        steps.append(step)
    return json.dumps({"steps": steps, "output": total, "error": error, "vars": final, "asked": asked[0], "unused": len(inputs), "draw": draws, "files": files})
`;

async function init(message) {
  const started = performance.now();
  if (message.interrupt) interruptView = new Uint8Array(message.interrupt);
  if (message.inputCtl) {
    inputCtl = new Int32Array(message.inputCtl);
    inputBytes = new Uint8Array(message.inputBytes);
  }
  if (message.flow) flow = new Int32Array(message.flow);
  if (message.keys) keyView = new Int32Array(message.keys);
  // PYTHONHASHSEED: 글자의 해시를 고정해서 집합의 차례가 실행마다 같게 한다(예측 문제와 채점이 흔들리지 않게).
  pyodide = await loadPyodide({ indexURL: new URL('./pyodide/', self.location.href).href, env: { PYTHONHASHSEED: '0' } });
  pyodide.setStdout(makeWriter('out'));
  pyodide.setStderr(makeWriter('err'));
  pyodide.setStdin({ stdin: readLine, isatty: false });
  if (interruptView) pyodide.setInterruptBuffer(interruptView);
  pyodide.runPython(RUNNER_SOURCE);
  pyodide.globals.set('_kidpy_draw_hook', emitDraw);
  pyodide.globals.set('_kidpy_keys_hook', pollKeys);
  // 한 장면을 다 그렸거나 쉬기 전에: 모아 둔 것을 화면으로 보낸다(화면이 밀려 있으면 다음에 보낸다).
  pyodide.globals.set('_kidpy_flush_hook', () => flush());
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
  // 앞 프로그램 때 눌린 키는 버린다.
  if (keyView) keysRead = Atomics.load(keyView, 0);
  let result = { error: null };
  try {
    if (message.mode === 'trace' || message.mode === 'check') {
      result = JSON.parse(
        runScripted(message.code, JSON.stringify(message.inputs ?? []), message.mode === 'trace', message.limit ?? 300, JSON.stringify(message.randoms ?? []), JSON.stringify(message.keys ?? []), message.frames ?? 0, JSON.stringify(message.files ?? null)),
      );
    } else {
      result = JSON.parse(runUser(message.code, JSON.stringify(message.files ?? null)));
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
    draw: result.draw ?? null,
    vars: result.vars ?? {},
    files: result.files ?? null,
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
