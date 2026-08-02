# Date-list counts and an expandable event list — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry each collected day's headline total on the `collected_dates` view so the surge comparison stops issuing two `HEAD` counts per view, and let the event list expand from its five rows to the day's full set.

**Architecture:** One `create or replace view` migration adds a column to the end of `collected_dates`, which is append-only and therefore leaves every existing reader working. `fetchAvailableDates` becomes `fetchCollectedDates` and returns both fields; `App.tsx` derives the `string[]` it already used plus a `Map<string, number>` of denominators, falling back to the existing `fetchHeadlineCount` for any date the map lacks. Separately, `topEvents` is called with no limit when an `expanded` flag in `App.tsx` is set, and `EventList` renders one trailing toggle row.

**Tech Stack:** Vite + React 19 + TypeScript, Vitest (unit), Playwright (e2e), Supabase Postgres reached through `@supabase/postgrest-js`, migrations applied via the Supabase Management API.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-date-counts-and-event-expansion-design.md`. Read it before Task 1.
- Branch is `canonical-links`. **Do not merge to `main`** — the user reviews and merges himself.
- Comments, commit messages, plan and spec prose are **English**. Conversational replies to the user are Korean. Do not translate pre-existing Korean comments.
- `npm run build` is the real gate; `npm test` passes on code that does not type-check.
- Never sum a response to get a denominator, and never let a response be silently truncated (`CLAUDE.md`).
- The schema lives in three places — `supabase/migrations/*.sql`, the Edge Function's inserts, and `src/lib/queries.ts`. This change touches the first and third; the Edge Function does not read `collected_dates`.
- No threshold, dictionary or sieve value changes, so `scripts/analysis/10_sieve_eval.sql` is not involved.
- Collapsed event-list length stays `DEFAULT_LIMIT` (5) in `src/lib/events.ts`.

---

### Task 1: The migration file

**Files:**
- Create: `supabase/migrations/0011_collected_dates_counts.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: the view `public.collected_dates` with columns `collected_date date` and `headline_count bigint`.

- [ ] **Step 1: Read the current view definition**

Run: `sed -n '55,70p' supabase/migrations/0001_init_schema.sql`
Expected: the view is `select distinct collected_date from headlines;` with `security_invoker = on`, followed by `grant select on collected_dates to anon, authenticated;`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0011_collected_dates_counts.sql`:

```sql
-- The day's headline total is a denominator the surge comparison needs for both
-- the day on screen and the previous collected day, and it was being fetched as
-- two `HEAD ... count=exact` requests per view. This view is already read once
-- per load for the date picker and holds exactly one row per collected day, so
-- it can carry the number instead.
--
-- `create or replace view` may only append columns — never rename, reorder or
-- drop them — and `collected_date` stays first, so every existing
-- `select('collected_date')` keeps working. Replacing in place rather than
-- dropping preserves the grant and the security_invoker setting from
-- 0001_init_schema.sql.
--
-- count(*) grouped by collected_date is exactly what fetchHeadlineCount counted:
-- every headline of that day, all six sections, no category filter. Postgres
-- computes it, so this is not the forbidden pattern of summing a response.
create or replace view collected_dates with (security_invoker = on) as
select collected_date, count(*)::bigint as headline_count
from headlines
group by collected_date;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_collected_dates_counts.sql
git commit -m "Carry each day's headline total on collected_dates"
```

---

### Task 2: Apply the migration to the deployed project and verify it

**Files:**
- None. This task changes the deployed database only.

**Interfaces:**
- Consumes: `supabase/migrations/0011_collected_dates_counts.sql` from Task 1.
- Produces: the deployed view, so Task 3's query has something to read.

- [ ] **Step 1: Apply the migration**

Use the Supabase MCP tool `mcp__supabase__apply_migration` with name `collected_dates_counts` and the exact SQL body from Task 1.

If MCP is unavailable, POST the same SQL to
`https://api.supabase.com/v1/projects/{ref}/database/query` with the token from
`.env.supabase` (`set -a && . ./.env.supabase && set +a`).

- [ ] **Step 2: Verify the shape**

Run this through `mcp__supabase__execute_sql`:

```sql
select collected_date, headline_count from collected_dates order by collected_date desc;
```

Expected: one row per collected day, three rows as of 2026-08-03, `headline_count` a positive integer on each.

- [ ] **Step 3: Verify it agrees with what the app counted before**

```sql
select (select headline_count from collected_dates where collected_date = '2026-08-01') as from_view,
       (select count(*) from headlines where collected_date = '2026-08-01') as direct;
```

Expected: the two columns are equal. If they are not, stop — the view body is wrong, and every surge ratio would be computed against a wrong denominator.

- [ ] **Step 4: Verify `anon` can still read it**

```sql
select has_table_privilege('anon', 'collected_dates', 'select') as anon_can_select;
```

Expected: `true`. Replacing a view in place keeps its grants; this confirms it rather than assuming it.

- [ ] **Step 5: Record the result**

No commit. Report the three dates and their counts in the task summary, since Task 4's tests use real-shaped numbers.

---

### Task 3: `fetchCollectedDates` returns dates with their counts

**Files:**
- Modify: `src/lib/queries.ts` (the `fetchAvailableDates` function)
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: the deployed view from Task 2.
- Produces: `export interface CollectedDate { date: string; headlines: number }` and
  `export async function fetchCollectedDates(): Promise<CollectedDate[]>`, newest first.
  `fetchHeadlineCount(date: string): Promise<number>` is unchanged and still exported.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/queries.test.ts`, and add `fetchCollectedDates` to the destructured import at the top of that file:

```ts
describe('fetchCollectedDates', () => {
  it('returns each collected day with its headline total, newest first', async () => {
    const chain = makeQueryChain({
      data: [
        { collected_date: '2026-08-02', headline_count: 1002 },
        { collected_date: '2026-08-01', headline_count: 1144 },
      ],
      error: null,
    })
    mockSupabase.from.mockReturnValue(chain)

    const result = await fetchCollectedDates()

    expect(mockSupabase.from).toHaveBeenCalledWith('collected_dates')
    expect(chain.order).toHaveBeenCalledWith('collected_date', { ascending: false })
    expect(result).toEqual([
      { date: '2026-08-02', headlines: 1002 },
      { date: '2026-08-01', headlines: 1144 },
    ])
  })

  it('coerces a bigint arriving as a string', async () => {
    // Postgres renders bigint as a JSON string in some drivers. Number(null)
    // would be 0, which reads as a measured zero rather than as missing, so a
    // string has to be coerced rather than passed through.
    mockSupabase.from.mockReturnValue(
      makeQueryChain({ data: [{ collected_date: '2026-08-01', headline_count: '1144' }], error: null }),
    )

    const result = await fetchCollectedDates()

    expect(result[0].headlines).toBe(1144)
  })

  it('throws a real Error carrying the PostgREST message', async () => {
    mockSupabase.from.mockReturnValue(
      makeQueryChain({
        data: null,
        error: { message: 'permission denied for view collected_dates', code: '42501' },
      }),
    )

    await expect(fetchCollectedDates()).rejects.toThrow(
      'permission denied for view collected_dates (42501)',
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/queries.test.ts -t "fetchCollectedDates"`
Expected: FAIL — `fetchCollectedDates is not a function`.

- [ ] **Step 3: Replace `fetchAvailableDates`**

In `src/lib/queries.ts`, replace the whole `fetchAvailableDates` function with:

```ts
export interface CollectedDate {
  date: string
  /** Every headline of that day, all six sections. The denominator the surge comparison divides by. */
  headlines: number
}

// One row per collected day, newest first. The count rides along because the
// surge comparison needs it for two days at once and this query is issued on
// every load anyway; before this it cost two `HEAD ... count=exact` requests.
//
// Not cached: this is read once at mount and the cache exists for views that get
// revisited.
export async function fetchCollectedDates(): Promise<CollectedDate[]> {
  const { data, error } = await supabase
    .from('collected_dates')
    .select('collected_date, headline_count')
    .order('collected_date', { ascending: false })
  if (error) throw queryError(error)

  const rows = (data ?? []) as { collected_date: string; headline_count: number | string }[]
  return rows.map((row) => ({ date: row.collected_date, headlines: Number(row.headline_count) }))
}
```

Note the old function deduplicated with a `Set` because `select distinct` could
still return repeats through PostgREST; `group by` cannot, so the `Set` goes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: PASS, all of them. `App.tsx` will not compile yet — that is Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "Read the collected days and their headline totals in one query"
```

---

### Task 4: `App.tsx` reads the denominators from that map

**Files:**
- Modify: `src/App.tsx`
- Test: `e2e/support/mockSupabase.ts` (the `collected_dates` fixture must carry the new column)

**Interfaces:**
- Consumes: `fetchCollectedDates` and `CollectedDate` from Task 3; `fetchHeadlineCount` unchanged.
- Produces: no new exports. `availableDates: string[]` keeps its meaning for `adjacentDate` and the masthead.

- [ ] **Step 1: Update the e2e Supabase mock**

In `e2e/support/mockSupabase.ts`, find where `collected_dates` is fulfilled and
make each row carry `headline_count` as well as `collected_date`. Use values
that differ per date — `1144` for the newest and `899` for the one before —
because equal totals would hide a denominator swapped between days.

- [ ] **Step 2: Swap the query and derive both shapes**

In `src/App.tsx`:

- change the import from `fetchAvailableDates` to `fetchCollectedDates`
- replace the `availableDates` state with `const [collectedDates, setCollectedDates] = useState<CollectedDate[]>([])`
- in the mount effect, `fetchCollectedDates().then(setCollectedDates).catch(...)`
- add the two derivations:

```ts
const availableDates = useMemo(() => collectedDates.map((d) => d.date), [collectedDates])
const headlinesByDate = useMemo(
  () => new Map(collectedDates.map((d) => [d.date, d.headlines])),
  [collectedDates],
)
```

- [ ] **Step 3: Read the denominators from the map, with the fallback**

Replace the two `fetchHeadlineCount` calls in the surge effect's `Promise.all`
with this, keeping the rest of the effect as it is:

```ts
// The day totals now ride along with the date list, so the common path costs
// no request at all. The fallback is not decoration: collected_dates is one
// row per collected day, which reaches PostgREST's 1,000-row cap in about
// 2.7 years, and a silently truncated denominator is the specific failure
// this file already carries a warning about. Being truncated costs one request
// instead of producing a wrong ratio.
const headlineCount = (date: string) =>
  headlinesByDate.get(date) ?? fetchHeadlineCount(date)

Promise.all([
  fetchWordCountsFor([selectedDate, previousDate], graphWords),
  headlineCount(selectedDate),
  headlineCount(previousDate),
])
```

Add `headlinesByDate` to that effect's dependency array.

- [ ] **Step 4: Type check and run the whole suite**

Run: `npx tsc -b --force && npm test`
Expected: no type errors, all unit tests pass.

- [ ] **Step 5: Run the e2e suite**

Run: `npm run test:e2e`
Expected: all pass. If `appControls.spec.ts`'s date-stepper tests fail, the mock
from Step 1 is returning rows the new mapping cannot read.

- [ ] **Step 6: Measure the saving**

Create `e2e/_measure.spec.ts` (deleted in Step 8), counting Supabase requests on
a cold load:

```ts
import { expect, test } from '@playwright/test'
import { EVENT_GRAPH } from './support/fixtures'
import { mockSupabase } from './support/mockSupabase'

test('cold load request count', async ({ page }) => {
  await mockSupabase(page, { keyword_graph: EVENT_GRAPH })
  const seen: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/')) seen.push(`${r.method()} ${r.url().split('/rest/v1/')[1]}`)
  })

  await page.goto('/')
  await expect(page.getByRole('list', { name: '오늘의 사건' })).toContainText('건')
  await page.waitForTimeout(600)

  console.log(`[measure] cold load ${seen.length}: ${JSON.stringify(seen)}`)
  expect(seen.filter((s) => s.startsWith('HEAD'))).toHaveLength(0)
})
```

Run: `npx playwright test e2e/_measure.spec.ts --reporter=line`
Expected: PASS, and the logged count is 7 where it was 9. No `HEAD headlines`
requests remain.

- [ ] **Step 7: Update `CLAUDE.md`**

In the section that describes the query rules, record: the day totals now come
from `collected_dates` rather than from a `head: true, count: 'exact'` query;
that this is still not a summed response because Postgres does the counting;
that `fetchHeadlineCount` survives as the fallback for a date the view did not
return; and the measured cold-load count 9 → 7.

- [ ] **Step 8: Delete the measurement spec and commit**

```bash
rm e2e/_measure.spec.ts
git add -A
git commit -m "Take the day totals from the date list instead of two HEAD counts"
```

---

### Task 5: `topEvents` returns everything when asked

**Files:**
- Modify: `src/lib/events.ts`
- Test: `src/lib/events.test.ts`

**Interfaces:**
- Consumes: the existing `topEvents(events, headlines, { limit, pinned })`.
- Produces: no signature change. `limit: Infinity` is a supported value, and `DEFAULT_LIMIT` becomes exported as `EVENT_LIST_LIMIT` for `App.tsx` to pass.

- [ ] **Step 1: Write the failing test**

Add to the `topEvents — pinned` describe in `src/lib/events.test.ts`, reusing the
`manyEvents()` and `indexOf()` helpers already defined there:

```ts
it('returns every event in rank order when the limit is lifted', () => {
  const events = manyEvents()
  const ranked = topEvents(events, null, { limit: Infinity })

  expect(ranked).toHaveLength(8)
  expect(ranked.map((r) => r.event.words[0].word)).toEqual([
    'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
  ])
})

it('adds nothing when a pinned event is already shown by a lifted limit', () => {
  const events = manyEvents()
  const ranked = topEvents(events, null, { limit: Infinity, pinned: [indexOf(events, 'a7')] })

  expect(ranked).toHaveLength(8)
})
```

- [ ] **Step 2: Run the test to verify it fails or passes**

Run: `npx vitest run src/lib/events.test.ts -t "limit is lifted"`
Expected: PASS already — `slice(0, Infinity)` returns everything and the pinning
loop skips what is held. **If it passes, that is the correct outcome**; the test
is here to pin the behaviour the next task depends on, not to drive a change.
If it fails, fix `topEvents` until it passes.

- [ ] **Step 3: Export the collapsed limit**

In `src/lib/events.ts`, change the `DEFAULT_LIMIT` declaration to:

```ts
// How many rows the list holds when collapsed. A rank, not a threshold — the
// same reasoning surgeLimitFor already measured. Exported so App.tsx can name
// it when it lifts the limit rather than keeping a second copy of the number.
export const EVENT_LIST_LIMIT = 5
```

and replace its two uses (`limit = DEFAULT_LIMIT` in `topEvents`) accordingly.

- [ ] **Step 4: Run the full unit suite**

Run: `npx tsc -b --force && npm test`
Expected: no type errors, all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/events.ts src/lib/events.test.ts
git commit -m "Let the event list be asked for every event"
```

---

### Task 6: `EventList` renders the toggle

**Files:**
- Modify: `src/components/EventList.tsx`
- Test: `src/components/EventList.test.tsx`

**Interfaces:**
- Consumes: `RankedEvent` from `src/lib/events.ts`.
- Produces: `EventListProps` gains `total?: number`, `expanded?: boolean`, `onToggle?: () => void`. All three optional so existing call sites and tests keep compiling; the toggle renders only when `total` exceeds the rows given.

- [ ] **Step 1: Write the failing test**

Add to `src/components/EventList.test.tsx`:

```tsx
it('offers the rest of the day when there are more events than rows', () => {
  render(
    <EventList
      events={[ranked(['폭염', '양산'], 63, 0)]}
      selected={null}
      total={15}
      expanded={false}
      onToggle={vi.fn()}
      onSelect={vi.fn()}
    />,
  )

  const toggle = screen.getByRole('button', { name: /더 보기/ })
  expect(toggle).toHaveTextContent('14')
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

it('offers to collapse once expanded', () => {
  render(
    <EventList
      events={[ranked(['폭염', '양산'], 63, 0), ranked(['트럼프', '하마스'], 39, 1)]}
      selected={null}
      total={2}
      expanded
      onToggle={vi.fn()}
      onSelect={vi.fn()}
    />,
  )

  expect(screen.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true')
})

it('offers nothing when the day holds no more than is shown', () => {
  // The archive's smallest day and a category tab both land here.
  render(
    <EventList
      events={[ranked(['폭염', '양산'], 63, 0)]}
      selected={null}
      total={1}
      expanded={false}
      onToggle={vi.fn()}
      onSelect={vi.fn()}
    />,
  )

  expect(screen.queryByRole('button', { name: /더 보기|접기/ })).not.toBeInTheDocument()
})

it('calls onToggle when the row is pressed', () => {
  const onToggle = vi.fn()
  render(
    <EventList
      events={[ranked(['폭염', '양산'], 63, 0)]}
      selected={null}
      total={15}
      expanded={false}
      onToggle={onToggle}
      onSelect={onToggle}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /더 보기/ }))
  expect(onToggle).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/EventList.test.tsx -t "더 보기"`
Expected: FAIL — no button with that name, and TypeScript rejects the unknown props.

- [ ] **Step 3: Implement the toggle**

In `src/components/EventList.tsx`, extend the props interface:

```ts
  /** How many events the day holds in total. The toggle appears only when this exceeds the rows given. */
  total?: number
  expanded?: boolean
  onToggle?: () => void
```

destructure `total = events.length, expanded = false, onToggle` in the
signature, and add before the closing `</ol>`:

```tsx
      {onToggle && (expanded || total > events.length) && (
        // Inside the list, because it is about the list's own length rather
        // than a control that happens to sit under it. The dot column is kept
        // so the label lines up with the event names above it.
        <li>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs text-ink-faint hover:bg-surface hover:text-ink"
          >
            <span aria-hidden="true" className="inline-block size-2 shrink-0" />
            <span>{expanded ? '접기' : `더 보기 ${total - events.length}개`}</span>
          </button>
        </li>
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/EventList.test.tsx`
Expected: PASS, all of them.

- [ ] **Step 5: Commit**

```bash
git add src/components/EventList.tsx src/components/EventList.test.tsx
git commit -m "Give the event list a way to show the rest of the day"
```

---

### Task 7: Wire the expansion in `App.tsx` and cover it end to end

**Files:**
- Modify: `src/App.tsx`
- Test: `e2e/eventList.spec.ts`

**Interfaces:**
- Consumes: `EVENT_LIST_LIMIT` and `topEvents` from Task 5, the props from Task 6.
- Produces: nothing new.

- [ ] **Step 1: Write the failing e2e test**

`EVENT_GRAPH` holds two events, so the collapsed limit of 5 never bites with it.
Add a fixture-driven test to `e2e/eventList.spec.ts` that mocks a graph with
more than five events. Build it from six disjoint pairs so Louvain gives six
communities that the merge rule (2 edges) cannot join:

```ts
test('사건이 다섯 개를 넘으면 나머지를 펼쳐 볼 수 있다', async ({ page }) => {
  const nodes = []
  const edges = []
  for (let i = 0; i < 6; i++) {
    nodes.push({ word: `가${i}`, count: 20 - i, faded: false, category_slug: 'politics' })
    nodes.push({ word: `나${i}`, count: 19 - i, faded: false, category_slug: 'politics' })
    edges.push({ a: `가${i}`, b: `나${i}`, cooc: 5, npmi: 0.8 })
  }
  await mockSupabase(page, { keyword_graph: { nodes, edges } })
  await page.goto('/')

  const list = page.getByRole('list', { name: '오늘의 사건' })
  await expect(list.getByRole('button', { name: /가0/ })).toBeVisible()
  await expect(list.getByRole('button', { name: /가5/ })).toHaveCount(0)

  await list.getByRole('button', { name: /더 보기/ }).click()
  await expect(list.getByRole('button', { name: /가5/ })).toBeVisible()
  await expect(list.getByRole('button', { name: '접기' })).toBeVisible()
})
```

Check `e2e/support/fixtures.ts` for the exact node and edge field names before
writing this, and match them — a node missing a field the app reads renders an
empty canvas and the test fails for the wrong reason.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/eventList.spec.ts -g "펼쳐" --reporter=line`
Expected: FAIL — no `더 보기` button exists.

- [ ] **Step 3: Hold the expansion state in `App.tsx`**

Add beside the other state:

```ts
const [eventsExpanded, setEventsExpanded] = useState(false)
```

Pass the lifted limit into the existing `topEvents` call:

```ts
topEvents(eventGraph.events, eventCounts?.of === eventGraph ? eventCounts.counts : null, {
  limit: eventsExpanded ? Infinity : EVENT_LIST_LIMIT,
  pinned: relatedEvents,
})
```

and add `eventsExpanded` to that `useMemo`'s dependency array. Import
`EVENT_LIST_LIMIT` from `./lib/events`.

- [ ] **Step 4: Collapse again when the day or the section changes**

```ts
// Event counts differ per day — the archive's three days hold 15, 14 and 15 —
// so an expanded list carried across a change leaves the page at the previous
// day's height showing a different day's content. eventGraph is the identity
// that changes on both a date and a category change.
useEffect(() => {
  setEventsExpanded(false)
}, [eventGraph])
```

- [ ] **Step 5: Pass the props to `EventList`**

```tsx
<EventList
  events={rankedEvents}
  selected={selectedEvent}
  related={relatedEvents}
  total={eventGraph.events.length}
  expanded={eventsExpanded}
  onToggle={() => setEventsExpanded((current) => !current)}
  onSelect={...unchanged...}
/>
```

- [ ] **Step 6: Run the new test to verify it passes**

Run: `npx playwright test e2e/eventList.spec.ts --reporter=line`
Expected: PASS, all of them.

- [ ] **Step 7: Add the collapse-on-change assertion**

Append to the test from Step 1:

```ts
  await page.locator('header').getByRole('button', { name: '정치' }).click()
  await expect(list.getByRole('button', { name: '접기' })).toHaveCount(0)
```

Run it again; expected PASS.

- [ ] **Step 8: Run the full gate**

Run: `npm run build && npm test && npm run lint && npm run test:e2e`
Expected: all green.

- [ ] **Step 9: Update `CLAUDE.md`**

In the event-list section, record: the list shows `EVENT_LIST_LIMIT` (5) rows
and can be expanded to the day's full set; expansion is component state and
deliberately not in the query string, which already carries a mutual-exclusion
rule between `?word=` and `?event=`; and it collapses on a date or category
change because event counts differ per day.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Let the reader open the rest of the day's events"
```

---

## Self-Review

**Spec coverage.** Migration → Task 1. Deploy and verify → Task 2. `fetchCollectedDates`
→ Task 3. `availableDates` / `headlinesByDate` derivation and the surge effect →
Task 4. Truncation fallback → Task 4 Step 3. `topEvents` with no limit → Task 5.
`EventList` toggle with `aria-expanded` and the no-toggle case → Task 6.
Collapse on day/category change, expansion kept out of the URL → Task 7. The
9 → 7 request measurement → Task 4 Step 6. Every spec verification bullet has a
step.

**Placeholders.** None: every code step carries the code, every run step carries
the command and the expected result.

**Type consistency.** `CollectedDate { date, headlines }` is defined in Task 3
and consumed by that name in Task 4. `EVENT_LIST_LIMIT` is exported in Task 5
and imported in Task 7. `total` / `expanded` / `onToggle` are declared in Task 6
and passed in Task 7 with those names. `fetchHeadlineCount` keeps its existing
signature throughout.

**One deliberate deviation from TDD.** Task 5 Step 2 expects its test to pass on
first run, because `slice(0, Infinity)` already does the right thing. It is
written as a characterisation test that pins behaviour Task 7 depends on, and
the step says so rather than pretending it drove a change.
