# kid-python

블록 코딩에서 파이썬으로 넘어가는 초등학생을 위한 학습 앱입니다. 태블릿 브라우저에서 홈 화면에 추가해 쓰고, 진짜 파이썬이 브라우저 안에서 돌아갑니다.

지금은 **0단계: 기술 확인용 시험판**입니다. 학습 내용은 아직 없고, 태블릿에서 아래가 되는지 확인하는 화면만 있습니다.

- 파이썬 실행, `input()`, 끝나지 않는 프로그램 멈춤
- 오류가 난 줄 표시
- 코드 자동 저장, 오프라인 실행, 새 판 자동 반영

## 개발

```
npm install
npm run dev      # 개발 서버
npm run build    # dist/ 에 배포물을 만든다
npm run preview  # 배포물을 localhost로 띄운다 (서비스 워커, 오프라인 확인)
```

`master`에 푸시하면 GitHub Actions가 빌드해서 GitHub Pages에 올립니다.

## 구조

- `public/py-worker.js` 파이썬을 돌리는 일꾼(웹 워커)
- `public/sw.js` 오프라인 저장과 교차 출처 격리 머리말
- `src/runner.js` 일꾼 켜기, 실행, 멈춤, 입력 넘기기
- `src/editor.js` 코드 편집기
- `src/checks.js` 자동 점검과 직접 해 보는 점검 목록
- `src/sync.js` 기록을 비공개 저장소로 보내기
- `scripts/` 실행기 복사, 빌드 마무리, 아이콘 만들기

파이썬 실행기는 [Pyodide](https://pyodide.org)이고, 편집기는 [CodeMirror](https://codemirror.net)입니다.
