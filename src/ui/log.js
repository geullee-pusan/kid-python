// 사용 기록. 가공하지 않은 사건을 한 줄에 하나씩 남긴다(요약이 아니라 원본을 남겨야 나중에 다시 분석할 수 있다).
// 기기에 쌓아 두었다가, 인증키가 저장되어 있으면 비공개 저장소로 올린다. 올리지 못해도 수업은 그대로 된다.
import { loadSync, logPath, putFile } from './sync.js';

const KEY = 'kidpy.log.pending';
const MAX_PENDING = 3000;
const session = `s-${Date.now().toString(36)}`;
let build = 'dev';
let pending = [];

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
  if (Array.isArray(saved)) pending = saved;
} catch {
  pending = [];
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(pending.slice(-MAX_PENDING)));
  } catch {
    // 저장하지 못해도 계속 쓴다.
  }
}

export function setBuild(version) {
  build = version;
}

/** 사건 하나를 적는다. 모든 사건에 시각, 세션, 앱 판 번호가 붙는다. */
export function log(type, data = {}) {
  pending.push({ t: new Date().toISOString(), session, app: build, type, ...data });
  if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
  save();
}

let sending = false;

/** 쌓인 기록을 올린다. 인증키가 없거나 올릴 것이 없으면 아무 일도 하지 않는다. */
export async function flushLog() {
  const sync = loadSync();
  if (sending || !sync.repo || !sync.token || pending.length === 0) return { ok: false, sent: 0 };
  sending = true;
  try {
    const batch = pending.slice();
    const text = `${batch.map((event) => JSON.stringify(event)).join('\n')}\n`;
    const result = await putFile(sync, logPath('logs').replace(/\.json$/, '.jsonl'), text, '사용 기록');
    if (result.ok) {
      pending = pending.slice(batch.length);
      save();
    }
    return { ok: result.ok, sent: result.ok ? batch.length : 0 };
  } finally {
    sending = false;
  }
}

export const pendingCount = () => pending.length;
