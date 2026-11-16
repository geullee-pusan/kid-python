// 서비스 워커를 켠다(오프라인 사용 + input()과 멈춤에 필요한 격리 머리말).

const RELOAD_FLAG = 'kidpy.reloaded';

function flag(action) {
  try {
    if (action === 'get') return sessionStorage.getItem(RELOAD_FLAG);
    if (action === 'set') sessionStorage.setItem(RELOAD_FLAG, '1');
    if (action === 'clear') sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // 저장소를 못 쓰면 다시 읽기를 한 번도 하지 않은 것으로 본다.
  }
  return null;
}

/**
 * 돌려주는 값: 'dev'(개발 서버), 'ready', 'reloading'(곧 한 번 다시 읽는다), 'unsupported', 'failed'
 */
export async function setupOffline() {
  // 개발 서버는 머리말을 직접 붙인다(vite.config.js). 서비스 워커는 배포물에서만 쓴다.
  if (import.meta.env.DEV) return 'dev';
  if (!('serviceWorker' in navigator)) return 'unsupported';
  try {
    // 새 판이 올라와 서비스 워커가 바뀌면 한 번 다시 읽어서 바로 새 판을 쓴다.
    // (코드는 닫히기 직전에 저장되므로 잃지 않는다. 처음 설치할 때는 아래에서 따로 다시 읽는다.)
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) location.reload();
    });
    const registration = await navigator.serviceWorker.register('./sw.js');
    // 새 판을 다 받아 두었으면 넘겨받으라고 알린다. 이 코드가 도는 시점에는 화면이 이미 다 떠 있어서 안전하다.
    const promote = (worker) => {
      if (worker && navigator.serviceWorker.controller) worker.postMessage({ type: 'activate-now' });
    };
    promote(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const incoming = registration.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        if (incoming.state === 'installed') promote(incoming);
      });
    });
    if (globalThis.crossOriginIsolated) {
      flag('clear');
      return 'ready';
    }
    // 처음 열었을 때는 서비스 워커가 아직 이 페이지를 맡지 않았다. 준비되면 한 번만 다시 읽는다.
    await navigator.serviceWorker.ready;
    if (!flag('get')) {
      flag('set');
      location.reload();
      return 'reloading';
    }
    return 'ready';
  } catch {
    return 'failed';
  }
}

/** 받아 둔 파일 수와 실행기 파일이 들어 있는지 알려 준다. */
export async function offlineStatus() {
  if (!('caches' in globalThis)) return { supported: false };
  const names = (await caches.keys()).filter((name) => name.startsWith('kidpy-'));
  let files = 0;
  let runtime = false;
  for (const name of names) {
    const keys = await (await caches.open(name)).keys();
    files += keys.length;
    if (keys.some((request) => request.url.endsWith('pyodide.asm.wasm'))) runtime = true;
  }
  return {
    supported: true,
    controlled: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
    caches: names.length,
    files,
    runtime,
  };
}
