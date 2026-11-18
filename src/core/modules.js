// 모듈(아이가 import하는 .py 파일)과 보통 파일을 가르고 합친다. 순수 함수다(단원 19).
// 실행기에는 모듈도 파일처럼 폴더에 넣어 보낸다(그래야 import 도구가 된다). 화면에서는 모듈은 편집기의 탭으로,
// 나머지는 파일 칸으로 보인다.

/** .py로 끝나는 이름(모듈)인가 */
export const isModule = (name) => /\.py$/.test(name);

/** 파일들과 모듈들을 합친다. 둘 다 비었으면 null(파일을 쓰지 않는 프로그램은 전처럼 null을 보낸다). */
export function withModules(files, modules) {
  const all = { ...(files ?? {}), ...(modules ?? {}) };
  return Object.keys(all).length || files ? all : null;
}

/** 파일들을 보통 파일과 모듈로 가른다. */
export function splitFiles(files) {
  const data = {};
  const modules = {};
  for (const [name, text] of Object.entries(files ?? {})) (isModule(name) ? modules : data)[name] = text;
  return { data, modules };
}

/** 오류 자리를 말로: " (3번 줄)", 모듈에서 났으면 " (도구.py 2번 줄)" */
export function errorAt(error) {
  if (!error?.line) return '';
  return error.file ? ` (${error.file} ${error.line}번 줄)` : ` (${error.line}번 줄)`;
}

/** 모듈 이름으로 쓸 수 있는가: 글자로 시작하고 글자·숫자·밑줄만, 끝은 .py */
export function validModuleName(name) {
  return /^[A-Za-z_가-힣][A-Za-z0-9_가-힣]*\.py$/.test(name);
}
