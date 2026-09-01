# Google 연동 설정 — 단계별

블로그: `https://richyong-growthlab.tistory.com`
목표: Search Console 소유권 확인 → GA4 연결 → 서비스계정 JSON 발급 → 자동 수집 가동

소요 시간 약 40분. **순서대로** 하셔야 합니다 (뒤 단계가 앞 단계 결과를 씁니다).

---

## STEP 1. Search Console 소유권 확인

### 1-1. 등록 방식 확인

Search Console 속성이 **「URL 접두어」** 방식으로 등록돼 있어야 합니다.

- ✅ `https://richyong-growthlab.tistory.com/` ← 이렇게 등록
- ❌ 「도메인」 방식은 DNS TXT 레코드가 필요한데, 티스토리 서브도메인은 DNS를 만질 수 없어 불가능합니다.

「도메인」으로 등록하셨다면 지우고 「URL 접두어」로 다시 등록하세요.

### 1-2. 확인 방법 두 가지 — A를 먼저 시도

**[방법 A] 티스토리 플러그인 (권장, 3분)**

티스토리에 **「구글 서치콘솔」 플러그인이 이미 사용중**입니다. 이게 소유권 확인과 사이트맵 제출을 한 번에 처리합니다.

1. 티스토리 → **블로그 관리 → 플러그인**
2. **「구글 서치콘솔」** 카드 클릭 → **설정**
3. 구글 계정 연결 → 블로그 선택 → **등록**
4. 사이트맵이 자동 제출됩니다

**[방법 B] 메타 태그 수동 등록 (A가 안 될 때)**

1. Search Console → 속성 선택 → 소유권 확인 화면
2. **「HTML 태그」** 방식 선택 → 아래 같은 태그가 나옵니다:
   ```html
   <meta name="google-site-verification" content="AbCd1234..." />
   ```
   이걸 **통째로 복사**합니다.
3. 티스토리 → **플러그인** → **「메타 태그 등록」** 검색 → **사용하기**
4. 설정 화면에서:
   - 이름: `google-site-verification`
   - 값: `AbCd1234...` (content 안의 값만. `<meta ...>` 전체가 아님)
5. 저장 후 Search Console 로 돌아가 **「확인」** 클릭

> 스킨 편집으로 `<head>` 에 직접 넣는 방법도 있지만, 스킨을 바꾸면 사라집니다. 플러그인 방식이 안전합니다.

### 1-3. 사이트맵 제출 (수동 확인)

Search Console → 왼쪽 메뉴 **색인 생성 → Sitemaps** → 새 사이트맵 추가:

```
sitemap.xml
```

상태가 **「성공」** 이 되면 완료입니다. (반영까지 몇 시간 걸립니다)

---

## STEP 2. GA4 속성 만들고 티스토리에 연결

### 2-1. GA4 속성 생성

1. [analytics.google.com](https://analytics.google.com) 접속
2. 왼쪽 아래 **관리(톱니바퀴)** → **만들기 → 속성**
3. 속성 이름: `리춍의 성장연구소` / 시간대 **대한민국** / 통화 **KRW**
4. 업종·규모는 아무거나 → **다음**
5. 플랫폼 선택에서 **웹** 선택
   - 웹사이트 URL: `https://richyong-growthlab.tistory.com`
   - 스트림 이름: `티스토리`
6. 생성되면 **측정 ID** 가 나옵니다 → `G-XXXXXXXXXX` 형태. **복사해 두세요.**

### 2-2. 티스토리에 측정 ID 연결

1. 티스토리 → **플러그인** → **「구글 애널리틱스」** → **사용하기**
2. 설정에 **측정 ID** (`G-XXXXXXXXXX`) 붙여넣기 → 저장

> 스킨에 gtag 스크립트를 직접 넣지 마세요. 플러그인이 모든 페이지에 정확히 삽입해 줍니다.

### 2-3. 속성 ID 확인 (숫자)

API 가 쓰는 건 측정 ID(`G-...`)가 **아니라** 속성 ID(숫자)입니다.

GA4 → **관리 → 속성 → 속성 세부정보** → 우측 상단 **속성 ID**: `123456789` 같은 9자리 숫자.
**이 숫자를 저에게 알려주세요.**

---

## STEP 3. Google Cloud 서비스계정 발급

API 를 서버에서 호출하려면 사람 계정이 아닌 **서비스계정**이 필요합니다.

> 메뉴를 찾지 말고 **아래 링크로 바로 이동**하세요. Google Cloud 는 메뉴 구조가 자주 바뀝니다.
> 각 화면 상단의 **프로젝트 선택기에 `myblog-autopilot` 이 떠 있는지** 매번 확인하세요. 다른 프로젝트에 만들면 안 보입니다.

### 3-1. 프로젝트 만들기

→ **https://console.cloud.google.com/projectcreate**

| 영어 UI | 입력 |
|---|---|
| Project name | `myblog-autopilot` |
| Location | No organization (그대로) |

**CREATE** 클릭 → 생성 알림이 뜨면 **SELECT PROJECT** 로 전환.

### 3-2. API 두 개 켜기

각 링크로 이동해서 파란 **ENABLE** 버튼만 누르면 됩니다.

| API | 직접 링크 |
|---|---|
| Google Analytics Data API | https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com |
| Google Search Console API | https://console.cloud.google.com/apis/library/searchconsole.googleapis.com |

이미 켜져 있으면 **MANAGE** 로 보입니다. 그럼 통과입니다.

> AdSense Management API 는 애드센스 승인 후에 추가합니다. 서비스계정을 지원하지 않아 OAuth 를 따로 씁니다.

### 3-3. 서비스계정 만들기

→ **https://console.cloud.google.com/iam-admin/serviceaccounts**

상단 **+ CREATE SERVICE ACCOUNT** 클릭. 3단계 마법사가 나옵니다:

| 단계 | 영어 화면 이름 | 할 일 |
|---|---|---|
| 1 | **Service account details** | Service account name 에 `blog-collector` 입력 (ID 는 자동) → **CREATE AND CONTINUE** |
| 2 | **Grant this service account access to project** *(optional)* | **아무것도 선택하지 말고** → **CONTINUE** |
| 3 | **Grant users access to this service account** *(optional)* | 비워둔 채 → **DONE** |

2단계에서 역할(Role)을 고르지 않는 게 맞습니다. 프로젝트 권한은 필요 없고, 실제 권한은 STEP 4 에서 GA4·Search Console 쪽에 각각 초대하는 방식으로 줍니다.

### 3-4. 키(JSON) 다운로드

1. 목록에서 방금 만든 **blog-collector** 의 이메일을 클릭
2. 상단 탭에서 **KEYS**
3. **ADD KEY → Create new key**
4. Key type: **JSON** 선택 → **CREATE**
5. `.json` 파일이 자동 다운로드됩니다 (한 번만 받을 수 있으니 잘 보관)
6. 서비스계정 **이메일**을 복사해 두세요. STEP 4 에서 씁니다:
   ```
   blog-collector@myblog-autopilot.iam.gserviceaccount.com
   ```

### 3-5. 이 단계에서 막히는 경우

| 증상 | 원인 | 조치 |
|---|---|---|
| **+ CREATE SERVICE ACCOUNT** 가 회색 | 프로젝트가 선택 안 됨 | 상단 프로젝트 선택기에서 `myblog-autopilot` 선택 |
| `You do not have permission` | 다른 계정으로 로그인됨 | 우측 상단 계정 확인. 프로젝트를 만든 계정이어야 함 |
| **CREATE** 눌러도 키가 안 받아짐 | 조직 정책 `disableServiceAccountKeyCreation` | 개인 Gmail 계정이면 해당 없음. 회사 Workspace 계정이면 개인 계정으로 프로젝트를 새로 만드세요 |
| Library 에서 API 검색이 안 됨 | 프로젝트 미선택 | 위와 동일 |

### 3-5. 파일 배치

다운로드한 JSON 을 아래 경로로 옮깁니다:

```bash
mv ~/Downloads/myblog-autopilot-*.json \
   /home/yongbot-admin/workspace/myBlog/secrets/gcp-service-account.json
chmod 600 /home/yongbot-admin/workspace/myBlog/secrets/gcp-service-account.json
```

`secrets/` 는 `.gitignore` 에 있어 git 에 올라가지 않습니다.

---

## STEP 4. 서비스계정에 권한 주기

키를 만들었다고 데이터가 보이는 게 아닙니다. **각 서비스에서 따로 초대**해야 합니다.

### 4-1. GA4 에 추가

1. GA4 → **관리 → 속성 → 속성 액세스 관리**
2. 우측 상단 **+ → 사용자 추가**
3. 이메일: `blog-collector@....iam.gserviceaccount.com`
4. 역할: **뷰어**
5. **이메일 알림 보내기** 체크 해제 → **추가**

### 4-2. Search Console 에 추가

1. Search Console → 속성 선택 → 왼쪽 아래 **설정 → 사용자 및 권한**
2. **사용자 추가**
3. 이메일: 같은 서비스계정 이메일
4. 권한: **전체** (제한적으로는 API 조회가 막힐 수 있습니다)
5. **추가**

---

## STEP 5. 저에게 알려주실 것

```
GA4 속성 ID (숫자 9자리): ____________
서비스계정 JSON 배치 완료: 예 / 아니오
GA4 권한 부여 완료:       예 / 아니오
GSC 권한 부여 완료:       예 / 아니오
GSC 소유권 확인 완료:      예 / 아니오
```

이게 오면 `.env` 를 채우고 Phase 4(수집) → 5(리포트) → 6(자동 최적화)를 이어서 만듭니다.

---

## 자주 막히는 곳

| 증상 | 원인 | 조치 |
|---|---|---|
| GSC 소유권 확인 실패 | 메타 태그가 `<head>` 에 없음 | 블로그 방문 → 소스보기(Ctrl+U) → `google-site-verification` 검색해 실제로 들어갔는지 확인 |
| 「도메인」 방식으로 등록됨 | DNS 필요 | 속성 삭제 후 「URL 접두어」로 재등록 |
| API 호출 시 403 | 서비스계정 초대 누락 | STEP 4 를 다시 확인. 키 발급만으로는 권한이 없습니다 |
| GA4 에 데이터 0 | 측정 ID 미연결 또는 반영 대기 | 플러그인 설정 확인 후 24시간 대기. 실시간 보고서로 즉시 확인 가능 |
| 사이트맵 「가져올 수 없음」 | 제출 직후 | 몇 시간 뒤 자동으로 「성공」 으로 바뀝니다 |
