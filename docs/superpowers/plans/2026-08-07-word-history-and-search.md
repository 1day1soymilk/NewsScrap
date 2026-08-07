# Word history and search — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A word clicked on the canvas shows how its share of the day has moved
across the collected days, and any word in the archive — drawn or not — can be
found by substring and shown the same thing.

**Architecture:** Two halves that share a panel. The trajectory needs no
database change at all: `fetchWordCountsFor(dates, words)` already issues the
exact query (`daily_word_counts`, `.in('collected_date', …).in('word', …)`,
5.7 ms on the live database) and `App.tsx` already holds the denominators from
`collected_dates`. Search needs one migration, because `word like` uses no index
at any anchoring and reads all 114,457 noun rows (316 ms, growing with headline
volume) — a materialised `word_directory` of ~19,767 rows is filtered in ~1 ms
and grows with vocabulary instead. The collector refreshes it at the end of each
run.

**Tech Stack:** Vite + React 19 + TypeScript, Tailwind v4 (`@theme` tokens),
Vitest + Testing Library, Playwright, Supabase Postgres + a Deno Edge Function.

**Spec:** `docs/superpowers/specs/2026-08-07-word-history-and-search-design.md`

## Global Constraints

- **`npm run build` is the gate.** It runs `tsc -b` over all four projects and
  then `vite build`. `npm test` alone passes on code that does not compile.
- **Never make a build pass by excluding tests from type checking, loosening
  `tsconfig`, or weakening an assertion.** That has been tried in this repo and
  it hides real errors.
- **Colours come from `var(--color-*)` only** — the `@theme` block in
  `src/index.css`. Never a hex literal in a component. SVG `fill`/`stroke` go
  through inline `style` (`var()` is unreliable in presentation attributes);
  `opacity` and `stroke-opacity` stay attributes because e2e asserts on them.
- **Do not add write policies** anywhere. All access is select-only.
- **Reply/commit language:** commit messages and code comments in English,
  matching the surrounding files. `CLAUDE.md` and `scripts/*/README.md` keep the
  language they already use.
- Migrations are sequential: the next number is **`0030`**.
- Run one test file with `npx vitest run <path>`, one test by name with
  `npx vitest run -t "<name>"`.
- Work happens on the branch `word-history-and-search`, already created. **Do
  not merge to `main`** — the repository owner does that himself.

---

### Task 1: One definition of "share"

`share = count / headlines` is about to exist in two features. `surge.ts` has it
inline today. Extract it before adding the second caller, so there is never a
moment when two copies exist.

**Files:**
- Create: `src/lib/share.ts`
- Create: `src/lib/share.test.ts`
- Modify: `src/lib/surge.ts` (the two share expressions inside `computeSurges`)

**Interfaces:**
- Consumes: nothing.
- Produces: `share(count: number, headlines: number): number`

- [ ] **Step 1: Write the failing test**

Create `src/lib/share.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { share } from './share'

describe('share', () => {
  it('divides a count by the day it belongs to', () => {
    expect(share(5, 12)).toBe(5 / 12)
  })

  it('is zero for a word with no headlines that day', () => {
    expect(share(0, 8)).toBe(0)
  })

  // A day with no headlines is a day nothing can be a share of. NaN would
  // poison a sort silently and Infinity would draw a sparkline off the top, so
  // neither may escape this function.
  it('is zero rather than NaN when the day is empty', () => {
    expect(share(3, 0)).toBe(0)
  })

  it('is zero rather than negative when the denominator is nonsense', () => {
    expect(share(3, -5)).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/share.test.ts`
Expected: FAIL — `Failed to resolve import "./share"`.

- [ ] **Step 3: Write `src/lib/share.ts`**

```ts
// src/lib/share.ts
//
// A word's share of a day: its headline count over that day's headline total.
//
// **This is a module of its own because two features need it**, and a second
// copy is how the two would drift apart. `surge.ts` established the rule by
// measurement — 2026-08-01 was collected twice and holds 1,144 headlines
// against 2026-07-31's 899, so on raw counts every word looks about 27% up —
// and `history.ts` runs the same comparison across the whole archive, where the
// spread is wider still (691 to 4,218 headlines a day).
//
// It does not live in `surge.ts`, because a trajectory has nothing to do with a
// day-over-day comparison and should not import one; nor in `history.ts`, which
// would be worse in the same way. Same reason `keyword_signals` is not
// reimplemented in a script: one copy of an arithmetic that two callers must
// agree on.

/**
 * `count / headlines`, and 0 when the day has no headlines to be a share of.
 *
 * The guard is not defensive decoration. `NaN` sorts unpredictably and compares
 * false against itself, and `Infinity` would take a sparkline off the top of
 * its box — both would surface far from here as a wrong picture rather than as
 * an error.
 */
export function share(count: number, headlines: number): number {
  return headlines > 0 ? count / headlines : 0
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/share.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Point `surge.ts` at it**

In `src/lib/surge.ts`, add the import at the top:

```ts
import { share } from './share'
import type { WordCount } from './types'
```

and inside `computeSurges` replace the two inline divisions:

```ts
    const before = previousByWord.get(row.word) ?? 0
    const todayShare = share(row.count, today.headlines)
    const previousShare = share(before, previous.headlines)
```

Leave the early return (`if (today.headlines <= 0 || previous.headlines <= 0)`)
exactly as it is — it guards a different thing (there is no comparison to make),
and removing it would change which words are marked.

- [ ] **Step 6: Run the surge tests and the type check**

Run: `npx vitest run src/lib/surge.test.ts src/lib/share.test.ts`
Expected: PASS — every existing surge test unchanged, because the arithmetic is
identical.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/share.ts src/lib/share.test.ts src/lib/surge.ts
git commit -m "Give the share arithmetic one home before it has two callers"
```

---

### Task 2: `buildHistory` — the trajectory, as pure arithmetic

**Files:**
- Create: `src/lib/history.ts`
- Create: `src/lib/history.test.ts`

**Interfaces:**
- Consumes: `share()` from Task 1; `WordCount` from `src/lib/types.ts`
  (`{ word: string; count: number }`).
- Produces:
  - `HISTORY_WINDOW = 14`
  - `interface HistoryPoint { date: string; count: number; share: number; present: boolean }`
  - `buildHistory(countsByDate: Map<string, WordCount[]>, headlinesByDate: Map<string, number>, dates: string[], options: { endDate: string; window?: number }): HistoryPoint[]`
  - `interface HistorySummary { days: number; daysPresent: number; change: number | null; isNew: boolean }`
  - `summariseHistory(points: HistoryPoint[]): HistorySummary`

`countsByDate` is exactly what `fetchWordCountsFor` returns — a `Map` from date
to the rows for that date — so nothing has to adapt it. Asked about one word,
each entry holds zero rows or one.

- [ ] **Step 1: Write the failing test**

Create `src/lib/history.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HISTORY_WINDOW, buildHistory, summariseHistory } from './history'
import type { WordCount } from './types'

// Newest first, which is the order fetchCollectedDates returns.
const DATES = ['2026-08-05', '2026-08-04', '2026-08-03']

function counts(rows: Record<string, number>): Map<string, WordCount[]> {
  return new Map(
    Object.entries(rows).map(([date, count]) => [date, [{ word: '폭염', count }]]),
  )
}

const HEADLINES = new Map([
  ['2026-08-05', 100],
  ['2026-08-04', 200],
  ['2026-08-03', 50],
])

describe('buildHistory', () => {
  it('reads oldest first, so the series runs left to right', () => {
    const points = buildHistory(
      counts({ '2026-08-03': 5, '2026-08-04': 20, '2026-08-05': 10 }),
      HEADLINES,
      DATES,
      { endDate: '2026-08-05' },
    )
    expect(points.map((point) => point.date)).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ])
  })

  // The whole reason the y axis is share: 08-04 holds four times the count of
  // 08-03 and a smaller share of its day.
  it('divides each day by its own headline total', () => {
    const points = buildHistory(
      counts({ '2026-08-03': 5, '2026-08-04': 20, '2026-08-05': 10 }),
      HEADLINES,
      DATES,
      { endDate: '2026-08-05' },
    )
    expect(points.map((point) => point.share)).toEqual([0.1, 0.1, 0.1])
  })

  it('stops at the selected date rather than at the newest one', () => {
    const points = buildHistory(
      counts({ '2026-08-03': 5, '2026-08-04': 20, '2026-08-05': 10 }),
      HEADLINES,
      DATES,
      { endDate: '2026-08-04' },
    )
    expect(points.map((point) => point.date)).toEqual(['2026-08-03', '2026-08-04'])
  })

  // A gap would read as "not collected". A day that was collected and simply
  // did not hold the word is a zero, and says so.
  it('draws a day the word is absent from as zero, not as a hole', () => {
    const points = buildHistory(counts({ '2026-08-05': 10 }), HEADLINES, DATES, {
      endDate: '2026-08-05',
    })
    expect(points).toHaveLength(3)
    expect(points[0]).toEqual({ date: '2026-08-03', count: 0, share: 0, present: false })
    expect(points[2].present).toBe(true)
  })

  it('keeps only the last `window` collected days', () => {
    const many = Array.from({ length: 20 }, (_, i) => `2026-07-${String(20 - i).padStart(2, '0')}`)
    const points = buildHistory(new Map(), new Map(), many, {
      endDate: '2026-07-20',
      window: 3,
    })
    expect(points.map((point) => point.date)).toEqual(['2026-07-18', '2026-07-19', '2026-07-20'])
  })

  it('defaults the window to HISTORY_WINDOW', () => {
    const many = Array.from({ length: 30 }, (_, i) => `2026-07-${String(30 - i).padStart(2, '0')}`)
    const points = buildHistory(new Map(), new Map(), many, { endDate: '2026-07-30' })
    expect(points).toHaveLength(HISTORY_WINDOW)
  })

  // collected_dates and the counts come from the same source, so this should
  // not happen — but a missing denominator must not become NaN on a chart.
  it('is zero for a day with no denominator', () => {
    const points = buildHistory(counts({ '2026-08-03': 5 }), new Map(), DATES, {
      endDate: '2026-08-03',
    })
    expect(points[0]).toEqual({ date: '2026-08-03', count: 5, share: 0, present: true })
  })

  it('is empty when the selected date is older than everything collected', () => {
    expect(buildHistory(new Map(), HEADLINES, DATES, { endDate: '2026-07-01' })).toEqual([])
  })
})

describe('summariseHistory', () => {
  const points = (shares: number[]) =>
    shares.map((value, index) => ({
      date: `2026-08-0${index + 1}`,
      count: value === 0 ? 0 : 1,
      share: value,
      present: value > 0,
    }))

  it('counts the days it appeared on out of the days in the window', () => {
    expect(summariseHistory(points([0, 0.1, 0.2]))).toMatchObject({
      days: 3,
      daysPresent: 2,
    })
  })

  it('reports the last step as a proportion of the step before it', () => {
    expect(summariseHistory(points([0.1, 0.2])).change).toBeCloseTo(1)
  })

  // A word absent yesterday has not risen by a percentage. It is new, and the
  // caption says that word instead of a number.
  it('has no change and is new when it was absent the day before', () => {
    expect(summariseHistory(points([0, 0.2]))).toMatchObject({ change: null, isNew: true })
  })

  it('is not new when it appeared earlier in the window', () => {
    expect(summariseHistory(points([0.3, 0, 0.2]))).toMatchObject({ isNew: false })
  })

  it('has no change on a one-day window', () => {
    expect(summariseHistory(points([0.2])).change).toBeNull()
  })

  it('survives an empty series', () => {
    expect(summariseHistory([])).toEqual({ days: 0, daysPresent: 0, change: null, isNew: false })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/history.test.ts`
Expected: FAIL — `Failed to resolve import "./history"`.

- [ ] **Step 3: Write `src/lib/history.ts`**

```ts
// src/lib/history.ts
//
// A word's trajectory across the collected days.
//
// Everything else in this app terminates inside one `collected_date`. This is
// the one axis that crosses days, and it only became legitimate when the
// day-boundary stop shipped: before it, 8.4% of a day's rows carried the wrong
// date, so a line across days would have drawn the collector rather than the
// news.
//
// **Share, never raw counts** — the rule `surge.ts` established by measurement
// and this extends. Days run 691 to 4,218 headlines, and 2026-08-07 is a
// collect-cap regime boundary (150 to 300) on top of that, so a count series
// draws collection depth. Dividing by each day's own total is exactly what a
// step change in depth needs.
//
// **Day-wide, whatever tab is on screen.** Which section is selected decides
// what is *shown*, never what a word *did* that day. Same rule as the surge
// comparison and the sieve.
//
// The counts arrive from `fetchWordCountsFor`, which names its words and so
// cannot be truncated by PostgREST's 1,000-row cap; the denominators arrive
// from `collected_dates`, where they are `count(*)` grouped by day. Neither is
// a summed response — the failure this repository has already paid for once.

import { share } from './share'
import type { WordCount } from './types'

/**
 * How many collected days a trajectory may hold.
 *
 * The archive is 8 days long today, so nothing is dropped yet. The cap is here
 * so the sparkline stays readable in a 320px panel as the archive grows —
 * beyond a couple of weeks the points stop being distinguishable and the line
 * says less, not more.
 */
export const HISTORY_WINDOW = 14

export interface HistoryPoint {
  date: string
  /** Headlines that day holding the word, all six sections. */
  count: number
  /** `count` over that day's headline total. */
  share: number
  /**
   * Was the word in that day's headlines at all? A zero share can mean "absent"
   * or "present but the day was empty", and the sparkline's caption tells them
   * apart.
   */
  present: boolean
}

export interface HistoryOptions {
  /** The day on screen. The series ends here rather than at the newest day. */
  endDate: string
  /** At most this many collected days, counting back from `endDate`. */
  window?: number
}

/**
 * @param countsByDate exactly what `fetchWordCountsFor` returns — date to the
 *   rows for that date. Asked about one word, each entry holds zero rows or
 *   one, and a date missing from the map is a day the word did not appear on.
 * @param headlinesByDate `collected_dates`, date to that day's headline total.
 * @param dates every collected day, newest first, as `fetchCollectedDates`
 *   returns them.
 */
export function buildHistory(
  countsByDate: Map<string, WordCount[]>,
  headlinesByDate: Map<string, number>,
  dates: string[],
  options: HistoryOptions,
): HistoryPoint[] {
  const { endDate, window = HISTORY_WINDOW } = options

  // ISO dates compare correctly as strings, which is why no Date is built here:
  // a Date would drag in a time zone, and every date in this app is already a
  // KST calendar day decided server side.
  const inWindow = dates
    .filter((date) => date <= endDate)
    .sort()
    .slice(-window)

  return inWindow.map((date) => {
    const rows = countsByDate.get(date) ?? []
    const count = rows[0]?.count ?? 0
    return {
      date,
      count,
      share: share(count, headlinesByDate.get(date) ?? 0),
      present: rows.length > 0,
    }
  })
}

export interface HistorySummary {
  /** Collected days in the window. */
  days: number
  /** How many of them the word appeared on. */
  daysPresent: number
  /**
   * The last day's share over the day before it, minus one — so 0.12 is "up
   * 12%". Null when there is no day before, or when the word was absent then:
   * a word that was not there yesterday has not risen by a percentage.
   */
  change: number | null
  /** Present on the last day and on none before it. */
  isNew: boolean
}

export function summariseHistory(points: HistoryPoint[]): HistorySummary {
  const days = points.length
  const daysPresent = points.filter((point) => point.present).length
  if (days === 0) return { days: 0, daysPresent: 0, change: null, isNew: false }

  const last = points[days - 1]
  const before = days > 1 ? points[days - 2] : null
  const isNew = last.present && points.slice(0, -1).every((point) => !point.present)

  return {
    days,
    daysPresent,
    change: before && before.share > 0 ? last.share / before.share - 1 : null,
    isNew,
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/lib/history.test.ts`
Expected: PASS, 14 tests.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/history.ts src/lib/history.test.ts
git commit -m "Turn a word's collected days into a series of shares"
```

---

### Task 3: `WordHistory` — the sparkline

**Files:**
- Create: `src/components/WordHistory.tsx`
- Create: `src/components/WordHistory.test.tsx`

**Interfaces:**
- Consumes: `HistoryPoint`, `summariseHistory` from Task 2.
- Produces: `<WordHistory points={HistoryPoint[]} />` — renders nothing when
  `points` is empty or holds fewer than 2 points.

**Before writing any of the chart code, read the `dataviz` skill.** Then apply
this codebase's own ruling on top of it, which the donut already records: the
six section inks are canvas *text* held to a stricter bar than a chart fill
wants, so **nothing here may carry meaning by colour alone**. Every fact is in
ink text beside the line, and the svg is `aria-hidden`.

- [ ] **Step 1: Write the failing test**

Create `src/components/WordHistory.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WordHistory } from './WordHistory'
import type { HistoryPoint } from '../lib/history'

function points(shares: number[]): HistoryPoint[] {
  return shares.map((value, index) => ({
    date: `2026-08-0${index + 1}`,
    count: value === 0 ? 0 : Math.round(value * 100),
    share: value,
    present: value > 0,
  }))
}

describe('WordHistory', () => {
  it('says how many of the days it appeared on, in text', () => {
    render(<WordHistory points={points([0, 0.1, 0.2])} />)
    expect(screen.getByText(/3일 중 2일/)).toBeInTheDocument()
  })

  it('states the day-over-day move as a percentage', () => {
    render(<WordHistory points={points([0.1, 0.2])} />)
    expect(screen.getByText(/\+100%/)).toBeInTheDocument()
  })

  it('says a word absent the day before is new rather than showing a ratio', () => {
    render(<WordHistory points={points([0, 0.2])} />)
    expect(screen.getByText(/새로 등장/)).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('marks a fall with a minus rather than only with colour', () => {
    render(<WordHistory points={points([0.2, 0.1])} />)
    expect(screen.getByText(/−50%/)).toBeInTheDocument()
  })

  // One point is not a trajectory: a flat dot would claim the word has been
  // steady when what happened is that there is nothing to compare.
  it('renders nothing for fewer than two days', () => {
    const { container } = render(<WordHistory points={points([0.2])} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing with no days at all', () => {
    const { container } = render(<WordHistory points={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  // The caption carries every fact. Announcing the drawing as well would read
  // the same numbers out twice — the rule the donut already follows.
  it('hides the drawing from assistive technology', () => {
    const { container } = render(<WordHistory points={points([0.1, 0.2])} />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('draws one point per day', () => {
    const { container } = render(<WordHistory points={points([0.1, 0, 0.2])} />)
    expect(container.querySelectorAll('circle')).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/WordHistory.test.tsx`
Expected: FAIL — cannot resolve `./WordHistory`.

- [ ] **Step 3: Write `src/components/WordHistory.tsx`**

```tsx
import { summariseHistory } from '../lib/history'
import type { HistoryPoint } from '../lib/history'

interface WordHistoryProps {
  points: HistoryPoint[]
}

// Drawn in its own coordinate space and scaled by CSS, exactly as the donut is.
const WIDTH = 240
const HEIGHT = 40
const PAD = 4

/**
 * 한 단어가 수집된 날들을 지나오며 그날의 몇 퍼센트를 차지했는지.
 *
 * **세로축은 점유율이지 건수가 아니다.** 하루 깊이가 691에서 4,218까지 벌어져
 * 있고 2026-08-07에는 수집 상한이 150에서 300으로 바뀌었으므로, 건수를 그리면
 * 뉴스가 아니라 수집량이 그려진다. 이 규칙은 `surge.ts`가 측정으로 정해 둔 것이고
 * 여기서는 그것을 아카이브 전체로 늘릴 뿐이다.
 *
 * **사실은 전부 캡션의 글자가 진다.** 도넛에서와 같은 이유다 — 이 저장소의 잉크는
 * 캔버스 위의 *글자*로서 대비 4.5:1과 색상 40° 간격에 묶여 있어 도형 칠에 좋은
 * 색과 반대 방향이고, 그래서 색만으로 무엇을 지시해서는 안 된다. 오르내림은
 * 부호(+/−)로도 적히고, svg는 `aria-hidden`이다.
 */
export function WordHistory({ points }: WordHistoryProps) {
  // 점 하나는 궤적이 아니다. 평평한 점 하나는 "이 단어는 내내 그대로였다"고
  // 주장하는데, 실제로 일어난 일은 비교할 것이 없다는 것이다.
  if (points.length < 2) return null

  const summary = summariseHistory(points)

  // 최대 점유율로 정규화한다. 0을 바닥으로 삼는 것은 이 그림이 "그날의 몇 퍼센트"를
  // 말하기 때문이다 — 최솟값을 바닥으로 잡으면 잔잔한 변화가 절벽처럼 보인다.
  // 엣지 굵기가 0이 아니라 0.3에서 정규화되는 것과는 반대 방향의 판단이고, 이유도
  // 반대다: 거기서는 쓰이지 않는 아래쪽이 있었고 여기서는 0이 실제 값이다.
  const peak = Math.max(...points.map((point) => point.share))
  const step = points.length > 1 ? (WIDTH - PAD * 2) / (points.length - 1) : 0
  const y = (value: number) =>
    HEIGHT - PAD - (peak > 0 ? (value / peak) * (HEIGHT - PAD * 2) : 0)

  const placed = points.map((point, index) => ({
    ...point,
    x: PAD + index * step,
    y: y(point.share),
  }))
  const line = placed.map((point) => `${point.x},${point.y}`).join(' ')
  const last = placed[placed.length - 1]

  return (
    <figure className="mb-4 border-b border-line pb-4">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        className="h-10 w-full"
      >
        <polyline
          points={line}
          fill="none"
          style={{ stroke: 'var(--color-ink-faint)' }}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {placed.map((point) => (
          <circle
            key={point.date}
            cx={point.x}
            cy={point.y}
            r={point === last ? 3 : 1.75}
            style={{
              fill: point === last ? 'var(--color-ink)' : 'var(--color-ink-faint)',
            }}
          />
        ))}
      </svg>
      <figcaption className="mt-2 text-xs text-ink-muted">
        <span className="tabular-nums">
          {summary.days}일 중 {summary.daysPresent}일
        </span>
        {summary.isNew && <> · 오늘 새로 등장</>}
        {!summary.isNew && summary.change !== null && (
          <> · 전날 대비 <span className="tabular-nums">{formatChange(summary.change)}</span></>
        )}
      </figcaption>
    </figure>
  )
}

// 부호를 반드시 적는다 — 오르내림이 색으로만 구별되면 안 되고, 그것이 이 차트가
// dataviz의 색 기준을 통과하지 못하는 팔레트 위에서 정직할 수 있는 방법이다.
// 마이너스는 하이픈이 아니라 U+2212로, 숫자 옆에서 폭이 맞는다.
function formatChange(change: number): string {
  const percent = Math.round(change * 100)
  return percent >= 0 ? `+${percent}%` : `−${Math.abs(percent)}%`
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/components/WordHistory.test.tsx`
Expected: PASS, 8 tests.

If `--color-ink-faint` does not exist, read the `@theme` block in
`src/index.css` and use the tokens that are actually defined there. **Do not add
a new colour** — this chart is not entitled to one, and `theme.test.ts` guards
the palette's two invariants.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/WordHistory.tsx src/components/WordHistory.test.tsx
git commit -m "Draw the trajectory, and put every fact about it in text"
```

---

### Task 4: Wire the trajectory into the panel

After this task the first half of the feature is complete and shippable.

**Files:**
- Modify: `src/components/HeadlinePanel.tsx` (props, and render `WordHistory`
  above the list)
- Modify: `src/components/HeadlinePanel.test.tsx` (a case for the new prop)
- Modify: `src/App.tsx` (fetch the series, build it, pass it down)
- Modify: `e2e/keywordGraph.spec.ts` **or** `e2e/headlinePanel.spec.ts` (one
  browser assertion)

**Interfaces:**
- Consumes: `buildHistory` (Task 2), `WordHistory` (Task 3), and the existing
  `fetchWordCountsFor` from `src/lib/queries.ts`.
- Produces: `HeadlinePanelProps` gains `history?: HistoryPoint[]`.

- [ ] **Step 1: Write the failing unit test**

Append to `src/components/HeadlinePanel.test.tsx` — match the file's existing
render helper and imports rather than inventing new ones:

```tsx
  it('shows the trajectory above the headlines for a word', () => {
    renderPanel({
      subject: '폭염',
      history: [
        { date: '2026-08-03', count: 4, share: 0.1, present: true },
        { date: '2026-08-04', count: 12, share: 0.2, present: true },
      ],
    })
    expect(screen.getByText(/2일 중 2일/)).toBeInTheDocument()
  })

  // An event is not a thing that persists across days here: the Louvain
  // partition is per day and mergeCommunities runs on one day's edges, so
  // nothing can say yesterday's event and today's are the same event.
  it('shows no trajectory for an event', () => {
    renderPanel({ subject: '김민석 · 정청래', isEvent: true, history: [] })
    expect(screen.queryByText(/일 중 /)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/HeadlinePanel.test.tsx`
Expected: FAIL — `history` is not a known prop; the text is not found.

- [ ] **Step 3: Take the prop in `HeadlinePanel.tsx`**

Add to the imports:

```tsx
import { WordHistory } from './WordHistory'
import type { HistoryPoint } from '../lib/history'
```

Add to `HeadlinePanelProps`:

```tsx
  /**
   * The subject word's share across the collected days. Empty for an event —
   * event identity is not defined across days here, so there is no line to
   * draw.
   */
  history?: HistoryPoint[]
```

Take it in the signature with a default of `[]`, and render it immediately after
the heading block and before the `{error && …}` line:

```tsx
      {!isEvent && <WordHistory points={history} />}
```

`WordHistory` already renders nothing below two points, so no second guard is
needed and the loading state does not have to be threaded through.

- [ ] **Step 4: Run the unit tests and watch them pass**

Run: `npx vitest run src/components/HeadlinePanel.test.tsx`
Expected: PASS, including the two new cases.

- [ ] **Step 5: Fetch and build the series in `App.tsx`**

Add the imports:

```tsx
import { buildHistory } from './lib/history'
import type { HistoryPoint } from './lib/history'
```

Add state beside the other panel state:

```tsx
  const [history, setHistory] = useState<HistoryPoint[]>([])
```

Add this effect after the surge effect. **Note it reuses `fetchWordCountsFor`
rather than adding a query** — that function already names its words, which is
what keeps the response inside PostgREST's cap, and it is already cached, so a
word looked at twice costs nothing:

```tsx
  // 그 단어가 수집된 날들을 지나며 그날의 몇 퍼센트였는지. 사건에는 붙이지 않는다
  // — 루뱅 분할은 하루짜리고 `mergeCommunities`도 그날 엣지 위에서만 돌아서, 어제의
  // 사건과 오늘의 사건이 같다고 말할 근거가 이 코드베이스에 없다.
  //
  // 새 쿼리를 만들지 않는다. `fetchWordCountsFor`가 이미 단어를 지목해서 묻고
  // (그래서 1,000행 상한에 안 걸리고) 이미 캐시돼 있다. 분모도 이미 손에 있는
  // `headlinesByDate`이고, 그것은 `collected_dates`의 `count(*)`이지 응답의 합이
  // 아니다.
  useEffect(() => {
    if (!selectedWord || availableDates.length === 0) {
      setHistory([])
      return
    }
    let cancelled = false
    fetchWordCountsFor(availableDates, [selectedWord])
      .then((counts) => {
        if (cancelled) return
        setHistory(
          buildHistory(counts, headlinesByDate, availableDates, { endDate: selectedDate }),
        )
      })
      .catch(() => {
        // 급상승 표식과 같은 방식으로 삼킨다. 궤적이 없어도 헤드라인 목록은 그대로
        // 읽히고, 없는 편이 오류 페이지보다 낫다.
        if (!cancelled) setHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedWord, selectedDate, availableDates, headlinesByDate])
```

Pass it to the panel:

```tsx
        history={history}
```

- [ ] **Step 6: Write the browser assertion**

The e2e mock needs **nothing new** — the trajectory reads `daily_word_counts`,
which `mockSupabase`'s `wordCountsFor` already serves and already filters by the
`in.(…)` lists. `WORD_COUNTS` in `e2e/support/fixtures.ts` holds two days for
예산안, so a two-point series exists.

Add to `e2e/headlinePanel.spec.ts`, following the file's existing setup:

```ts
test('the panel shows the word trajectory across collected days', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')
  // The file's own way of clicking a word on the canvas — the labels are SVG
  // text, so getByText would also match the event list's copy of the word.
  await page.locator('svg text').filter({ hasText: /^예산안$/ }).click()

  const panel = page.getByRole('complementary')
  await expect(panel.getByText(/2일 중 2일/)).toBeVisible()
  // 5/12 today against 1/8 yesterday — a rise in **share**, which is the whole
  // point: the count went 1 → 5 while the day went 8 → 12 headlines.
  await expect(panel.getByText(/\+233%/)).toBeVisible()
})
```

- [ ] **Step 7: Run everything**

Run: `npm run build`
Expected: exits 0.

Run: `npm test`
Expected: PASS.

Run: `npm run test:e2e`
Expected: PASS. If `e2e/smoke.spec.ts` alone fails on a bare count mismatch,
that is the known missing-`.env` case, not this change — say so rather than
"tests pass". Note `playwright.config.ts` sets `reuseExistingServer: true`, so
stop any dev server started before `.env` existed.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/HeadlinePanel.tsx src/components/HeadlinePanel.test.tsx e2e/headlinePanel.spec.ts
git commit -m "Put a word's trajectory above its headlines"
```

---

### Task 5: Migration `0030` — the word directory

**Files:**
- Create: `supabase/migrations/0030_word_directory.sql`

**Interfaces:**
- Produces: table-like `public.word_directory (word text, total int, days int,
  last_date date)` readable by `anon`; `public.refresh_word_directory()`
  executable by `service_role` only.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0030_word_directory.sql`:

```sql
-- 0030: a directory of every word the analyser has ever produced, so a word
-- that is not on the canvas can still be found.
--
-- **Why this is materialised rather than a view or a plain index.** Search means
-- a substring match, and `word like '%…%'` uses no index at any anchoring. On
-- 2026-08-07, measured on the live database as the second of two runs:
--
--   archive-wide  `word like '김%'`  ->  316 ms, seq scan of all 114,457 rows
--   the same, restricted to one day ->   20 ms, the same seq scan
--   building this directory inline  ->  311 ms (~300 to build, ~1 to filter)
--
-- Restricting by date does not help, because the seq scan is the fixed cost and
-- only the join to `headlines` shrinks. The important part is how each grows:
-- searching `headline_nouns` grows with **headline volume** (~1.3M rows at 90
-- days), while this grows with **vocabulary**, which grows far more slowly — a
-- new day is mostly words already here. 19,767 rows at eight days.
--
-- No index beyond the unique one below. Filtering 19,767 short strings is the
-- ~1 ms above, and a substring match could not use a btree index anyway.
--
-- `last_date` is shown on every search result and breaks ties in the ordering.
-- It deliberately does not outrank `total`: a recency-weighted score would be a
-- ranking invented here with nothing to measure it against, and the trajectory
-- answers the recency question properly one click later.

create materialized view public.word_directory as
select
  n.word,
  count(*)::int as total,
  count(distinct h.collected_date)::int as days,
  max(h.collected_date) as last_date
from public.headline_nouns n
join public.headlines h on h.id = n.headline_id
group by n.word;

-- `refresh materialized view concurrently` requires a unique index, and
-- concurrently is what keeps the directory readable while the collector is
-- rebuilding it. Without it a search issued during a refresh would block.
create unique index word_directory_word_idx on public.word_directory (word);

-- **A materialised view cannot carry an RLS policy**, so unlike every table in
-- this schema its access model is the grant and nothing else. Supabase's
-- default grants are wide, so they are revoked explicitly first rather than
-- assumed away.
revoke all on public.word_directory from public, anon, authenticated;
grant select on public.word_directory to anon, authenticated;

comment on materialized view public.word_directory is
  'One row per word ever analysed, for substring search. Refreshed by the '
  'collector at the end of every run via refresh_word_directory(). Has no RLS — '
  'a matview cannot carry a policy — so the select-only grant is the whole of '
  'its access model.';

-- **security definer, and this is not the case CLAUDE.md forbids.** `refresh
-- materialized view` is owner-only; this migration runs as the owner and the
-- Edge Function connects as `service_role`. What that rule protects is the
-- `keyword_graph` chain, where a definer would hand out the service role's view
-- of the tables to `anon`. This function reads nothing and returns nothing.
--
-- `set search_path = ''` all the same, which is why every name inside is
-- schema-qualified. Execute is granted to `service_role` alone: to `anon` it
-- would let anyone queue unbounded ~300 ms refreshes through PostgREST.
create or replace function public.refresh_word_directory()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view concurrently public.word_directory;
end;
$$;

revoke all on function public.refresh_word_directory() from public, anon, authenticated;
grant execute on function public.refresh_word_directory() to service_role;
```

- [ ] **Step 2: Apply it**

There is no local Postgres, Docker or Deno in this environment. Push it:

```bash
set -a && . ./.env.supabase && set +a
npx supabase db push --password "$SUPABASE_DB_PASSWORD"
```

Expected: `0030_word_directory.sql` applied.

- [ ] **Step 3: Verify the object, by querying rather than by assuming**

Through the Management API (`POST
https://api.supabase.com/v1/projects/{ref}/database/query`) or the Supabase MCP
`execute_sql`, run each and check the stated expectation:

```sql
-- 1. The directory holds one row per distinct word. Must be equal.
select
  (select count(*) from public.word_directory) as directory,
  (select count(distinct word) from public.headline_nouns) as vocabulary;

-- 2. The totals are the noun rows, nothing dropped by the join. Must be equal.
select
  (select sum(total) from public.word_directory) as directory,
  (select count(*) from public.headline_nouns) as noun_rows;

-- 3. Only service_role may refresh. Expect exactly one row: service_role.
select grantee from information_schema.routine_privileges
where routine_name = 'refresh_word_directory' and privilege_type = 'EXECUTE';

-- 4. anon may read it. Expect a row for anon with SELECT.
select grantee, privilege_type from information_schema.table_privileges
where table_name = 'word_directory';
```

- [ ] **Step 4: Verify the refresh works and time the search**

```sql
select public.refresh_word_directory();
```

Then run the search twice and record the **second** time — this repo has already
been bitten once by reading a cold-cache first query as a signal:

```sql
explain analyze
select word, total, days, last_date from public.word_directory
where word ilike '%민석%' order by total desc, last_date desc, word limit 20;
```

Write the measured number into the migration's header comment beside the 316 ms,
so the two sit together. Do not skip this — the whole justification for the
migration is that comparison.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0030_word_directory.sql
git commit -m "Build a word directory, because a substring match indexes nothing"
```

---

### Task 6: `searchWords`

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `word_directory` from Task 5, `cachedQuery` from
  `src/lib/queryCache.ts`.
- Produces:
  - `interface WordMatch { word: string; total: number; days: number; lastDate: string }`
  - `searchWords: CachedQuery<[string], WordMatch[]>`
  - `SEARCH_LIMIT = 20`

- [ ] **Step 1: Write the failing test**

Three edits to `src/lib/queries.test.ts`.

**(a)** `makeQueryChain` at the top of the file has no `ilike`. Add it beside
the other filter methods:

```ts
    ilike: vi.fn(() => chain),
```

**(b)** Add `searchWords` to the destructured import at the top:

```ts
const {
  fetchCategoryShare,
  fetchCollectedDates,
  fetchEventHeadlineCounts,
  fetchHeadlineCount,
  fetchHeadlinesForEvent,
  fetchHeadlinesForWord,
  fetchKeywordGraph,
  fetchWordCounts,
  fetchWordCountsFor,
  searchWords,
} = await import('./queries')
```

**(c)** Append the describe block. `clearQueryCache()` is already in this file's
`beforeEach` and must stay — without it one test's response leaks into the next,
and these four all search similar terms:

```ts
describe('searchWords', () => {
  const ROW = { word: '김민석', total: 120, days: 8, last_date: '2026-08-07' }

  it('asks the directory for a substring match, biggest first', async () => {
    const chain = makeQueryChain({ data: [ROW], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const result = await searchWords('민석')

    expect(mockSupabase.from).toHaveBeenCalledWith('word_directory')
    expect(chain.ilike).toHaveBeenCalledWith('word', '%민석%')
    expect(chain.order).toHaveBeenCalledWith('total', { ascending: false })
    expect(result).toEqual([
      { word: '김민석', total: 120, days: 8, lastDate: '2026-08-07' },
    ])
  })

  it('coerces counts arriving as strings', async () => {
    mockSupabase.from.mockReturnValue(
      makeQueryChain({
        data: [{ ...ROW, total: '120', days: '8' }],
        error: null,
      }),
    )

    const result = await searchWords('민석')

    expect(result[0].total).toBe(120)
    expect(result[0].days).toBe(8)
  })

  it('returns nothing for a blank term without going to the network', async () => {
    mockSupabase.from.mockClear()

    expect(await searchWords('   ')).toEqual([])

    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  // `_` is a LIKE wildcard, so left alone it matches every one-character word
  // in the archive. PostgREST also rewrites `*` into `%` before Postgres sees
  // the pattern, so escaping would have to happen at two layers with two sets
  // of rules; stripping is one rule in one place.
  it('strips wildcards rather than escaping them', async () => {
    const chain = makeQueryChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    await searchWords('민_석*%')

    expect(chain.ilike).toHaveBeenCalledWith('word', '%민석%')
  })

  it('trims the term', async () => {
    const chain = makeQueryChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    await searchWords('  민석  ')

    expect(chain.ilike).toHaveBeenCalledWith('word', '%민석%')
  })

  it('throws a real Error carrying the PostgREST message', async () => {
    mockSupabase.from.mockReturnValue(
      makeQueryChain({
        data: null,
        error: { message: 'permission denied for materialized view word_directory', code: '42501' },
      }),
    )

    await expect(searchWords('민석')).rejects.toThrow(
      'permission denied for materialized view word_directory (42501)',
    )
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: FAIL — `searchWords` is not exported.

- [ ] **Step 3: Add it to `src/lib/queries.ts`**

```ts
export interface WordMatch {
  word: string
  /** Headline rows holding this word, across the whole archive. */
  total: number
  /** Collected days it appeared on. */
  days: number
  /** The most recent of those days. */
  lastDate: string
}

/** Result rows shown for one search. Twenty fills the list without paging it. */
export const SEARCH_LIMIT = 20

// `%`, `_` and `*` are wildcards by the time a term reaches Postgres — PostgREST
// rewrites `*` into `%` before Postgres sees the pattern — so escaping them
// correctly means escaping at two layers with two sets of rules. They are
// stripped instead, which is one rule in one place. The cost was counted rather
// than waved away: of 19,767 words, **two** contain `%` (0.45%포인트, 1%포인트)
// and **none** contain `_` or `*`, and both of those two are still reachable by
// searching 포인트. Left alone, a lone `_` matches every one-character word in
// the archive.
function stripWildcards(term: string): string {
  return term.replace(/[%_*\\]/g, '')
}

// Substring search over the whole archive, against the materialised directory
// from migration 0030 rather than against headline_nouns.
//
// `word like '%…%'` uses no index at any anchoring, so searching the noun rows
// reads all 114,457 of them — 316 ms measured — and that cost grows with
// headline volume. The directory is ~19,767 rows, grows with vocabulary
// instead, and is filtered in about a millisecond.
//
// Ordered by total, then by the last day it appeared on, then by the word so a
// tie is broken the same way every time. `last_date` deliberately does not
// outrank `total`: a recency-weighted score would be a ranking invented here
// with nothing to measure it against, and the trajectory answers that question
// properly one click later.
//
// Cached because a reader types, deletes a character and types it again.
export const searchWords = cachedQuery(
  (query: string) => `word-search|${stripWildcards(query.trim())}`,
  async (query: string): Promise<WordMatch[]> => {
    const term = stripWildcards(query.trim())
    if (term === '') return []

    const { data, error } = await supabase
      .from('word_directory')
      .select('word, total, days, last_date')
      .ilike('word', `%${term}%`)
      .order('total', { ascending: false })
      .order('last_date', { ascending: false })
      .order('word')
      .limit(SEARCH_LIMIT)
    if (error) throw queryError(error)

    const rows = (data ?? []) as {
      word: string
      total: number | string
      days: number | string
      last_date: string
    }[]
    return rows.map((row) => ({
      word: row.word,
      total: Number(row.total),
      days: Number(row.days),
      lastDate: row.last_date,
    }))
  },
)
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: PASS.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Count the cached queries, do not increment**

Run: `grep -c "= cachedQuery(" src/lib/queries.ts`
Expected: `8`.

Note the number for Task 9. `CLAUDE.md` states it in prose and it has twice
been incremented from a stale value instead of counted — this step exists so it
is counted.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "Search the directory, and strip the wildcards a term should not carry"
```

---

### Task 7: `WordSearch` — the box and its results

**Files:**
- Create: `src/components/WordSearch.tsx`
- Create: `src/components/WordSearch.test.tsx`

**Interfaces:**
- Consumes: `searchWords`, `WordMatch` (Task 6).
- Produces: `<WordSearch onSelect={(word: string) => void} />`

- [ ] **Step 1: Write the failing test**

Create `src/components/WordSearch.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WordSearch } from './WordSearch'

const searchWords = vi.hoisted(() => vi.fn())
vi.mock('../lib/queries', () => ({ searchWords }))

const MATCH = { word: '김민석', total: 120, days: 8, lastDate: '2026-08-07' }

beforeEach(() => {
  searchWords.mockReset()
  searchWords.mockResolvedValue([MATCH])
})

describe('WordSearch', () => {
  it('lists what the directory returned', async () => {
    render(<WordSearch onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('searchbox'), '민석')
    expect(await screen.findByRole('option', { name: /김민석/ })).toBeInTheDocument()
  })

  it('says how many days a word appeared on and when it last did', async () => {
    render(<WordSearch onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('searchbox'), '민석')
    const option = await screen.findByRole('option', { name: /김민석/ })
    expect(option).toHaveTextContent('8일')
    expect(option).toHaveTextContent('120')
  })

  it('hands the chosen word up', async () => {
    const onSelect = vi.fn()
    render(<WordSearch onSelect={onSelect} />)
    await userEvent.type(screen.getByRole('searchbox'), '민석')
    await userEvent.click(await screen.findByRole('option', { name: /김민석/ }))
    expect(onSelect).toHaveBeenCalledWith('김민석')
  })

  it('asks nothing while the box is empty', async () => {
    render(<WordSearch onSelect={() => {}} />)
    await userEvent.click(screen.getByRole('searchbox'))
    await waitFor(() => expect(searchWords).not.toHaveBeenCalled())
  })

  it('says so when a term matches nothing', async () => {
    searchWords.mockResolvedValue([])
    render(<WordSearch onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('searchbox'), '없는말')
    expect(await screen.findByText(/찾은 단어가 없습니다/)).toBeInTheDocument()
  })

  // A failed search must not take the page down: it annotates a screen that
  // reads perfectly well without it, the same choice the surge markers make.
  it('shows no results and no error page when the search fails', async () => {
    searchWords.mockRejectedValue(new Error('nope'))
    render(<WordSearch onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('searchbox'), '민석')
    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/WordSearch.test.tsx`
Expected: FAIL — cannot resolve `./WordSearch`.

- [ ] **Step 3: Write `src/components/WordSearch.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { formatDate } from '../lib/formatDate'
import { searchWords } from '../lib/queries'
import type { WordMatch } from '../lib/queries'

interface WordSearchProps {
  onSelect: (word: string) => void
}

// 타자를 치는 동안 매 글자마다 묻지 않는다. 250ms는 한 글자를 더 칠 만한 시간이고,
// 사전 조회 자체는 ~1ms이므로 이 값은 네트워크가 아니라 요청 수를 위한 것이다.
const DEBOUNCE_MS = 250

/**
 * 캔버스가 그리지 않은 단어로 가는 길.
 *
 * 화면에 손이 닿는 단어는 그려진 70개뿐이고, 아카이브에는 19,767개가 있다. 체에
 * 걸린 단어는 존재를 확인할 방법조차 없었다.
 *
 * **찾은 단어를 골라도 날짜는 바뀌지 않는다.** 보던 날을 말없이 빼앗지 않기
 * 위해서다 — 어느 날로 가야 하는지는 패널의 궤적이 말해 주고, 이동은 읽는 사람이
 * 한다.
 */
export function WordSearch({ onSelect }: WordSearchProps) {
  const [term, setTerm] = useState('')
  const [matches, setMatches] = useState<WordMatch[]>([])
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    if (term.trim() === '') {
      setMatches([])
      setSearched(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      searchWords(term)
        .then((found) => {
          // 느린 앞 요청이 새 응답을 덮어쓰지 못하게 한다. 지우고 다시 치면
          // 두 요청이 겹치고, 도착 순서는 보낸 순서가 아니다.
          if (cancelled) return
          setMatches(found)
          setSearched(true)
        })
        .catch(() => {
          // 급상승 표식과 같은 방식으로 삼킨다. 검색이 실패해도 화면은 그대로
          // 읽히고, 오류 페이지를 띄우는 것보다 목록이 비는 편이 낫다.
          if (cancelled) return
          setMatches([])
          setSearched(true)
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term])

  return (
    <div className="relative">
      <input
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        // 보이는 라벨이 없으므로 접근 가능한 이름은 여기서 나온다.
        aria-label="단어 검색"
        placeholder="단어 검색"
        className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint sm:w-56"
      />

      {searched && matches.length === 0 && (
        <p className="absolute z-40 mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-muted">
          찾은 단어가 없습니다.
        </p>
      )}

      {matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="검색 결과"
          className="absolute z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-line bg-surface shadow-lg"
        >
          {matches.map((match) => (
            <li key={match.word}>
              <button
                role="option"
                aria-selected={false}
                onClick={() => onSelect(match.word)}
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-ground"
              >
                <span className="truncate text-ink">{match.word}</span>
                <span className="ml-auto shrink-0 tabular-nums text-xs text-ink-muted">
                  {match.total.toLocaleString('ko-KR')}건 · {match.days}일
                </span>
                {/* 마지막으로 나온 날. 정렬은 건수 순이므로, 일주일 전에 컸던
                    단어와 오늘 큰 단어를 구별하는 것은 이 글자다. */}
                <span className="shrink-0 text-xs text-ink-faint">
                  {formatDate(match.lastDate).day}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

Two notes for whoever builds this:

- `role="option"` on a `<button>` inside a `role="listbox"` satisfies the tests
  and keeps the row keyboard-operable. If `oxlint`'s a11y rules object to the
  nesting, keep `role="option"` — the tests select on it — and resolve the
  complaint by moving the role onto the `<li>` and making the whole row
  clickable, rather than by dropping the role.
- `formatDate` returns `{ day, weekday, year }`; only `day` is used here.
  Do not format a date by hand.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/components/WordSearch.test.tsx`
Expected: PASS, 6 tests.

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/WordSearch.tsx src/components/WordSearch.test.tsx
git commit -m "Add the box that reaches a word the canvas did not draw"
```

---

### Task 8: Wire search into the app, and say when a word is not on the canvas

**Files:**
- Modify: `src/App.tsx` (mount `WordSearch` in the header; compute the flag)
- Modify: `src/components/HeadlinePanel.tsx` (+ its test) for the note
- Modify: `e2e/support/fixtures.ts` (a `WORD_DIRECTORY` fixture)
- Modify: `e2e/support/mockSupabase.ts` (serve it)
- Modify: `e2e/appControls.spec.ts` (the browser assertion)

**Interfaces:**
- Consumes: `WordSearch` (Task 7), `searchWords` (Task 6).
- Produces: `HeadlinePanelProps` gains `offCanvas?: boolean`.

- [ ] **Step 1: Write the failing unit test for the note**

Add to `src/components/HeadlinePanel.test.tsx`:

```tsx
  it('says when the word is not among the words drawn that day', () => {
    renderPanel({ subject: '유상증자', offCanvas: true })
    expect(screen.getByText(/이 날 화면에는 없는 단어/)).toBeInTheDocument()
  })

  it('says nothing of the sort for a word that is drawn', () => {
    renderPanel({ subject: '폭염' })
    expect(screen.queryByText(/이 날 화면에는 없는 단어/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/HeadlinePanel.test.tsx`
Expected: FAIL on the first of the two.

- [ ] **Step 3: Add the note to `HeadlinePanel.tsx`**

Add the prop:

```tsx
  /**
   * The subject is a word the sieve did not draw on this day — reached by
   * search rather than by clicking the canvas. Saying so is what stops the
   * canvas looking broken for not lighting anything.
   */
  offCanvas?: boolean
```

and render it under the heading, above the trajectory:

```tsx
      {offCanvas && (
        <p className="mb-3 text-xs text-ink-faint">
          이 날 화면에는 없는 단어입니다.
        </p>
      )}
```

- [ ] **Step 4: Mount the search box and compute the flag in `App.tsx`**

Import `WordSearch`, and put it in the sticky header beside `CategoryTabs`:

```tsx
          <WordSearch
            onSelect={(word) => {
              // 단어 선택과 사건 선택은 상호배제다 — 캔버스에서 무엇이 살아 있는지
              // 읽을 수 없게 된다. 캔버스 클릭 핸들러와 같은 규칙.
              setSelectedEvent(null)
              setSelectedWord(word)
            }}
          />
```

Compute the flag beside the other memos:

```tsx
  // 검색으로 닿은 단어는 그날 그려진 70개 안에 없을 수 있다. 그래프가 아직 안
  // 왔을 때(nodes 0)는 아직 판단할 수 없으므로 false로 둔다 — 공유된 링크가
  // 그래프 도착 전에 "없는 단어"라고 불려서는 안 된다.
  const wordOffCanvas = useMemo(
    () =>
      selectedWord !== null &&
      graph.nodes.length > 0 &&
      !graph.nodes.some((node) => node.word === selectedWord),
    [graph.nodes, selectedWord],
  )
```

and pass `offCanvas={wordOffCanvas}` to `HeadlinePanel`.

- [ ] **Step 5: Add the e2e fixture and serve it**

In `e2e/support/fixtures.ts`, add this **below `WORD_COUNTS`** (it reads it, so
it cannot come first) — and **derive it from `WORD_COUNTS` rather than writing
rows out again**. The same rule
`COLLECTED_DATES` and `CATEGORY_SHARE` already follow: a drifted copy describes
a day that does not exist, and then the assertions describe it too.

```ts
export type WordDirectoryRow = {
  word: string
  total: number
  days: number
  last_date: string
}

// The directory is what the database would materialise from WORD_COUNTS, so it
// is computed from WORD_COUNTS rather than written out beside it. 유상증자 is
// added as the one word that exists in the archive and is **not** in
// DEFAULT_GRAPH — it is what the "not on this day's canvas" assertion needs,
// and it has to be absent from the graph to test anything.
export const WORD_DIRECTORY: WordDirectoryRow[] = [
  ...Object.entries(
    WORD_COUNTS.reduce<Record<string, { total: number; days: Set<string> }>>((acc, row) => {
      const held = (acc[row.word] ??= { total: 0, days: new Set() })
      held.total += row.count
      held.days.add(row.collected_date)
      return acc
    }, {}),
  ).map(([word, held]) => ({
    word,
    total: held.total,
    days: held.days.size,
    last_date: [...held.days].sort().slice(-1)[0],
  })),
  { word: '유상증자', total: 4, days: 1, last_date: previousDayInSeoul() },
]
```

In `e2e/support/mockSupabase.ts`:

- add `'word_directory'` to `EndpointName` and `word_directory?: RowsOrFn` to
  `MockOptions`
- add a default that **reads the request**, because the point of a search mock
  is that it filters:

```ts
// The whole point of a search is the filter, so the default applies it: a mock
// that ignored `ilike` would pass even if the app searched for the wrong term.
// PostgREST spells it `ilike.%민석%`.
function directoryFor({ params }: MockRequest): Rows {
  const pattern = (params.get('word') ?? '').replace(/^ilike\./, '').replace(/%/g, '')
  if (pattern === '') return []
  return WORD_DIRECTORY.filter((row) => row.word.includes(pattern))
}
```

- register it: `word_directory: directoryFor` in `TABLE_DEFAULTS`, and import
  `WORD_DIRECTORY` at the top.

**It must be a function, and `resolve()` must call it.** Returning the function
itself serialises to `undefined`, which reaches the app as an empty result and
reads exactly like "no data" — this is how the surge markers once silently never
appeared. `resolve()` already handles both, so registering it in
`TABLE_DEFAULTS` is enough; do not special-case it.

- [ ] **Step 6: Write the browser assertion**

Add to `e2e/appControls.spec.ts`:

`유상증자` is in `WORD_DIRECTORY` and deliberately **not** in `DEFAULT_GRAPH` —
that is the whole point of it, and if a later fixture edit adds it to the graph
these tests stop testing anything.

```ts
test('a searched word that was not drawn opens the panel and says so', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  const before = new URL(page.url()).searchParams.get('date')

  await page.getByRole('searchbox').fill('유상증자')
  await page.getByRole('option', { name: /유상증자/ }).click()

  const panel = page.getByRole('complementary')
  await expect(panel).toBeVisible()
  await expect(panel.getByText(/이 날 화면에는 없는 단어/)).toBeVisible()

  // The day did not move under the reader. Asserted on the date rather than on
  // a hand-encoded word, which would be testing URLSearchParams' escaping.
  await expect
    .poll(() => new URL(page.url()).searchParams.get('word'))
    .toBe('유상증자')
  expect(new URL(page.url()).searchParams.get('date')).toBe(before)
})

test('a searched word that was drawn does not carry the note', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  await page.getByRole('searchbox').fill('예산안')
  await page.getByRole('option', { name: /예산안/ }).click()

  const panel = page.getByRole('complementary')
  await expect(panel.getByText(/2일 중 2일/)).toBeVisible()
  await expect(panel.getByText(/이 날 화면에는 없는 단어/)).toHaveCount(0)
})
```

- [ ] **Step 7: Check that the sparkline did not widen a bare selector**

Run: `grep -rn "svg path\|svg text\|svg circle\|'svg'\|\"svg\"" e2e/`

The donut already made `svg path` stop meaning "an edge", and one
`toHaveCount(1)` had been passing only in the frame before the donut existed.
The sparkline adds `<polyline>` and `<circle>` inside a **third** svg, so it is
the same hazard with different element names.

What to check, concretely: `svg text` is used to click a canvas word and is
**safe** — the sparkline draws no `<text>`. Any bare `svg`, `svg path`, or a new
`svg circle` count is not. The graph's own scope is `svg[role="group"]`; the
panel's sparkline sits inside `role="complementary"`. Narrow anything unscoped
and name in the commit message which selectors were touched — "none needed
narrowing" is also a fine answer, but only after running the grep.

- [ ] **Step 8: Run everything**

Run: `npm run build` → exits 0.
Run: `npm test` → PASS.
Run: `npm run test:e2e` → PASS (`smoke.spec.ts` may fail on a missing `.env`;
report that separately rather than as a pass).

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/HeadlinePanel.tsx src/components/HeadlinePanel.test.tsx e2e/
git commit -m "Reach a word the sieve did not draw, and say that is what happened"
```

---

### Task 9: The collector refreshes the directory

**Files:**
- Modify: `supabase/functions/collect-headlines/index.ts` (inside `Deno.serve`,
  after the category loop, before the `Response`)

**Interfaces:**
- Consumes: `refresh_word_directory()` from Task 5.
- Produces: a `directory` field in the run's JSON response body.

`index.ts` is Deno-only and **not type-checked** — `tsc` cannot resolve Deno
globals. Its correctness is established by running the deployed function and
reading the response. Keep the change small for that reason.

- [ ] **Step 1: Add the refresh**

After the category loop and before `return new Response(`:

```ts
  // 검색이 읽는 사전은 미리 지어 둬야 의미가 있다 — 부분일치는 어떤 인덱스도 타지
  // 않아서, 명사 행 11만 개를 그때그때 훑으면 316ms이고 그 값은 헤드라인 수에
  // 비례해 자란다. 여기서 갱신하면 검색은 항상 직전 런까지 최신이다.
  //
  // **실패는 삼킨다.** 사전이 하루 낡는 것과 수집이 실패하는 것은 비교 대상이
  // 아니다. 대신 응답 본문에 적는다: `CHK` 로그는 대시보드에만 있고 Management
  // API는 function_logs에 403을 주므로, 기계가 읽을 수 있는 유일한 자리가 본문이다.
  //
  // CPU 예산과는 무관하다. 이 함수를 죽이는 한계는 워커의 **누적 CPU**인데 이것은
  // DB가 하는 일을 기다리는 벽시계 시간이다.
  let directory = 'ok'
  try {
    const { error: refreshError } = await supabase.rpc('refresh_word_directory')
    if (refreshError) {
      directory = `failed: ${refreshError.message}`
      console.error('CHK word_directory refresh failed:', refreshError)
    }
  } catch (refreshThrow) {
    // postgrest-js resolves an ordinary failure into { error }, but a network
    // error it raises itself is not that shape — and an unguarded await here
    // would lose the whole run's summary at the very last step.
    directory = `failed: ${String(refreshThrow)}`
    console.error('CHK word_directory refresh threw:', refreshThrow)
  }
```

and add it to the body:

```ts
    JSON.stringify({
      date: collectedDate,
      cap: headlineCap,
      elapsedMs: Date.now() - startedAt,
      directory,
      summary,
    }),
```

- [ ] **Step 2: Deploy**

```bash
set -a && . ./.env.supabase && set +a
npx supabase functions deploy collect-headlines --project-ref "$SUPABASE_PROJECT_REF"
```

- [ ] **Step 3: Run it and read the body**

Invoke the deployed function once and check the response holds `"directory":
"ok"` alongside the six category lines.

**A 546 with no body is evidence about the worker, not about this change.** The
CPU budget is cumulative across the requests one worker serves, so the same call
can pass on a fresh worker and fail on a warm one. If that happens, wait and
invoke again rather than concluding the refresh is too expensive.

- [ ] **Step 4: Confirm the directory actually moved**

```sql
select count(*) as directory, (select count(distinct word) from public.headline_nouns) as vocabulary
from public.word_directory;
```

Expected: equal. Then search the app for a word first collected by that run and
confirm it is found.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/collect-headlines/index.ts
git commit -m "Refresh the word directory at the end of every run, and report it in the body"
```

---

### Task 10: Write down what this changed

`CLAUDE.md` is the map a future session reads before touching any of this. Four
of its statements are now wrong or incomplete.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Fix the counted number, by counting**

Run: `grep -c "= cachedQuery(" src/lib/queries.ts` and put **that** number into
the sentence in the "Reading the same view twice costs nothing" section. That
sentence already records that it has twice been incremented from a stale value
instead of counted.

- [ ] **Step 2: Correct "the schema lives in three places"**

It is four now: `supabase/migrations/*.sql`, the Edge Function's inserts,
`src/lib/queries.ts`, and `word_directory`, which is derived from
`headline_nouns` and `headlines` and so has to be rebuilt whenever either
changes shape.

- [ ] **Step 3: Add a section on the time axis**

Under the frontend architecture, covering:

- What the trajectory is, that its y axis is share, and that this is `surge.ts`'s
  rule extended rather than a new decision.
- **That it costs no migration and no new query**, because
  `fetchWordCountsFor` already names its words and the denominators already ride
  on `collected_dates` — and why naming the words is what keeps it inside the
  1,000-row cap.
- **That events get none**, and why: the Louvain partition is per day, so
  nothing here can say yesterday's event and today's are the same event.
- That it only became legitimate when the day-boundary stop shipped — 8.4% of a
  day's rows had the wrong date before it.
- The `HISTORY_WINDOW` of 14, and that it is a readability cap on a 320px panel
  rather than a measured number.

- [ ] **Step 4: Add a section on the directory**

Covering the three measurements (316 ms archive-wide, 20 ms day-scoped with the
same seq scan, ~1 ms on the directory) and the conclusion that matters:
**searching the noun rows grows with headline volume while the directory grows
with vocabulary.** Then:

- `word_directory` **has no RLS**, because a matview cannot carry a policy — the
  select-only grant is the whole of its access model, and that is a genuine
  exception to the "every table has RLS" statement in the access-model section.
  Say so there too.
- `refresh_word_directory()` is `SECURITY DEFINER` and why that does not
  contradict the `keyword_graph` chain rule, and that execute is `service_role`
  only.
- Wildcards are stripped, not escaped, and the two-layer reason (PostgREST
  rewrites `*` into `%`). Name the two words this costs.
- The collector refreshes it and reports `directory` in the response body, and
  that this is DB wall clock rather than worker CPU.

- [ ] **Step 5: Verify nothing else drifted**

Run: `npm run build` → exits 0.
Run: `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "Record the time axis, the directory, and the RLS exception it introduces"
```

---

## Done

Report to the repository owner with:

- the measured search time from Task 5 step 4, beside the 316 ms baseline
- the `directory: 'ok'` from a live run (Task 9 step 3)
- `npm run build`, `npm test` and `npm run test:e2e` output

**Do not merge to `main`.** He does that himself — offer the branch and wait.
