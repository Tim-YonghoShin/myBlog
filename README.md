# myBlog Autopilot

티스토리 수익형 블로그 **자동 운영 시스템**.
글감 선정 → 공식 출처 리서치 → 초안 생성 → 품질 검사 → 텔레그램 승인 → 자동 발행 → 유입·수익 수집 → 리포트.

- 블로그: [리춍의 성장연구소](https://richyong-growthlab.tistory.com)
- 지시·보고: 텔레그램 (`@myblog_agent_bot`)
- 전략 문서: [`strategy/`](strategy/) · 작업 목록: [`ROADMAP.md`](ROADMAP.md) · 운영: [`OPERATIONS.md`](OPERATIONS.md)

## 왜 이런 구조인가

**티스토리 Open API 는 2024년 2월에 종료됐습니다.** 그래서 발행은 관리자 화면이 쓰는 내부 JSON API 를
로그인 세션 쿠키로 직접 호출합니다. 브라우저 에디터를 조작하지 않으므로 UI 변경에 덜 취약합니다.

```
POST   /manage/post.json        글 생성·수정 (예약 발행 포함)
DELETE /manage/post/{id}.json   글 삭제
PUT    /manage/category.json    카테고리 추가·삭제
```

**콘텐츠는 Claude Opus 5 가 씁니다.** 단, `web_search` 를 정부·공공기관 도메인 22개로 제한해서
모델이 최신 공고를 직접 확인한 뒤 쓰게 합니다. 기억에 의존한 숫자는 금지하고, 확인된 출처만 인용합니다.

**발행 전 사람이 한 번 봅니다.** 텔레그램 승인 버튼을 거칩니다. 구글의 scaled content abuse 정책상
무검수 대량 발행은 애드센스 계정 정지 위험이 있고, 계정이 죽으면 프로젝트 전체가 끝납니다.

**외형은 코드가 결정합니다.** 모델은 구조(제목·표·목록)만 만들고, 요약 카드(인라인 SVG)·색상 표·
제목 위계·출처 블록은 `src/content/render.js` 가 일괄 적용합니다. 모델 출력에 맡기면 글마다
스타일이 달라지고, 실제로 출처를 본문에 넣지 않는 사고도 있었습니다.

## 구조

```
src/
  core/       config · logger · db(SQLite) · net(IPv6/타임아웃 대응) · scheduler · categories
  content/    selector(글감 선정) · prompt · generate(리서치+작성) · quality(게이트)
              style(인라인 스타일) · svg-card(요약 카드) · render(본문 완성) · approve · pipeline · mining(피드백 루프)
  collect/    ga4 · gsc · google(인증)
  report/     metrics(집계) · index(일간·주간·월간)
  publish/    tistory-api · publisher(발행) · sync-categories
  telegram/   client · bot(명령 수신)
  daemon.js   상시 구동 진입점
strategy/     니치·플랫폼·수익화·실행계획 문서
keywords/     글감 100개 (난이도·시즌·수익라인)
data/blog.db  posts / keywords / metrics_daily / queries_daily / approvals / runs
```

## 빠른 시작

```bash
npm run daemon        # 데몬 실행
npm run pick          # 다음 글감 확인
npm run posts         # 티스토리 글 목록
```

텔레그램에서 `/write` 를 보내면 초안이 만들어지고 승인 요청이 옵니다.
전체 명령과 장애 대응은 [`OPERATIONS.md`](OPERATIONS.md) 참고.

## 진행 상황

| Phase | 내용 | 상태 |
|---|---|---|
| 1 | 기반 (설정·DB·텔레그램·스케줄러) | ✅ |
| 2 | 콘텐츠 생성 (리서치·작성·품질·승인) | ✅ |
| 3 | 자동 발행 (세션·발행·카테고리·수정) | ✅ |
| 4 | 수집 (GA4 · Search Console) | ✅ · AdSense 는 승인 후 |
| 5 | 리포트 (일간·주간·월간) | ✅ |
| 6 | 피드백 루프 (쿼리 마이닝·가중치·갱신 큐) | ✅ · 내부링크 추천만 남음 |
| 7 | 운영 안정화 (헬스체크·백업·매뉴얼) | ✅ |

**발행 스케줄**: 하루 3편 (09시·16시·22시). `/rate 5` 로 증량. 계단식 증량 계획은 [`OPERATIONS.md`](OPERATIONS.md) 참고.
