# 네이버 뉴스 워드클라우드 스크랩 앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이버 뉴스 6개 섹션의 헤드라인을 매일 자동 수집해 명사만 추출한 뒤, 날짜/카테고리별로 워드클라우드로 보여주고 단어 클릭 시 관련 헤드라인을 볼 수 있는 개인용 웹앱을 만든다.

**Architecture:** Supabase(Postgres + Edge Function + pg_cron)가 유일한 백엔드다. Edge Function `collect-headlines`가 `news.naver.com/section/{id}` HTML을 파싱하고 ETRI 형태소분석 API로 명사를 뽑아 DB에 저장한다. 기존 Vite+React 앱은 Supabase를 read-only로 조회해 `d3-cloud` 기반 워드클라우드를 렌더링한다.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind CSS v4, Supabase (Postgres/Edge Functions/pg_cron), `@supabase/supabase-js`, `d3-cloud`, Vitest + Testing Library.

## Global Constraints

- 로그인 불필요, 모든 테이블은 공개 read-only RLS.
- Naver RSS는 폐지되었으므로 절대 사용하지 않는다 — `news.naver.com/section/{id}` HTML 파싱만 사용 ([설계 문서](../specs/2026-07-31-news-wordcloud-design.md) 참조).
- 카테고리(섹션 ID)는 정치=100, 경제=101, 사회=102, 생활/문화=103, 세계=104, IT/과학=105로 고정.
- Edge Function의 순수 로직(HTML 파싱, ETRI 응답 파싱, 명사 필터링)은 Deno 전용 문법(예: `Deno.env`, `npm:` import) 없이 작성해 Vitest(Node)에서도 그대로 테스트한다. Deno 전용 코드는 `index.ts` 오케스트레이션 부분에만 둔다.
- 이 개발 환경에는 Deno CLI, Docker, 연결된 Supabase 프로젝트가 없다. 따라서 이 계획의 태스크는 전부 로컬에서 코드 작성 + Vitest 테스트로 검증하고, Supabase 프로젝트에 실제로 배포/적용하는 것은 마지막 "Deployment" 섹션에 별도로 안내한다 (사용자가 프로젝트 생성 후 진행).

---

### Task 1: Vitest 테스트 도구 세팅

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `src/sanity.test.ts`

**Interfaces:**
- Produces: `npm test` 명령으로 전체 Vitest 스위트 실행.

- [ ] **Step 1: 의존성 설치**

```bash
npm install -D vitest@4 jsdom@30 @testing-library/react@16 @testing-library/jest-dom@7
```

- [ ] **Step 2: `vitest.config.ts` 작성**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
})
```

- [ ] **Step 3: `vitest.setup.ts` 작성**

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: `package.json`의 `scripts`에 `test` 추가**

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "oxlint",
  "preview": "vite preview",
  "test": "vitest run"
}
```

- [ ] **Step 5: 임시 sanity 테스트 작성**

```ts
// src/sanity.test.ts
import { describe, expect, it } from 'vitest'

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: `src/sanity.test.ts` 포함 전체 PASS

- [ ] **Step 7: sanity 테스트 삭제 후 커밋**

```bash
rm src/sanity.test.ts
git add package.json package-lock.json vitest.config.ts vitest.setup.ts
git commit -m "Add Vitest test tooling"
```

---

### Task 2: DB 스키마 마이그레이션

**Files:**
- Create: `supabase/migrations/0001_init_schema.sql`

**Interfaces:**
- Produces: 테이블 `categories(id, slug, label, section_id)`, `headlines(id, category_id, title, link, collected_date, created_at)`, `headline_nouns(id, headline_id, word)`. `categories.slug` 값: `politics`, `economy`, `society`, `culture`, `world`, `it`.

- [ ] **Step 1: 마이그레이션 SQL 작성**

```sql
-- supabase/migrations/0001_init_schema.sql

create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  label text not null,
  section_id text not null
);

create table headlines (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  title text not null,
  link text not null,
  collected_date date not null,
  created_at timestamptz not null default now(),
  unique (category_id, link)
);

create index headlines_collected_date_idx on headlines (collected_date);

create table headline_nouns (
  id bigint generated always as identity primary key,
  headline_id uuid not null references headlines(id) on delete cascade,
  word text not null
);

create index headline_nouns_headline_id_idx on headline_nouns (headline_id);
create index headline_nouns_word_idx on headline_nouns (word);

alter table categories enable row level security;
alter table headlines enable row level security;
alter table headline_nouns enable row level security;

create policy "public read categories" on categories for select using (true);
create policy "public read headlines" on headlines for select using (true);
create policy "public read headline_nouns" on headline_nouns for select using (true);

insert into categories (slug, label, section_id) values
  ('politics', '정치', '100'),
  ('economy', '경제', '101'),
  ('society', '사회', '102'),
  ('culture', '생활/문화', '103'),
  ('world', '세계', '104'),
  ('it', 'IT/과학', '105');
```

- [ ] **Step 2: SQL 문법 검증**

Supabase 프로젝트가 아직 없으므로 실제 적용은 이 태스크의 범위 밖이다 (Deployment 섹션 참고). 대신 각 `create table` / `create policy` / `insert` 문의 괄호와 세미콜론이 맞는지, 컬럼명이 이후 태스크에서 참조하는 이름(`slug`, `section_id`, `collected_date`, `category_id`, `headline_id`, `word`)과 일치하는지 눈으로 재검토한다.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/0001_init_schema.sql
git commit -m "Add initial DB schema migration"
```

---

### Task 3: 헤드라인 HTML 파서

**Files:**
- Create: `supabase/functions/collect-headlines/lib/categories.ts`
- Create: `supabase/functions/collect-headlines/lib/headlines.ts`
- Test: `supabase/functions/collect-headlines/lib/headlines.test.ts`

**Interfaces:**
- Produces: `CATEGORIES: { slug: string; label: string; sectionId: string }[]`, `extractHeadlines(html: string): { title: string; link: string }[]`.

- [ ] **Step 1: 카테고리 목록 작성**

```ts
// supabase/functions/collect-headlines/lib/categories.ts
export interface Category {
  slug: string
  label: string
  sectionId: string
}

export const CATEGORIES: Category[] = [
  { slug: 'politics', label: '정치', sectionId: '100' },
  { slug: 'economy', label: '경제', sectionId: '101' },
  { slug: 'society', label: '사회', sectionId: '102' },
  { slug: 'culture', label: '생활/문화', sectionId: '103' },
  { slug: 'world', label: '세계', sectionId: '104' },
  { slug: 'it', label: 'IT/과학', sectionId: '105' },
]
```

- [ ] **Step 2: 실패하는 테스트 작성**

네이버 뉴스 정치 섹션(`news.naver.com/section/100`)에서 2026-07-31에 실제로 확인한 마크업을 축약한 픽스처를 사용한다 (헤드라인 앵커는 `class="sa_text_title"`, 제목은 그 안의 `<strong class="sa_text_strong">`, 링크는 `href` 속성).

```ts
// supabase/functions/collect-headlines/lib/headlines.test.ts
import { describe, expect, it } from 'vitest'
import { extractHeadlines } from './headlines'

const SAMPLE_HTML = `
<li class="sa_item">
  <div class="sa_text">
    <a href="https://n.news.naver.com/mnews/article/087/0001208610" class="sa_text_title _NLOG_IMPRESSION" data-clk="pol.clart">
      <strong class="sa_text_strong">[속보]김의겸 &quot;24년전 발언은 사실과 다르다&quot;</strong>
    </a>
    <div class="sa_text_lede">기사 요약...</div>
  </div>
</li>
<li class="sa_item">
  <div class="sa_text">
    <a href="https://n.news.naver.com/mnews/article/001/0016226272" class="sa_text_title _NLOG_IMPRESSION" data-clk="pol.clart">
      <strong class="sa_text_strong">여야, 예산안 처리 &amp; 협상 재개</strong>
    </a>
  </div>
</li>
`

describe('extractHeadlines', () => {
  it('extracts title and link for each headline anchor', () => {
    const result = extractHeadlines(SAMPLE_HTML)

    expect(result).toEqual([
      {
        title: '[속보]김의겸 "24년전 발언은 사실과 다르다"',
        link: 'https://n.news.naver.com/mnews/article/087/0001208610',
      },
      {
        title: '여야, 예산안 처리 & 협상 재개',
        link: 'https://n.news.naver.com/mnews/article/001/0016226272',
      },
    ])
  })

  it('returns an empty array when there are no matching anchors', () => {
    expect(extractHeadlines('<html><body>no headlines here</body></html>')).toEqual([])
  })

  it('deduplicates repeated links', () => {
    const html = SAMPLE_HTML + SAMPLE_HTML
    const result = extractHeadlines(html)
    expect(result).toHaveLength(2)
  })
})
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `npm test -- headlines.test.ts`
Expected: FAIL (`extractHeadlines` 함수가 없음)

- [ ] **Step 4: 구현**

```ts
// supabase/functions/collect-headlines/lib/headlines.ts
export interface ScrapedHeadline {
  title: string
  link: string
}

const ANCHOR_RE = /<a\b([^>]*class="sa_text_title[^"]*"[^>]*)>([\s\S]*?)<\/a>/g
const HREF_RE = /href="([^"]+)"/
const STRONG_RE = /<strong[^>]*>([\s\S]*?)<\/strong>/

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
}

export function extractHeadlines(html: string): ScrapedHeadline[] {
  const results: ScrapedHeadline[] = []
  const seenLinks = new Set<string>()

  for (const match of html.matchAll(ANCHOR_RE)) {
    const [, attrs, inner] = match
    const hrefMatch = HREF_RE.exec(attrs)
    if (!hrefMatch) continue
    const link = hrefMatch[1]
    if (seenLinks.has(link)) continue

    const strongMatch = STRONG_RE.exec(inner)
    const rawTitle = strongMatch ? strongMatch[1] : inner
    const title = decodeHtmlEntities(stripTags(rawTitle))
    if (!title) continue

    seenLinks.add(link)
    results.push({ title, link })
  }

  return results
}
```

`&amp;` 치환은 반드시 다른 엔티티(`&quot;`, `&#39;` 등)를 먼저 치환한 뒤 마지막에 수행한다 — 그렇지 않으면 `&amp;quot;` 같은 이중 인코딩된 문자열이 잘못 풀린다.

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npm test -- headlines.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add supabase/functions/collect-headlines/lib/categories.ts supabase/functions/collect-headlines/lib/headlines.ts supabase/functions/collect-headlines/lib/headlines.test.ts
git commit -m "Add Naver section-page headline parser"
```

---

### Task 4: ETRI 형태소분석 클라이언트 + 명사 필터링

**Files:**
- Create: `supabase/functions/collect-headlines/lib/nouns.ts`
- Test: `supabase/functions/collect-headlines/lib/nouns.test.ts`

**Interfaces:**
- Consumes: 없음 (독립 모듈).
- Produces: `callEtriMorphAnalysis(text: string, apiKey: string): Promise<EtriResponse>`, `extractNouns(response: EtriResponse): string[]`, `filterNouns(words: string[]): string[]`.

ETRI 형태소분석 API 스펙 (2026-07-31 웹 조사로 확인):
- Endpoint: `POST http://aiopen.etri.re.kr:8000/WiseNLU`
- Header: `Authorization: <ACCESS_KEY>`, `Content-Type: application/json`
- Body: `{ "request_id": "collect-headlines", "argument": { "analysis_code": "morp", "text": "..." } }`
- Response: `response_json.return_object.sentence[].morp[]`, 각 형태소는 `{ id, lemma, type, position, weight }`. 명사는 `type`이 `NNG`(일반명사) 또는 `NNP`(고유명사).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// supabase/functions/collect-headlines/lib/nouns.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { callEtriMorphAnalysis, extractNouns, filterNouns } from './nouns'

describe('extractNouns', () => {
  it('collects NNG/NNP lemmas across all sentences', () => {
    const response = {
      return_object: {
        sentence: [
          {
            morp: [
              { id: 0, lemma: '여야', type: 'NNG', position: 0, weight: 1 },
              { id: 1, lemma: '예산안', type: 'NNG', position: 1, weight: 1 },
              { id: 2, lemma: '처리', type: 'NNG', position: 2, weight: 1 },
              { id: 3, lemma: '하', type: 'VV', position: 3, weight: 1 },
            ],
          },
        ],
      },
    }

    expect(extractNouns(response)).toEqual(['여야', '예산안', '처리'])
  })

  it('returns an empty array when return_object is missing', () => {
    expect(extractNouns({})).toEqual([])
  })
})

describe('filterNouns', () => {
  it('drops words shorter than 2 characters and known stopwords', () => {
    expect(filterNouns(['여야', '예산안', '것', '기자', '사진'])).toEqual(['여야', '예산안'])
  })
})

describe('callEtriMorphAnalysis', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the expected request and returns the parsed JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ return_object: { sentence: [] } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callEtriMorphAnalysis('여야 예산안 처리', 'test-key')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://aiopen.etri.re.kr:8000/WiseNLU',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'test-key' }),
      }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({
      request_id: 'collect-headlines',
      argument: { analysis_code: 'morp', text: '여야 예산안 처리' },
    })
    expect(result).toEqual({ return_object: { sentence: [] } })
  })

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(callEtriMorphAnalysis('text', 'key')).rejects.toThrow('500')
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- nouns.test.ts`
Expected: FAIL (모듈이 없음)

- [ ] **Step 3: 구현**

```ts
// supabase/functions/collect-headlines/lib/nouns.ts
export interface EtriMorpheme {
  id: number
  lemma: string
  type: string
  position: number
  weight: number
}

export interface EtriResponse {
  return_object?: {
    sentence?: { morp?: EtriMorpheme[] }[]
  }
}

const NOUN_TYPES = new Set(['NNG', 'NNP'])
const STOPWORDS = new Set(['기자', '사진', '종합', '단독', '속보', '영상'])
const ETRI_ENDPOINT = 'http://aiopen.etri.re.kr:8000/WiseNLU'

export function extractNouns(response: EtriResponse): string[] {
  const sentences = response.return_object?.sentence ?? []
  const nouns: string[] = []
  for (const sentence of sentences) {
    for (const morph of sentence.morp ?? []) {
      if (NOUN_TYPES.has(morph.type)) {
        nouns.push(morph.lemma)
      }
    }
  }
  return nouns
}

export function filterNouns(words: string[]): string[] {
  return words.filter((word) => word.length >= 2 && !STOPWORDS.has(word))
}

export async function callEtriMorphAnalysis(text: string, apiKey: string): Promise<EtriResponse> {
  const response = await fetch(ETRI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({
      request_id: 'collect-headlines',
      argument: { analysis_code: 'morp', text },
    }),
  })

  if (!response.ok) {
    throw new Error(`ETRI API request failed with status ${response.status}`)
  }

  return (await response.json()) as EtriResponse
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test -- nouns.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/collect-headlines/lib/nouns.ts supabase/functions/collect-headlines/lib/nouns.test.ts
git commit -m "Add ETRI morphological analysis client and noun filtering"
```

---

### Task 5: Edge Function 오케스트레이션 (`collect-headlines`)

**Files:**
- Create: `supabase/functions/collect-headlines/index.ts`

**Interfaces:**
- Consumes: `CATEGORIES`, `extractHeadlines` (Task 3), `callEtriMorphAnalysis`, `extractNouns`, `filterNouns` (Task 4). DB 컬럼명은 Task 2의 스키마(`categories.slug`, `headlines.category_id/title/link/collected_date`, `headline_nouns.headline_id/word`)를 그대로 사용.
- Produces: HTTP 핸들러 — 배포 후 pg_cron 또는 수동 호출로 실행되는 Supabase Edge Function.

이 파일은 Deno 런타임에서만 실행되므로 Vitest로 테스트하지 않는다 (Deno 전용 API `Deno.serve`/`Deno.env` 사용). 각 조각(파싱/ETRI 호출/필터링)은 이미 Task 3~4에서 단위 테스트했으므로, 이 태스크는 그것들을 올바르게 조립하는 데 집중한다. 정확성은 Deployment 섹션의 수동 실행으로 검증한다.

- [ ] **Step 1: `index.ts` 작성**

```ts
// supabase/functions/collect-headlines/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import { CATEGORIES } from './lib/categories.ts'
import { extractHeadlines } from './lib/headlines.ts'
import { callEtriMorphAnalysis, extractNouns, filterNouns } from './lib/nouns.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ETRI_API_KEY = Deno.env.get('ETRI_API_KEY')!

function todayInSeoul(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const collectedDate = todayInSeoul()
  const summary: Record<string, string> = {}

  for (const category of CATEGORIES) {
    try {
      const { data: categoryRow, error: categoryError } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', category.slug)
        .single()

      if (categoryError || !categoryRow) {
        throw new Error(`category "${category.slug}" not found in DB — did the migration run?`)
      }

      const pageResponse = await fetch(`https://news.naver.com/section/${category.sectionId}`)
      if (!pageResponse.ok) {
        throw new Error(`section fetch failed with status ${pageResponse.status}`)
      }
      const html = await pageResponse.text()
      const headlines = extractHeadlines(html)

      let storedCount = 0
      for (const headline of headlines) {
        const { data: inserted, error: insertError } = await supabase
          .from('headlines')
          .upsert(
            {
              category_id: categoryRow.id,
              title: headline.title,
              link: headline.link,
              collected_date: collectedDate,
            },
            { onConflict: 'category_id,link', ignoreDuplicates: true },
          )
          .select('id')
          .single()

        if (insertError || !inserted) {
          continue // already collected earlier today
        }
        storedCount += 1

        try {
          const etriResponse = await callEtriMorphAnalysis(headline.title, ETRI_API_KEY)
          const nouns = filterNouns(extractNouns(etriResponse))
          if (nouns.length > 0) {
            await supabase
              .from('headline_nouns')
              .insert(nouns.map((word) => ({ headline_id: inserted.id, word })))
          }
        } catch (etriError) {
          console.error(`ETRI analysis failed for headline ${inserted.id}:`, etriError)
        }
      }

      summary[category.slug] = `ok: ${headlines.length} seen, ${storedCount} new`
    } catch (categoryError) {
      console.error(`Category "${category.slug}" failed:`, categoryError)
      summary[category.slug] = `failed: ${String(categoryError)}`
    }
  }

  return new Response(JSON.stringify({ date: collectedDate, summary }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

- [ ] **Step 2: TypeScript 컴파일 확인 (프론트엔드 빌드에 영향 없는지)**

`supabase/functions`는 `tsconfig.app.json`의 `include` 범위 밖에 있어야 한다. `tsconfig.app.json`을 열어 `include`가 `["src"]`로 한정되어 있는지 확인하고, 아니라면 `supabase`를 `exclude`에 추가한다.

Run: `npm run build`
Expected: 기존과 동일하게 성공 (Edge Function 코드가 프론트엔드 빌드에 포함되지 않음)

- [ ] **Step 3: 커밋**

```bash
git add supabase/functions/collect-headlines/index.ts
git commit -m "Add collect-headlines Edge Function orchestration"
```

---

### Task 6: 프론트엔드 데이터 레이어

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/queries.ts`
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `src/lib/supabaseClient.ts`의 `supabase` (기존 파일, 이미 존재).
- Produces: `fetchCategories(): Promise<Category[]>`, `fetchAvailableDates(): Promise<string[]>`, `fetchWordCounts(date: string, categorySlug: string | null): Promise<WordCount[]>`, `fetchHeadlinesForWord(date: string, categorySlug: string | null, word: string): Promise<HeadlineSummary[]>`. 타입 `Category { id, slug, label }`, `WordCount { word, count }`, `HeadlineSummary { id, title, link }`.

- [ ] **Step 1: 타입 정의**

```ts
// src/lib/types.ts
export interface Category {
  id: string
  slug: string
  label: string
}

export interface WordCount {
  word: string
  count: number
}

export interface HeadlineSummary {
  id: string
  title: string
  link: string
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// src/lib/queries.test.ts
import { describe, expect, it, vi } from 'vitest'

const mockSupabase = {
  from: vi.fn(),
}

vi.mock('./supabaseClient', () => ({ supabase: mockSupabase }))

const { fetchHeadlinesForWord, fetchWordCounts } = await import('./queries')

function makeQueryChain(result: { data: unknown; error: null }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    then: (resolve: (r: typeof result) => unknown) => resolve(result),
  }
  return chain
}

describe('fetchWordCounts', () => {
  it('aggregates word counts and sorts by frequency descending', async () => {
    const rows = [{ word: '예산안' }, { word: '여야' }, { word: '예산안' }]
    mockSupabase.from.mockReturnValue(makeQueryChain({ data: rows, error: null }))

    const result = await fetchWordCounts('2026-07-31', 'politics')

    expect(result).toEqual([
      { word: '예산안', count: 2 },
      { word: '여야', count: 1 },
    ])
  })
})

describe('fetchHeadlinesForWord', () => {
  it('deduplicates headlines that share the same id', async () => {
    const rows = [
      { headlines: { id: 'h1', title: '제목1', link: 'https://a' } },
      { headlines: { id: 'h1', title: '제목1', link: 'https://a' } },
      { headlines: { id: 'h2', title: '제목2', link: 'https://b' } },
    ]
    mockSupabase.from.mockReturnValue(makeQueryChain({ data: rows, error: null }))

    const result = await fetchHeadlinesForWord('2026-07-31', null, '예산안')

    expect(result).toEqual([
      { id: 'h1', title: '제목1', link: 'https://a' },
      { id: 'h2', title: '제목2', link: 'https://b' },
    ])
  })
})
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `npm test -- queries.test.ts`
Expected: FAIL (`./queries` 모듈이 없음)

- [ ] **Step 4: 구현**

```ts
// src/lib/queries.ts
import { supabase } from './supabaseClient'
import type { Category, HeadlineSummary, WordCount } from './types'

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('id, slug, label').order('label')
  if (error) throw error
  return (data ?? []) as Category[]
}

export async function fetchAvailableDates(): Promise<string[]> {
  const { data, error } = await supabase
    .from('headlines')
    .select('collected_date')
    .order('collected_date', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as { collected_date: string }[]
  return Array.from(new Set(rows.map((row) => row.collected_date)))
}

export async function fetchWordCounts(
  date: string,
  categorySlug: string | null,
): Promise<WordCount[]> {
  let query = supabase
    .from('headline_nouns')
    .select('word, headlines!inner(collected_date, categories!inner(slug))')
    .eq('headlines.collected_date', date)

  if (categorySlug) {
    query = query.eq('headlines.categories.slug', categorySlug)
  }

  const { data, error } = await query
  if (error) throw error

  const counts = new Map<string, number>()
  for (const row of (data ?? []) as { word: string }[]) {
    counts.set(row.word, (counts.get(row.word) ?? 0) + 1)
  }

  return Array.from(counts, ([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count)
}

export async function fetchHeadlinesForWord(
  date: string,
  categorySlug: string | null,
  word: string,
): Promise<HeadlineSummary[]> {
  let query = supabase
    .from('headline_nouns')
    .select('word, headlines!inner(id, title, link, collected_date, categories!inner(slug))')
    .eq('word', word)
    .eq('headlines.collected_date', date)

  if (categorySlug) {
    query = query.eq('headlines.categories.slug', categorySlug)
  }

  const { data, error } = await query
  if (error) throw error

  const seen = new Set<string>()
  const results: HeadlineSummary[] = []
  for (const row of (data ?? []) as { headlines: HeadlineSummary }[]) {
    const headline = row.headlines
    if (seen.has(headline.id)) continue
    seen.add(headline.id)
    results.push(headline)
  }
  return results
}
```

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npm test -- queries.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/types.ts src/lib/queries.ts src/lib/queries.test.ts
git commit -m "Add Supabase query layer for categories, word counts, and headlines"
```

---

### Task 7: 워드클라우드 크기 계산 + 컴포넌트

**Files:**
- Create: `src/components/wordCloudLayout.ts`
- Test: `src/components/wordCloudLayout.test.ts`
- Create: `src/components/WordCloud.tsx`

**Interfaces:**
- Consumes: `WordCount` (Task 6).
- Produces: `computeFontSizes(words: WordCount[]): SizedWord[]` (`SizedWord { text, count, fontSize }`), `<WordCloud words={{word,count}[]} onWordClick={(word: string) => void} />`.

- [ ] **Step 1: `d3-cloud` 설치**

```bash
npm install d3-cloud
npm install -D @types/d3-cloud
```

- [ ] **Step 2: 실패하는 테스트 작성 (크기 계산 순수 함수)**

```ts
// src/components/wordCloudLayout.test.ts
import { describe, expect, it } from 'vitest'
import { computeFontSizes } from './wordCloudLayout'

describe('computeFontSizes', () => {
  it('maps the highest count to the max font size and the lowest to the min', () => {
    const result = computeFontSizes([
      { word: '여야', count: 1 },
      { word: '예산안', count: 10 },
    ])

    const bySizeDesc = [...result].sort((a, b) => b.fontSize - a.fontSize)
    expect(bySizeDesc[0].text).toBe('예산안')
    expect(bySizeDesc[0].fontSize).toBe(64)
    expect(bySizeDesc[1].text).toBe('여야')
    expect(bySizeDesc[1].fontSize).toBe(14)
  })

  it('gives every word the max font size when all counts are equal', () => {
    const result = computeFontSizes([
      { word: 'a', count: 5 },
      { word: 'b', count: 5 },
    ])
    expect(result.every((w) => w.fontSize === 64)).toBe(true)
  })

  it('returns an empty array for empty input', () => {
    expect(computeFontSizes([])).toEqual([])
  })
})
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `npm test -- wordCloudLayout.test.ts`
Expected: FAIL

- [ ] **Step 4: 구현**

```ts
// src/components/wordCloudLayout.ts
import type { WordCount } from '../lib/types'

export interface SizedWord {
  text: string
  count: number
  fontSize: number
}

export const MIN_FONT_SIZE = 14
export const MAX_FONT_SIZE = 64

export function computeFontSizes(words: WordCount[]): SizedWord[] {
  if (words.length === 0) return []

  const counts = words.map((w) => w.count)
  const min = Math.min(...counts)
  const max = Math.max(...counts)

  return words.map(({ word, count }) => {
    const ratio = max === min ? 1 : (count - min) / (max - min)
    const fontSize = Math.round(MIN_FONT_SIZE + ratio * (MAX_FONT_SIZE - MIN_FONT_SIZE))
    return { text: word, count, fontSize }
  })
}
```

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npm test -- wordCloudLayout.test.ts`
Expected: PASS

- [ ] **Step 6: `WordCloud` 컴포넌트 작성**

`d3-cloud`는 내부적으로 canvas 텍스트 측정을 사용해 jsdom 테스트 환경에서 신뢰성 있게 동작하지 않으므로, 이 컴포넌트 자체는 자동 테스트하지 않는다 (크기 계산 로직은 위에서 이미 테스트됨). 검증은 Task 9 완료 후 `npm run dev`로 브라우저에서 직접 확인한다.

```tsx
// src/components/WordCloud.tsx
import { useEffect, useState } from 'react'
import cloud from 'd3-cloud'
import { computeFontSizes, MIN_FONT_SIZE } from './wordCloudLayout'
import type { WordCount } from '../lib/types'

interface PlacedWord {
  text: string
  fontSize: number
  x: number
  y: number
  rotate: number
}

interface WordCloudProps {
  words: WordCount[]
  onWordClick: (word: string) => void
  width?: number
  height?: number
}

export function WordCloud({ words, onWordClick, width = 700, height = 450 }: WordCloudProps) {
  const [placed, setPlaced] = useState<PlacedWord[]>([])

  useEffect(() => {
    const sized = computeFontSizes(words)
    if (sized.length === 0) {
      setPlaced([])
      return
    }

    const layout = cloud()
      .size([width, height])
      .words(sized.map((w) => ({ text: w.text, size: w.fontSize })))
      .padding(4)
      .rotate(0)
      .font('sans-serif')
      .fontSize((d) => (d as { size: number }).size)
      .on('end', (output) => {
        setPlaced(
          output.map((word) => ({
            text: word.text ?? '',
            fontSize: (word as unknown as { size: number }).size ?? MIN_FONT_SIZE,
            x: word.x ?? 0,
            y: word.y ?? 0,
            rotate: word.rotate ?? 0,
          })),
        )
      })

    layout.start()
  }, [words, width, height])

  if (placed.length === 0) {
    return <p className="text-center text-gray-500">아직 수집된 데이터가 없습니다.</p>
  }

  return (
    <svg width={width} height={height} className="mx-auto">
      <g transform={`translate(${width / 2}, ${height / 2})`}>
        {placed.map((word) => (
          <text
            key={word.text}
            textAnchor="middle"
            fontSize={word.fontSize}
            transform={`translate(${word.x}, ${word.y}) rotate(${word.rotate})`}
            onClick={() => onWordClick(word.text)}
            className="cursor-pointer fill-current hover:opacity-70"
          >
            {word.text}
          </text>
        ))}
      </g>
    </svg>
  )
}
```

- [ ] **Step 7: 커밋**

```bash
git add package.json package-lock.json src/components/wordCloudLayout.ts src/components/wordCloudLayout.test.ts src/components/WordCloud.tsx
git commit -m "Add word cloud sizing logic and SVG rendering component"
```

---

### Task 8: 카테고리 탭 + 헤드라인 패널 컴포넌트

**Files:**
- Create: `src/components/CategoryTabs.tsx`
- Create: `src/components/HeadlinePanel.tsx`
- Test: `src/components/CategoryTabs.test.tsx`
- Test: `src/components/HeadlinePanel.test.tsx`

**Interfaces:**
- Consumes: `Category`, `HeadlineSummary` (Task 6).
- Produces: `<CategoryTabs categories onSelect selected />`, `<HeadlinePanel word headlines onClose />`.

- [ ] **Step 1: 실패하는 테스트 작성 — CategoryTabs**

```tsx
// src/components/CategoryTabs.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CategoryTabs } from './CategoryTabs'

const categories = [
  { id: '1', slug: 'politics', label: '정치' },
  { id: '2', slug: 'economy', label: '경제' },
]

describe('CategoryTabs', () => {
  it('renders an entry for every category plus "전체"', () => {
    render(<CategoryTabs categories={categories} selected={null} onSelect={vi.fn()} />)
    expect(screen.getByText('전체')).toBeInTheDocument()
    expect(screen.getByText('정치')).toBeInTheDocument()
    expect(screen.getByText('경제')).toBeInTheDocument()
  })

  it('calls onSelect with the category slug when clicked', () => {
    const onSelect = vi.fn()
    render(<CategoryTabs categories={categories} selected={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('경제'))
    expect(onSelect).toHaveBeenCalledWith('economy')
  })

  it('calls onSelect with null when "전체" is clicked', () => {
    const onSelect = vi.fn()
    render(<CategoryTabs categories={categories} selected="economy" onSelect={onSelect} />)
    fireEvent.click(screen.getByText('전체'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npm test -- CategoryTabs.test.tsx`
Expected: FAIL

- [ ] **Step 3: `CategoryTabs` 구현**

```tsx
// src/components/CategoryTabs.tsx
import type { Category } from '../lib/types'

interface CategoryTabsProps {
  categories: Category[]
  selected: string | null
  onSelect: (slug: string | null) => void
}

export function CategoryTabs({ categories, selected, onSelect }: CategoryTabsProps) {
  return (
    <nav className="flex flex-wrap justify-center gap-2">
      <button
        onClick={() => onSelect(null)}
        className={`rounded-full px-3 py-1 text-sm ${selected === null ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}
      >
        전체
      </button>
      {categories.map((category) => (
        <button
          key={category.slug}
          onClick={() => onSelect(category.slug)}
          className={`rounded-full px-3 py-1 text-sm ${
            selected === category.slug ? 'bg-gray-900 text-white' : 'bg-gray-100'
          }`}
        >
          {category.label}
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test -- CategoryTabs.test.tsx`
Expected: PASS

- [ ] **Step 5: 실패하는 테스트 작성 — HeadlinePanel**

```tsx
// src/components/HeadlinePanel.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HeadlinePanel } from './HeadlinePanel'

describe('HeadlinePanel', () => {
  it('renders nothing when no word is selected', () => {
    const { container } = render(<HeadlinePanel word={null} headlines={[]} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders headline titles as links to the original article', () => {
    render(
      <HeadlinePanel
        word="예산안"
        headlines={[{ id: 'h1', title: '여야 예산안 처리', link: 'https://example.com/a' }]}
        onClose={vi.fn()}
      />,
    )
    const link = screen.getByRole('link', { name: '여야 예산안 처리' })
    expect(link).toHaveAttribute('href', 'https://example.com/a')
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<HeadlinePanel word="예산안" headlines={[]} onClose={onClose} />)
    fireEvent.click(screen.getByText('닫기'))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: 테스트 실행해 실패 확인**

Run: `npm test -- HeadlinePanel.test.tsx`
Expected: FAIL

- [ ] **Step 7: `HeadlinePanel` 구현**

```tsx
// src/components/HeadlinePanel.tsx
import type { HeadlineSummary } from '../lib/types'

interface HeadlinePanelProps {
  word: string | null
  headlines: HeadlineSummary[]
  onClose: () => void
}

export function HeadlinePanel({ word, headlines, onClose }: HeadlinePanelProps) {
  if (!word) return null

  return (
    <aside className="fixed right-0 top-0 h-full w-80 overflow-y-auto border-l bg-white p-4 shadow-lg">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">&quot;{word}&quot; 관련 헤드라인</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900">
          닫기
        </button>
      </div>
      <ul className="space-y-3">
        {headlines.map((headline) => (
          <li key={headline.id}>
            <a
              href={headline.link}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-700 hover:underline"
            >
              {headline.title}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  )
}
```

- [ ] **Step 8: 테스트 실행해 통과 확인**

Run: `npm test -- HeadlinePanel.test.tsx`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add src/components/CategoryTabs.tsx src/components/CategoryTabs.test.tsx src/components/HeadlinePanel.tsx src/components/HeadlinePanel.test.tsx
git commit -m "Add CategoryTabs and HeadlinePanel components"
```

---

### Task 9: `App.tsx` 조립 및 수동 검증

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: 모든 이전 태스크의 export (`fetchCategories`, `fetchAvailableDates`, `fetchWordCounts`, `fetchHeadlinesForWord` / `CategoryTabs` / `WordCloud` / `HeadlinePanel`).

- [ ] **Step 1: `App.tsx` 재작성**

```tsx
// src/App.tsx
import { useEffect, useState } from 'react'
import { CategoryTabs } from './components/CategoryTabs'
import { HeadlinePanel } from './components/HeadlinePanel'
import { WordCloud } from './components/WordCloud'
import {
  fetchAvailableDates,
  fetchCategories,
  fetchHeadlinesForWord,
  fetchWordCounts,
} from './lib/queries'
import type { Category, HeadlineSummary, WordCount } from './lib/types'

function todayInSeoul(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

function App() {
  const [categories, setCategories] = useState<Category[]>([])
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState(todayInSeoul())
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [wordCounts, setWordCounts] = useState<WordCount[]>([])
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [headlinesForWord, setHeadlinesForWord] = useState<HeadlineSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCategories().then(setCategories).catch((e) => setError(String(e)))
    fetchAvailableDates().then(setAvailableDates).catch((e) => setError(String(e)))
  }, [])

  function loadWordCounts() {
    setLoading(true)
    setError(null)
    fetchWordCounts(selectedDate, selectedCategory)
      .then(setWordCounts)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(loadWordCounts, [selectedDate, selectedCategory])

  useEffect(() => {
    if (!selectedWord) {
      setHeadlinesForWord([])
      return
    }
    fetchHeadlinesForWord(selectedDate, selectedCategory, selectedWord)
      .then(setHeadlinesForWord)
      .catch((e) => setError(String(e)))
  }, [selectedWord, selectedDate, selectedCategory])

  return (
    <div className="min-h-svh p-6">
      <h1 className="mb-6 text-center text-4xl font-semibold">오늘의 주요 뉴스 스크랩</h1>

      <div className="mx-auto mb-6 flex max-w-3xl flex-col items-center gap-4">
        <input
          type="date"
          value={selectedDate}
          min={availableDates[availableDates.length - 1]}
          max={availableDates[0]}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded border px-3 py-1"
        />
        <CategoryTabs categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />
      </div>

      {error && (
        <div className="text-center">
          <p className="mb-2 text-red-600">{error}</p>
          <button onClick={loadWordCounts} className="rounded border px-3 py-1 text-sm hover:bg-gray-100">
            다시 시도
          </button>
        </div>
      )}
      {!error && loading && <p className="text-center text-gray-500">불러오는 중...</p>}
      {!error && !loading && (
        <WordCloud words={wordCounts} onWordClick={setSelectedWord} />
      )}

      <HeadlinePanel word={selectedWord} headlines={headlinesForWord} onClose={() => setSelectedWord(null)} />
    </div>
  )
}

export default App
```

날짜 선택은 "데이터가 있는 가장 이른 날짜 ~ 가장 늦은 날짜" 범위로만 제한하는 단순한 방식이다 (그 사이의 특정 날짜에 데이터가 없을 수도 있음 — 그 경우 `WordCloud`가 "아직 수집된 데이터가 없습니다"를 보여준다). 캘린더에서 데이터 있는 날짜만 활성화하는 정교한 위젯은 이 개인 프로젝트 규모에서 과한 복잡도라 제외했다.

- [ ] **Step 2: 전체 테스트 스위트 실행**

Run: `npm test`
Expected: 모든 테스트 PASS (Task 1~8에서 작성한 테스트 전부)

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 타입 에러 없이 빌드 성공

- [ ] **Step 4: 로컬 개발 서버로 수동 확인**

Run: `npm run dev`

Supabase 프로젝트가 아직 연결되지 않았다면 (`.env`가 비어 있다면) 화면에는 "아직 수집된 데이터가 없습니다" 또는 콘솔 경고가 뜨는 것이 정상이다 — 레이아웃과 카테고리 탭 UI가 깨지지 않고 렌더링되는지만 확인한다. Deployment 섹션을 완료한 뒤에는 실제 워드클라우드가 보여야 한다.

- [ ] **Step 5: 커밋**

```bash
git add src/App.tsx
git commit -m "Wire up date/category selection, word cloud, and headline panel in App"
```

---

## Deployment (수동, 코드 작성 이후 진행)

이 단계는 사용자의 Supabase 계정/프로젝트와 ETRI API 키가 필요해 에이전트가 대신 실행할 수 없다. Task 1~9를 마친 뒤 다음을 사용자가 직접 진행한다:

1. [supabase.com](https://supabase.com)에서 프로젝트 생성 → Project Settings에서 URL/anon key를 복사해 `.env`의 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`에 채운다.
2. [aiopen.etri.re.kr](https://aiopen.etri.re.kr)에서 무료 API 키를 발급받는다.
3. `npx supabase login` → `npx supabase link --project-ref <project-ref>` 로 로컬 저장소를 프로젝트에 연결한다.
4. `npx supabase db push` 로 `supabase/migrations/0001_init_schema.sql`을 적용한다.
5. `npx supabase secrets set ETRI_API_KEY=<발급받은 키>` 로 Edge Function 시크릿을 등록한다.
6. `npx supabase functions deploy collect-headlines` 로 함수를 배포한다.
7. 배포된 함수를 한 번 수동 호출해 정상 동작을 확인한다: `curl -X POST https://<project-ref>.supabase.co/functions/v1/collect-headlines -H "Authorization: Bearer <anon-or-service-key>"` — 응답 JSON의 `summary`에 6개 카테고리가 모두 `ok`인지 확인.
8. Supabase 대시보드의 SQL Editor에서 pg_cron으로 매일 자동 호출을 예약한다 (project ref와 키를 실제 값으로 채워야 함):

```sql
select cron.schedule(
  'collect-headlines-daily',
  '0 22 * * *', -- UTC 22:00 = KST 07:00
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/collect-headlines',
    headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>')
  );
  $$
);
```

9. `npm run dev`로 프론트엔드를 실행해 실제 데이터로 워드클라우드가 뜨는지 최종 확인한다.
