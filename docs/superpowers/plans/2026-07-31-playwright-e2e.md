# Playwright E2E 테스트 스위트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단위 테스트가 닿지 못하는 `App.tsx` 오케스트레이션과 `WordCloud.tsx` 렌더링을 실제 Chromium 으로 검증하는 상시 회귀 스위트를 만든다.

**Architecture:** `e2e/` 디렉터리에 Playwright 스위트를 두고 별도 TypeScript 프로젝트(`tsconfig.e2e.json`)로 분리한다. 동작 테스트 5개는 `page.route` 로 Supabase REST 응답을 가로채 고정 픽스처를 먹이고, 스모크 1개만 실제 프로젝트에 붙는다. 프론트엔드 소스는 수정하지 않는다 — 셀렉터는 전부 role/text 로 해결한다.

**Tech Stack:** Playwright 1.62.1 (`@playwright/test`), Chromium 단독, Vite dev server(포트 5173), 기존 Vitest 스위트는 그대로 유지.

**Spec:** [설계 문서](../specs/2026-07-31-playwright-e2e-design.md)

## Global Constraints

- **프론트엔드 소스(`src/**`)를 수정하지 않는다.** `data-testid` 를 추가하지 않고 role/text 셀렉터만 쓴다.
- **타입 체크를 우회하지 않는다.** `tsconfig.json` 의 `references` 에 E2E 프로젝트를 추가해 `npm run build` 가 검사하게 한다. 테스트를 `exclude` 로 빼서 빌드를 통과시키는 것은 `CLAUDE.md` 가 금지한다.
- **워드클라우드의 단어 개수를 단언하지 않는다.** d3-cloud 는 canvas 측정으로 배치하고 안 들어가는 단어를 조용히 버린다. 특정 단어의 가시성으로만 단언한다.
- **`불러오는 중...` 을 단언하지 않는다.** 모킹 응답이 즉시 도착해 관측 불가능하다.
- 픽스처 행 타입은 반드시 `type` 별칭으로 선언한다. `interface` 는 암묵적 인덱스 시그니처가 없어 `Record<string, unknown>[]` 에 할당되지 않는다.
- 커밋 메시지는 영어 명령형으로 쓴다 (기존 이력과 동일).

---

### Task 1: Playwright 하네스 구축 및 기존 도구와의 격리

**Files:**
- Create: `playwright.config.ts`
- Create: `tsconfig.e2e.json`
- Create: `e2e/smoke.spec.ts`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm run test:e2e` 명령. `e2e/` 디렉터리와 baseURL `http://localhost:5173`.

이 태스크의 핵심은 테스트 자체가 아니라 **격리**다. 이 저장소에는 E2E 를 조용히 망가뜨리는 함정이 세 개 있고, 이 태스크가 전부 막는다.

- [ ] **Step 1: Playwright 설치**

```bash
npm i -D @playwright/test@1.62.1
npx playwright install chromium
```

- [ ] **Step 2: `tsconfig.e2e.json` 작성**

`tsconfig.app.json` 은 `"types"` 에 `vitest/globals` 를 실어 Vitest 의 `test`/`expect` 를 전역에 올린다. Playwright 의 동명 export 와 충돌하므로 E2E 는 별도 프로젝트를 갖는다. Playwright 는 `test`/`expect` 를 명시적으로 import 하므로 `types` 에 `node` 만 있으면 된다.

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

`moduleResolution` 이 `bundler` 인 이유는 Playwright 로더가 확장자 없는 상대 import 를 해석하기 때문이다. `nodenext` 로 두면 `./support/mockSupabase.js` 라고 써야 해서 실제 동작과 어긋난다.

- [ ] **Step 3: `tsconfig.json` 에 프로젝트 참조 추가**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.functions.json" },
    { "path": "./tsconfig.e2e.json" }
  ]
}
```

- [ ] **Step 4: `vitest.config.ts` 에 exclude 추가**

Vitest 의 기본 `include` 는 `**/*.{test,spec}.?(c|m)[jt]s?(x)` 라서 `e2e/*.spec.ts` 를 주워 실행하고 실패한다.

```ts
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Vitest's default include picks up e2e/*.spec.ts, which import
    // @playwright/test and fail under Vitest. Spread the defaults — replacing
    // them outright would put node_modules back in scope.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
```

`configDefaults` 를 펼치지 않고 `['e2e/**']` 만 쓰면 `node_modules` 가 다시 수집 대상이 된다.

- [ ] **Step 5: `playwright.config.ts` 작성**

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      // viewport MUST come after the spread: devices['Desktop Chrome'] carries
      // 1280x720, and HeadlinePanel (fixed right-0, 320px wide) overlaps the
      // centred word cloud on shorter viewports.
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

- [ ] **Step 6: `package.json` 에 스크립트 추가**

`scripts` 에 아래 한 줄을 추가한다. `test` 는 Vitest 그대로 둔다.

```json
"test:e2e": "playwright test"
```

- [ ] **Step 7: `.gitignore` 에 Playwright 산출물 추가**

파일 끝에 추가한다:

```
# Playwright output.
test-results/
playwright-report/
```

- [ ] **Step 8: 하네스를 검증하는 첫 테스트 작성**

이 단언은 데이터나 `.env` 없이도 성립한다 — `App.tsx` 는 로딩/에러 상태와 무관하게 `<h1>` 을 항상 렌더한다. Task 6 에서 이 파일에 실제 백엔드 단언을 덧붙인다.

```ts
// e2e/smoke.spec.ts
import { expect, test } from '@playwright/test'

test('renders the app shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '오늘의 주요 뉴스 스크랩' })).toBeVisible()
})
```

- [ ] **Step 9: E2E 테스트 실행해 통과 확인**

Run: `npm run test:e2e`
Expected: 1 passed. Playwright 가 `npm run dev` 를 자동 기동한다.

- [ ] **Step 10: Vitest 가 E2E 를 수집하지 않는지 확인**

Run: `npm test`
Expected: 기존 테스트만 PASS. 출력에 `e2e/` 경로가 **등장하지 않아야** 한다.

- [ ] **Step 11: 빌드가 E2E 까지 타입 체크하는지 확인**

Run: `npm run build`
Expected: 성공. (`tsc -b` 가 이제 프로젝트 4개를 빌드한다.)

- [ ] **Step 12: 커밋**

```bash
git add playwright.config.ts tsconfig.e2e.json tsconfig.json vitest.config.ts package.json package-lock.json .gitignore e2e/smoke.spec.ts
git commit -m "Add Playwright harness isolated from the Vitest setup"
```

---

### Task 2: 픽스처와 Supabase 모킹 헬퍼

**Files:**
- Create: `e2e/support/fixtures.ts`
- Create: `e2e/support/mockSupabase.ts`
- Create: `e2e/wordcloud.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 Playwright 설정.
- Produces:
  - `mockSupabase(page: Page, options?: MockOptions): Promise<void>`
  - `MockOptions = { categories?: RowsOrFn; collected_dates?: RowsOrFn; daily_word_counts?: RowsOrFn; headline_nouns?: RowsOrFn; failOn?: TableName }`
  - `RowsOrFn = Rows | ((params: URLSearchParams) => Rows)`, `Rows = Record<string, unknown>[]`
  - `TableName = 'categories' | 'collected_dates' | 'daily_word_counts' | 'headline_nouns'`
  - 픽스처 상수 `CATEGORIES`, `COLLECTED_DATES`, `DEFAULT_WORD_COUNTS`, `ECONOMY_WORD_COUNTS`, `HEADLINE_ROWS`, 헬퍼 `todayInSeoul()`

- [ ] **Step 1: 픽스처 작성**

행 타입은 반드시 `type` 별칭으로 선언한다. `interface` 는 암묵적 인덱스 시그니처를 갖지 않아 `Record<string, unknown>[]` 에 할당할 때 컴파일 에러가 난다.

```ts
// e2e/support/fixtures.ts
export type CategoryRow = { id: string; slug: string; label: string }
export type WordCountRow = { word: string; count: number }
export type CollectedDateRow = { collected_date: string }
export type HeadlineNounRow = {
  word: string
  headlines: {
    id: string
    title: string
    link: string
    collected_date: string
    categories: { slug: string }
  }
}

// Mirrors todayInSeoul() in src/App.tsx so the date input's min/max line up
// with the date the app asks for on load.
export function todayInSeoul(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

// Order matches fetchCategories()'s `.order('section_id')`.
export const CATEGORIES: CategoryRow[] = [
  { id: '00000000-0000-4000-8000-000000000100', slug: 'politics', label: '정치' },
  { id: '00000000-0000-4000-8000-000000000101', slug: 'economy', label: '경제' },
  { id: '00000000-0000-4000-8000-000000000102', slug: 'society', label: '사회' },
  { id: '00000000-0000-4000-8000-000000000103', slug: 'culture', label: '생활/문화' },
  { id: '00000000-0000-4000-8000-000000000104', slug: 'world', label: '세계' },
  { id: '00000000-0000-4000-8000-000000000105', slug: 'it', label: 'IT/과학' },
]

export const COLLECTED_DATES: CollectedDateRow[] = [{ collected_date: todayInSeoul() }]

// Three short words only: d3-cloud drops whatever does not fit the canvas, and
// short strings at 700x450 are certain to be placed.
export const DEFAULT_WORD_COUNTS: WordCountRow[] = [
  { word: '예산안', count: 5 },
  { word: '여야', count: 3 },
  { word: '국회', count: 1 },
]

export const ECONOMY_WORD_COUNTS: WordCountRow[] = [
  { word: '금리', count: 4 },
  { word: '환율', count: 2 },
]

// Shape matches the nested select in fetchHeadlinesForWord().
export const HEADLINE_ROWS: HeadlineNounRow[] = [
  {
    word: '예산안',
    headlines: {
      id: '00000000-0000-4000-8000-00000000aaa1',
      title: '여야 예산안 처리 합의',
      link: 'https://n.news.naver.com/mnews/article/001/0000000001',
      collected_date: todayInSeoul(),
      categories: { slug: 'politics' },
    },
  },
]
```

- [ ] **Step 2: 모킹 헬퍼 작성**

**CORS 처리가 필수다.** 앱은 `localhost:5173` 에서 돌고 Supabase 는 다른 오리진이므로 브라우저가 preflight `OPTIONS` 를 먼저 보낸다. CORS 헤더 없이 응답하면 브라우저가 본 요청을 차단해 테스트가 전부 실패한다. (`.env` 가 없어 `localhost:54321` 폴백이 걸려도 포트가 달라 여전히 cross-origin 이다.)

```ts
// e2e/support/mockSupabase.ts
import type { Page } from '@playwright/test'
import {
  CATEGORIES,
  COLLECTED_DATES,
  DEFAULT_WORD_COUNTS,
  HEADLINE_ROWS,
} from './fixtures'

const SUPABASE_REST_GLOB = '**/rest/v1/**'

export type Rows = Record<string, unknown>[]
export type RowsOrFn = Rows | ((params: URLSearchParams) => Rows)
export type TableName =
  | 'categories'
  | 'collected_dates'
  | 'daily_word_counts'
  | 'headline_nouns'

export type MockOptions = {
  categories?: RowsOrFn
  collected_dates?: RowsOrFn
  daily_word_counts?: RowsOrFn
  headline_nouns?: RowsOrFn
  failOn?: TableName
}

// The app is served from localhost:5173 and Supabase is a different origin, so
// the browser sends a preflight OPTIONS before every REST call. Fulfilling
// without these headers makes the browser block the real request.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Expose-Headers': 'content-range',
}

const DEFAULTS: Record<TableName, Rows> = {
  categories: CATEGORIES,
  collected_dates: COLLECTED_DATES,
  daily_word_counts: DEFAULT_WORD_COUNTS,
  headline_nouns: HEADLINE_ROWS,
}

function resolveRows(value: RowsOrFn | undefined, fallback: Rows, params: URLSearchParams): Rows {
  if (value === undefined) return fallback
  return typeof value === 'function' ? value(params) : value
}

export async function mockSupabase(page: Page, options: MockOptions = {}): Promise<void> {
  // Re-registering must replace rather than stack: the retry test installs a
  // failing mock and then a succeeding one. Relying on Playwright's handler
  // precedence would hide that intent and is version-dependent.
  await page.unroute(SUPABASE_REST_GLOB)

  await page.route(SUPABASE_REST_GLOB, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS })
      return
    }

    const url = new URL(route.request().url())
    const table = url.pathname.split('/').pop() as TableName

    if (options.failOn === table) {
      await route.fulfill({
        status: 500,
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'mocked failure',
          code: 'PGRST500',
          details: null,
          hint: null,
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: JSON.stringify(resolveRows(options[table], DEFAULTS[table] ?? [], url.searchParams)),
    })
  })
}
```

- [ ] **Step 3: 첫 워드클라우드 테스트 작성**

`filter({ hasText: /^…$/ })` 로 정규식을 앵커해 부분 일치를 막는다.

```ts
// e2e/wordcloud.spec.ts
import { expect, test } from '@playwright/test'
import { mockSupabase } from './support/mockSupabase'

test('renders every fixture word in the cloud', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  const words = page.locator('svg text')
  await expect(words.filter({ hasText: /^예산안$/ })).toBeVisible()
  await expect(words.filter({ hasText: /^여야$/ })).toBeVisible()
  await expect(words.filter({ hasText: /^국회$/ })).toBeVisible()
})
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx playwright test e2e/wordcloud.spec.ts`
Expected: PASS

실패하고 화면에 `아직 수집된 데이터가 없습니다.` 가 보이면 CORS 헤더 누락이거나 route 글롭이 안 맞는 것이다. `npx playwright test --debug` 로 네트워크를 확인한다.

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: 성공

- [ ] **Step 6: 커밋**

```bash
git add e2e/support/fixtures.ts e2e/support/mockSupabase.ts e2e/wordcloud.spec.ts
git commit -m "Add Supabase route mock and word cloud render test"
```

---

### Task 3: 단어 클릭 → 헤드라인 패널 왕복

**Files:**
- Modify: `e2e/wordcloud.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `mockSupabase`, `HEADLINE_ROWS`.

`<aside>` 의 암묵적 role 은 `complementary` 다. 클릭 대상은 `count` 가 가장 큰 `예산안` 으로 고정한다 — 폰트가 가장 크고 가장 먼저 배치되므로 반드시 존재한다.

- [ ] **Step 1: 테스트 추가**

`e2e/wordcloud.spec.ts` 파일 끝에 추가한다:

```ts
test('opens and closes the headline panel for a clicked word', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  await page.locator('svg text').filter({ hasText: /^예산안$/ }).click()

  const panel = page.getByRole('complementary')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading', { name: '"예산안" 관련 헤드라인' })).toBeVisible()

  const link = panel.getByRole('link', { name: '여야 예산안 처리 합의' })
  await expect(link).toHaveAttribute(
    'href',
    'https://n.news.naver.com/mnews/article/001/0000000001',
  )
  await expect(link).toHaveAttribute('target', '_blank')

  await panel.getByRole('button', { name: '닫기' }).click()
  await expect(panel).toBeHidden()
})
```

링크는 `target="_blank"` 이므로 **클릭하지 않고 속성만 단언한다.** 클릭하면 새 탭이 열려 팝업 처리가 필요해진다.

- [ ] **Step 2: 테스트 실행해 통과 확인**

Run: `npx playwright test e2e/wordcloud.spec.ts`
Expected: 2 passed

- [ ] **Step 3: 커밋**

```bash
git add e2e/wordcloud.spec.ts
git commit -m "Test headline panel round trip on word click"
```

---

### Task 4: 카테고리 전환 시 클라우드 교체

**Files:**
- Modify: `e2e/wordcloud.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `mockSupabase`, `DEFAULT_WORD_COUNTS`, `ECONOMY_WORD_COUNTS`.

`fetchWordCounts` 는 전체 선택 시 `category_slug=is.null`, 카테고리 선택 시 `category_slug=eq.<slug>` 를 보낸다. `mockSupabase` 의 함수 형태는 바로 이 분기를 위해 존재한다.

- [ ] **Step 1: import 확장**

`e2e/wordcloud.spec.ts` 상단의 import 를 아래로 바꾼다:

```ts
import { expect, test } from '@playwright/test'
import { DEFAULT_WORD_COUNTS, ECONOMY_WORD_COUNTS } from './support/fixtures'
import { mockSupabase } from './support/mockSupabase'
```

- [ ] **Step 2: 테스트 추가**

파일 끝에 추가한다:

```ts
test('swaps the cloud when a category is selected', async ({ page }) => {
  await mockSupabase(page, {
    daily_word_counts: (params) =>
      params.get('category_slug') === 'eq.economy' ? ECONOMY_WORD_COUNTS : DEFAULT_WORD_COUNTS,
  })
  await page.goto('/')

  const words = page.locator('svg text')
  await expect(words.filter({ hasText: /^예산안$/ })).toBeVisible()

  await page.getByRole('button', { name: '경제' }).click()

  await expect(words.filter({ hasText: /^금리$/ })).toBeVisible()
  await expect(words.filter({ hasText: /^예산안$/ })).toHaveCount(0)
})
```

- [ ] **Step 3: 테스트 실행해 통과 확인**

Run: `npx playwright test e2e/wordcloud.spec.ts`
Expected: 3 passed

- [ ] **Step 4: 커밋**

```bash
git add e2e/wordcloud.spec.ts
git commit -m "Test category switch swaps the word cloud"
```

---

### Task 5: 빈 상태와 에러/재시도 경로

**Files:**
- Modify: `e2e/wordcloud.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `mockSupabase` (`failOn` 옵션 포함).

에러 테스트는 `src/lib/queries.ts:13` 의 `queryError()` 회귀를 막는 것이 목적이다. supabase-js 는 에러를 `Error` 가 아닌 평범한 객체로 돌려주므로, 그대로 throw 하면 UI 에 `[object Object]` 가 뜬다.

- [ ] **Step 1: 빈 상태 테스트 추가**

파일 끝에 추가한다:

```ts
test('shows the empty state when the day has no words', async ({ page }) => {
  await mockSupabase(page, { daily_word_counts: [] })
  await page.goto('/')

  await expect(page.getByText('아직 수집된 데이터가 없습니다.')).toBeVisible()
  await expect(page.locator('svg text')).toHaveCount(0)
})
```

- [ ] **Step 2: 에러/재시도 테스트 추가**

파일 끝에 추가한다:

```ts
test('surfaces a query failure and recovers on retry', async ({ page }) => {
  await mockSupabase(page, { failOn: 'daily_word_counts' })
  await page.goto('/')

  const retry = page.getByRole('button', { name: '다시 시도' })
  await expect(retry).toBeVisible()

  // queries.ts wraps the PostgREST error object into a real Error; without that
  // wrapping the UI renders "[object Object]".
  await expect(page.getByText(/mocked failure/)).toBeVisible()
  await expect(page.getByText('[object Object]')).toHaveCount(0)

  await mockSupabase(page)
  await retry.click()

  await expect(page.locator('svg text').filter({ hasText: /^예산안$/ })).toBeVisible()
})
```

- [ ] **Step 3: 전체 E2E 실행해 통과 확인**

Run: `npm run test:e2e`
Expected: 6 passed (`smoke.spec.ts` 1 + `wordcloud.spec.ts` 5)

- [ ] **Step 4: 커밋**

```bash
git add e2e/wordcloud.spec.ts
git commit -m "Test empty state and query failure recovery"
```

---

### Task 6: 실제 백엔드 스모크 및 문서 갱신

**Files:**
- Modify: `e2e/smoke.spec.ts`
- Modify: `CLAUDE.md` (Commands 코드블록과 Testing notes 섹션)
- Create: `.env` (커밋하지 않음)

**Interfaces:**
- Consumes: Task 1 의 `e2e/smoke.spec.ts`.

여기서만 실제 Supabase 에 붙는다. `.env` 가 필요한 유일한 테스트다 — 모킹 테스트 5개는 `localhost:54321` 폴백 상태에서도 `**/rest/v1/**` 글롭에 걸려 정상 동작한다.

- [ ] **Step 1: `.env` 복구**

```bash
npx vercel env pull .env --environment=development
```

Vercel 프로젝트에 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 가 등록되어 있으므로 그대로 내려온다. `.gitignore` 의 `.env*` 규칙에 걸려 커밋되지 않는다.

받은 뒤 두 변수가 들어있는지 **이름만** 확인한다 (값은 출력하지 않는다):

```bash
grep -oE '^VITE_[A-Z_]+=' .env
```

Expected: `VITE_SUPABASE_URL=` 와 `VITE_SUPABASE_ANON_KEY=` 두 줄

- [ ] **Step 2: dev 서버 재기동 필요성 확인**

Vite 는 `.env` 를 기동 시점에만 읽는다. Task 1~5 를 돌리며 띄워둔 dev 서버가 있으면 종료한다. `playwright.config.ts` 의 `reuseExistingServer: true` 때문에 낡은 서버가 재사용되어 `.env` 가 반영되지 않는다.

- [ ] **Step 3: 스모크 테스트 확장**

`e2e/smoke.spec.ts` 를 아래로 교체한다:

```ts
import { expect, test } from '@playwright/test'

// No mocks here on purpose: this is the one test that proves the Vite env vars,
// the Supabase connection, the schema, and the RLS select policies are all live.
test('renders the app shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '오늘의 주요 뉴스 스크랩' })).toBeVisible()
})

test('reaches the real Supabase project', async ({ page }) => {
  await page.goto('/')

  // categories is seeded by migration 0001 and never changes, so this holds
  // regardless of what the collector did that day. Asserting on collected words
  // instead would fail every day between midnight and 13:00 KST, when the cron
  // has not yet run for the date the app asks for.
  await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(7)

  // The retry button only renders when a query failed.
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
})
```

- [ ] **Step 4: 전체 E2E 실행해 통과 확인**

Run: `npm run test:e2e`
Expected: 7 passed

`reaches the real Supabase project` 가 실패하면 `.env` 가 안 잡힌 것이다 — Step 2 로 돌아가 dev 서버를 완전히 종료했는지 확인한다.

- [ ] **Step 5: `CLAUDE.md` 의 Commands 블록 갱신**

`tsc -b` 가 이제 프로젝트 4개를 빌드하고 `test:e2e` 가 생겼다. Commands 코드블록의 처음 네 줄을 아래로 바꾼다:

```
npm run dev            # Vite dev server
npm run build          # tsc -b (all four projects) then vite build
npm test               # full Vitest suite
npm run test:e2e       # Playwright suite (Chromium, boots the dev server itself)
npm run lint           # oxlint
```

- [ ] **Step 6: `CLAUDE.md` 의 Testing notes 섹션 갱신**

기존 문단을 아래로 교체한다:

```markdown
`WordCloud.tsx` and `App.tsx` have no unit tests: d3-cloud measures text on a
canvas, which jsdom does not implement. Their layout arithmetic is extracted into
`src/components/wordCloudLayout.ts`, which is tested. The rendered cloud and the
`App.tsx` wiring around it are covered by the Playwright suite in `e2e/` instead —
`npm run test:e2e`, which boots its own dev server.

Five of those tests stub Supabase at the network layer
(`e2e/support/mockSupabase.ts`), so they do not depend on what was collected that
day. `e2e/smoke.spec.ts` is the only test that hits the real project, and it
asserts the seeded category tabs rather than collected words — nothing exists for
the current date between midnight and 13:00 KST, when the cron runs.

Do not assert on how many words the cloud rendered. d3-cloud silently drops words
that do not fit the canvas, so counts vary with font rendering. Assert that
specific words are visible instead.
```

- [ ] **Step 7: 최종 검증 3종 실행**

```bash
npm run build
npm test
npm run test:e2e
```

Expected: 셋 다 성공. `npm test` 출력에 `e2e/` 가 등장하지 않고, `npm run test:e2e` 는 7 passed.

- [ ] **Step 8: 커밋**

```bash
git add e2e/smoke.spec.ts CLAUDE.md
git commit -m "Add real-backend smoke test and document the E2E suite"
```

---

## 완료 조건

- `npm run build` — E2E 코드까지 타입 체크되며 성공한다.
- `npm test` — Vitest 가 기존 테스트만 실행하고 `e2e/` 를 수집하지 않는다.
- `npm run test:e2e` — 7개 테스트가 모두 통과한다.
- `src/**` 에 변경이 없다 (`git diff --stat main -- src/` 가 비어 있다).
