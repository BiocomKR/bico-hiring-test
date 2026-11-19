# 풀스택 문제해결 과제

채용 지원자가 40분 동안 푸는 규칙 기반 평가 페이지입니다. 서버 없이 GitHub Pages에서 돌아갑니다.

## 구성

| 파일 | 내용 |
|---|---|
| `exam.js` | 지원자에게 보이는 문제, 질문, 선택지 |
| `cards.js` | 정보 카드 문구 (인코딩만, 암호화 아님) |
| `grading.enc.json` | 선택지 점수, 기타 채점 규칙, 모범 답, 추가질문 (AES-GCM 암호화) |
| `scoring.js` | 채점과 추가질문 선택 규칙 |
| `app.js` | 시험 진행, 결과 탭, PDF와 JSON 내보내기 |

채점 원본(`grading.json`, `cards.json`)은 이 저장소에 두지 않습니다.

## 채점 원본을 고친 뒤

```sh
GRADING_PASSWORD=<결과 탭 비밀번호> node tools/build-answer-key.mjs <채점 원본 폴더>
GRADING_JSON=<채점 원본 폴더>/grading.json node --test tests/
```

`exam.js`의 `version`과 `grading.json`의 `version`이 같아야 결과 탭이 열립니다.

## 운영 주의

- 답은 지원자가 푼 브라우저에만 저장됩니다. 같은 기기에서 결과 탭을 열고, PDF나 JSON으로 저장한 뒤 「다음 지원자 준비」로 초기화합니다.
- 페이지 원본은 공개입니다. 정답은 암호화돼 있지만 비밀번호가 짧으면 풀릴 수 있으니 시험은 감독 아래에서 진행합니다.
