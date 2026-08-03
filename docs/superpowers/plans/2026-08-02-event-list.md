# 사건 목록 (Event List) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캔버스가 이미 찾아 놓고 버리던 루뱅 커뮤니티를 화면에 내보내, 하루를 단어 뭉치가 아니라 **사건 목록**으로 읽게 하고, 사건 사이를 잇는 **다리 단어**를 클릭 동작으로 드러낸다.

**Architecture:** 새 순수 모듈 `src/lib/events.ts`가 (노드, 엣지, 커뮤니티 배정) 셋만 받아 합치기 → 사건 목록 → 다리 맵을 만든다. `graphLayout.ts`는 이미 매 렌더 계산하고 있는 루뱅 분할을 잘리지 않은 채로 노출하기만 한다. 중복 제거된 기사 수는 클라이언트에서 셀 수 없으므로 마이그레이션 `0010`이 RPC 두 개를 더한다. `App`이 목록을 소유하고, `KeywordGraph`는 헤더 슬롯과 "이 단어들만 살려라"는 집합 하나를 새로 받는다.

**Tech Stack:** TypeScript, React 19, Vite, d3-force, Supabase (Postgres + PostgREST RPC), Vitest + @testing-library/react, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-02-event-list-design.md` — 이 플랜의 모든 수치와 판단 근거는 거기 있다.

## Global Constraints

- **`npm run build`가 게이트다.** `npm test`만으로는 컴파일되지 않는 코드도 통과한다 (Vitest는 타입 검사 없이 트랜스파일한다). 태스크를 끝냈다고 말하기 전에 반드시 돌린다.
- **테스트를 타입 검사에서 빼거나 `tsconfig`를 느슨하게 하거나 단언을 약화시켜 빌드를 통과시키지 않는다.** 이 저장소에서 이미 시도됐고 실제 오류를 감췄다.
- **색은 `src/index.css`의 `@theme` 블록에 한 번만 정의된다.** 컴포넌트는 `var(--color-*)` 문자열만 들고, 16진수를 두 번째로 적지 않는다.
- **SVG `fill`/`stroke`는 인라인 `style`로 간다** (프레젠테이션 속성에서 `var()`는 신뢰할 수 없다). **`opacity`와 `stroke-opacity`는 속성으로 남는다** — `e2e/keywordGraph.spec.ts`가 직접 단언한다.
- **응답을 합해서 분모를 만들지 않는다. 잘릴 수 있는 읽기로 수를 세지 않는다.** PostgREST는 1000행에서 자르고 아무 말도 하지 않는다.
- **스키마는 세 곳에 있다** — `supabase/migrations/*.sql`, Edge Function의 insert, `src/lib/queries.ts`. 하나를 바꾸면 셋을 다 바꾼다.
- **`keyword_signals`의 공식을 다시 구현하지 않는다.** 손으로 베낀 두 번째 사본을 재는 것은 엉뚱한 것을 재는 것이다.
- **Playwright 목의 세 함정** (`CLAUDE.md`): RPC는 **POST**이고 인자가 본문에 있으므로 `route.request().postDataJSON()`으로 읽는다. HEAD 요청은 `content-range` 헤더로 답한다. 요청마다 달라지는 기본값은 **함수**여야 하고 `resolve()`가 그것을 호출해야 한다 — 함수를 그대로 돌려주면 `undefined`로 직렬화되어 "데이터 없음"처럼 보인다.
- **UI 문구는 한국어다.**
- **`--font-display`(Noto Serif KR)는 마스트헤드 날짜와 패널 제목에만 쓴다.** 캔버스는 시스템 스택(`FONT_FAMILY`)에 머문다.
- **합치기 문턱은 2다.** 스펙 2절이 1과 3을 각각 측정해 기각했다. 이 플랜 안에서 바꾸지 않는다.
- **클러스터는 그리지 않는다.** 음영·볼록 껍질·엣지 그라디언트는 전부 측정 후 제거됐다. 다리 단어에도 **고정 잉크를 붙이지 않는다.**
- 마이그레이션은 **`0010_event_rpcs.sql`** 하나뿐이다. 데이터는 건드리지 않는다.

## File Structure

| 파일 | 책임 |
| --- | --- |
| `supabase/migrations/0010_event_rpcs.sql` (신규) | `event_headline_counts`, `event_headlines` |
| `src/lib/events.ts` (신규) | 합치기, 순위, 라벨, 다리 맵. d3 없음, DOM 없음 |
| `src/lib/events.test.ts` (신규) | 위의 산술 전부 |
| `src/components/EventList.tsx` (신규) | 목록 렌더링과 클릭 |
| `src/components/EventList.test.tsx` (신규) | 렌더링 계약 |
| `src/components/graphLayout.ts` (수정) | `GraphLayout.communities` 노출 |
| `src/components/graphLayout.test.ts` (수정) | 노출된 분할이 `findClusters`와 일치 |
| `src/lib/queries.ts` (수정) | 두 RPC 래퍼 |
| `src/lib/queries.test.ts` (수정) | 호출 형태와 응답 매핑 |
| `src/lib/urlState.ts` (수정) | `event` 필드 |
| `src/lib/urlState.test.ts` (수정) | `word`가 `event`를 이긴다 |
| `src/components/KeywordGraph.tsx` (수정) | 캡션 제거, `header` 슬롯, `focusWords`, `onCommunities` |
| `src/components/HeadlinePanel.tsx` (수정) | `word` → `subject` + `isEvent` |
| `src/components/HeadlinePanel.test.tsx` (수정) | prop 이름 변경 반영 |
| `src/App.tsx` (수정) | 사건 상태, 카운트 요청, 배선 |
| `e2e/support/fixtures.ts` (수정) | `EVENT_GRAPH`, 사건 헤드라인 픽스처 |
| `e2e/support/mockSupabase.ts` (수정) | 두 새 RPC 엔드포인트 |
| `e2e/eventList.spec.ts` (신규) | 목록, 클릭, URL, 다리 |
| `e2e/keywordGraph.spec.ts` (수정) | 캡션 단언 제거 |

`events.ts`가 `graphLayout.ts` 안이 아니라 새 파일인 이유: `graphLayout.ts`는 961줄이고 본업이 좌표 계산이다. 사건 산술을 거기 넣으면 **레이아웃을 돌리지 않고는 테스트할 수 없게 된다.** `events.ts`는 노드·엣지·커뮤니티 배정만 받으므로 d3 없이 테스트된다.

---

## 스펙과의 차이 하나 — 읽고 넘어갈 것

스펙 5절의 데이터 흐름 그림은 `events.ts`가 **상위 5개까지 자른 뒤** 카운트 RPC를 부르는 것처럼 그려져 있다. 그 순서로는 순위가 **합계**로 정해지고, 그것이 정확히 1절이 버그라고 밝힌 값이다 — 08-01의 진짜 1위는 트럼프(합계 73 / 실제 51)가 아니라 폭염(합계 69 / 실제 61)이다.

그래서 이 플랜은 순서를 뒤집는다: **합쳐진 사건 전체(하루 14~17개)를 한 번의 RPC로 세고, 돌아온 중복 제거 수로 정렬한 다음 상위 5개를 자른다.** 여전히 왕복 한 번이고, 세는 쪽은 하루치 `headline_nouns` 한 번 훑기라 15개든 5개든 같은 일이다. 1절이 명시적이고 측정에 근거한 반면 그림은 스케치이므로, 1절을 따른다.

---

## Task 1: 마이그레이션 0010 — 사건 RPC 두 개

**Files:**
- Create: `supabase/migrations/0010_event_rpcs.sql`

**Interfaces:**
- Consumes: 없음. 기존 `headline_nouns` / `headlines` / `categories` 스키마만 읽는다.
- Produces:
  - `event_headline_counts(p_date date, p_category text default null, p_events jsonb default '[]'::jsonb) returns json` — 입력과 **같은 순서의** 정수 배열
  - `event_headlines(p_date date, p_category text default null, p_words text[] default '{}') returns json` — `{id, title, link, category_slug}` 객체 배열, 헤드라인 id로 유일화됨

**배경:** 클라이언트는 단어별 카운트만 갖고 있고, 그것을 더하면 한 기사를 여러 번 센다. 그리고 루뱅 분할은 클라이언트에서만 알려져 있으므로 서버가 미리 계산해 둘 수 없다. `count(distinct …)`는 PostgREST가 표현할 수 없으므로 `keyword_graph`와 같은 이유로 RPC다.

- [ ] **Step 1: 마이그레이션 파일을 쓴다**

```sql
-- supabase/migrations/0010_event_rpcs.sql
--
-- 사건 단위의 기사 수와 헤드라인. 둘 다 클라이언트가 할 수 없는 일을 한다.
--
-- 지금 화면의 "오늘의 톱 스토리"가 부르는 숫자는 멤버 단어들의 count를 더한
-- 값이고, 한 기사가 사건의 두 단어를 물면 두 번 세어진다. 그래서 그것은 사건의
-- 기사 수가 아니라 (기사, 단어) 쌍의 수다. 실측한 배율은 1.10에서 2.22 사이이고
-- **사건마다 다르며 단어 수와 함께 커지므로, 표시만이 아니라 순위가 틀린다** —
-- 2026-08-01의 실제 1위는 트럼프(합계 73 / 실제 51)가 아니라 폭염(69 / 61)이다.
--
-- 클라이언트가 이것을 고칠 수 없는 이유는 둘이다. headline_nouns를
-- .in('word', words)로 읽어 headline_id를 유일화하면 (1) 08-02의 가장 큰 사건이
-- 이미 164행이고 이 수는 사건의 단어 수와 함께 자라므로 PostgREST의 1000행
-- 상한에 잘릴 수 있고, (2) 응답을 세어 수를 만드는 것은 CLAUDE.md가 금지한
-- 바로 그 동작이다. count(distinct …)는 PostgREST가 표현할 수 없다.
--
-- 사건 분할은 클라이언트의 루뱅에서 나오므로 서버가 미리 계산해 둘 수 없다.
-- 따라서 사건이 정해진 뒤 한 번 더 물어보는 형태가 된다.
--
-- 데이터는 건드리지 않는다. drop function 둘로 완전히 되돌아간다.

-- 사건마다 그 멤버 단어 중 하나라도 물고 있는 헤드라인의 수. 유일화는 헤드라인
-- id로 한다.
--
-- p_events는 단어 배열의 배열이고, 반환은 **같은 순서의** 정수 배열이다. 목록
-- 전체가 한 번의 왕복으로 끝난다. 순서가 어긋나면 사건에 남의 기사 수가 붙고
-- 화면상 그럴듯해 보이므로, ordinality를 끝까지 들고 가서 그 순서로 집계한다.
--
-- p_category가 null이면 전체 보기다. keyword_graph의 scoped CTE와 같은 필터를
-- 쓰므로 화면에 있는 것과 같은 것을 센다.
create function event_headline_counts(
  p_date date,
  p_category text default null,
  p_events jsonb default '[]'::jsonb
)
returns json
language sql
stable
set search_path = ''
as $fn$
with scoped as (
  select distinct h.id as headline_id, n.word
  from public.headline_nouns n
  join public.headlines h on h.id = n.headline_id
  join public.categories c on c.id = h.category_id
  where h.collected_date = p_date
    and (p_category is null or c.slug = p_category)
),
ev as (
  select
    e.ordinality - 1 as idx,
    array(select jsonb_array_elements_text(e.value)) as words
  from jsonb_array_elements(p_events) with ordinality as e(value, ordinality)
)
select coalesce(
  (
    select json_agg(t.n order by t.idx)
    from (
      select
        ev.idx,
        (
          select count(distinct s.headline_id)
          from scoped s
          where s.word = any(ev.words)
        )::int as n
      from ev
    ) t
  ),
  '[]'::json
);
$fn$;

comment on function event_headline_counts(date, text, jsonb) is
  '사건별 중복 제거 기사 수. 입력 순서 그대로 돌려준다.';

-- 클릭한 사건의 헤드라인. fetchHeadlinesForWord의 200행 상한을 사건 경로에
-- 그대로 쓰면 74건짜리 사건이 164행을 소비해 여유가 22%밖에 없으므로, 상한을
-- 올리는 대신 서버에서 유일화해 상한 자체를 없앤다.
--
-- 한 기사가 두 섹션에 실린 경우는 여기서 두 행으로 남는다 — id가 다르기
-- 때문이고, HeadlinePanel의 dedupe()가 기사 id 경로로 다시 접는다. 그 동작은
-- 지금과 같다.
create function event_headlines(
  p_date date,
  p_category text default null,
  p_words text[] default '{}'
)
returns json
language sql
stable
set search_path = ''
as $fn$
select coalesce(
  (
    select json_agg(
      json_build_object(
        'id', t.id,
        'title', t.title,
        'link', t.link,
        'category_slug', t.slug
      )
      order by t.slug, t.title
    )
    from (
      select distinct h.id, h.title, h.link, c.slug
      from public.headline_nouns n
      join public.headlines h on h.id = n.headline_id
      join public.categories c on c.id = h.category_id
      where h.collected_date = p_date
        and (p_category is null or c.slug = p_category)
        and n.word = any(p_words)
    ) t
  ),
  '[]'::json
);
$fn$;

comment on function event_headlines(date, text, text[]) is
  '사건 멤버 단어 중 하나라도 문 헤드라인, 헤드라인 id로 유일화.';

-- SQL 함수는 기본이 SECURITY INVOKER이므로 select 전용 정책이 그대로 산다.
-- keyword_graph와 같이 anon에게 execute를 준다.
grant execute on function event_headline_counts(date, text, jsonb) to anon, authenticated;
grant execute on function event_headlines(date, text, text[]) to anon, authenticated;
```

- [ ] **Step 2: 배포된 데이터베이스에 적용한다**

로컬 Postgres도 Docker도 없다. MCP 도구를 쓴다:

```
mcp__supabase__apply_migration  name: "event_rpcs"  query: <위 파일의 내용>
```

MCP를 쓸 수 없으면 CLAUDE.md의 경로를 쓴다:

```bash
set -a && . ./.env.supabase && set +a
npx supabase db push --password "$SUPABASE_DB_PASSWORD"
```

- [ ] **Step 3: 스펙 1절의 실측치로 검증한다**

`mcp__supabase__execute_sql`로 다음을 돌린다. **기대값은 스펙 1절 표에서 온 것이고, 다르게 나오면 함수가 틀린 것이다.**

```sql
-- 2026-07-31: 폭염 사건 63, 트럼프 묶음 39.
select event_headline_counts(
  '2026-07-31'::date,
  null,
  '[["폭염","양산","한반도","에어컨"],
    ["트럼프","우크라","사우디","패트리엇","하마스","이스라엘","가자지구"]]'::jsonb
) as counts;
```

Expected: `[63, 39]`

```sql
-- 2026-08-01의 순위 뒤집힘. 합계로는 트럼프 73 > 폭염 69지만 실제는 51 < 61이다.
select event_headline_counts(
  '2026-08-01'::date,
  null,
  '[["트럼프","이스라엘","하마스","에너지","에너지시설"],
    ["폭염","양산","구마모토"]]'::jsonb
) as counts;
```

Expected: `[51, 61]`

```sql
-- 빈 입력은 빈 배열이고 오류가 아니다.
select event_headline_counts('2026-07-31'::date, null, '[]'::jsonb) as counts;
```

Expected: `[]`

```sql
-- 두 함수가 서로를 교차 검증한다: 같은 사건의 헤드라인 수는 같아야 한다.
select json_array_length(
  event_headlines('2026-07-31'::date, null, array['폭염','양산','한반도','에어컨'])
) as n;
```

Expected: `63`

```sql
-- 카테고리 필터가 먹는지. 전체보다 작아야 한다.
select event_headline_counts(
  '2026-07-31'::date, 'society', '[["폭염","양산","한반도","에어컨"]]'::jsonb
) as counts;
```

Expected: 63보다 작은 값 하나가 담긴 배열.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/0010_event_rpcs.sql
git commit -m "Count an event's headlines once each"
```

---

## Task 2: `src/lib/events.ts` — 합치기, 순위, 라벨, 다리

**Files:**
- Create: `src/lib/events.ts`
- Test: `src/lib/events.test.ts`

**Interfaces:**
- Consumes: `GraphEdge` (`src/lib/types.ts`) — `{ a: string; b: string; cooc: number; npmi: number }`. 커뮤니티 배정은 `Map<string, number>`로 받는다 (Task 3이 노출한다).
- Produces:
  - `interface EventWord { word: string; count: number }`
  - `interface NewsEvent { words: EventWord[]; index: number; countSum: number }`
  - `interface EventGraph { events: NewsEvent[]; bridges: Map<string, number[]> }`
  - `interface RankedEvent { event: NewsEvent; headlines: number | null }`
  - `buildEvents(words: EventWord[], edges: GraphEdge[], communities: Map<string, number>): EventGraph`
  - `topEvents(events: NewsEvent[], headlines: number[] | null, limit?: number): RankedEvent[]`
  - `eventLabel(words: EventWord[], max?: number): { shown: string[]; rest: number }`
  - `sameCommunities(a: Map<string, number>, b: Map<string, number>): boolean`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildEvents, eventLabel, sameCommunities, topEvents } from './events'
import type { EventWord } from './events'
import type { GraphEdge } from './types'

function w(word: string, count: number): EventWord {
  return { word, count }
}

function e(a: string, b: string): GraphEdge {
  return { a, b, cooc: 3, npmi: 0.7 }
}

// Louvain's output, handed in rather than computed: buildEvents takes the
// partition the canvas actually used, so these tests name it directly.
function communities(groups: string[][]): Map<string, number> {
  const map = new Map<string, number>()
  groups.forEach((group, id) => group.forEach((word) => map.set(word, id)))
  return map
}

describe('buildEvents — 합치기', () => {
  it('엣지 2개로 이어진 두 커뮤니티를 하나로 본다', () => {
    const words = [w('김민석', 10), w('정청래', 8), w('최민희', 6), w('최고위원', 4)]
    const { events } = buildEvents(
      words,
      [e('김민석', '정청래'), e('최민희', '최고위원'), e('김민석', '최민희'), e('정청래', '최고위원')],
      communities([['김민석', '정청래'], ['최민희', '최고위원']]),
    )

    expect(events).toHaveLength(1)
    expect(events[0].words.map((x) => x.word)).toEqual(['김민석', '정청래', '최민희', '최고위원'])
  })

  it('엣지 1개짜리는 합치지 않는다', () => {
    // 2026-08-01의 민주당–한동훈. 닿아 있지만 민주당 전당대회와 국민의힘
    // 지도부는 다른 사건이고, 문턱을 1로 내리면 이 둘이 붙는다.
    const words = [w('민주당', 10), w('곽상언', 8), w('한동훈', 6), w('장동혁', 4)]
    const { events } = buildEvents(
      words,
      [e('민주당', '곽상언'), e('한동훈', '장동혁'), e('민주당', '한동훈')],
      communities([['민주당', '곽상언'], ['한동훈', '장동혁']]),
    )

    expect(events).toHaveLength(2)
  })

  it('합치기는 전이적이다', () => {
    // 2026-08-02: 전당대회 묶음이 최민희 쪽과 5개, 순회경선 쪽과 2개로 붙어
    // 셋이 하나가 된다. 순회경선과 최민희 사이에는 직접 엣지가 없어도 된다.
    const words = [w('A1', 9), w('A2', 8), w('B1', 7), w('B2', 6), w('C1', 5), w('C2', 4)]
    const { events } = buildEvents(
      words,
      [
        e('A1', 'A2'), e('B1', 'B2'), e('C1', 'C2'),
        e('A1', 'B1'), e('A2', 'B2'),
        e('A1', 'C1'), e('A2', 'C2'),
      ],
      communities([['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2']]),
    )

    expect(events).toHaveLength(1)
    expect(events[0].words).toHaveLength(6)
  })

  it('혼자인 커뮤니티는 사건이 아니다', () => {
    // findClusters가 싱글턴을 버리는 것과 같은 컷. 이것이 다리 계산에서
    // "자기 사건 밖" 자체를 정의할 수 없는 단어의 정체이기도 하다.
    const { events } = buildEvents(
      [w('폭염', 9), w('열대야', 7), w('까마귀', 5)],
      [e('폭염', '열대야')],
      communities([['폭염', '열대야'], ['까마귀']]),
    )

    expect(events).toHaveLength(1)
    expect(events[0].words.map((x) => x.word)).toEqual(['폭염', '열대야'])
  })

  it('사건 안의 단어는 기사 수 내림차순, 동수면 단어순이다', () => {
    // 2026-07-31 하루에만 두 번 걸린다 (노무현·정청래 둘 다 8건,
    // 삼전닉스·코스닥 둘 다 6건). 클라이언트 정렬이므로 안정 정렬에 기대지
    // 않고 단어를 명시적 2차 키로 쓴다.
    const { events } = buildEvents(
      [w('정청래', 8), w('김민석', 12), w('노무현', 8)],
      [e('김민석', '정청래'), e('정청래', '노무현')],
      communities([['김민석', '정청래', '노무현']]),
    )

    expect(events[0].words.map((x) => x.word)).toEqual(['김민석', '노무현', '정청래'])
  })

  it('엣지가 없으면 사건도 없다', () => {
    const { events, bridges } = buildEvents(
      [w('폭염', 9), w('까마귀', 5)],
      [],
      communities([['폭염'], ['까마귀']]),
    )

    expect(events).toEqual([])
    expect(bridges.size).toBe(0)
  })
})

describe('buildEvents — 다리', () => {
  it('합쳐지지 않은 쌍의 양끝이 다리이고, 자기 사건도 목록에 든다', () => {
    const words = [w('민주당', 10), w('곽상언', 8), w('한동훈', 6), w('장동혁', 4)]
    const { events, bridges } = buildEvents(
      words,
      [e('민주당', '곽상언'), e('한동훈', '장동혁'), e('민주당', '한동훈')],
      communities([['민주당', '곽상언'], ['한동훈', '장동혁']]),
    )

    const democrats = events.findIndex((ev) => ev.words.some((x) => x.word === '민주당'))
    const opposition = events.findIndex((ev) => ev.words.some((x) => x.word === '한동훈'))

    expect(bridges.get('민주당')).toEqual([democrats, opposition].sort((a, b) => a - b))
    expect(bridges.get('한동훈')).toEqual([democrats, opposition].sort((a, b) => a - b))
    expect(bridges.has('곽상언')).toBe(false)
    expect(bridges.has('장동혁')).toBe(false)
  })

  it('합쳐진 쌍의 양끝은 다리가 아니다', () => {
    // 정의상 그렇다 — 2개 이상으로 이어진 쌍은 이미 한 사건이므로 그 엣지는
    // 자기 사건 밖으로 나가지 않는다.
    const { bridges } = buildEvents(
      [w('김민석', 10), w('정청래', 8), w('최민희', 6), w('최고위원', 4)],
      [e('김민석', '정청래'), e('최민희', '최고위원'), e('김민석', '최민희'), e('정청래', '최고위원')],
      communities([['김민석', '정청래'], ['최민희', '최고위원']]),
    )

    expect(bridges.size).toBe(0)
  })

  it('제3의 커뮤니티를 거쳐 한 사건이 된 쌍의 엣지도 다리가 아니다', () => {
    // A와 C는 엣지 1개로만 닿아 있지만 둘 다 B를 통해 한 사건이 되었다.
    // 다리 판정은 쌍의 엣지 수가 아니라 **최종 사건 소속**으로 한다.
    const { events, bridges } = buildEvents(
      [w('A1', 9), w('A2', 8), w('B1', 7), w('B2', 6), w('C1', 5), w('C2', 4)],
      [
        e('A1', 'A2'), e('B1', 'B2'), e('C1', 'C2'),
        e('A1', 'B1'), e('A2', 'B2'),
        e('B1', 'C1'), e('B2', 'C2'),
        e('A1', 'C1'),
      ],
      communities([['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2']]),
    )

    expect(events).toHaveLength(1)
    expect(bridges.size).toBe(0)
  })

  it('세 사건에 닿는 단어는 셋을 다 돌려준다', () => {
    const { bridges } = buildEvents(
      [w('허브', 12), w('A2', 8), w('B1', 7), w('B2', 6), w('C1', 5), w('C2', 4)],
      [e('허브', 'A2'), e('B1', 'B2'), e('C1', 'C2'), e('허브', 'B1'), e('허브', 'C1')],
      communities([['허브', 'A2'], ['B1', 'B2'], ['C1', 'C2']]),
    )

    expect(bridges.get('허브')).toHaveLength(3)
  })

  it('싱글턴 커뮤니티의 단어는 다리가 아니고, 그 엣지도 다리를 만들지 않는다', () => {
    // 속한 사건이 없으므로 "자기 사건 밖으로 나가는 엣지"를 정의할 수 없다.
    // 양끝 중 하나라도 사건에 속하지 않으면 그 엣지는 다리가 아니다.
    const { bridges } = buildEvents(
      [w('폭염', 9), w('열대야', 7), w('외톨이', 5)],
      [e('폭염', '열대야'), e('폭염', '외톨이')],
      communities([['폭염', '열대야'], ['외톨이']]),
    )

    expect(bridges.size).toBe(0)
  })
})

describe('topEvents', () => {
  const words = [w('트럼프', 30), w('이스라엘', 25), w('폭염', 40), w('양산', 20)]
  const edges = [e('트럼프', '이스라엘'), e('폭염', '양산')]
  const partition = communities([['트럼프', '이스라엘'], ['폭염', '양산']])

  it('합계가 아니라 넘겨받은 중복 제거 기사 수로 순위를 매긴다', () => {
    // 2026-08-01이 이 모양이었다. countSum은 트럼프 55, 폭염 60이므로 합계로는
    // 폭염이 이긴다. 중복 제거 수를 51 대 40으로 주면 순서가 뒤집히고, 그
    // 뒤집힘이 이 함수가 카운트를 인자로 받는 이유 전부다.
    const { events } = buildEvents(words, edges, partition)
    const trump = events.findIndex((ev) => ev.words.some((x) => x.word === '트럼프'))
    const heat = events.findIndex((ev) => ev.words.some((x) => x.word === '폭염'))

    const counts: number[] = []
    counts[trump] = 51
    counts[heat] = 40

    const ranked = topEvents(events, counts)
    expect(ranked[0].event.words[0].word).toBe('트럼프')
    expect(ranked[0].headlines).toBe(51)
    expect(ranked[1].headlines).toBe(40)
  })

  it('카운트가 없으면 합계 순서로 떨어지고 기사 수는 null이다', () => {
    const { events } = buildEvents(words, edges, partition)
    const ranked = topEvents(events, null)

    expect(ranked[0].event.words[0].word).toBe('폭염')
    expect(ranked[0].headlines).toBeNull()
  })

  it('상위 5개로 자른다', () => {
    const many: EventWord[] = []
    const pairs: GraphEdge[] = []
    const groups: string[][] = []
    for (let i = 0; i < 8; i++) {
      many.push(w(`a${i}`, 10 - i), w(`b${i}`, 9 - i))
      pairs.push(e(`a${i}`, `b${i}`))
      groups.push([`a${i}`, `b${i}`])
    }
    const { events } = buildEvents(many, pairs, communities(groups))

    expect(events).toHaveLength(8)
    expect(topEvents(events, null)).toHaveLength(5)
  })

  it('5개가 안 되면 있는 만큼, 0개면 빈 배열', () => {
    const { events } = buildEvents(words, edges, partition)
    expect(topEvents(events, null)).toHaveLength(2)
    expect(topEvents([], null)).toEqual([])
  })
})

describe('eventLabel', () => {
  it('4개까지는 그대로 보이고 외 N이 붙지 않는다', () => {
    expect(eventLabel([w('가', 4), w('나', 3), w('다', 2), w('라', 1)])).toEqual({
      shown: ['가', '나', '다', '라'],
      rest: 0,
    })
  })

  it('넘으면 앞의 4개와 나머지 수를 돌려준다', () => {
    const words = ['가', '나', '다', '라', '마', '바', '사'].map((x, i) => w(x, 10 - i))
    expect(eventLabel(words)).toEqual({ shown: ['가', '나', '다', '라'], rest: 3 })
  })
})

describe('sameCommunities', () => {
  it('내용이 같으면 참이다', () => {
    expect(sameCommunities(communities([['가', '나']]), communities([['가', '나']]))).toBe(true)
  })

  it('배정이 다르거나 크기가 다르면 거짓이다', () => {
    expect(sameCommunities(communities([['가', '나']]), communities([['가'], ['나']]))).toBe(false)
    expect(sameCommunities(communities([['가', '나']]), communities([['가']]))).toBe(false)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/events.test.ts`
Expected: FAIL — `Failed to resolve import "./events"`

- [ ] **Step 3: `src/lib/events.ts`를 쓴다**

```ts
// src/lib/events.ts
//
// 하루를 사건 목록으로 읽는 산술. 캔버스와 무관하고 d3에 닿지 않으므로
// graphLayout.ts가 아니라 여기 있다 — 거기 넣으면 레이아웃을 돌리지 않고는
// 테스트할 수 없어진다.
//
// 입력의 세 번째 인자인 커뮤니티 배정은 **캔버스가 실제로 쓴 루뱅 분할**이고,
// 여기서 다시 계산하지 않는다. 손으로 베낀 두 번째 사본을 재는 것은 이
// 저장소가 이미 두 번 당한 함정이다.

import type { GraphEdge } from './types'

export interface EventWord {
  word: string
  count: number
}

export interface NewsEvent {
  /** 멤버 단어. 기사 수 내림차순, 동수면 단어순. */
  words: EventWord[]
  /**
   * EventGraph.events 안의 자리. 다리 맵이 가리키는 신원이다 — 화면에 보이는
   * 목록은 중복 제거 카운트로 다시 정렬된 다른 순서이므로 그쪽을 쓸 수 없다.
   */
  index: number
  /**
   * 멤버들의 count 합. **사건의 기사 수가 아니다** — 한 기사가 두 멤버를 물면
   * 두 번 세어지고, 2026-08-02의 13단어 사건에서는 2.22배가 된다. 카운트 RPC가
   * 실패했을 때의 대체 순서로만 쓰고 화면에 내보내지 않는다.
   */
  countSum: number
}

export interface EventGraph {
  /** 합쳐진 사건 전부. 잘려 있지 않다 — 다리는 이 전체에 대해 계산된다. */
  events: NewsEvent[]
  /** 다리 단어 → 그 단어가 닿는 사건 인덱스들(오름차순, 자기 사건 포함). */
  bridges: Map<string, number[]>
}

export interface RankedEvent {
  event: NewsEvent
  /** 중복 제거된 기사 수. 카운트 RPC가 실패하면 null이고 화면은 자리를 비운다. */
  headlines: number | null
}

// 루뱅 커뮤니티 두 개가 이만큼의 엣지로 이어져 있으면 목록에서 하나로 본다.
//
// 1이 아닌 이유: 2026-08-01의 민주당–한동훈이 엣지 하나로 붙어 있고, 민주당
// 전당대회와 국민의힘 지도부는 다른 사건이다. 3이 아닌 이유: 2026-08-02의
// 순회경선·명청대전이 엣지 2개로 붙어 있고 그것은 전당대회 사건의 일부라,
// 3으로 올리면 그날 최대 기사가 다시 쪼개진다.
const MERGE_MIN_EDGES = 2

// 목록의 길이. 문턱이 아니라 순위다 — 비율로 자르면 아무것도 가리키지 못한다는
// 것은 surgeLimitFor가 이미 측정한 것과 같은 이야기다. 합쳐진 뒤 하루의 사건은
// 14~17개이므로 상위 5개는 3분의 1이고, 잘려 나가는 꼬리는 대부분 캔버스에서
// 이미 선으로 이어진 채 붙어 있는 2단어 쌍이다.
const DEFAULT_LIMIT = 5

// 목록 한 줄에 보이는 단어 수. 세 날 통틀어 이 상한에 걸리는 것은 07-31의
// 트럼프 묶음(7단어)과 08-02의 전당대회(13단어)뿐이다.
const LABEL_WORDS = 4

export function buildEvents(
  words: EventWord[],
  edges: GraphEdge[],
  communities: Map<string, number>,
): EventGraph {
  // 혼자인 커뮤니티는 사건이 아니다 — findClusters가 싱글턴을 버리는 것과 같은
  // 컷이고, 그런 단어에는 "자기 사건 밖"이라는 것이 정의되지 않으므로 다리도
  // 될 수 없다.
  const size = new Map<number, number>()
  for (const word of words) {
    const id = communities.get(word.word)
    if (id === undefined) continue
    size.set(id, (size.get(id) ?? 0) + 1)
  }

  const communityOf = new Map<string, number>()
  for (const word of words) {
    const id = communities.get(word.word)
    if (id !== undefined && (size.get(id) ?? 0) > 1) communityOf.set(word.word, id)
  }

  // 서로 다른 두 커뮤니티를 잇는 엣지를 쌍마다 센다.
  const between = new Map<string, number>()
  for (const edge of edges) {
    const a = communityOf.get(edge.a)
    const b = communityOf.get(edge.b)
    if (a === undefined || b === undefined || a === b) continue
    between.set(pairKey(a, b), (between.get(pairKey(a, b)) ?? 0) + 1)
  }

  // 유니온-파인드. 전이성은 여기서 공짜로 나온다 — 2026-08-02의 정치 커뮤니티
  // 셋은 서로 다른 두 쌍을 통해 한 사건이 된다.
  const parent = new Map<number, number>()
  for (const id of size.keys()) parent.set(id, id)

  function find(id: number): number {
    const up = parent.get(id)
    if (up === undefined || up === id) return id
    const root = find(up)
    parent.set(id, root)
    return root
  }

  // 키 순으로 돌린다: 합치는 순서가 Postgres가 엣지를 돌려준 순서에 따라
  // 달라지면 같은 날이 두 번 다르게 그려진다.
  for (const key of [...between.keys()].sort()) {
    if ((between.get(key) ?? 0) < MERGE_MIN_EDGES) continue
    const [a, b] = key.split(':').map(Number)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb))
  }

  const members = new Map<number, EventWord[]>()
  for (const word of words) {
    const id = communityOf.get(word.word)
    if (id === undefined) continue
    const root = find(id)
    const group = members.get(root)
    if (group) group.push(word)
    else members.set(root, [word])
  }

  const events: NewsEvent[] = [...members.values()]
    .map((group) => {
      const sorted = [...group].sort(
        (a, b) => b.count - a.count || a.word.localeCompare(b.word),
      )
      return {
        words: sorted,
        index: 0,
        countSum: sorted.reduce((sum, word) => sum + word.count, 0),
      }
    })
    // 대체 순서일 뿐이다 — topEvents가 중복 제거 카운트로 다시 매긴다. 동수는
    // findClusters와 같이 첫 단어로 깬다.
    .sort(
      (a, b) => b.countSum - a.countSum || a.words[0].word.localeCompare(b.words[0].word),
    )
    .map((event, index) => ({ ...event, index }))

  const eventOf = new Map<string, number>()
  for (const event of events) {
    for (const word of event.words) eventOf.set(word.word, event.index)
  }

  // 다리는 **자기 사건 밖으로 엣지를 가진 단어**다. 쌍의 엣지 수가 아니라 최종
  // 소속으로 판정하는 것이 중요하다: 합치기가 거절한 쌍이라도 제3의 커뮤니티를
  // 거쳐 한 사건이 되었을 수 있고, 그러면 다리가 아니다.
  const bridges = new Map<string, number[]>()
  function touch(word: string, index: number): void {
    const held = bridges.get(word)
    if (!held) bridges.set(word, [index])
    else if (!held.includes(index)) held.push(index)
  }

  for (const edge of edges) {
    const a = eventOf.get(edge.a)
    const b = eventOf.get(edge.b)
    if (a === undefined || b === undefined || a === b) continue
    touch(edge.a, a)
    touch(edge.a, b)
    touch(edge.b, a)
    touch(edge.b, b)
  }
  for (const indices of bridges.values()) indices.sort((x, y) => x - y)

  return { events, bridges }
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

// 중복 제거된 기사 수로 순위를 매기고 자른다.
//
// 이 함수가 카운트를 인자로 받고 스스로 세지 않는 것은 CLAUDE.md의 규칙과 같은
// 이유다 — computeSurges가 분모를 넘겨받는 것과 같다. 멤버 카운트를 더해
// 순위를 매기면 사건마다 다른 배율로 부풀고 순서가 뒤집힌다: 2026-08-01의
// 실제 1위는 트럼프(합계 73 / 실제 51)가 아니라 폭염(69 / 61)이다.
export function topEvents(
  events: NewsEvent[],
  headlines: number[] | null,
  limit: number = DEFAULT_LIMIT,
): RankedEvent[] {
  return events
    .map((event) => ({ event, headlines: headlines?.[event.index] ?? null }))
    // 카운트는 전부 있거나 전부 없다(RPC 한 번), 그래서 이 비교가 실제 수와
    // 합계를 섞는 일은 없다. 없을 때만 합계로 떨어진다.
    .sort(
      (a, b) =>
        (b.headlines ?? b.event.countSum) - (a.headlines ?? a.event.countSum) ||
        a.event.words[0].word.localeCompare(b.event.words[0].word),
    )
    .slice(0, limit)
}

// 목록 한 줄에 보일 단어와, 가려진 나머지 수.
export function eventLabel(
  words: EventWord[],
  max: number = LABEL_WORDS,
): { shown: string[]; rest: number } {
  return {
    shown: words.slice(0, max).map((word) => word.word),
    rest: Math.max(0, words.length - max),
  }
}

// 레이아웃은 폭에 반응하므로 커뮤니티 배정이 리사이즈마다 새 Map으로 올라온다.
// 값은 바뀌지 않으므로(루뱅은 위상만 본다) 내용을 비교해 재요청을 막는다.
export function sameCommunities(
  a: Map<string, number>,
  b: Map<string, number>,
): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [word, id] of a) {
    if (b.get(word) !== id) return false
  }
  return true
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/lib/events.test.ts`
Expected: PASS, 전부.

- [ ] **Step 5: 타입 검사**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/events.ts src/lib/events.test.ts
git commit -m "Merge the day's communities into a list of events"
```

---

## Task 3: `graphLayout.ts`가 루뱅 분할을 노출한다

**Files:**
- Modify: `src/components/graphLayout.ts` (`GraphLayout` 인터페이스, `computeGraphLayout`의 두 return)
- Test: `src/components/graphLayout.test.ts` (추가)

**Interfaces:**
- Consumes: 없음.
- Produces: `GraphLayout.communities: Map<string, number>` — **잘리지 않은** 배정. `findClusters`가 버리는 싱글턴도 들어 있다.

`detectCommunities`는 이미 매 렌더 돌고 있고 `findClusters`가 `clusterLimit`으로 잘라 버린다. 계산을 더 하는 것이 아니라 이미 나온 값을 밖으로 내보내기만 한다. `clusterLimit`과 `PlacedCluster.hull`은 그대로 둔다 — 아무것도 그리지 않지만 `graphLayout.test.ts`가 분할 자체를 검사할 때 쓴다.

**이 태스크는 힘을 하나도 건드리지 않는다.** 합치기는 **목록에서만** 일어나고, `clusterCohesion`과 `chooseHubs`는 합치기 이전 루뱅 분할을 계속 쓴다. 13단어짜리 사건 하나를 한 허브에 응집시키면 캔버스 가운데가 뭉치고, 지금의 배치는 이미 측정으로 정해진 것이다. 여기서 `MERGE_MIN_EDGES`를 아는 코드는 `events.ts`뿐이어야 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/components/graphLayout.test.ts` 끝에 붙인다:

```ts
describe('communities', () => {
  it('그려진 모든 단어에 배정을 준다 — 엣지가 없는 단어까지', () => {
    const words = [word('폭염'), word('양산'), word('까마귀')]
    const layout = computeGraphLayout(words, [edge('폭염', '양산')], SIZE)

    expect(layout.communities.size).toBe(3)
    expect(layout.communities.has('까마귀')).toBe(true)
  })

  it('한 클러스터의 단어들은 정확히 하나의 커뮤니티에 속한다', () => {
    // 노출된 배정과 findClusters의 분할이 갈리면 목록이 캔버스와 다른 하루를
    // 말하게 된다. clusterLimit을 올려 잘리지 않은 분할 전체를 본다.
    const words = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map((w) => word(w))
    const layout = computeGraphLayout(
      words,
      [edge('a1', 'a2'), edge('b1', 'b2'), edge('c1', 'c2')],
      { ...SIZE, clusterLimit: 99 },
    )

    expect(layout.clusters.length).toBeGreaterThan(1)

    const seen = new Set<number>()
    for (const cluster of layout.clusters) {
      const ids = new Set(cluster.words.map((w) => layout.communities.get(w)))
      expect(ids.size).toBe(1)
      const [id] = [...ids]
      expect(id).toBeDefined()
      expect(seen.has(id!)).toBe(false)
      seen.add(id!)
    }
  })

  it('단어가 없으면 빈 맵이다', () => {
    expect(computeGraphLayout([], [], SIZE).communities.size).toBe(0)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/components/graphLayout.test.ts -t "communities"`
Expected: FAIL — `layout.communities`가 `undefined`.

- [ ] **Step 3: 인터페이스에 필드를 더한다**

`src/components/graphLayout.ts`의 `GraphLayout`에서, `clusters` 다음에:

```ts
export interface GraphLayout {
  nodes: PlacedNode[]
  edges: PlacedEdge[]
  /** Biggest first, so the day's top story is clusters[0]. Singletons omitted. */
  clusters: PlacedCluster[]
  /**
   * Every drawn word's Louvain community, uncut — including the singletons
   * findClusters drops and the words past clusterLimit.
   *
   * The canvas does not use this; src/lib/events.ts does, to build the event
   * list out of the same partition the cohesion force ran on. Exposing it
   * rather than recomputing it is the point: a second copy of the partition is
   * the hazard CLAUDE.md records against keyword_signals.
   */
  communities: Map<string, number>
  /** Tight box around the drawn labels, for cropping the viewport to them. */
  bounds: { x: number; y: number; width: number; height: number }
}
```

- [ ] **Step 4: 두 return 지점에 값을 넣는다**

빈 입력의 조기 반환 (`computeGraphLayout` 맨 앞):

```ts
  if (words.length === 0) {
    return {
      nodes: [],
      edges: [],
      clusters: [],
      communities: new Map(),
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    }
  }
```

본 반환 (파일 끝쪽, `const clusters = findClusters(...)` 다음):

```ts
  return {
    nodes: placed,
    edges: placedEdges,
    clusters,
    communities,
    bounds: boundingBox(placed, clusters, padding),
  }
```

`communities`는 이미 그 스코프에 있는 지역 변수다 (`const communities = detectCommunities(words, links)`).

- [ ] **Step 5: 테스트를 돌린다**

Run: `npx vitest run src/components/graphLayout.test.ts`
Expected: PASS — 새 것과 기존 것 전부.

- [ ] **Step 6: 커밋**

```bash
git add src/components/graphLayout.ts src/components/graphLayout.test.ts
git commit -m "Let the layout hand back the partition it already found"
```

---

## Task 4: `queries.ts` — 두 RPC 래퍼

**Files:**
- Modify: `src/lib/queries.ts`
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: Task 1의 `event_headline_counts`, `event_headlines`. `HeadlineSummary` (`src/lib/types.ts`).
- Produces:
  - `fetchEventHeadlineCounts(date: string, categorySlug: string | null, events: string[][]): Promise<number[]>`
  - `fetchHeadlinesForEvent(date: string, categorySlug: string | null, words: string[]): Promise<HeadlineSummary[]>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/queries.test.ts`의 import 줄을 고쳐 두 함수를 더한다:

```ts
const {
  fetchAvailableDates,
  fetchEventHeadlineCounts,
  fetchHeadlinesForEvent,
  fetchHeadlinesForWord,
  fetchKeywordGraph,
  fetchWordCounts,
} = await import('./queries')
```

파일 끝에 붙인다:

```ts
describe('fetchEventHeadlineCounts', () => {
  it('세 인자를 그대로 넘기고 숫자 배열로 매핑한다', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: [63, 39], error: null })

    const result = await fetchEventHeadlineCounts('2026-07-31', null, [
      ['폭염', '양산'],
      ['트럼프', '하마스'],
    ])

    expect(mockSupabase.rpc).toHaveBeenCalledWith('event_headline_counts', {
      p_date: '2026-07-31',
      p_category: null,
      p_events: [
        ['폭염', '양산'],
        ['트럼프', '하마스'],
      ],
    })
    expect(result).toEqual([63, 39])
  })

  it('사건이 없으면 RPC를 부르지 않는다', async () => {
    mockSupabase.rpc.mockClear()
    expect(await fetchEventHeadlineCounts('2026-07-31', null, [])).toEqual([])
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('길이가 어긋나면 던진다', async () => {
    // 순서가 곧 신원이므로, 짧은 응답을 그대로 쓰면 사건에 남의 기사 수가
    // 붙고 화면상 그럴듯해 보인다. 조용히 틀리느니 시끄럽게 실패한다.
    mockSupabase.rpc.mockResolvedValue({ data: [63], error: null })

    await expect(
      fetchEventHeadlineCounts('2026-07-31', null, [['폭염'], ['트럼프']]),
    ).rejects.toThrow(/event_headline_counts/)
  })

  it('PostgREST 오류를 진짜 Error로 던진다', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'boom', code: 'PGRST202' },
    })

    await expect(fetchEventHeadlineCounts('2026-07-31', null, [['폭염']])).rejects.toThrow(
      'boom (PGRST202)',
    )
  })
})

describe('fetchHeadlinesForEvent', () => {
  it('단어 배열을 넘기고 헤드라인으로 매핑한다', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [
        {
          id: 'h1',
          title: '폭염 특보 확대',
          link: 'https://n.news.naver.com/article/001/0000000001',
          category_slug: 'society',
        },
      ],
      error: null,
    })

    const result = await fetchHeadlinesForEvent('2026-07-31', 'society', ['폭염', '양산'])

    expect(mockSupabase.rpc).toHaveBeenCalledWith('event_headlines', {
      p_date: '2026-07-31',
      p_category: 'society',
      p_words: ['폭염', '양산'],
    })
    expect(result).toEqual([
      {
        id: 'h1',
        title: '폭염 특보 확대',
        link: 'https://n.news.naver.com/article/001/0000000001',
        category_slug: 'society',
      },
    ])
  })

  it('단어가 없으면 RPC를 부르지 않는다', async () => {
    mockSupabase.rpc.mockClear()
    expect(await fetchHeadlinesForEvent('2026-07-31', null, [])).toEqual([])
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: FAIL — `fetchEventHeadlineCounts is not a function`.

- [ ] **Step 3: 두 함수를 `src/lib/queries.ts` 끝에 더한다**

```ts
// 사건별 중복 제거 기사 수. RPC인 이유는 keyword_graph와 같다: count(distinct …)를
// PostgREST가 표현할 수 없고, headline_nouns를 읽어 클라이언트에서 유일화하면
// 응답이 1000행에 잘릴 수 있는데 잘려도 아무도 모른다 — 2026-08-02의 가장 큰
// 사건이 이미 164행이고 이 수는 사건의 단어 수와 함께 자란다.
//
// 하루의 사건 전부를 한 번에 묻는다. 상위 5개를 먼저 자르면 순위가 멤버 카운트의
// 합으로 정해지는데, 그 합이 바로 이 함수가 고치려는 값이다.
export async function fetchEventHeadlineCounts(
  date: string,
  categorySlug: string | null,
  events: string[][],
): Promise<number[]> {
  if (events.length === 0) return []

  const { data, error } = await supabase.rpc('event_headline_counts', {
    p_date: date,
    p_category: categorySlug,
    p_events: events,
  })
  if (error) throw queryError(error)

  const counts = (data ?? []) as number[]
  // 순서가 곧 신원이다. 어긋난 응답을 쓰면 사건에 남의 기사 수가 붙고, 그것은
  // 화면에서 틀려 보이지 않는다.
  if (counts.length !== events.length) {
    throw new Error(
      `event_headline_counts가 ${events.length}개를 물었는데 ${counts.length}개를 돌려줬습니다`,
    )
  }
  return counts.map((count) => Number(count))
}

// 한 사건의 헤드라인. fetchHeadlinesForWord의 200행 상한을 여기 그대로 쓰면
// 74건짜리 사건이 164행을 소비해 여유가 22%밖에 없으므로, 상한을 올리는 대신
// 서버에서 유일화해 상한 자체를 없앤다.
export async function fetchHeadlinesForEvent(
  date: string,
  categorySlug: string | null,
  words: string[],
): Promise<HeadlineSummary[]> {
  if (words.length === 0) return []

  const { data, error } = await supabase.rpc('event_headlines', {
    p_date: date,
    p_category: categorySlug,
    p_words: words,
  })
  if (error) throw queryError(error)

  return (data ?? []) as HeadlineSummary[]
}
```

- [ ] **Step 4: 테스트를 돌린다**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: 타입 검사**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "Ask the server how many headlines an event holds"
```

---

## Task 5: `urlState.ts` — `event` 필드

**Files:**
- Modify: `src/lib/urlState.ts`
- Test: `src/lib/urlState.test.ts`

**Interfaces:**
- Consumes: 없음.
- Produces: `UrlState`에 `event: string | null`이 늘어난다. 값은 **사건의 첫 단어**(그 사건 안에서 기사 수 1위). 인덱스는 데이터가 움직이면 다른 사건을 가리키므로 쓸 수 없고, 단어 목록 전체는 URL이 감당하기에 길다.

**주의:** 기존 테스트 두 개가 `toEqual`로 객체 전체를 비교하고 있으므로 같이 고쳐야 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/urlState.test.ts`에서 기존 두 단언을 고친다:

```ts
  it('reads all three keys', () => {
    expect(parseUrlState('?date=2026-07-31&category=economy&word=금리', SLUGS)).toEqual({
      date: '2026-07-31',
      category: 'economy',
      word: '금리',
      event: null,
    })
  })

  it('returns nulls for an empty query string', () => {
    expect(parseUrlState('', SLUGS)).toEqual({
      date: null,
      category: null,
      word: null,
      event: null,
    })
  })
```

그리고 파일 끝에 붙인다:

```ts
describe('event', () => {
  it('사건의 첫 단어를 읽는다', () => {
    expect(parseUrlState(`?event=${encodeURIComponent('폭염')}`, SLUGS).event).toBe('폭염')
  })

  it('둘 다 있으면 word가 이긴다', () => {
    // 단어 선택과 사건 선택은 상호 배타다. 둘 다 켜진 상태는 캔버스에서 무엇이
    // 살아 있는지 읽을 수 없다.
    const state = parseUrlState('?word=폭염&event=트럼프', SLUGS)
    expect(state.word).toBe('폭염')
    expect(state.event).toBeNull()
  })

  it('toSearch가 event를 쓰고, word가 있으면 event를 쓰지 않는다', () => {
    expect(toSearch({ date: null, category: null, word: null, event: '폭염' })).toBe(
      `?event=${encodeURIComponent('폭염')}`,
    )
    expect(toSearch({ date: null, category: null, word: '금리', event: '폭염' })).toBe(
      `?word=${encodeURIComponent('금리')}`,
    )
  })

  it('sameState가 event를 본다', () => {
    const base = { date: '2026-07-31', category: null, word: null, event: '폭염' }
    expect(sameState(base, { ...base })).toBe(true)
    expect(sameState(base, { ...base, event: '트럼프' })).toBe(false)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/urlState.test.ts`
Expected: FAIL — `event` 프로퍼티 없음.

- [ ] **Step 3: `src/lib/urlState.ts`를 고친다**

```ts
export interface UrlState {
  date: string | null
  category: string | null
  word: string | null
  /**
   * 선택된 사건의 첫 단어(그 사건 안에서 기사 수 1위). 인덱스가 아닌 이유는
   * 데이터가 움직이면 인덱스가 다른 사건을 가리키기 때문이고, 단어 목록
   * 전체가 아닌 이유는 URL이 감당하기에 길기 때문이다.
   *
   * `word`와 상호 배타다.
   */
  event: string | null
}

export const EMPTY_URL_STATE: UrlState = {
  date: null,
  category: null,
  word: null,
  event: null,
}
```

`parseUrlState`의 본문:

```ts
  const date = params.get('date')
  const category = params.get('category')
  const word = params.get('word')
  const event = params.get('event')

  return {
    date: date && isCalendarDate(date) ? date : null,
    category:
      category && (knownSlugs.length === 0 || knownSlugs.includes(category)) ? category : null,
    word: word ? word : null,
    // 손으로 고친 링크는 둘 다 담을 수 있다. 단어와 사건이 동시에 선택된
    // 상태는 UI가 만들 수 없고 캔버스에서 읽을 수도 없으므로, 하나를 버린다.
    event: word ? null : event ? event : null,
  }
```

`toSearch`:

```ts
  if (state.date) params.set('date', state.date)
  if (state.category) params.set('category', state.category)
  if (state.word) params.set('word', state.word)
  else if (state.event) params.set('event', state.event)
```

`sameState`:

```ts
export function sameState(a: UrlState, b: UrlState): boolean {
  return (
    a.date === b.date &&
    a.category === b.category &&
    a.word === b.word &&
    a.event === b.event
  )
}
```

- [ ] **Step 4: 테스트를 돌린다**

Run: `npx vitest run src/lib/urlState.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/urlState.ts src/lib/urlState.test.ts
git commit -m "Put the selected event in the query string"
```

---

## Task 6: `EventList.tsx`

**Files:**
- Create: `src/components/EventList.tsx`
- Test: `src/components/EventList.test.tsx`

**Interfaces:**
- Consumes: `RankedEvent`, `eventLabel` (Task 2).
- Produces:
  ```ts
  interface EventListProps {
    events: RankedEvent[]
    /** 선택된 사건의 첫 단어, 없으면 null. */
    selected: string | null
    onSelect: (topWord: string) => void
  }
  ```

**색에 대하여:** 사건은 여러 섹션에 걸치므로 섹션 잉크를 쓸 수 없다 — 탭 줄이 캔버스의 색 열쇠이고, 다른 초록을 부르는 두 번째 열쇠는 없느니만 못하다. 목록은 무채색이고, 1위 앞의 점만 `--color-top-story`로 남는다(지금 캡션이 쓰는 바로 그 점). 선택된 항목은 배경으로만 구분한다. 페이지 바탕이 `bg-ground`이므로 강조는 `bg-surface`다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/components/EventList.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EventList } from './EventList'
import type { RankedEvent } from '../lib/events'

function ranked(words: string[], headlines: number | null, index = 0): RankedEvent {
  return {
    event: {
      words: words.map((word, i) => ({ word, count: 10 - i })),
      index,
      countSum: words.length * 10,
    },
    headlines,
  }
}

describe('EventList', () => {
  it('사건이 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<EventList events={[]} selected={null} onSelect={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('멤버 단어와 기사 수를 그린다', () => {
    render(
      <EventList
        events={[ranked(['폭염', '양산', '한반도', '에어컨'], 63)]}
        selected={null}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('폭염 · 양산 · 한반도 · 에어컨')).toBeInTheDocument()
    expect(screen.getByText('63건')).toBeInTheDocument()
  })

  it('단어가 4개를 넘으면 외 N이 붙는다', () => {
    render(
      <EventList
        events={[ranked(['트럼프', '하마스', '우크라', '사우디', '이스라엘', '가자지구', '패트리엇'], 39)]}
        selected={null}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('트럼프 · 하마스 · 우크라 · 사우디')).toBeInTheDocument()
    expect(screen.getByText('외 3')).toBeInTheDocument()
  })

  it('기사 수가 null이면 자리를 비운다 — 목록 자체는 그린다', () => {
    // 카운트 RPC가 실패했을 때. 사건 이름이 숫자보다 중요하고, 목록 전체를
    // 감추면 캡션조차 없어진다.
    render(<EventList events={[ranked(['폭염', '양산'], null)]} selected={null} onSelect={vi.fn()} />)

    expect(screen.getByText('폭염 · 양산')).toBeInTheDocument()
    expect(screen.queryByText(/건$/)).not.toBeInTheDocument()
  })

  it('누르면 사건의 첫 단어로 onSelect를 부른다', () => {
    const onSelect = vi.fn()
    render(
      <EventList events={[ranked(['폭염', '양산'], 63)]} selected={null} onSelect={onSelect} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /폭염/ }))
    expect(onSelect).toHaveBeenCalledWith('폭염')
  })

  it('선택된 항목만 aria-pressed다', () => {
    render(
      <EventList
        events={[ranked(['폭염', '양산'], 63, 0), ranked(['트럼프', '하마스'], 39, 1)]}
        selected="트럼프"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /폭염/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /트럼프/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/components/EventList.test.tsx`
Expected: FAIL — `Failed to resolve import "./EventList"`.

- [ ] **Step 3: `src/components/EventList.tsx`를 쓴다**

```tsx
import { eventLabel } from '../lib/events'
import type { RankedEvent } from '../lib/events'

// 1위 앞의 점. 지금 "오늘의 톱 스토리" 캡션이 쓰는 바로 그 색이고, 목록에서
// 유일한 색이다.
//
// 사건은 여러 섹션에 걸치므로 섹션 잉크는 쓸 수 없다 — 탭 줄이 캔버스의 색
// 열쇠이고, 화면의 초록과 다른 초록을 부르는 두 번째 열쇠는 없느니만 못하다.
const TOP_STORY_TINT = 'var(--color-top-story)'

interface EventListProps {
  events: RankedEvent[]
  /** 선택된 사건의 첫 단어, 없으면 null. */
  selected: string | null
  onSelect: (topWord: string) => void
}

export function EventList({ events, selected, onSelect }: EventListProps) {
  // 엣지가 하나도 없는 날은 사건이 0개다. 오류가 아니라 그날 아무것도 이어지지
  // 않았다는 뜻이고, 지금 캡션이 없을 때와 같이 아무것도 그리지 않는다.
  if (events.length === 0) return null

  return (
    <ol aria-label="오늘의 사건" className="flex min-w-0 flex-col gap-0.5 text-sm">
      {events.map((ranked, rank) => {
        const top = ranked.event.words[0].word
        const { shown, rest } = eventLabel(ranked.event.words)
        const isSelected = top === selected

        return (
          <li key={top}>
            <button
              type="button"
              onClick={() => onSelect(top)}
              aria-pressed={isSelected}
              className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-surface ${
                isSelected ? 'bg-surface' : ''
              }`}
            >
              {/* 자리는 모든 줄이 잡고 색만 1위가 갖는다. 점 없는 줄이
                  들여쓰기를 잃으면 목록이 계단처럼 어긋난다. */}
              <span
                aria-hidden="true"
                className="inline-block size-2 shrink-0 translate-y-px rounded-full"
                style={{ background: rank === 0 ? TOP_STORY_TINT : 'transparent' }}
              />
              <span className="min-w-0 text-ink">
                {shown.join(' · ')}
                {rest > 0 && <span className="text-ink-faint"> 외 {rest}</span>}
              </span>
              {ranked.headlines !== null && (
                <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-ink-faint">
                  {ranked.headlines}건
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
```

- [ ] **Step 4: 테스트를 돌린다**

Run: `npx vitest run src/components/EventList.test.tsx`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/components/EventList.tsx src/components/EventList.test.tsx
git commit -m "Draw the day as a list of events"
```

---

## Task 7: `KeywordGraph.tsx` — 캡션을 슬롯으로, 포커스를 집합으로

**Files:**
- Modify: `src/components/KeywordGraph.tsx`

**Interfaces:**
- Consumes: `GraphLayout.communities` (Task 3).
- Produces: `KeywordGraphProps`에 셋이 는다.
  ```ts
  /** 캡션 자리에 들어갈 것. 사건 목록이 여기 온다. */
  header?: ReactNode
  /** 이 단어들만 불투명하게 남긴다. null이면 기존 단어 포커스가 그대로 돈다. */
  focusWords?: Set<string> | null
  /** 잘리지 않은 루뱅 배정을 올려보낸다. 리사이즈마다 불린다. */
  onCommunities?: (communities: Map<string, number>) => void
  ```

**없어지는 것:** `const topStory = layout.clusters[0]`와 "오늘의 톱 스토리" `<p>`. `TOP_STORY_TINT` 상수도 여기서는 쓰이지 않으므로 지운다 (`EventList.tsx`가 자기 것을 갖고 있다). `layout.clusters`는 계속 계산되지만 이 컴포넌트는 더 이상 읽지 않는다.

**남는 것:** 급상승 키("직전 수집일 대비 급상승")는 같은 줄에 남는다. 그것은 캔버스의 표식을 설명하는 범례이고, 캔버스는 이 줄 바로 아래에 있다.

- [ ] **Step 1: import와 props를 고친다**

파일 맨 위:

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
```

`TOP_STORY_TINT` 상수와 그 위의 주석 블록을 지운다.

props:

```ts
interface KeywordGraphProps {
  graph: KeywordGraphData
  selectedWord: string | null
  onWordClick: (word: string) => void
  /** Section colours only mean something in the all-categories view. */
  colorByCategory: boolean
  /** Words that grew against the previous collected day. Empty is normal. */
  surges: Map<string, Surge>
  /**
   * Whatever goes above the canvas — the event list, in practice. A slot
   * rather than a component of its own so the list and the surge key share one
   * bordered row; two stacked bordered rows read as two unrelated blocks.
   */
  header?: ReactNode
  /**
   * The words an event or a bridge selection holds lit. Null means no such
   * selection, and the word focus below runs as it always has.
   *
   * An event lights its members and **not their neighbours**: a word selection
   * expands to neighbours, but an event already is a neighbourhood, and
   * expanding it would light the very event across a bridge that the merge
   * rule declined to join — letting the display overturn that judgement.
   */
  focusWords?: Set<string> | null
  /**
   * The uncut Louvain partition, handed up so the event list is built from the
   * same one the cohesion force ran on. Called on every resize; the assignment
   * is a function of topology alone, so the value does not change and the
   * caller compares content before acting on it.
   */
  onCommunities?: (communities: Map<string, number>) => void
}

export function KeywordGraph({
  graph,
  selectedWord,
  onWordClick,
  colorByCategory,
  surges,
  header,
  focusWords = null,
  onCommunities,
}: KeywordGraphProps) {
```

- [ ] **Step 2: 배정을 올려보내는 effect를 더한다**

`layout` memo 바로 다음에:

```ts
  useEffect(() => {
    onCommunities?.(layout.communities)
  }, [layout.communities, onCommunities])
```

- [ ] **Step 3: 불투명도 규칙을 고친다**

`nodeOpacity`를 이렇게 바꾼다 (`neighbors` memo는 그대로 둔다):

```ts
  function nodeOpacity(word: string, faded: boolean): number {
    const base = faded ? FADED_OPACITY : 1
    // 사건이나 다리가 선택되면 살아남는 집합이 밖에서 정해져 온다. 그럴 때는
    // 이웃으로 넓히지 않는다 — 사건은 그 자체가 이미 이웃 집합이다.
    if (focusWords) return focusWords.has(word) ? base : UNFOCUSED_OPACITY
    if (!selectedWord) return base
    if (word === selectedWord || neighbors.has(word)) return base
    return UNFOCUSED_OPACITY
  }

  // 엣지는 양끝이 다 살아 있을 때만 살아 있다. 단어 포커스일 때의 규칙은 그대로
  // 둔다 — 이웃끼리 잇는 선까지 살리면 지금 화면이 달라진다.
  function edgeLit(a: string, b: string): boolean {
    if (focusWords) return focusWords.has(a) && focusWords.has(b)
    if (!selectedWord) return true
    return a === selectedWord || b === selectedWord
  }
```

엣지 렌더링 안의 `touchesSelection`을 바꾼다:

```ts
            const touchesSelection = edgeLit(edge.a, edge.b)
```

- [ ] **Step 4: 캡션을 슬롯으로 바꾼다**

`const topStory = layout.clusters[0]` 줄을 지우고, 캡션 블록 전체를 이것으로 교체한다:

```tsx
      {/* One rule of caption above the canvas rather than two centred lines
          floating in the gap between the toolbar and the first word — that gap
          was most of what made the top of the page read as empty.
          The header slot holds the event list. The surge key is here for its
          own reason: the mark is small and sits off the side of a word, so
          without a key it reads as a rendering artefact. */}
      {(header || marked) && (
        <div className="mb-4 border-b border-line pb-2">
          {header}
          {marked && (
            <p className="mt-1 text-right text-xs text-ink-faint">
              <span className="mr-1" style={{ color: SURGE_COLOR }}>
                {SURGE_MARK}
              </span>
              직전 수집일 대비 급상승
            </p>
          )}
        </div>
      )}
```

- [ ] **Step 5: 빌드와 기존 테스트**

Run: `npm run build`
Expected: 성공. `topStory`가 지워졌으므로 `layout.clusters`를 읽는 곳이 없어야 한다.

Run: `npm test`
Expected: PASS. (`e2e/keywordGraph.spec.ts`의 캡션 테스트는 Task 9에서 고친다 — 여기서는 e2e를 돌리지 않는다.)

- [ ] **Step 6: 커밋**

```bash
git add src/components/KeywordGraph.tsx
git commit -m "Give the caption row to the event list"
```

---

## Task 8: `App.tsx` 배선 + `HeadlinePanel` 제목

**Files:**
- Modify: `src/components/HeadlinePanel.tsx`
- Modify: `src/components/HeadlinePanel.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 2의 `buildEvents` / `topEvents` / `eventLabel` / `sameCommunities`, Task 4의 두 fetch, Task 5의 `event` URL 필드, Task 6의 `EventList`, Task 7의 세 prop.
- Produces: `HeadlinePanelProps.word`가 **`subject`로 이름이 바뀌고** `isEvent?: boolean`이 는다. 사건의 이름은 단어 목록이라 따옴표를 두르면 이상하게 읽힌다.

- [ ] **Step 1: `HeadlinePanel`의 prop을 고친다**

`src/components/HeadlinePanel.tsx`:

```ts
interface HeadlinePanelProps {
  /** 무엇에 대한 목록인가. null이면 패널이 닫힌다. */
  subject: string | null
  /** 사건의 이름은 단어 목록이므로 따옴표를 두르지 않는다. */
  isEvent?: boolean
  headlines: HeadlineSummary[]
  /** In tab order, which is what the list groups by. */
  categories: Category[]
  loading: boolean
  error: string | null
  onClose: () => void
}

export function HeadlinePanel({
  subject,
  isEvent = false,
  headlines,
  categories,
  loading,
  error,
  onClose,
}: HeadlinePanelProps) {
  const open = subject !== null
  const heading = isEvent ? `${subject} 관련 헤드라인` : `"${subject}" 관련 헤드라인`
```

`<aside>`의 `aria-label`과 `<h2>` 안을 고친다:

```tsx
    <aside
      className="fixed inset-x-0 bottom-0 z-20 max-h-[70svh] overflow-y-auto rounded-t-xl border-t border-line bg-surface p-4 shadow-lg sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-(--header-height) sm:max-h-none sm:w-80 sm:rounded-none sm:border-l sm:border-t-0"
      aria-label={heading}
    >
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">
          {heading}
          {!loading && !error && sorted.length > 0 && (
            <span className="ml-2 font-sans text-sm font-normal text-ink-faint">
              {sorted.length}건
            </span>
          )}
        </h2>
```

기존 단어 경로의 출력 문자열은 한 글자도 바뀌지 않는다 — `"예산안" 관련 헤드라인` 그대로다.

- [ ] **Step 2: `HeadlinePanel.test.tsx`의 prop 이름을 고친다**

`renderPanel`의 기본값 `word="예산안"` → `subject="예산안"`. 그리고 `{ word: null }`을 쓰는 테스트를 `{ subject: null }`로 바꾼다. **다른 단언은 손대지 않는다** — 렌더 결과가 같아야 하는 것이 이 변경의 요점이다.

파일 끝에 하나 더한다:

```tsx
  it('사건 이름에는 따옴표를 두르지 않는다', () => {
    renderPanel({ subject: '폭염 · 양산 · 한반도 · 에어컨', isEvent: true })
    expect(
      screen.getByRole('heading', { name: /폭염 · 양산 · 한반도 · 에어컨 관련 헤드라인/ }),
    ).toBeInTheDocument()
  })
```

Run: `npx vitest run src/components/HeadlinePanel.test.tsx`
Expected: PASS.

- [ ] **Step 3: `App.tsx`의 import와 상수를 고친다**

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CategoryTabs } from './components/CategoryTabs'
import { EventList } from './components/EventList'
import { HeadlinePanel } from './components/HeadlinePanel'
import { KeywordGraph } from './components/KeywordGraph'
import {
  fetchAvailableDates,
  fetchCategories,
  fetchEventHeadlineCounts,
  fetchHeadlineCount,
  fetchHeadlinesForEvent,
  fetchHeadlinesForWord,
  fetchKeywordGraph,
  fetchWordCountsFor,
} from './lib/queries'
import { adjacentDate } from './lib/dateNav'
import { buildEvents, eventLabel, sameCommunities, topEvents } from './lib/events'
import { computeSurges, surgeLimitFor } from './lib/surge'
import type { Surge } from './lib/surge'
import { parseUrlState, sameState, toSearch } from './lib/urlState'
import type { Category, HeadlineSummary, KeywordGraphData } from './lib/types'

const EMPTY_GRAPH: KeywordGraphData = { nodes: [], edges: [] }
const NO_SURGES: Map<string, Surge> = new Map()
const NO_COMMUNITIES: Map<string, number> = new Map()
```

- [ ] **Step 4: 상태를 더한다**

`const [selectedWord, ...]` 다음에:

```ts
  const [selectedEvent, setSelectedEvent] = useState<string | null>(() => stateFromUrl().event)
  const [communities, setCommunities] = useState<Map<string, number>>(NO_COMMUNITIES)
  const [eventCounts, setEventCounts] = useState<number[] | null>(null)
```

- [ ] **Step 5: URL 동기화에 event를 넣는다**

```ts
  useEffect(() => {
    const next = {
      date: selectedDate,
      category: selectedCategory,
      word: selectedWord,
      event: selectedEvent,
    }
    if (sameState(stateFromUrl(), next)) return

    const write = urlSynced.current ? window.history.pushState : window.history.replaceState
    write.call(window.history, null, '', `${window.location.pathname}${toSearch(next)}`)
    urlSynced.current = true
  }, [selectedDate, selectedCategory, selectedWord, selectedEvent])

  useEffect(() => {
    function onPopState() {
      const state = stateFromUrl()
      setSelectedDate(state.date ?? todayInSeoul())
      setSelectedCategory(state.category)
      setSelectedWord(state.word)
      setSelectedEvent(state.event)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
```

- [ ] **Step 6: 사건 파이프라인을 더한다**

`graphWords` memo 다음, 헤드라인 effect 앞에 넣는다:

```ts
  // --- 사건 ------------------------------------------------------------------

  // 캔버스가 쓴 것과 같은 루뱅 분할을 그대로 받는다. 레이아웃은 폭에 반응하므로
  // 리사이즈마다 새 Map이 올라오지만, 배정은 위상만의 함수라 값이 바뀌지 않는다
  // — 내용을 비교해 재요청을 막는다.
  const onCommunities = useCallback((next: Map<string, number>) => {
    setCommunities((current) => (sameCommunities(current, next) ? current : next))
  }, [])

  const eventGraph = useMemo(
    () =>
      buildEvents(
        graph.nodes.map((node) => ({ word: node.word, count: node.count })),
        graph.edges,
        communities,
      ),
    [graph.nodes, graph.edges, communities],
  )

  // 하루의 사건 전부를 한 번에 센다. 상위 5개를 먼저 자르면 순위가 멤버 카운트의
  // 합으로 정해지는데, 그 합이 바로 이 요청이 고치려는 값이다 — 2026-08-01의
  // 실제 1위는 트럼프(합계 73 / 실제 51)가 아니라 폭염(69 / 61)이다.
  useEffect(() => {
    if (eventGraph.events.length === 0) {
      setEventCounts(null)
      return
    }
    let cancelled = false
    fetchEventHeadlineCounts(
      selectedDate,
      selectedCategory,
      eventGraph.events.map((event) => event.words.map((word) => word.word)),
    )
      .then((counts) => {
        if (!cancelled) setEventCounts(counts)
      })
      .catch(() => {
        // 목록은 그린다. 숫자 자리를 비운다. 사건 이름이 숫자보다 중요하고,
        // 목록 전체를 감추면 캡션조차 없어진다.
        if (!cancelled) setEventCounts(null)
      })
    return () => {
      cancelled = true
    }
  }, [eventGraph, selectedDate, selectedCategory])

  const rankedEvents = useMemo(
    () => topEvents(eventGraph.events, eventCounts),
    [eventGraph, eventCounts],
  )

  const activeEvent = useMemo(() => {
    if (!selectedEvent) return null
    return eventGraph.events.find((event) => event.words[0].word === selectedEvent) ?? null
  }, [eventGraph, selectedEvent])

  // 사전 변경이나 재수집으로 그 단어가 그날 화면에서 사라졌으면 조용히 버린다 —
  // category가 이미 그렇게 동작한다. 사건이 0개인 동안은 아직 판단할 수 없으므로
  // 건드리지 않는다: 공유된 링크가 그래프가 도착하기 전에 버려지면 안 된다.
  useEffect(() => {
    if (selectedEvent === null || eventGraph.events.length === 0) return
    if (!eventGraph.events.some((event) => event.words[0].word === selectedEvent)) {
      setSelectedEvent(null)
    }
  }, [eventGraph, selectedEvent])

  // 캔버스에서 살아남는 단어들. 사건이면 멤버 전부, 다리 단어면 그 단어가 닿는
  // 모든 사건의 멤버 전부. 둘 다 아니면 null이고 KeywordGraph의 단어 포커스가
  // 그대로 돈다.
  const focusWords = useMemo(() => {
    if (activeEvent) return new Set(activeEvent.words.map((word) => word.word))
    if (!selectedWord) return null
    const touched = eventGraph.bridges.get(selectedWord)
    if (!touched) return null
    const lit = new Set<string>()
    for (const index of touched) {
      for (const word of eventGraph.events[index].words) lit.add(word.word)
    }
    return lit
  }, [activeEvent, selectedWord, eventGraph])

  // 패널 제목. 목록의 한 줄과 같은 규칙으로 자른다.
  const eventSubject = useMemo(() => {
    if (!activeEvent) return null
    const { shown, rest } = eventLabel(activeEvent.words)
    return rest > 0 ? `${shown.join(' · ')} 외 ${rest}` : shown.join(' · ')
  }, [activeEvent])
```

- [ ] **Step 7: 헤드라인 effect를 사건까지 받게 고친다**

기존 effect를 통째로 교체한다:

```ts
  useEffect(() => {
    setHeadlinesError(null)
    // 다리 단어를 눌러도 열리는 것은 **그 단어의** 헤드라인이다. 두 사건의
    // 헤드라인을 합쳐 열면 그 단어가 왜 접점인지가 오히려 묻힌다.
    const eventWords = activeEvent?.words.map((word) => word.word) ?? null
    if (!selectedWord && !eventWords) {
      setHeadlinesForWord([])
      setHeadlinesLoading(false)
      return
    }

    let cancelled = false
    setHeadlinesLoading(true)
    const request = selectedWord
      ? fetchHeadlinesForWord(selectedDate, selectedCategory, selectedWord)
      : fetchHeadlinesForEvent(selectedDate, selectedCategory, eventWords!)

    request
      .then((data) => {
        if (cancelled) return
        setHeadlinesForWord(data)
      })
      .catch((e) => {
        if (cancelled) return
        setHeadlinesError(errorMessage(e))
      })
      .finally(() => {
        if (cancelled) return
        setHeadlinesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedWord, activeEvent, selectedDate, selectedCategory])
```

- [ ] **Step 8: JSX를 배선한다**

`selectedWord ? 'sm:-translate-x-24 sm:scale-90' : ''`를 고치고 `KeywordGraph`에 세 prop을 넘긴다:

```tsx
          <div
            className={`origin-top transition-transform duration-300 motion-reduce:transition-none ${
              selectedWord || selectedEvent ? 'sm:-translate-x-24 sm:scale-90' : ''
            }`}
          >
            <KeywordGraph
              graph={graph}
              selectedWord={selectedWord}
              // 단어를 누르면 사건 선택이 풀린다. 둘 다 켜진 상태는 캔버스에서
              // 무엇이 살아 있는지 읽을 수 없다.
              onWordClick={(word) => {
                setSelectedEvent(null)
                setSelectedWord((current) => (current === word ? null : word))
              }}
              colorByCategory={selectedCategory === null}
              surges={surges}
              focusWords={focusWords}
              onCommunities={onCommunities}
              header={
                <EventList
                  events={rankedEvents}
                  selected={selectedEvent}
                  onSelect={(topWord) => {
                    setSelectedWord(null)
                    setSelectedEvent((current) => (current === topWord ? null : topWord))
                  }}
                />
              }
            />
          </div>
```

패널:

```tsx
      <HeadlinePanel
        subject={selectedWord ?? eventSubject}
        isEvent={!selectedWord && eventSubject !== null}
        headlines={headlinesForWord}
        categories={categories}
        loading={headlinesLoading}
        error={headlinesError}
        onClose={() => {
          setSelectedWord(null)
          setSelectedEvent(null)
        }}
      />
```

- [ ] **Step 9: 빌드와 전체 유닛 테스트**

Run: `npm run build`
Expected: 성공.

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: 커밋**

```bash
git add src/App.tsx src/components/HeadlinePanel.tsx src/components/HeadlinePanel.test.tsx
git commit -m "Wire the event list to the canvas and the panel"
```

---

## Task 9: e2e — 픽스처, 목, `eventList.spec.ts`

**Files:**
- Modify: `e2e/support/fixtures.ts`
- Modify: `e2e/support/mockSupabase.ts`
- Create: `e2e/eventList.spec.ts`
- Modify: `e2e/keywordGraph.spec.ts` (캡션 테스트 교체)

**Interfaces:**
- Consumes: 앞의 모든 태스크.
- Produces: 없음 (마지막 태스크).

**목이 지켜야 하는 세 가지** (`CLAUDE.md`): 두 새 엔드포인트는 **POST RPC**이므로 인자가 본문에 있다 — `route.request().postDataJSON()`으로 읽는다. 요청마다 달라지는 기본값은 **함수**여야 하고 `resolve()`가 그것을 호출해야 한다. `headlines`는 HEAD라 `content-range`로 답한다(기존 그대로).

- [ ] **Step 1: 픽스처에 사건이 있는 그래프를 더한다**

`e2e/support/fixtures.ts` 끝에 붙인다:

```ts
// 두 사건과 그 사이의 다리 하나.
//
//   사건 A: 예산안 — 여야 — 국회   (삼각형)
//   사건 B: 폭염 — 열대야 — 양산   (삼각형)
//   다리:   국회 — 폭염            (약한 엣지 하나)
//
// 삼각형 안은 npmi를 높게, 다리는 낮게 주어 루뱅이 둘로 가르도록 한다. 엣지가
// 하나뿐이므로 합치기 문턱 2에 걸리지 않고, 그래서 국회와 폭염이 다리가 된다 —
// 다리는 예외 없이 합치기가 "안 합친다"고 판정한 쌍이다.
export const EVENT_GRAPH: GraphPayload = {
  nodes: [
    node('예산안', 9, 'politics'),
    node('여야', 7, 'politics'),
    node('국회', 6, 'politics'),
    node('폭염', 8, 'society'),
    node('열대야', 5, 'society'),
    node('양산', 4, 'society'),
    // 어디에도 붙지 않는 단어. 실제 하루의 3분의 1이 이렇고, 사건에 속하지
    // 않으므로 다리도 될 수 없다.
    node('까마귀', 3, 'culture'),
  ],
  edges: [
    { a: '예산안', b: '여야', cooc: 6, npmi: 0.92 },
    { a: '예산안', b: '국회', cooc: 5, npmi: 0.9 },
    { a: '여야', b: '국회', cooc: 5, npmi: 0.9 },
    { a: '폭염', b: '열대야', cooc: 5, npmi: 0.92 },
    { a: '폭염', b: '양산', cooc: 4, npmi: 0.9 },
    { a: '열대야', b: '양산', cooc: 4, npmi: 0.9 },
    { a: '국회', b: '폭염', cooc: 2, npmi: 0.32 },
  ],
}

// event_headline_counts의 답. 단어별 카운트의 합(A는 22, B는 17)과 일부러 다르게
// 두어, 화면의 숫자가 합계가 아니라 이 값에서 오는 것이 관측 가능하도록 한다.
// 순서는 입력 순서이므로, 목이 본문의 p_events를 읽어 사건을 알아본다.
export const EVENT_HEADLINE_COUNTS: Record<string, number> = {
  예산안: 12,
  폭염: 11,
}

// event_headlines의 답. 두 섹션이라 패널의 뱃지와 정렬이 관측된다.
export const EVENT_HEADLINE_ROWS: Record<string, HeadlineSummary[]> = {
  예산안: [
    {
      id: '00000000-0000-4000-8000-00000000bbb1',
      title: '국회 예산안 심사 착수',
      link: 'https://n.news.naver.com/article/001/0000000011',
      category_slug: 'politics',
    },
    {
      id: '00000000-0000-4000-8000-00000000bbb2',
      title: '여야 예산안 협상 재개',
      link: 'https://n.news.naver.com/article/001/0000000012',
      category_slug: 'politics',
    },
  ],
  폭염: [
    {
      id: '00000000-0000-4000-8000-00000000bbb3',
      title: '폭염 특보 전국 확대',
      link: 'https://n.news.naver.com/article/001/0000000013',
      category_slug: 'society',
    },
  ],
}
```

`HeadlineSummary` import가 없으므로 파일 위쪽에 타입을 하나 더한다 (기존 파일은 `src`에서 타입을 들여오지 않고 자기 것을 선언하는 방식이므로 같은 방식을 쓴다):

```ts
export type HeadlineSummary = {
  id: string
  title: string
  link: string
  category_slug: string
}
```

- [ ] **Step 2: 목에 두 엔드포인트를 더한다**

`e2e/support/mockSupabase.ts`:

```ts
import {
  CATEGORIES,
  COLLECTED_DATES,
  DEFAULT_GRAPH,
  EVENT_HEADLINE_COUNTS,
  EVENT_HEADLINE_ROWS,
  HEADLINE_COUNTS,
  HEADLINE_ROWS,
  WORD_COUNTS,
} from './fixtures'
import type { GraphPayload, HeadlineSummary } from './fixtures'
```

타입을 넓힌다:

```ts
// 두 사건 RPC도 POST이고 인자가 본문에 있다. p_events는 단어 배열의 배열,
// p_words는 단어 배열이다.
export type RpcBody = {
  p_date?: string
  p_category?: string | null
  p_events?: string[][]
  p_words?: string[]
}

export type CountsOrFn = number[] | ((request: MockRequest) => number[])
export type HeadlinesOrFn = HeadlineSummary[] | ((request: MockRequest) => HeadlineSummary[])

export type EndpointName =
  | 'categories'
  | 'collected_dates'
  | 'headline_nouns'
  | 'daily_word_counts'
  | 'headlines'
  | 'keyword_graph'
  | 'event_headline_counts'
  | 'event_headlines'

export type MockOptions = {
  categories?: RowsOrFn
  collected_dates?: RowsOrFn
  headline_nouns?: RowsOrFn
  daily_word_counts?: RowsOrFn
  headlines?: Record<string, number>
  keyword_graph?: GraphOrFn
  event_headline_counts?: CountsOrFn
  event_headlines?: HeadlinesOrFn
  failOn?: EndpointName
  delayOn?: { endpoint: EndpointName; ms: number }
}
```

기본 핸들러 두 개를 `wordCountsFor` 옆에 더한다. **둘 다 함수다** — 요청마다 답이 달라지므로, 상수로 두면 사건이 뒤바뀐 채로도 테스트가 통과한다:

```ts
// 사건은 첫 단어로 알아본다. 앱이 보내는 순서 그대로 돌려주는 것이 계약이므로,
// 목도 입력을 훑어 그 순서대로 만든다 — 상수 배열이면 순서 계약을 검사하지
// 못한다.
function eventCountsFor({ body }: MockRequest): number[] {
  return (body.p_events ?? []).map((words) => EVENT_HEADLINE_COUNTS[words[0]] ?? 0)
}

function eventHeadlinesFor({ body }: MockRequest): HeadlineSummary[] {
  return EVENT_HEADLINE_ROWS[(body.p_words ?? [])[0] ?? ''] ?? []
}
```

라우트 핸들러의 payload 선택에 두 갈래를 더한다:

```ts
    const payload =
      endpoint === 'keyword_graph'
        ? resolve(options.keyword_graph, DEFAULT_GRAPH, request)
        : endpoint === 'event_headline_counts'
          ? resolve(options.event_headline_counts, eventCountsFor, request)
          : endpoint === 'event_headlines'
            ? resolve(options.event_headlines, eventHeadlinesFor, request)
            : resolve(options[endpoint] as RowsOrFn, TABLE_DEFAULTS[endpoint] ?? [], request)
```

- [ ] **Step 3: `keywordGraph.spec.ts`의 캡션 테스트를 고친다**

`test('names the day’s biggest event', …)` 전체를 이것으로 교체한다:

```ts
test('draws no cluster blob', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  // Named in the event list, never shaded. A cluster blob was the convex hull
  // of its members' label boxes, so on a real day it enclosed words belonging
  // to other events and asserted a membership they did not have.
  await expect(page.locator('svg polygon')).toHaveCount(0)
  await expect(page.getByText('오늘의 톱 스토리')).toHaveCount(0)
})
```

그날의 사건을 부르는 일은 `eventList.spec.ts`가 맡는다. 옛 단언의 `8건`은 5+3이라는 **합계**였고, 그것이 이 작업이 고치는 버그다.

- [ ] **Step 4: `e2e/eventList.spec.ts`를 쓴다**

```ts
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { EVENT_GRAPH } from './support/fixtures'
import { mockSupabase } from './support/mockSupabase'

// EVENT_GRAPH는 삼각형 두 개가 약한 엣지 하나로 닿아 있다. 루뱅이 그것을 두
// 커뮤니티로 가르고, 엣지가 하나뿐이라 합치기 문턱 2에 걸리지 않으므로 두
// 사건으로 남는다 — 그리고 국회와 폭염이 그 사이의 다리가 된다.
const withEvents = { keyword_graph: EVENT_GRAPH }

// 캔버스에서 물러난 단어의 불투명도. KeywordGraph의 UNFOCUSED_OPACITY와 같아야
// 한다. 다리 단어에는 고정 잉크가 없으므로 검사할 표식이 없고, 불투명도가
// 유일한 관측 지점이다.
const UNFOCUSED = '0.1'

function label(page: Page, word: string) {
  return page.locator('svg text').filter({ hasText: new RegExp(`^${word}$`) })
}

// 목록의 버튼과 캔버스의 <text role="button">은 접근 가능한 이름이 둘 다 그
// 단어를 담으므로, 범위를 좁히지 않으면 strict mode에 걸린다.
function eventItem(page: Page, word: string) {
  return page
    .getByRole('list', { name: '오늘의 사건' })
    .getByRole('button', { name: new RegExp(word) })
}

test('사건을 기사 수와 함께 목록으로 그린다', async ({ page }) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  const list = page.getByRole('list', { name: '오늘의 사건' })
  await expect(list).toBeVisible()

  // 12와 11은 event_headline_counts가 돌려준 중복 제거 수이고, 멤버 카운트의
  // 합(22와 17)이 아니다. 화면의 숫자가 합계에서 오지 않는다는 것이 요점이다.
  await expect(list.getByRole('button', { name: /예산안/ })).toContainText('12건')
  await expect(list.getByRole('button', { name: /폭염/ })).toContainText('11건')

  // 어디에도 붙지 않은 단어는 사건이 아니다.
  await expect(list.getByRole('button', { name: /까마귀/ })).toHaveCount(0)
})

test('사건을 누르면 캔버스가 좁혀지고 패널이 열린다', async ({ page }) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  await eventItem(page, '예산안').click()

  // 멤버는 살고 나머지는 물러난다. **멤버의 이웃까지 살리지는 않는다** — 국회는
  // 폭염과 엣지를 갖고 있지만, 합치기가 두 사건을 합치지 않기로 판정한 것을
  // 화면이 뒤집으면 안 된다.
  await expect(label(page, '국회')).not.toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '폭염')).toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '까마귀')).toHaveAttribute('opacity', UNFOCUSED)

  await expect(page.getByRole('heading', { name: /관련 헤드라인/ })).toBeVisible()
  await expect(page.getByRole('link', { name: '국회 예산안 심사 착수' })).toBeVisible()

  // 사건 이름은 단어 목록이므로 따옴표를 두르지 않는다.
  await expect(page.getByRole('heading', { name: /^예산안 · 여야 · 국회 관련 헤드라인/ })).toBeVisible()
})

test('선택한 사건이 URL에 남고 뒤로 가기가 되돌린다', async ({ page }) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  await eventItem(page, '예산안').click()
  await expect(page).toHaveURL(/event=/)

  await page.goBack()
  await expect(page).not.toHaveURL(/event=/)
  await expect(label(page, '폭염')).not.toHaveAttribute('opacity', UNFOCUSED)
})

test('다리 단어는 양쪽 사건 전체를 살리고, 보통 단어는 직접 이웃까지만 살린다', async ({
  page,
}) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  // 보통 단어: 여야는 예산안·국회와만 엣지를 갖는다. 폭염 쪽은 물러난다.
  await label(page, '여야').click()
  await expect(label(page, '예산안')).not.toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '폭염')).toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '열대야')).toHaveAttribute('opacity', UNFOCUSED)
  await label(page, '여야').click()

  // 다리 단어: 국회는 폭염과 엣지를 하나 갖고 있다. 직접 이웃인 폭염만이 아니라
  // **폭염이 속한 사건 전체**가 산다 — 열대야와 양산은 국회의 이웃이 아니다.
  await label(page, '국회').click()
  await expect(label(page, '폭염')).not.toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '열대야')).not.toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '양산')).not.toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '예산안')).not.toHaveAttribute('opacity', UNFOCUSED)
  // 어느 사건에도 속하지 않은 단어는 여전히 물러난다.
  await expect(label(page, '까마귀')).toHaveAttribute('opacity', UNFOCUSED)

  // 패널에는 **그 단어의** 헤드라인이 열린다. 두 사건의 헤드라인을 합쳐 열면
  // 그 단어가 왜 접점인지가 오히려 묻힌다.
  await expect(page.getByRole('heading', { name: /^"국회" 관련 헤드라인/ })).toBeVisible()
})

test('단어 선택과 사건 선택은 상호 배타다', async ({ page }) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  await eventItem(page, '예산안').click()
  await expect(page).toHaveURL(/event=/)

  await label(page, '까마귀').click()
  await expect(page).toHaveURL(/word=/)
  await expect(page).not.toHaveURL(/event=/)
})

test('카운트 RPC가 실패해도 목록은 그린다 — 숫자만 빈다', async ({ page }) => {
  await mockSupabase(page, { ...withEvents, failOn: 'event_headline_counts' })
  await page.goto('/')

  await expect(eventItem(page, '예산안')).toBeVisible()
  await expect(page.getByRole('list', { name: '오늘의 사건' })).not.toContainText('건')
})
```

- [ ] **Step 5: e2e를 돌리고 분할을 확인한다**

Run: `npm run test:e2e`

Expected: 새 스펙 전부 통과.

**루뱅 분할이 의도와 다르게 나오면** — 예를 들어 두 삼각형이 한 커뮤니티가 되어 사건이 하나만 그려지면 — **단언을 약화시키지 말고 픽스처의 가중치를 고친다.** 루뱅의 이득 항은 커뮤니티 차수에 비례해 빼므로, 삼각형 안을 무겁게 하고 다리를 가볍게 할수록 갈라진다: 삼각형 안의 `npmi`를 0.95까지 올리고 다리의 `npmi`를 0.31로 내린다. `cooc`은 손대지 않는다 — 루뱅은 `npmi`만 가중치로 쓴다 (`detectCommunities`의 `Math.max(0.01, e.npmi)`).

분할을 직접 보고 싶으면 임시 파일 `src/components/__probe.test.ts`를 만든다. TypeScript는 node로 바로 돌지 않으므로 Vitest를 실행기로 쓰는 것이고, **Vitest는 `console.log`를 삼키므로 결과를 파일로 쓴다:**

```ts
import { writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { computeGraphLayout } from './graphLayout'
import { EVENT_GRAPH } from '../../e2e/support/fixtures'

it('prints the partition', () => {
  const measured = EVENT_GRAPH.nodes.map((n) => ({
    word: n.word,
    count: n.count,
    fontSize: 20,
    textWidth: n.word.length * 20,
    faded: false,
  }))
  const layout = computeGraphLayout(measured, EVENT_GRAPH.edges, {
    width: 800,
    height: 500,
    clusterLimit: 99,
  })
  writeFileSync('probe-out.txt', JSON.stringify([...layout.communities], null, 2))
})
```

Run: `npx vitest run src/components/__probe.test.ts`, `probe-out.txt`를 읽는다. 확인이 끝나면 **`__probe.test.ts`와 `probe-out.txt`를 둘 다 지운다** — 커밋에 들어가면 안 된다. (`e2e/`는 `src`와 다른 tsconfig 프로젝트라 이 import는 `npm run build`를 깨뜨린다. 프로브가 남아 있으면 빌드가 알려 줄 것이고, 그것이 지웠는지 확인하는 두 번째 장치다.)

`e2e/smoke.spec.ts`가 실패하면 `.env` 문제다 (`npx vercel env pull .env --environment=development`). `playwright.config.ts`가 `reuseExistingServer: true`이므로 `.env`가 생기기 전에 띄운 dev 서버는 조용히 재사용된다 — 먼저 죽인다.

- [ ] **Step 6: 전체 게이트**

Run: `npm run build`
Expected: 성공.

Run: `npm test`
Expected: PASS.

Run: `npm run lint`
Expected: 통과.

- [ ] **Step 7: 커밋**

```bash
git add e2e/
git commit -m "Cover the event list and the bridging words end to end"
```

---

## 마지막 확인 — 실제 데이터

전부 끝나면 dev 서버를 띄우고(`npm run dev`) 진짜 프로젝트로 세 날을 눈으로 본다. 목이 아니라 배포된 RPC를 읽는 유일한 지점이다.

- **2026-08-01**: 목록 1위가 **폭염**(61건)이어야 한다. 트럼프(51건)가 아니다. 지금 배포된 캡션은 그날 틀린 사건을 부르고 있고, 이것이 그 수정이 화면에 나타나는 자리다.
- **2026-08-02**: 1위가 전당대회 묶음이고 **74건**이어야 한다(164가 아니다). 폭염이 `양산·최고기온·초열대야`와 `폭염·열대야` 둘로 갈려 있어야 하고, **초열대야를 누르면 두 사건이 함께 살아야 한다** — 그것이 갈라짐이 감춰지지 않는다는 스펙 2절의 주장이다.
- **2026-07-31**: 목록이 이래야 한다.

  ```
  1. 폭염 · 양산 · 한반도 · 에어컨            63건
  2. 트럼프 · 하마스 · 우크라 · 사우디 외 3     39건
  3. 하이닉스 · 최태원 · 삼성전자 · 임단협      34건
  4. 김민석 · 김의겸 · 노무현 · 정청래         31건
  5. 코스피 · 삼전닉스 · 코스닥 · 래블업        30건
  ```

- 카테고리 탭을 눌러 목록이 그 섹션의 사건으로 좁혀지는지, 사건이 0개인 탭에서 목록이 사라지는지 본다.
- 휴대폰 폭(360px 근처)에서 목록이 가로로 넘치지 않는지 본다.

숫자가 다르면 **스펙 1절이 아니라 구현이 틀린 것이다** — 저 표는 배포된 데이터베이스에서 잰 것이다.

---

## 되돌리기

마이그레이션 `0010`은 함수 두 개를 더할 뿐 데이터를 건드리지 않으므로 `drop function event_headline_counts(date, text, jsonb); drop function event_headlines(date, text, text[]);`로 완전히 되돌아간다. 프런트엔드는 커밋 되돌리기로 끝나고, 되돌리면 지금의 캡션이 살아난다 — 다만 1절이 밝힌 순위 버그도 함께 살아난다.
