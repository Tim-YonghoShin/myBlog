# 운영 매뉴얼

## 구동

```bash
# 데몬 실행 (텔레그램 명령 수신 + 스케줄 잡)
npm run daemon

# systemd 로 상시 구동
mkdir -p ~/.config/systemd/user
cp deploy/myblog.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now myblog
systemctl --user status myblog
loginctl enable-linger $USER    # 로그아웃해도 계속 돌게

# 로그
tail -f logs/daemon.log
tail -f logs/$(date +%F).log
```

## 텔레그램 명령

| 명령 | 하는 일 |
|---|---|
| `/status` | 시스템 준비 상태, 글 수, 일시정지 여부 |
| `/next` | 선정기가 다음에 고를 글감 5개 |
| `/write [키워드]` | 초안 작성 (생략 시 다음 순번). 3~5분 소요 |
| `/retry <키워드>` | 같은 키워드로 다시 작성 |
| `/pending` | 승인 대기 목록 |
| `/queue` | 작성중·승인대기·발행대기 글 |
| `/keywords` | 글감 풀 현황 |
| `/rate [n]` | 하루 발행 편수 확인·변경 (1~12). 변경 시 데몬 자동 재시작 |
| `/health` | 티스토리 세션·Anthropic OAuth·Google API 점검 |
| `/collect` | 지금 즉시 지표 수집 |
| `/mine` | 기회 키워드 발굴 |
| `/report` `/week` `/month` | 일간·주간·월간 리포트 |
| `/categories` `/catwatch` | 카테고리 현황·제안 (승인 버튼으로 생성) |
| `/reset` | 에이전트 대화 기록 초기화 |
| `/pause` `/resume` | 자동 발행 정지·재개 |

### 자유 대화

슬래시 없이 그냥 말을 걸면 **운영 에이전트**가 응답합니다. 추측하지 않고 실제로 DB를 조회하고
도구를 실행합니다. 대화 1회당 약 **$0.035**.

```
"어제 성과 어때?"                  → sql_select 로 실제 지표 조회
"연말정산 키워드 10개 추가해줘"      → add_keywords 실행
"재산세 글 본문 보여줘"             → get_post_content
"하루 5편으로 올려줘"               → set_rate (데몬 재시작)
"최근 오류 로그"                    → read_logs
"3번 글 발행해"                     → publish_post (확인 후 실행)
```

노출된 도구는 12개이며 **셸·파일시스템 접근은 없습니다**. 발행처럼 되돌리기 어려운 작업은
에이전트가 먼저 확인을 구합니다. 등록된 chat_id 외의 요청은 무시됩니다.

초안이 완성되면 **승인 요청**이 옵니다. 버튼 4개:

- **✅ 승인하고 발행** — 공개 발행
- **🔒 비공개로 발행** — 티스토리에 올리되 비공개 (검토용)
- **🔄 다시 쓰기** — 같은 키워드로 재생성
- **🗑 반려** — 폐기하고 글감을 skip 처리

## 수동 실행

```bash
npm run pick               # 다음 글감 점수 확인
npm run posts              # 티스토리 글 목록
npm run categories:plan    # 카테고리 드라이런
npm run categories:sync    # 카테고리 목표 구조로 맞추기
node src/content/pipeline.js "키워드"            # 초안 1편 생성
node src/content/pipeline.js "키워드" --no-notify # 텔레그램 알림 없이
node scripts/tistory-posts.mjs delete 12         # 글 삭제
```

## 인증 관리

두 종류의 세션이 있고, 둘 다 만료됩니다.

### 1. 티스토리 세션 (발행용)

카카오 로그인 세션이라 **몇 주에 한 번 만료**됩니다. 만료되면 발행이 실패하고 텔레그램으로 알림이 옵니다.

```bash
npm run session:login      # 브라우저가 열리면 직접 로그인
```

비밀번호는 코드가 다루지 않습니다. 브라우저 창에서 직접 입력하시면 쿠키만 저장됩니다.

### 2. Anthropic OAuth (콘텐츠 생성용)

```bash
ant auth status            # 현재 상태
ant auth login             # 재인증 (브라우저)
```

액세스 토큰은 8시간마다 자동 갱신되지만, **리프레시 토큰은 언젠가 하드 만료**됩니다.
초안 생성이 인증 오류로 실패하면 `ant auth login` 을 먼저 실행하세요.

> ⚠️ `ANTHROPIC_API_KEY` 환경변수가 설정되어 있으면 OAuth 프로필을 덮어씁니다.
> systemd 유닛에서 `UnsetEnvironment` 로 비워 두고 있습니다. 셸에서도 설정하지 마세요.

## 비용

Claude Opus 5 + web_search 8회 기준, 실측 **초안 1편당 $0.43** (2,500자 · 출처 7개 · 4분).

| 발행 속도 | 월 비용 (실측 기준) |
|---|---|
| 하루 3편 (현재) | 약 $39 |
| 하루 5편 | 약 $65 |
| 하루 12편 | 약 $155 |

### 계단식 증량 계획

| 기간 | 하루 | 누적 | 조치 |
|---|---|---|---|
| 1~2주차 | 3편 | 42편 | 현재 설정. 30편 시점에 애드센스 신청 |
| 3~4주차 | 5편 | 112편 | `/rate 5` |
| 이후 | 성과 기준 결정 | | 주간 리포트의 카테고리 ROI 참고 |

> 신규 블로그가 단기간에 발행량을 급증시키면 구글이 scaled content abuse 로 판단할 수 있습니다.
> 적발 시 애드센스 계정 정지 + 색인 삭제로 이어지므로, 한 번에 올리지 말고 위 계단을 지키세요.
> 글감은 현재 99개 — 하루 5편이면 20일치입니다. 그 전에 GSC 쿼리 마이닝(`/mine`)이 자동 보충합니다.

비용을 줄이려면 `src/content/generate.js` 의 `output_config.effort` 를 `high` → `medium` 으로,
또는 `max_uses` 를 8 → 5 로 낮추면 됩니다. 다만 출처 수와 수치 정확도가 함께 떨어집니다.
지금은 품질 쪽에 무게를 두고 `high` + 8회로 두었습니다.

시스템 프롬프트에 캐시가 걸려 있어 연속 생성 시 입력 비용이 줄어듭니다.

## ⚠️ GA4 가 데이터를 수집하지 않는 문제 (미해결 — 수동 조치 필요)

**증상**: 티스토리 방문자 카운터는 올라가는데 GA4·리포트는 계속 0.

**원인**: 티스토리 「구글 애널리틱스」 플러그인이 아래를 삽입합니다.

```js
gtag('config','G-XXXXXXXXXX', {
    cookie_flags: 'max-age=0;domain=.tistory.com',   // ← 쿠키를 즉시 만료시킴
    ...
});
```

`max-age=0` 때문에 `_ga` 쿠키가 저장되지 않고, **gtag 가 `/g/collect` 요청 자체를 보내지 않습니다.**
브라우저 통제 실험으로 확인했습니다.

| 설정 | /g/collect | _ga 쿠키 |
|---|---|---|
| 플러그인 기본값 | 0건 | 0개 |
| `cookie_flags` 제거 | 2건 | 2개 |

**조치** (약 2분, 티스토리 관리 화면에서 직접):

1. 블로그 관리 → **플러그인** → 「구글 애널리틱스」 → **사용 해제**
2. 블로그 관리 → 꾸미기 → **스킨 편집** → 우측 상단 **html 편집**
3. `</head>` **바로 위**에 아래를 붙여넣고 **적용**

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-7ZHGT5GNSW"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-7ZHGT5GNSW');
</script>
```

4. 확인:

```bash
node src/core/ga-check.js     # "✅ GA4 정상 수집" 이 나와야 함
```

> 스킨을 변경하면 이 코드가 사라집니다. 스킨 교체 후에는 다시 넣고 위 명령으로 확인하세요.
> 매일 23시 헬스체크가 이 상태를 감시하며, 수집이 멈추면 텔레그램으로 알립니다.

## 자주 나는 문제

| 증상                       | 원인                       | 조치                                      |
| ------------------------ | ------------------------ | --------------------------------------- |
| 발행 시 "세션이 만료되었습니다"       | 카카오 세션 만료                | `npm run session:login`                 |
| 초안 생성 401/403            | OAuth 만료                 | `ant auth login`                        |
| `fetch failed ETIMEDOUT` | Node happy-eyeballs 타임아웃 | `src/core/net.js` 가 이미 처리. import 누락 확인 |
| 품질 게이트 반복 실패             | 키워드가 공식 출처로 확인 불가        | `/retry` 또는 글감 교체                       |
| 카테고리 지정 실패               | 티스토리에서 카테고리 이름 변경됨       | `npm run categories:sync`               |
| 티스토리 발행 500              | 하루 공개 발행 한도(30편) 초과      | 다음날 재시도                                 |

## 백업

```bash
# DB + 세션 + 초안
tar czf ~/myblog-backup-$(date +%F).tar.gz data/ .session/ content/posts/ .env
```

`.session/` 과 `.env` 에는 자격증명이 들어있습니다. git 에 올리지 마세요 (`.gitignore` 처리됨).
