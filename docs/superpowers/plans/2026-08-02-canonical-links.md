# 스크레이퍼 링크 정규화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이버가 한 기사에 주는 두 가지 URL을 수집 시점에 하나로 정규화하고, 그 탓에 어긋난 아카이브를 한 번 정리한다.

**Architecture:** `supabase/functions/collect-headlines/lib/headlines.ts`에 순수 함수 `canonicalLink`를 추가하고 `extractHeadlines`가 href를 결과에 담기 전에 통과시킨다. 이 한 지점으로 런 내 중복 검사(`index.ts:47`)와 DB 조회(`index.ts:137`)가 동시에 고쳐지고, 이미 존재하는 `UNIQUE (category_id, link)` 제약이 비로소 올바른 불변식이 되므로 새 DDL은 필요 없다. 아카이브는 마이그레이션 `0007`이 **중복 삭제 후 링크 정규화** 순서로 한 번에 정리한다.

**Tech Stack:** Deno Edge Function (런타임 무관 `lib/`), TypeScript, Vitest, Postgres 정규식(`substring(... from ...)`), Supabase CLI, Playwright.

**설계 문서:** `docs/superpowers/specs/2026-08-02-canonical-links-design.md`

## Global Constraints

- `lib/*.ts`는 **런타임 무관**이어야 한다. `Deno.env`·`npm:` 지정자·Deno 전역 금지. 이것이 Vitest로 테스트되는 이유다.
- 정규형은 **`https://n.news.naver.com/article/{press}/{id}`** 하나뿐이다. `press`와 `id`는 숫자열.
- `canonicalLink`는 패턴이 맞지 않으면 **입력을 그대로 반환**한다. 절대 빈 문자열이나 부분 결과를 돌려주지 않는다 — 뭉개면 서로 다른 기사가 한 링크로 합쳐져 조용히 유실된다.
- 마이그레이션 `0007`은 **삭제가 먼저, `update`가 나중**이다. 순서를 뒤집으면 첫 `update`에서 `UNIQUE (category_id, link)` 위반이 난다.
- 배포 순서는 **함수 먼저, 마이그레이션 나중**이다. 반대로 하면 다음 크론이 1면 기사를 전부 mnews 형식으로 다시 넣는다.
- **체·`scoring_weights`·임계값은 하나도 건드리지 않는다.** 이 작업은 코퍼스만 고치므로 `scripts/analysis/10_sieve_eval.sql`을 통과할 일이 아니다.
- `npm run build`가 진짜 게이트다. `npm test`만으로는 컴파일 안 되는 코드도 통과한다.
- Supabase CLI는 git-ignore된 `.env.supabase`의 자격 증명이 필요하다: `set -a && . ./.env.supabase && set +a`

---

### Task 1: `canonicalLink`와 수집기 배포

**Files:**
- Modify: `supabase/functions/collect-headlines/lib/headlines.ts`
- Test: `supabase/functions/collect-headlines/lib/headlines.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `export function canonicalLink(href: string): string` — `headlines.ts`에서 export. `extractHeadlines(html: string): ScrapedHeadline[]`의 반환 `link`는 이제 항상 정규형이거나 정규화할 수 없었던 원본이다. `ScrapedHeadline` 타입은 변하지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`headlines.test.ts` 최상단 import를 고치고:

```ts
import { canonicalLink, extractHeadlines, extractListCursor, extractTemplateListHtml } from './headlines'
```

`describe('extractHeadlines', ...)` 블록 **앞에** 새 블록을 넣는다:

```ts
describe('canonicalLink', () => {
  // 섹션 첫 페이지는 인라인 HTML로 mnews 경로를 주고, "더보기" 페이지네이션은
  // 같은 기사에 mnews 없는 경로를 준다. 삽입 시 중복 검사는 링크 문자열 전체를
  // 맞춰 보므로 이 둘이 합쳐지지 않으면 같은 기사가 두 행이 된다.
  it('drops the mnews segment', () => {
    expect(canonicalLink('https://n.news.naver.com/mnews/article/001/0016225981')).toBe(
      'https://n.news.naver.com/article/001/0016225981',
    )
  })

  it('leaves an already canonical link alone', () => {
    expect(canonicalLink('https://n.news.naver.com/article/001/0016225921')).toBe(
      'https://n.news.naver.com/article/001/0016225921',
    )
  })

  // 아카이브의 3,120행에는 쿼리스트링이 하나도 없지만, 링크는 재구성으로
  // 만들어지므로 이것들은 공짜로 떨어져 나간다.
  it('drops a query string, a hash and a trailing slash', () => {
    expect(canonicalLink('https://n.news.naver.com/mnews/article/001/0016225981?sid=100')).toBe(
      'https://n.news.naver.com/article/001/0016225981',
    )
    expect(canonicalLink('https://n.news.naver.com/article/001/0016225981#comment')).toBe(
      'https://n.news.naver.com/article/001/0016225981',
    )
    expect(canonicalLink('https://n.news.naver.com/article/001/0016225981/')).toBe(
      'https://n.news.naver.com/article/001/0016225981',
    )
  })

  // 네이버가 URL 모양을 바꾸면 뭉개는 것보다 통과시키는 편이 낫다. 뭉개면 서로
  // 다른 기사가 한 링크로 합쳐져 조용히 사라진다.
  it('returns anything it cannot parse unchanged', () => {
    expect(canonicalLink('https://n.news.naver.com/hotissue/ranking')).toBe(
      'https://n.news.naver.com/hotissue/ranking',
    )
    expect(canonicalLink('/article/abc/def')).toBe('/article/abc/def')
    expect(canonicalLink('')).toBe('')
  })
})
```

같은 파일의 `describe('extractHeadlines', ...)` 안, `deduplicates repeated links` 테스트 **뒤에** 한 건 더 넣는다:

```ts
  // 첫 페이지와 페이지네이션이 한 응답에 섞여 들어와도 한 건이어야 한다.
  // 2026-08-02 world 섹션에서 실제로 관측된 상황이다.
  it('merges the two link forms of one article into a single headline', () => {
    const html = `
<li class="sa_item"><div class="sa_text">
  <a href="https://n.news.naver.com/mnews/article/001/0016226272" class="sa_text_title">
    <strong>여야, 예산안 처리 협상 재개</strong>
  </a>
</div></li>
<li class="sa_item"><div class="sa_text">
  <a href="https://n.news.naver.com/article/001/0016226272" class="sa_text_title">
    <strong>여야, 예산안 처리 협상 재개</strong>
  </a>
</div></li>
`
    expect(extractHeadlines(html)).toEqual([
      {
        title: '여야, 예산안 처리 협상 재개',
        link: 'https://n.news.naver.com/article/001/0016226272',
      },
    ])
  })
```

- [ ] **Step 2: 실패하는 것을 확인한다**

Run: `npx vitest run supabase/functions/collect-headlines/lib/headlines.test.ts`
Expected: FAIL. `canonicalLink is not a function` (또는 import 오류), 그리고 새 병합 테스트가 2건을 반환하며 실패.

- [ ] **Step 3: 최소 구현**

`headlines.ts`의 `STRONG_RE` 선언 아래에 추가:

```ts
// 섹션 첫 페이지는 /mnews/article/{press}/{id}를, "더보기" 페이지네이션은
// /article/{press}/{id}를 같은 기사에 준다. 삽입 시 중복 검사(index.ts)는 링크
// 문자열 전체를 맞춰 보므로, 여기서 합쳐 두지 않으면 같은 기사가 두 행이 된다.
//
// 꼬리에서 재구성하기 때문에 호스트·mnews·쿼리·해시·트레일링 슬래시가 한 번에
// 정리된다. 패턴이 맞지 않으면 원본을 그대로 돌려준다 — 네이버가 URL 모양을
// 바꿨을 때 뭉개면 서로 다른 기사가 한 링크로 합쳐져 조용히 유실된다.
const ARTICLE_PATH_RE = /\/article\/(\d+)\/(\d+)(?:[/?#]|$)/

export function canonicalLink(href: string): string {
  const match = ARTICLE_PATH_RE.exec(href)
  if (!match) return href
  return `https://n.news.naver.com/article/${match[1]}/${match[2]}`
}
```

`extractHeadlines` 안에서 href를 뽑는 줄을 고친다. **정규화가 `seenLinks` 검사보다 먼저**여야 한 응답 안에 섞인 두 형식이 합쳐진다:

```ts
    const link = canonicalLink(hrefMatch[1])
    if (seenLinks.has(link)) continue
```

- [ ] **Step 4: 기존 테스트의 기대값을 정규형으로 고친다**

`headlines.test.ts`의 픽스처 href는 실제 응답 형태이므로 **mnews로 남긴다.** 바뀌는 것은 기대값 세 곳뿐이다:

```ts
        link: 'https://n.news.naver.com/article/087/0001208610',
```
```ts
        link: 'https://n.news.naver.com/article/001/0016226272',
```
```ts
        link: 'https://n.news.naver.com/article/055/0001199999',
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run supabase/functions/collect-headlines/lib/headlines.test.ts`
Expected: PASS, 전부.

- [ ] **Step 6: 전체 게이트**

Run: `npm run build && npm test && npm run lint`
Expected: 세 개 다 통과. `npm run build`는 `functions` 프로젝트를 타입 검사하므로 `canonicalLink`의 시그니처가 여기서 걸린다.

- [ ] **Step 7: 커밋**

```bash
git add supabase/functions/collect-headlines/lib/headlines.ts supabase/functions/collect-headlines/lib/headlines.test.ts
git commit -m "Give one article one link"
```

- [ ] **Step 8: 함수를 배포한다 — 마이그레이션보다 먼저**

순서가 중요하다. 마이그레이션을 먼저 돌리면 아카이브는 정규형인데 수집기는 여전히 mnews를 써서, 다음 크론이 1면 기사를 전부 새 행으로 다시 넣는다. 반대 순서는 기존 누수가 며칠 더 이어질 뿐이라 안전하다.

```bash
set -a && . ./.env.supabase && set +a
npx supabase functions deploy collect-headlines --project-ref "$SUPABASE_PROJECT_REF"
```

Expected: `Deployed Functions on project ...`

`index.ts`는 타입 검사도 유닛 테스트도 되지 않는다. 이 함수가 실제로 도는지는 Task 4의 다음 날 수집 결과가 유일한 근거다.

---

### Task 2: 아카이브 정리 마이그레이션

**Files:**
- Create: `supabase/migrations/0007_canonical_links.sql`

**Interfaces:**
- Consumes: Task 1의 정규형 정의 `https://n.news.naver.com/article/{press}/{id}`. SQL 쪽 대응 표현은 `'https://n.news.naver.com/article/' || substring(link from '/article/(\d+/\d+)')`.
- Produces: `headlines.link`가 전부 정규형이고 `(category_id, article_key)` 중복이 0인 상태. Task 4의 검증 쿼리가 이것을 확인한다.

- [ ] **Step 1: 삭제 대상 규모를 먼저 읽는다**

로컬 Postgres가 없으므로 Management API(`POST https://api.supabase.com/v1/projects/{ref}/database/query`) 또는 Supabase MCP의 `execute_sql`로 돌린다.

```sql
with n as (
  select h.id, h.collected_date,
         row_number() over (
           partition by h.category_id, substring(h.link from '/article/(\d+/\d+)')
           order by h.collected_date, h.created_at, h.id
         ) rn
  from headlines h
  where h.link ~ '/article/\d+/\d+'
)
select count(*) filter (where n.rn > 1) as rows_to_delete,
       count(*) as rows_matched,
       (select count(*) from headlines) as rows_total,
       (select count(*) from headline_nouns hn
         where hn.headline_id in (select id from n where rn > 1)) as noun_rows_cascaded,
       (select string_agg(x.collected_date::text || ': ' || x.k, ' | ' order by x.collected_date)
        from (select collected_date, count(*)::text k from n where rn > 1 group by collected_date) x) as by_date
from n;
```

2026-08-02 기준 기대값: `rows_to_delete` 386, `rows_matched` = `rows_total` = 3120, `noun_rows_cascaded` 2343, `by_date` `2026-07-31: 1 | 2026-08-01: 238 | 2026-08-02: 147`.

**`rows_matched`가 `rows_total`보다 작으면 멈춘다** — 정규식에 걸리지 않는 링크 형식이 새로 생겼다는 뜻이고, 그건 `canonicalLink`도 통과시키지 못한다는 뜻이다. 08-03 이후에 돌린다면 새 수집일 몫만큼 숫자가 커지는 것은 정상이다.

- [ ] **Step 2: 마이그레이션 파일을 쓴다**

Create `supabase/migrations/0007_canonical_links.sql`:

```sql
-- supabase/migrations/0007_canonical_links.sql
--
-- 한 기사에 한 링크. 아카이브를 정규형으로 한 번 정리한다.
--
-- 섹션 첫 페이지는 인라인 HTML로 /mnews/article/{press}/{id}를 주고, "더보기"
-- 페이지네이션은 같은 기사에 /article/{press}/{id}를 준다. index.ts의 중복 검사는
-- 링크 문자열 전체를 맞춰 보므로 두 형식을 다른 기사로 봤다. 반대로 같은
-- 카테고리·같은 형식으로 중복된 행은 세 수집일 통틀어 0건이다 — 검사 자체는
-- 형식 안에서 완벽하게 동작했고, 새는 곳은 이 경계 하나뿐이었다.
--
-- 잡히는 것은 같은 날 중복(08-01 186건, 나머지 날은 한 자릿수)보다 날짜를
-- 건너뛰는 중복 쪽이 크다. 08-02 수집분 838행 중 143행(17.1%)이 08-01에 이미
-- 저장돼 있던 기사였다.
--
-- 그리는 화면은 거의 안 움직인다. 08-01과 08-02 모두 그려지는 70단어 중 2개가
-- 빠지고 엣지는 하나도 사라지지 않으며, 그날 최대 사건은 그대로다(김민석 46→46,
-- 정청래 39→39). 임계값은 하나도 건드리지 않으므로 10_sieve_eval.sql을 통과할
-- 일이 아니다. 다만 08-01은 라벨된 두 날 중 하나이므로, 다음에 체를 재려면
-- 20_unlabeled.sql을 먼저 다시 돌려야 한다.
--
-- 순서가 중요하다: 삭제가 먼저다. 링크를 먼저 정규형으로 바꾸면 그 즉시
-- UNIQUE (category_id, link) 위반이 난다.
--
-- 재실행해도 안전하다. 한 번 돌고 나면 중복도 비정규형 링크도 남지 않으므로 두
-- 문장 모두 0행에 영향을 준다.

-- 1) (category_id, article_key)별로 가장 이른 목격만 남긴다. 가장 이른 것을
--    남기는 것이 "기사는 처음 본 날에 센다"와 일치한다 — index.ts의 조회에
--    날짜 조건이 없다는 것이 원래 그 뜻이었고, 링크 정규화가 그것을 비로소
--    지켜지게 만든다. headline_nouns의 FK는 ON DELETE CASCADE라 명사는 따라
--    지워진다.
--
--    카테고리를 가로지르는 중복(하루 1~2건, 한 기사가 두 섹션에 걸린 경우)은
--    partition에 category_id가 들어 있으므로 자연히 남는다. 기사가 실제로 두
--    섹션에 걸린 것이므로 두 행이 맞다.
with ranked as (
  select id,
         row_number() over (
           partition by category_id, substring(link from '/article/(\d+/\d+)')
           order by collected_date, created_at, id
         ) as rn
  from headlines
  where link ~ '/article/\d+/\d+'
)
delete from headlines h
using ranked r
where h.id = r.id
  and r.rn > 1;

-- 2) 남은 행을 정규형으로. 정규식에 걸리지 않는 링크는 건드리지 않는다 —
--    canonicalLink도 그런 href는 원본 그대로 통과시킨다.
update headlines
set link = 'https://n.news.naver.com/article/' || substring(link from '/article/(\d+/\d+)')
where link ~ '/article/\d+/\d+'
  and link is distinct from
      'https://n.news.naver.com/article/' || substring(link from '/article/(\d+/\d+)');
```

- [ ] **Step 3: 적용한다**

```bash
set -a && . ./.env.supabase && set +a
npx supabase db push --password "$SUPABASE_DB_PASSWORD"
```

`db push`가 0004·0005를 다시 적용하겠다고 하면 놀라지 말 것 — 그 둘은 Management API로 들어가서 마이그레이션 이력에 없다. 재적용해도 무해하다(`word_overrides.word`가 기본 키다).

- [ ] **Step 4: 검증**

```sql
select
  (select count(*) from headlines)                                   as rows_total,
  (select count(*) from headlines where link like '%/mnews/%')       as mnews_left,
  (select count(*) from headlines
    where link !~ '^https://n\.news\.naver\.com/article/\d+/\d+$')   as non_canonical_left,
  (select count(*) from (
     select 1 from headlines
     group by category_id, substring(link from '/article/(\d+/\d+)')
     having count(*) > 1) x)                                          as duplicate_groups_left,
  (select count(*) from headlines h
    where not exists (select 1 from headline_nouns n where n.headline_id = h.id)) as headlines_without_nouns;
```

Expected: `rows_total` 2734 (3120 − 386), `mnews_left` 0, `non_canonical_left` 0, `duplicate_groups_left` 0, `headlines_without_nouns` 0.

**`headlines_without_nouns`가 0이 아니면 멈추고 보고한다.** 명사만 남고 헤드라인이 사라진 상황은 cascade가 의도대로 동작하지 않았다는 뜻이다.

- [ ] **Step 5: 그래프가 실제로 예측대로 움직였는지 본다**

```sql
select (select count(*) from json_array_elements((keyword_graph('2026-08-01'::date, null)->'nodes')::json)) as nodes_0801,
       (select count(*) from json_array_elements((keyword_graph('2026-08-01'::date, null)->'edges')::json)) as edges_0801,
       (select count(*) from json_array_elements((keyword_graph('2026-08-02'::date, null)->'nodes')::json)) as nodes_0802,
       (select count(*) from json_array_elements((keyword_graph('2026-08-02'::date, null)->'edges')::json)) as edges_0802;
```

정리 전에는 각각 70/47, 70/57이었다. 노드는 `render_cap`이 70이고 자격 단어 풀이 691·377로 여전히 충분하므로 **70/70 그대로**여야 한다. 엣지는 줄어들 수 있다. 노드가 70 미만이면 예측이 틀린 것이므로 멈추고 보고한다.

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/0007_canonical_links.sql
git commit -m "Collapse the archive onto one link per article"
```

---

### Task 3: 픽스처와 문서를 현실에 맞춘다

**Files:**
- Modify: `e2e/support/fixtures.ts:140`, `e2e/support/fixtures.ts:150`
- Modify: `e2e/keywordGraph.spec.ts:203`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1의 정규형, Task 2의 검증 결과.
- Produces: 없음 (문서와 목 데이터만).

- [ ] **Step 1: e2e 픽스처의 링크를 정규형으로**

`e2e/support/fixtures.ts`의 `HEADLINE_ROWS` 두 곳:

```ts
      link: 'https://n.news.naver.com/article/001/0000000002',
```
```ts
      link: 'https://n.news.naver.com/article/001/0000000001',
```

`e2e/keywordGraph.spec.ts`의 단언:

```ts
  await expect(link).toHaveAttribute(
    'href',
    'https://n.news.naver.com/article/001/0000000001',
  )
```

이 픽스처들은 DB가 돌려주는 행을 흉내 내는 것이므로, DB가 더는 담을 수 없는 형식을 쓰면 거짓말이 된다. `HeadlinePanel.tsx`의 `articleKey()`는 **그대로 둔다** — 정규화 후에도 한 기사가 두 섹션에 걸린 경우는 서로 다른 행이고, 패널의 중복은 그것이 잡는다.

- [ ] **Step 2: e2e를 돌린다**

Run: `npm run test:e2e`
Expected: 29건 전부 통과.

`playwright.config.ts`가 `reuseExistingServer: true`라 이미 떠 있는 dev 서버를 조용히 재사용한다. 먼저 떠 있는 것이 있으면 죽이고 시작할 것. `e2e/smoke.spec.ts`는 실제 프로젝트를 때리므로 진짜 `.env`가 필요하다(없으면 1건이 카운트 불일치로 실패한다).

- [ ] **Step 3: `CLAUDE.md`의 "External services" 절에 URL 두 형식을 적는다**

`Section IDs are fixed:` 줄 **앞에** 넣는다:

```markdown
- **One article, one link.** The section's first page and its `SECTION_ARTICLE_LIST`
  pagination hand back different URLs for the same article —
  `/mnews/article/{press}/{id}` against `/article/{press}/{id}` — and the boundary
  falls at whatever the first page held (46 of 150 in politics on 2026-08-02).
  `canonicalLink` in `lib/headlines.ts` rebuilds both as
  `https://n.news.naver.com/article/{press}/{id}` before `extractHeadlines`
  dedupes, which is what makes the existing `UNIQUE (category_id, link)` the real
  invariant. It returns anything it cannot parse **unchanged**: mangling an
  unrecognised href would merge two different articles into one link and lose one
  of them silently.
```

- [ ] **Step 4: `CLAUDE.md`에 박혀 있는 세 개의 숫자를 갱신한다**

마이그레이션 0007이 386행을 지웠으므로 `CLAUDE.md`가 인용한 실측치 세 곳이 낡는다. 먼저 새 값을 읽는다:

```sql
select
  (select count(distinct word) from headline_nouns n
     join headlines h on h.id = n.headline_id
    where h.collected_date = '2026-08-01')                                as words_0801,
  (select count(distinct word) from headline_nouns n
     join headlines h on h.id = n.headline_id
    where h.collected_date = '2026-07-31')                                as words_0731,
  (select count(*) from headlines where collected_date = '2026-08-01')    as rows_0801,
  (select count(*) from headlines where collected_date = '2026-07-31')    as rows_0731,
  (select count(*) from headlines)                                        as rows_total;
```

고칠 곳은 세 군데다. 줄 번호는 편집하면서 밀리므로 문구로 찾을 것:

1. **`daily_word_counts` 절** — `A day holds 3,289 distinct words (2026-08-01; 2,484 on 07-31)`. `words_0801` / `words_0731`로 교체. 이 문장의 논지(1000행 상한을 넘긴다)는 값이 줄어도 그대로 성립한다.
2. **"Day-over-day surge" 절** — `2026-08-01 was collected twice and holds 1,382 headlines against 2026-07-31's 900`. `rows_0801` / `rows_0731`로 교체하되, **"collected twice"는 남긴다** — 그날 크론이 두 번 돈 것은 사실이고, 0007이 지운 것은 그 결과인 중복 행이다. 이어지는 "on counts every word is up 50%"는 이제 과장이므로, 새 두 값의 비율로 고쳐 쓴다.
3. **"Word quality is measured" 절 끝** — `1,773 of 2,282 headlines were analysed before it first shipped`. 이 비율은 명사 병합 배포 시각을 기준으로 한 것이라 지금 재계산할 근거가 없다. 숫자를 지어내지 말고 `(counted before migration 0007 removed 386 duplicate rows)`를 괄호로 덧붙여 시점을 명시한다.

그리고 같은 절 끝에 다음 문단을 덧붙인다:

```markdown
Migration `0007` collapsed the archive onto one row per article, which **moves
both labelled days**. Before re-running `10_sieve_eval.sql` for any reason,
re-run `20_unlabeled.sql` first: ranks near the cut are filled by different
words now. Measured cost on the drawn set was small — 2 of the 70 words leave on
each day and none of the edges do, and the biggest story does not move (김민석
46→46 on 2026-08-02) — but "small" is not "none", and the percentages recorded
above were taken before it.
```

- [ ] **Step 5: 커밋**

```bash
git add e2e/support/fixtures.ts e2e/keywordGraph.spec.ts CLAUDE.md
git commit -m "Say one link per article everywhere it is written down"
```

---

### Task 4: 다음 날 수집으로 확인 (2026-08-03 07:00 KST 이후)

`index.ts`는 타입 검사도 유닛 테스트도 되지 않는다. 배포된 함수가 실제로 정규형을 쓰는지는 크론이 한 번 돈 뒤에만 알 수 있다. **Task 3까지는 오늘 끝내고, 이 태스크만 내일 아침으로 미룬다.**

**Files:** 없음 (검증만). 실패 시 수정 대상은 `supabase/functions/collect-headlines/lib/headlines.ts`.

- [ ] **Step 1: 새 수집일의 링크 형식**

```sql
select collected_date,
       count(*) as rows,
       count(*) filter (where link like '%/mnews/%') as mnews,
       count(*) filter (where link !~ '^https://n\.news\.naver\.com/article/\d+/\d+$') as non_canonical
from headlines
group by collected_date
order by collected_date;
```

Expected: 모든 날짜에서 `mnews` 0, `non_canonical` 0.

**`mnews`가 0이 아니면 배포가 안 붙은 것이다.** `npx supabase functions deploy collect-headlines`를 다시 돌리고 대시보드에서 함수 버전을 확인한다.

- [ ] **Step 2: 중복이 다시 생기지 않았는지**

```sql
select count(*) as duplicate_groups
from (select 1 from headlines
      group by category_id, substring(link from '/article/(\d+/\d+)')
      having count(*) > 1) x;
```

Expected: 0.

- [ ] **Step 3: 하루치 수집량이 예상 범위인지**

```sql
select collected_date, count(*) from headlines group by 1 order by 1;
```

08-03은 **695건 부근**을 기대한다(08-02의 838건에서 어제치 143건이 빠진 값). 830건대가 나오면 어제 기사가 여전히 다시 들어오고 있다는 뜻이고, Step 1의 `mnews` 카운트와 함께 읽으면 원인이 갈린다. 400건 아래면 수집 자체가 덜 돈 것이므로 함수 응답의 `summary`를 확인한다.

- [ ] **Step 4: 화면 확인**

`npm run dev`로 띄우고 08-03을 연다. 단어가 그려지고 아무 단어나 눌렀을 때 패널의 링크가 `n.news.naver.com/article/...` 형식이며 클릭하면 기사가 열리는지 본다.

- [ ] **Step 5: 프로젝트 메모리를 갱신한다**

`~/.claude/projects/C--Users-YNH-Desktop-Programming-NewsScrap/memory/keyword-graph-plan-state.md`에서 파킹된 두 건 중 **스크레이퍼 링크 정규화를 완료로 옮긴다.** `standalone` 사각지대는 파킹 상태 그대로 두고, 이제 그것을 재려면 라벨이 08-01·08-02 양쪽에서 다시 확인돼야 한다는 사실을 덧붙인다.

---

## Self-Review

**1. Spec coverage**

| 스펙 항목 | 태스크 |
|---|---|
| `canonicalLink` 순수 함수, 파싱 실패 시 원본 반환 | Task 1 Step 3 |
| `seenLinks` 검사보다 먼저 정규화 | Task 1 Step 3 (마지막 코드 블록) |
| DDL 없음 | Task 2 — 마이그레이션에 DDL 문장이 없다 |
| 마이그레이션 0007, 삭제 후 정규화 | Task 2 Step 2 |
| 카테고리 가로지르는 중복은 보존 | Task 2 Step 2 주석 + `partition by category_id` |
| `articleKey()` 유지 | Task 3 Step 1 |
| 체·임계값 불변 | Global Constraints |
| 테스트 5종 | Task 1 Step 1 |
| 기존 기대값 3곳 수정 | Task 1 Step 4 |
| 배포 순서 (함수 먼저) | Global Constraints + Task 1 Step 8 |
| 다음 수집일 검증 | Task 4 |
| `npm run test:e2e` 회귀 | Task 3 Step 2 |
| `CLAUDE.md` 갱신 | Task 3 Steps 3–4 |
| 메모리 갱신 | Task 4 Step 5 |

빠진 항목 없음.

**2. Placeholder scan** — "적절히", "필요하면", "TODO" 없음. 모든 코드 단계에 실제 코드가 들어 있다.

**3. Type consistency** — `canonicalLink(href: string): string` 하나가 Task 1에서 정의되고 Task 2·4의 SQL 표현이 같은 정규형(`https://n.news.naver.com/article/{press}/{id}`)을 쓴다. `ScrapedHeadline`은 변하지 않으므로 `index.ts`는 손댈 곳이 없다.
