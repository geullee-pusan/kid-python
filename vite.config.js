import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// 파이썬의 input()과 "멈춤"은 화면과 일꾼이 메모리를 함께 쓰는 기능(SharedArrayBuffer)이 있어야 된다.
// 브라우저는 아래 두 머리말이 붙은 페이지에만 그 기능을 열어 준다.
// - 개발 서버: 여기서 머리말을 붙인다.
// - 배포물(GitHub Pages는 머리말을 못 바꾼다): 서비스 워커(public/sw.js)가 붙인다.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // 상대 주소로 뽑는다. 하위 폴더 주소(GitHub Pages)에서도 열린다.
  base: './',
  server: { headers: isolation },
  // preview에는 일부러 붙이지 않는다. 배포했을 때처럼 서비스 워커가 붙이는지 확인하려는 것이다.
  build: {
    rollupOptions: {
      input: {
        // 수업 화면
        main: resolve(import.meta.dirname, 'index.html'),
        // 점검 화면(부모·개발용): 실행 기반 자동 점검과 기록 전송 설정
        check: resolve(import.meta.dirname, 'check.html'),
      },
    },
  },
});
