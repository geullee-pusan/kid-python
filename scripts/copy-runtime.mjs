// 파이썬 실행기(Pyodide)를 npm 패키지에서 public/pyodide/로 복사한다.
// 바깥 주소(CDN)에서 받지 않고 우리 배포물에 함께 넣어야 오프라인에서도 돌아간다.
import { copyFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'pyodide');
const to = join(root, 'public', 'pyodide');

// 브라우저에서 실행하는 데 필요한 파일만 고른다.
const FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

mkdirSync(to, { recursive: true });
let copied = 0;
for (const name of FILES) {
  const src = join(from, name);
  const dst = join(to, name);
  if (!existsSync(src)) {
    console.error(`실행기 파일이 없습니다: ${src}\nnpm install을 먼저 하세요.`);
    process.exit(1);
  }
  const same = existsSync(dst) && statSync(dst).size === statSync(src).size && statSync(dst).mtimeMs >= statSync(src).mtimeMs;
  if (!same) {
    copyFileSync(src, dst);
    copied += 1;
  }
}
console.log(`파이썬 실행기 준비: ${FILES.length}개 중 ${copied}개 복사`);
