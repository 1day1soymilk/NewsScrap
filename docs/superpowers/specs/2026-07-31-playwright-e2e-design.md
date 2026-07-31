# Playwright E2E 테스트 스위트 설계

**Goal:** `App.tsx` 오케스트레이션과 `WordCloud.tsx` 렌더링 — 단위 테스트가 닿지 못하는
두 곳 — 을 실제 브라우저로 검증하는 상시 회귀 스위트를 만든다.

**배경:** `CLAUDE.md` 의 Testing notes 는 "d3-cloud 가 canvas 로 텍스트를 측정하므로
jsdom 에서는 검증할 수 없고, 렌더된 클라우드를 확인하려면 실제 브라우저를 몰아야 한다"고
적어 두었다. 이 스펙은 그 문장이 가리키는 구멍을 메운다.

## 결정 사항 요약

| 항목 | 결정 |
|---|---|
| 수명 | 저장소에 남기는 상시 회귀 스위트 |
| 데이터 소스 | 하이브리드 — 동작 테스트 5개는 모킹, 스모크 1개만 실제 Supabase |
| 셀렉터 | role/text 전용. **소스 코드는 수정하지 않는다** |
| 스코프 | 핵심 배선 6개. 이미 단위 테스트가 있는 컴포넌트 내부 동작은 재검증하지 않는다 |
| 실행 환경 | 로컬 전용, Chromium 단독. CI 없음 |

## 범위

**포함:** 앱 부팅부터 워드클라우드 렌더까지의 배선, 단어 클릭 → 헤드라인 패널 왕복,
카테고리 전환 시 클라우드 교체, 빈 상태, 쿼리 실패 후 재시도, 실제 DB 연결 스모크.

**제외 (의도적):**

- `CategoryTabs` / `HeadlinePanel` 의 내부 동작 — `src/components/*.test.tsx` 가 이미 덮는다.
- 폰트 크기 계산 — `wordCloudLayout.test.ts` 가 이미 덮는다.
- 6개 카테고리 개별 데이터 검증, 날짜 `min`/`max` 경계, 패널을 연 채 카테고리 변경 —
  유지보수 비용 대비 회귀 방지 효과가 낮다.
- RLS 쓰기 차단 검증 — 브라우저 E2E 가 아니라 SQL/API 레벨의 관심사다.

## 아키텍처

### 파일 구조

```
e2e/
  support/
    fixtures.ts        # PostgREST 응답 형태의 고정 데이터
    mockSupabase.ts    # page.route 가로채기 + 테이블별 분기
  wordcloud.spec.ts    # 모킹 기반 동작 테스트 5개
  smoke.spec.ts        # 실제 백엔드 스모크 1개
playwright.config.ts
tsconfig.e2e.json
```

### 기존 도구와의 격리

이 프로젝트에는 E2E 를 조용히 망가뜨리는 함정이 세 개 있다.

**1. Vitest 전역 타입 충돌.** `tsconfig.app.json` 은 `"types": ["vite/client",
"vitest/globals", "@testing-library/jest-dom/vitest"]` 로 Vitest 의 `test`/`expect` 를
전역에 올린다. Playwright 의 동명 export 와 충돌하므로 E2E 는 `src/` 밖에 두고 별도
TypeScript 프로젝트를 갖는다. Playwright 는 `test`/`expect` 를 `@playwright/test` 에서
명시적으로 import 하므로 `types` 에 `node` 만 있으면 된다.

`tsconfig.e2e.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.e2e.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["e2e", "playwright.config.ts"]
}
```

`moduleResolution: "bundler"` 를 쓰는 이유는 Playwright 의 로더가 확장자 없는 상대
import 를 해석하기 때문이다. `nodenext` 로 두면 `./support/mockSupabase.js` 처럼 써야 해서
실제 런타임 동작과 어긋난다.

**2. 타입 체크 누락.** `CLAUDE.md` 는 "빌드를 통과시키려고 테스트를 타입 체크에서 제외하지
말라"고 못박는다. `tsconfig.json` 의 `references` 에 `./tsconfig.e2e.json` 을 추가해
`npm run build` 가 E2E 코드까지 검사하게 한다.

**3. Vitest 가 E2E 파일을 수집.** Vitest 의 기본 `include` 는 `**/*.{test,spec}.?(c|m)[jt]s?(x)`
라서 `e2e/*.spec.ts` 를 주워 실행하고 실패한다. `vitest.config.ts` 에 exclude 를 추가하되
**기본값을 반드시 보존한다**:

```ts
import { configDefaults, defineConfig } from 'vitest/config'

// test: { exclude: [...configDefaults.exclude, 'e2e/**'] }
```

`configDefaults.exclude` 를 펼치지 않고 `['e2e/**']` 만 쓰면 `node_modules` 가 다시
수집 대상이 된다.

### Playwright 설정

```ts
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
```

`viewport` 는 반드시 `...devices['Desktop Chrome']` **뒤에** 와야 한다. 스프레드가
`1280x720` 을 싣고 오기 때문에, 앞에 두면 조용히 덮어써진다.

## `mockSupabase` 인터페이스

```ts
type Rows = Record<string, unknown>[]
type TableName = 'categories' | 'collected_dates' | 'daily_word_counts' | 'headline_nouns'

interface MockOptions {
  categories?: Rows | ((params: URLSearchParams) => Rows)
  collected_dates?: Rows | ((params: URLSearchParams) => Rows)
  daily_word_counts?: Rows | ((params: URLSearchParams) => Rows)
  headline_nouns?: Rows | ((params: URLSearchParams) => Rows)
  failOn?: TableName
}

async function mockSupabase(page: Page, options?: MockOptions): Promise<void>
```

`**/rest/v1/**` 를 가로채 URL pathname 의 마지막 세그먼트로 테이블을 판별하고, 지정되지
않은 테이블은 기본 픽스처로 응답한다.

**함수 형태를 허용하는 이유는 단 하나** — 카테고리 전환 테스트가 `category_slug` 파라미터
(`is.null` vs `eq.economy`)에 따라 다른 행을 돌려줘야 하기 때문이다. 쿼리 엔진을 만들지
않고 이 한 가지 변주만 해결한다.

**재시도 테스트에는 함수가 필요 없다.** `mockSupabase` 는 등록 전에 항상
`page.unroute('**/rest/v1/**')` 를 먼저 호출한다. 그러면 다시 호출하는 것만으로 이전
핸들러가 결정적으로 교체된다:

```ts
await mockSupabase(page, { failOn: 'daily_word_counts' })
// ... 에러 확인 ...
await mockSupabase(page)              // 이전 핸들러를 걷어내고 교체
await page.getByRole('button', { name: '다시 시도' }).click()
```

핸들러 매칭 순서(나중에 등록한 것이 우선한다는 Playwright 의 동작)에 의존하지 않으려고
`unroute` 를 쓴다. 순서 의존은 버전에 따라 달라질 수 있고, 테스트를 읽는 사람에게도
드러나지 않는다.

실패 응답은 PostgREST 형태(`{ message, code }`)로 status 500 을 돌려준다. 이렇게 해야
`src/lib/queries.ts:13` 의 `queryError()` 가 만드는 `message (code)` 포맷이 실제로
검증되고, `[object Object]` 회귀가 다시 들어오는 것을 막는다.

### 픽스처

`collected_dates` 는 오늘 날짜로 생성한다 — 앱이 `todayInSeoul()` 로 기본 날짜를 잡으므로
날짜 입력의 `min`/`max` 가 일관되게 보인다. 단어 픽스처는 **짧은 단어 3개**만 쓴다
(아래 안정성 규칙 참고).

| 픽스처 | 내용 |
|---|---|
| `CATEGORIES` | 실제 6개 slug/label (`politics`/정치 … `it`/IT/과학) |
| `COLLECTED_DATES` | 오늘 날짜 1건 |
| `DEFAULT_WORD_COUNTS` | 예산안 5, 여야 3, 국회 1 |
| `ECONOMY_WORD_COUNTS` | 금리 4, 환율 2 |
| `HEADLINE_ROWS` | `{ word, headlines: { id, title, link, collected_date, categories: { slug } } }` 중첩 형태 |

## 테스트 명세

| # | 파일 | 검증 내용 |
|---|---|---|
| 1 | `wordcloud.spec.ts` | 부팅 후 픽스처 단어 3개가 `svg text` 로 모두 보인다 |
| 2 | `wordcloud.spec.ts` | 최다 빈도 단어 클릭 → 패널 열림, 제목이 `"예산안" 관련 헤드라인`, 링크 `href` 가 픽스처와 일치 → `닫기` → 패널 사라짐 |
| 3 | `wordcloud.spec.ts` | `경제` 탭 클릭 → 경제 단어가 보이고 전체 단어는 사라진다 |
| 4 | `wordcloud.spec.ts` | `daily_word_counts` 가 빈 배열 → `아직 수집된 데이터가 없습니다.` |
| 5 | `wordcloud.spec.ts` | 쿼리 500 → 에러 문구 + `다시 시도` 노출, 성공 mock 덧씌운 뒤 클릭 → 클라우드 복구 |
| 6 | `smoke.spec.ts` | **실제 DB**: `nav` 안의 버튼이 7개, `다시 시도` 버튼이 존재하지 않음 |
| 7 | `smoke.spec.ts` | 백엔드와 무관하게 `<h1>` 이 렌더된다 |

7번은 하네스를 세울 때 먼저 만드는 테스트다 — 모킹도 `.env` 도 필요 없으므로, 스위트가
무너졌을 때 "브라우저 구동 자체가 실패한 것"과 "백엔드가 문제인 것"을 구분해 준다.
그 진단 가치 때문에 하네스 검증용 임시 테스트로 쓰고 버리지 않고 남긴다.

### 스모크 테스트가 카테고리를 단언하는 이유

"워드클라우드에 단어가 있다"를 단언하면 **매일 아침 6시간씩 실패한다**. 수집 크론이
13:00 KST 로 옮겨졌으므로, 자정부터 13시까지는 `todayInSeoul()` 기준 그날 데이터가
정상적으로 비어 있다.

반면 `categories` 테이블은 마이그레이션이 심는 고정 6행이고 이후 변하지 않는다. 따라서
**카테고리 탭 7개(전체 + 6)** 는 수집 상태와 무관하게 항상 참이면서, 동시에
env var 주입 → Supabase 연결 → 스키마 → RLS select 정책이 모두 살아 있음을 증명한다.

## 셀렉터 매핑

소스를 수정하지 않고 전부 도달 가능함을 확인했다.

| 대상 | 셀렉터 |
|---|---|
| 제목 | `getByRole('heading', { name: '오늘의 주요 뉴스 스크랩' })` |
| 카테고리 버튼 | `getByRole('button', { name: '경제' })` |
| 카테고리 영역 | `getByRole('navigation')` — `<nav>` 의 암묵적 role |
| 워드클라우드 단어 | `page.locator('svg text')` |
| 헤드라인 패널 | `getByRole('complementary')` — `<aside>` 의 암묵적 role |
| 닫기 / 다시 시도 | `getByRole('button', { name: ... })` |
| 빈 상태 | `getByText('아직 수집된 데이터가 없습니다.')` |
| 날짜 입력 | `page.locator('input[type="date"]')` |

## 안정성 규칙

플레이키를 만드는 원인이 이 앱에는 네 가지 있다.

**단어 개수를 단언하지 않는다.** d3-cloud 는 canvas 로 텍스트를 측정해 배치하고, 들어가지
않는 단어는 조용히 버린다. `toHaveCount()` 는 폰트 렌더링 차이만으로 깨진다. 대신 픽스처를
짧은 단어 3개로 제한하고 **특정 단어가 보이는지**로 단언한다.

**클릭 대상은 `count` 가 가장 큰 단어로 고정한다.** 폰트가 가장 크고 가장 먼저 배치되므로
반드시 존재한다.

**`불러오는 중...` 은 단언하지 않는다.** 모킹 응답이 즉시 도착해 관측 불가능한 순간에
스쳐 지나간다.

**뷰포트를 1280×900 으로 고정한다.** `HeadlinePanel` 은 `fixed right-0 w-80`(320px) 이라
좁은 화면에서 클라우드 오른쪽을 덮는다. 패널을 연 채 다른 단어를 클릭하는 시나리오는
스코프에서 제외했으므로 이 고정만으로 충분하다.

## 실행 전제 — `.env` 복구

현재 이 작업 환경에는 `.env` 가 없다. `.env.local` 에는 `VERCEL_OIDC_TOKEN` 만 있어
`import.meta.env.VITE_SUPABASE_URL` 이 `undefined` 이고, `src/lib/supabaseClient.ts:24` 의
`http://localhost:54321` 폴백이 걸린다.

**모킹 테스트 5개는 이 상태로도 통과한다** — 폴백 URL 도 `/rest/v1/...` 경로를 그대로
쓰므로 `**/rest/v1/**` 글롭에 걸리고, `page.route` 는 요청이 나가기 전에 가로챈다.
실패하는 것은 **스모크 테스트 1개뿐**이다.

그래도 구현 첫 단계에서 복구한다. 스모크가 이 스위트에서 env 배선을 검증하는 유일한
테스트이고, `npm run dev` 로 수동 확인할 때도 필요하기 때문이다:

```bash
npx vercel env pull .env --environment=development
```

Vercel 프로젝트에 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 가 세 환경 모두
등록되어 있으므로 그대로 내려온다. `.env` 는 `.gitignore` 의 `.env*` 규칙에 걸려 커밋되지
않는다.

## 부수 변경

- `package.json`: `"test:e2e": "playwright test"` 추가. `npm test` 는 Vitest 그대로 둔다.
- `.gitignore`: `test-results/`, `playwright-report/` 추가.
- `CLAUDE.md` Testing notes: "렌더된 클라우드를 확인하려면 실제 브라우저를 몰아야 한다"는
  문장이 더 이상 미해결 과제가 아니므로, E2E 스위트의 존재와 실행 방법을 가리키도록 갱신한다.

## 검증 방법

구현 완료 조건은 다음 세 가지가 모두 통과하는 것이다.

1. `npm run build` — E2E 코드까지 타입 체크되며 성공한다.
2. `npm test` — Vitest 가 기존 테스트만 실행하고, `e2e/` 를 수집하지 않는다.
3. `npm run test:e2e` — 7개 테스트가 모두 통과한다.
