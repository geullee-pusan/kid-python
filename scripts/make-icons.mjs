// 홈 화면 아이콘을 만든다(외부 도구 없이 PNG를 직접 쓴다).
// 그림: 짙은 남색 바탕에 프롬프트 모양 ">" 와 밑줄 "_".
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

const BG = [20, 33, 61];
const FG = [252, 196, 25];
const FG2 = [233, 236, 239];

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC = crcTable();
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// 점 (px, py)에서 선분 (ax, ay)-(bx, by)까지의 거리
function distance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function draw(size) {
  // 그림은 가운데 60% 안에만 둔다(둥글게 잘리는 아이콘에서도 안 잘린다).
  const u = size / 100;
  const strokes = [
    { a: [30, 34], b: [48, 50], color: FG },
    { a: [48, 50], b: [30, 66], color: FG },
    { a: [54, 66], b: [72, 66], color: FG2 },
  ];
  const half = 4.2 * u;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      let color = BG;
      let alpha = 0;
      for (const stroke of strokes) {
        const d = distance(x + 0.5, y + 0.5, stroke.a[0] * u, stroke.a[1] * u, stroke.b[0] * u, stroke.b[1] * u);
        const a = Math.max(0, Math.min(1, half - d + 0.5));
        if (a > alpha) {
          alpha = a;
          color = stroke.color;
        }
      }
      const at = row + 1 + x * 4;
      raw[at] = Math.round(BG[0] + (color[0] - BG[0]) * alpha);
      raw[at + 1] = Math.round(BG[1] + (color[1] - BG[1]) * alpha);
      raw[at + 2] = Math.round(BG[2] + (color[2] - BG[2]) * alpha);
      raw[at + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 비트 깊이
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(out, name), draw(size));
  console.log(`아이콘: ${name}`);
}
