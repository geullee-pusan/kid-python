// 자동 점검과 직접 해 보는 점검 목록.
// 자동 점검의 run은 { pass: true | false | null, detail }을 돌려준다(null = 해당 없음).

import { offlineStatus } from './offline.js';

const ms = (value) => `${value}ms`;
const firstLine = (text) => text.trim().split('\n')[0];

export const AUTO_CHECKS = [
  {
    id: 'screen',
    title: '화면 크기',
    async run() {
      const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
      return {
        pass: true,
        detail: `${innerWidth}×${innerHeight}, 배율 ${devicePixelRatio}, ${standalone ? '홈 화면 앱으로 열림' : '브라우저 탭으로 열림'}`,
      };
    },
  },
  {
    id: 'isolation',
    title: '입력과 멈춤에 필요한 기능',
    async run() {
      const ok = globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined';
      return { pass: ok, detail: ok ? '켜져 있음' : '꺼져 있음 (input()을 못 쓰고, 멈춤은 실행기를 껐다 켜는 방식이 됨)' };
    },
  },
  {
    id: 'load',
    title: '파이썬 준비 시간',
    async run(ctx) {
      const info = ctx.runner.info;
      const history = ctx.loadHistory();
      const past = history.length > 1 ? ` (이전 기록: ${history.slice(0, -1).slice(-4).map(ms).join(', ')})` : '';
      return { pass: info.ms < 5000, detail: `${ms(info.ms)}, 파이썬 ${info.python}, 실행기 ${info.pyodide}${past}` };
    },
  },
  {
    id: 'simple',
    title: '간단한 계산 실행',
    async run(ctx) {
      const result = await ctx.exec('print(sum(range(1000)))');
      return { pass: result.ok && result.output.trim() === '499500', detail: `${ms(result.wallMs)} 걸림, 출력 "${firstLine(result.output)}"` };
    },
  },
  {
    id: 'hangul',
    title: '한글 변수 이름과 한글 출력',
    async run(ctx) {
      const result = await ctx.exec('이름 = "부산"\nprint(f"{이름}역")');
      return { pass: result.ok && result.output.trim() === '부산역', detail: `출력 "${firstLine(result.output)}"` };
    },
  },
  {
    id: 'input',
    title: 'input()으로 입력 받기',
    async run(ctx) {
      const result = await ctx.exec('a = input("이름: ")\nprint("안녕", a)', { inputs: ['테스트'] });
      const ok = result.ok && result.output.includes('안녕 테스트') && result.output.includes('이름: ');
      return { pass: ok, detail: ok ? '질문 글이 먼저 나오고 답을 받음' : `실패: ${result.error ? result.error.type : JSON.stringify(result.output)}` };
    },
  },
  {
    id: 'stop-loop',
    title: '끝나지 않는 반복 멈추기',
    async run(ctx) {
      const result = await ctx.exec('while True:\n    pass', { stopAfterMs: 300 });
      const took = result.wallMs - 300;
      return {
        pass: result.stopped && !result.hardStop,
        detail: result.hardStop ? `부드럽게 멈추지 못해 실행기를 껐다 켬 (${ms(took)})` : `멈춤을 누른 뒤 ${ms(took)} 만에 멈춤`,
      };
    },
  },
  {
    id: 'stop-print',
    title: '끝없이 출력하는 프로그램 멈추기',
    async run(ctx) {
      // 프로그램이 도는 동안 화면이 얼마나 굼떠지는지도 잰다.
      let last = performance.now();
      let worst = 0;
      const ticker = setInterval(() => {
        const now = performance.now();
        worst = Math.max(worst, now - last - 50);
        last = now;
      }, 50);
      // 실제 사용 때처럼 출력 창에 그리면서 2초 동안 돌린다(그리지 않으면 화면이 굳는 문제를 못 잡는다).
      const result = await ctx.exec('i = 0\nwhile True:\n    i += 1\n    print(i)', { stopAfterMs: 2000, show: true });
      clearInterval(ticker);
      const took = result.wallMs - 2000;
      return {
        pass: result.stopped && !result.hardStop && worst < 400 && took < 1000,
        detail: `2초 돌린 뒤 멈춤을 누르고 ${ms(took)} 만에 멈춤, 화면이 가장 오래 멈칫한 시간 ${ms(Math.round(worst))}, 출력 창에 남은 글자 ${result.shownChars.toLocaleString()}${result.hardStop ? ', 실행기를 껐다 켬' : ''}`,
      };
    },
  },
  {
    id: 'stop-input',
    title: '입력을 기다리는 중에 멈추기',
    async run(ctx) {
      const result = await ctx.exec('input("기다리는 중: ")\nprint("여기까지 오면 안 됨")', { stopAfterMs: 300 });
      const ok = result.stopped && !result.hardStop && !result.output.includes('여기까지');
      return { pass: ok, detail: ok ? `멈춤을 누른 뒤 ${ms(result.wallMs - 300)} 만에 멈춤` : `실패${result.hardStop ? ' (실행기를 껐다 켬)' : ''}` };
    },
  },
  {
    id: 'error-line',
    title: '오류가 난 줄 번호 알아내기',
    async run(ctx) {
      const name = await ctx.exec('a = 1\nb = 2\nprint(c)');
      const syntax = await ctx.exec('for i in range(3)\n    print(i)');
      const inside = await ctx.exec('def f(x):\n    return 10 / x\n\nf(0)');
      const ok =
        name.error && name.error.type === 'NameError' && name.error.line === 3 &&
        syntax.error && syntax.error.type === 'SyntaxError' && syntax.error.line === 1 &&
        inside.error && inside.error.type === 'ZeroDivisionError' && inside.error.line === 2;
      const got = [name, syntax, inside].map((r) => (r.error ? `${r.error.type} ${r.error.line}번 줄` : '오류 없음')).join(', ');
      return { pass: Boolean(ok), detail: got };
    },
  },
  {
    id: 'fresh',
    title: '다시 실행하면 앞의 변수가 남지 않음',
    async run(ctx) {
      await ctx.exec('x = 123');
      const result = await ctx.exec('print(x)');
      const ok = result.error && result.error.type === 'NameError';
      return { pass: Boolean(ok), detail: ok ? '남지 않음' : '앞에서 만든 변수가 남아 있음' };
    },
  },
  {
    id: 'modules',
    title: '기본 모듈 쓰기 (math, random, datetime)',
    async run(ctx) {
      const result = await ctx.exec('import math, random, datetime\nprint(math.gcd(12, 18), datetime.date(2026, 11, 16).weekday(), random.randint(5, 5))');
      return { pass: result.ok && result.output.trim() === '6 0 5', detail: `${ms(result.wallMs)} 걸림, 출력 "${firstLine(result.output)}"` };
    },
  },
  {
    id: 'sleep',
    title: '기다리기 (time.sleep)',
    async run(ctx) {
      const result = await ctx.exec('import time\nstart = time.time()\ntime.sleep(0.3)\nprint(round(time.time() - start, 1))');
      return { pass: result.ok && result.output.trim() === '0.3', detail: `출력 "${firstLine(result.output)}"` };
    },
  },
  {
    id: 'speed',
    title: '계산 속도 (2만까지의 소수 세기)',
    async run(ctx) {
      const code = 'count = 0\nfor n in range(2, 20000):\n    for d in range(2, int(n ** 0.5) + 1):\n        if n % d == 0:\n            break\n    else:\n        count += 1\nprint(count)';
      const result = await ctx.exec(code);
      return { pass: result.ok && result.output.trim() === '2262' && result.ms < 3000, detail: `${ms(result.ms)} 걸림, 출력 "${firstLine(result.output)}"` };
    },
  },
  {
    id: 'storage',
    title: '코드 저장',
    async run() {
      let roundTrip = false;
      try {
        const value = `점검-${Date.now()}`;
        localStorage.setItem('kidpy.spike.probe', value);
        roundTrip = localStorage.getItem('kidpy.spike.probe') === value;
        localStorage.removeItem('kidpy.spike.probe');
      } catch {
        roundTrip = false;
      }
      let kept = '알 수 없음';
      let room = '';
      if (navigator.storage && navigator.storage.persist) {
        // 브라우저가 저장 공간이 모자랄 때 우리 자료를 지우지 않게 해 달라고 부탁한다.
        const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
        kept = persisted ? '지워지지 않게 보호됨' : '보호되지 않음 (공간이 모자라면 브라우저가 지울 수 있음)';
        const estimate = await navigator.storage.estimate();
        room = `, 사용 ${(estimate.usage / 1024 / 1024).toFixed(1)} MB / 한도 ${(estimate.quota / 1024 / 1024 / 1024).toFixed(1)} GB`;
      }
      return { pass: roundTrip, detail: `${roundTrip ? '쓰고 읽기 됨' : '쓰고 읽기 안 됨'}, ${kept}${room}` };
    },
  },
  {
    id: 'offline',
    title: '오프라인 준비',
    async run(ctx) {
      if (ctx.offlineMode === 'dev') return { pass: null, detail: '개발 서버에서는 확인하지 않음' };
      const status = await offlineStatus();
      if (!status.supported) return { pass: false, detail: '이 브라우저는 파일을 받아 둘 수 없음' };
      const ok = status.controlled && status.runtime;
      return { pass: ok, detail: `받아 둔 파일 ${status.files}개, 실행기 ${status.runtime ? '포함' : '빠짐'}, ${status.controlled ? '서비스 워커가 맡고 있음' : '서비스 워커가 아직 맡지 않음'}` };
    },
  },
];

export const MANUAL_CHECKS = [
  { id: 'type', title: '실물 키보드로 이 줄을 그대로 쳐 보기', hint: 'for i in range(3): print("역", i)   ← 괄호, 따옴표, 콜론이 잘 들어가나요?' },
  { id: 'hangul-type', title: '한/영 키로 바꿔서 따옴표 안에 한글 쓰기', hint: '글자가 겹치거나 사라지지 않나요? 다시 영어로 잘 돌아오나요?' },
  { id: 'shortcut', title: 'Ctrl+Enter로 실행하기', hint: '편집기에 커서가 있을 때 실행되나요?' },
  { id: 'indent', title: '콜론 뒤 Enter, Tab과 Shift+Tab', hint: '콜론 뒤에서 줄을 바꾸면 저절로 들여쓰기가 되나요?' },
  { id: 'input-type', title: 'input()에 직접 답하기', hint: '아래 "입력 예제"를 넣고 실행한 뒤, 입력 칸에 답을 쳐 보세요.' },
  { id: 'install', title: '홈 화면에 추가해서 열기', hint: '크롬 메뉴 → 홈 화면에 추가(앱 설치). 주소 줄 없이 전체 화면으로 열리나요?' },
  { id: 'offline', title: '비행기 모드에서 열고 실행하기', hint: '한 번 연 뒤 앱을 완전히 닫고, 비행기 모드로 다시 열어 실행해 보세요.' },
  { id: 'restore', title: '껐다 켜도 코드가 남아 있음', hint: '코드를 조금 고친 뒤 앱을 닫았다가 다시 열어 보세요.' },
  { id: 'feel', title: '켤 때 기다리는 시간이 참을 만함', hint: '아이콘을 누른 뒤 실행 버튼이 켜질 때까지의 느낌을 적어 주세요.' },
];
