// 빌드가 끝난 뒤 dist/sw.js에 판 번호와 받아 둘 파일 목록을 써 넣는다.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function walk(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

const files = walk(dist)
  .map((full) => relative(dist, full).split(sep).join('/'))
  .filter((file) => file !== 'sw.js' && file !== 'build.json')
  .sort();

const hash = createHash('sha256');
// 서비스 워커만 고쳐도 판 번호가 바뀌어야 한다(안 바뀌면 받아 둔 파일이 새로 고쳐지지 않는다).
hash.update(readFileSync(join(dist, 'sw.js')));
let bytes = 0;
for (const file of files) {
  const content = readFileSync(join(dist, file));
  hash.update(file);
  hash.update(content);
  bytes += content.length;
}
const version = hash.digest('hex').slice(0, 12);

const build = { version, builtAt: new Date().toISOString(), files: files.length, bytes };
writeFileSync(join(dist, 'build.json'), JSON.stringify(build, null, 2));

const list = [...files, 'build.json'].map((file) => `./${file}`);
const swPath = join(dist, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
if (!sw.includes("'/*VERSION*/dev'") || !sw.includes('/*FILES*/[]')) {
  console.error('sw.js에서 채울 자리를 찾지 못했습니다.');
  process.exit(1);
}
writeFileSync(swPath, sw.replace("'/*VERSION*/dev'", JSON.stringify(version)).replace('/*FILES*/[]', JSON.stringify(list)));

console.log(`빌드 마무리: 판 ${version}, 파일 ${list.length}개, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
