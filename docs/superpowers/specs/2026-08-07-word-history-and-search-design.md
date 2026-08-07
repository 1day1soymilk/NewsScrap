# A word's trajectory, and a way to reach a word that is not on screen — design

2026-08-07. Two features asked for together and designed as one, because
separately each is half of the same thing. A third item — re-measuring
`head_pos` as a cut against a demotion on fat days — was asked for in the same
sitting and is deliberately **not** in this spec; section 8 says why and prices
it.

## 1. What this is for

Everything this app can answer is about **one day**. The date stepper, the
section tabs, the event list, the headline panel and the surge markers all
terminate inside a single `collected_date`. The archive stopped being one day
long some time ago:

| | |
| --- | --- |
| collected days | 8 (2026-07-31 – 08-07) |
| headlines per day | 691 – 4,218 (a 6× spread) |
| words appearing on **all 8** days (df ≥ 3) | 116 |
| words on 5 days or more | 639 |
| vocabulary / noun rows / headlines | 19,767 / 114,457 / 18,252 |

And the day-boundary stop merged two commits ago is what makes a multi-day
reading legitimate at all. Until it shipped, **8.4% of a day's rows carried the
wrong date** (measured on 2026-08-07: 141 of 1,821 rows from that day's four
old-code crons were published on another day; 0 of 937 after the deploy). A
trajectory drawn across days that are 8% mis-dated is a trajectory of the
collector, not of the news. The time axis opened this week.

The second problem is **reach**. The only words a reader can touch are the ≤70
drawn on the canvas. A word the sieve cut cannot be confirmed to exist, and no
word in the archive can be looked up. Search is the way off the canvas and the
trajectory is what there is to see when you arrive — search alone lands on a
headline list, and a trajectory alone attaches only to the 70.

**Goal.** Clicking a word shows how it has moved over the collected days, and a
word that is not on screen can be found and shown the same thing.

## 2. What was measured before designing anything

Live database, **second run of two** in every case — this repo has already paid
once for reading a cold-cache first query as a signal.

| query | time | plan |
| --- | --- | --- |
| trajectory: `daily_word_counts` where `word = '폭염'` and `category_slug is null` | **5.7 ms / 8 rows** | bitmap scan on `headline_nouns_word_idx` |
| search: archive-wide `word like '김%'` | **316 ms** | **seq scan** of `headline_nouns`, 114,457 rows |
| search: same, restricted to one day | 20 ms | seq scan unchanged; only the join shrinks |
| search: build a 19,767-row word directory on the fly, then `%민석%` | 311 ms | ~300 ms to build, ~1 ms to filter |

Two conclusions, and they point opposite ways.

**The trajectory is already indexed.** `headline_nouns_word_idx` answers it
directly. No RPC, no new index, no migration.

**Search cannot be done without pre-building something.** `word like` uses no
index at any anchoring, so every search reads all 114,457 noun rows — and that
cost **grows with headline volume** (~1.3M rows at 90 days). Restricting to one
day does not help: the seq scan is the fixed cost and only the join to
`headlines` shrinks. A word directory grows with **vocabulary** instead, which
grows far more slowly — a new day is mostly words already present. Filtering
19,767 short strings is ~1 ms; the 300 ms is entirely the building, so the
directory has to be materialised rather than computed per query.

`pg_trgm` is not installed, and is not a candidate anyway: a 2–4 character
Korean word yields too few trigrams for a GIN index to discriminate.

## 3. Decisions

### 3.1 The trajectory lives in the headline panel, above the list

One sparkline in the panel that already opens on a word click. The question it
answers is **"is this word new today, or is it day three?"** No new screen, no
new route, no change to the URL grammar.

**Events get no trajectory.** Event identity across days is undefined here: the
Louvain partition is computed per day and `mergeCommunities` runs on one day's
edges. Nothing in this codebase can say yesterday's event and today's are the
same event, so nothing should draw a line between them.

### 3.2 The y axis is share, always across all six sections

This extends two rules `surge.ts` already established by measurement rather than
inventing new ones:

- **Shares, never raw counts.** Days run 691 to 4,218 headlines, so a count
  series draws the collector's depth and not the news.
- **Which tab is on screen decides what is *shown*, never what a word *did* that
  day.** The trajectory is day-wide whatever tab is active — the same rule the
  surge comparison follows and the sieve follows.

CLAUDE.md has already ruled on the regime boundary: 2026-08-07 changed the
collect cap from 150 to 300, days must not be compared across it on F1 — **"The
surge comparison is not [affected]: it divides by each day's own total, which is
exactly what a step change in depth needs."** The trajectory is the same
arithmetic and inherits that ruling.

What it does **not** inherit is protection from thinness. 2026-08-02 holds 691
headlines, so a share computed on it rests on few articles and is noisy. That is
stated in the caption, not hidden.

### 3.3 Search runs over a pre-built word directory, substring match

`%민석%` finds `김민석`. Archive-wide. Prefix-only matching was considered and
rejected: Korean puts the surname first so `김민` finds `김민석`, but `재명`
would never find `이재명`.

### 3.4 A search result does not move the date

The selected day stays. The panel opens on the current day, and **if the word is
not on that day's canvas the panel says so**. The trajectory is what tells the
reader which day to go to, so the navigation is theirs.

This costs almost nothing to build: `fetchHeadlinesForWord(date, category, word)`
already works for any word, drawn or not, and `?word=` already exists in the URL
state. Neither the `?word=` / `?event=` mutual exclusion nor the focus rules
move.

### 3.5 The collector refreshes the directory at the end of every run

Search is then current to the last run, and there is no state in which the
directory is empty or lagging by a day.

## 4. What gets built

### 4.1 Migration `0030_word_directory.sql`

```
word_directory  (materialised view)   word · total · days · last_date    ~19,767 rows
  unique index on (word)              -- required by refresh ... concurrently
  revoke all; grant select to anon, authenticated
refresh_word_directory()              -- security definer, set search_path = ''
  grant execute to service_role       -- never to anon
```

The columns: `total` is `count(*)` over that word's noun rows, `days` is
`count(distinct collected_date)`, `last_date` is `max(collected_date)`. All
three are read by the result row in §4.6 — `last_date` is there because ranking
by `total` alone puts a word that was large a week ago above one that is large
today, and the directory already knows which it is.

**Why `security definer`, and the care it needs.** `refresh materialized view`
is an owner-only operation; the migration runs as `postgres` and the Edge
Function connects as `service_role`. This function is not on the
`keyword_graph` chain and returns nothing, so it is not the case CLAUDE.md
forbids — a `SECURITY DEFINER` on that chain would hand out the service role's
view of the tables. It still takes `set search_path = ''`, and **execute is
granted to `service_role` alone**. Granted to `anon` it would let anyone queue
unbounded 300 ms refreshes.

**A materialised view has no RLS.** The access model here rests on RLS
select-only policies, and a matview cannot carry one, so the protection is the
grant and nothing else: `revoke all`, then `grant select`. This also adds a
fourth place the schema is encoded — CLAUDE.md's "the schema lives in three
places" becomes four.

### 4.2 Edge Function — `supabase/functions/collect-headlines/index.ts`

One `refresh_word_directory()` RPC after all six sections are stored.

- **Its failure is swallowed.** A directory refresh must not fail a collection
  run. It is reported in the response body as `directory: 'ok' | 'failed'` —
  the body is the only machine-readable channel out of this function, since the
  Management API answers 403 for `function_logs` and MCP `get_logs` returns
  request rows without console output.
- **It does not touch the CPU budget.** The limit that kills this function is
  accumulated CPU per worker; a refresh is database work the worker waits on,
  which is wall clock. `RUN_BUDGET_MS` accounting is unaffected at this size.

### 4.3 `src/lib/queries.ts`

- **No new function for the trajectory.** `fetchWordCountsFor(dates, words)`
  already issues `.in('collected_date', …).in('word', …).is('category_slug',
  null)`. Passing every collected date and one word returns one row per day — 8
  today. It already obeys the "name the words you want" rule and it is already
  behind `cachedQuery`.
- `searchWords(query)` — new. `word_directory`, `.ilike('word', '%q%')`,
  `.order('total', { ascending: false })`, `.limit(20)`, wrapped in
  `cachedQuery`.
  **`grep -c "= cachedQuery(" src/lib/queries.ts` goes 7 → 8.** CLAUDE.md's
  sentence naming that number must be fixed **by counting** — it has twice been
  incremented from a stale value instead.

### 4.4 `src/lib/history.ts` — new, pure

```
buildHistory(counts, headlinesByDate, { endDate, window })
  → { date, count, share, present }[]
```

- **The denominator is an argument.** `App.tsx` already holds `headlinesByDate`,
  derived from `collected_dates` where the number is `count(*)` grouped by day.
  Summing a response to get a denominator is structurally impossible here for
  the same reason `computeSurges` takes its total as an argument.
- **Share arithmetic exists once, in `src/lib/share.ts`.** `share = count /
  headlines` must not be written in both `surge.ts` and this file. It goes into
  a module of its own rather than into either — `history.ts` importing from
  `surge.ts` would make a trajectory depend on a day-over-day comparison it has
  nothing to do with, and the reverse is worse. `computeSurges` is refactored to
  call it, which its existing tests already cover. Same rule that stops
  `keyword_signals` being reimplemented in a script.
- **A day the word is absent from draws as zero, not as a gap.** A gap reads as
  "not collected". A day that genuinely was not collected has no point at all.
- **Window**: at most 14 collected days, ending at the selected date. All 8 are
  visible today, and the panel stays readable at 320px as the archive grows.

### 4.5 `src/components/WordHistory.tsx` — new

Inline SVG sparkline, above the headline list, **only when the subject is a
word** (never an event).

- **It follows the donut's precedent on honesty.** Every fact is stated in ink
  text beside it (`8일 중 8일 · 어제보다 +12%`), the svg is `aria-hidden`, and
  nothing carries meaning by colour alone.
- Existing tokens only; no new colour. Not the surge colour — this is not a
  surge marker, and that colour is held 40° clear of the six sections for a
  different job.
- Light and dark both.
- **Read the `dataviz` skill before writing the chart code.**

### 4.6 `src/components/WordSearch.tsx` — new

In the header beside `CategoryTabs`. Debounced. A result row states the word,
its total, the number of days it appeared on and the last of them. Selecting one
does `setSelectedEvent(null)` then `setSelectedWord(word)` — the same mutual
exclusion the canvas and event-list handlers already apply.

### 4.7 `src/components/HeadlinePanel.tsx`

Takes the history and a flag for "this word is not on today's canvas".
`App.tsx` decides the flag by testing `graph.nodes`.

## 5. Testing

**The gate is `npm run build`.** `npm test` alone passes on code that does not
compile.

- `history.test.ts` — absent days, a day with no denominator, the window
  boundary, a thin day, a word present on one day only.
- `queries.test.ts` — `searchWords`, with `clearQueryCache()` in the existing
  `beforeEach`.
- e2e (`e2e/support/mockSupabase.ts` gains a directory response and a
  trajectory response):
  - **Both are derived from `HEADLINE_COUNTS`**, never written out beside it.
    `COLLECTED_DATES` and `CATEGORY_SHARE` are already derived for this reason —
    a drifted copy describes a day that does not exist and makes the assertions
    describe it too.
  - **A default that varies by request must be a function, and `resolve()` must
    call it.** Returning the function serialises to `undefined`, which reaches
    the app as an empty result and reads exactly like "no data" — this is how
    the surge markers once silently never appeared.
  - A drawn word shows a sparkline.
  - A word that is not drawn, reached by search, opens the panel and shows the
    "not on this day's canvas" note.
  - **Bare `svg` / `svg path` selectors must not be re-poisoned.** The donut
    already made `svg path` stop meaning "an edge" and one `toHaveCount(1)` had
    been passing only in the frame before it existed. Existing selectors are
    checked and narrowed if the sparkline widens them.

## 6. Verification on the live project

1. `refresh_word_directory()` succeeds as `service_role` and fails as `anon`.
2. `anon` can select `word_directory`; insert/update/delete are refused.
3. The directory's row count equals `select count(distinct word) from
   headline_nouns`.
4. Search time on the directory is measured (second of two runs) and recorded
   beside the 316 ms in section 2.
5. After deploying the function, one run's response body carries
   `directory: 'ok'`, and a word first seen in that run is immediately findable.

## 7. What was considered and rejected

- **Prefix-only search on a `text_pattern_ops` index.** One migration line and
  nothing to refresh, but `재명` would never find `이재명`.
- **`pg_trgm`.** Not installed, and weak on 2–4 character Korean.
- **Jumping the date to the word's biggest day on a search hit.** It shows the
  story immediately, but it takes the reader's day away silently and changes the
  view wholesale; only Back returns it.
- **Sparklines in the search results themselves.** Friendliest, but the search
  response would have to carry a series per word, which is no longer "read a
  small directory once".
- **Mini sparklines on the canvas.** Directly against two recorded rulings — an
  edge is one neutral grey, and a word cloud already spends hue and size on
  every label. 70 sparklines would be a fourth layer.
- **A separate multi-day view.** Answers more (words rising and falling across
  the week) at the cost of a new URL grammar, routing and date model. Not now.

## 8. Not in this spec: re-measuring `head_pos` on fat days

Asked for in the same sitting. It belongs to a separate spec because it shares
no file and no verification method with the above — it is migrations and
`scripts/analysis/`, judged by the sieve harness, and mixing a frontend change
into that round would put an unmeasured variable inside a measurement.

The item is open because its stated reason collapsed. `head_pos` ships as a
demotion rather than a cut on the argument that "a tab draws at most 46 words,
the cap never binds, so a cut there is loss with nothing to fill the hole".
2026-08-03 puts 95 to 163 qualifying words on each of its six tabs against a cap
of 70; seven of the 24 cells bind. On a fat day a cut would substitute too.

**Its cost was measured and is mostly labelling.** The four eval days
(2026-07-31, 08-01, 08-02, 08-03) contain exactly one fat day, and one fat day
cannot answer a question about fat days. Adding one costs, day-wide:

| candidate | headlines | drawn | **unlabelled** |
| --- | --- | --- | --- |
| 2026-08-04 | 4,218 | 70 | **26** |
| 2026-08-05 | 3,077 | 70 | 22 |
| 2026-08-06 | 3,077 | 70 | 24 |
| 2026-08-07 | 2,949 | 70 | 21 |

plus the category-tab worklist (`21_unlabeled_category.sql`, which has returned
232 and 234 in past rounds). And 2026-08-07 is the collect-cap regime boundary,
so it is not F1-comparable with days before it — the recall denominator grows
while the screen stays at 70. **Which days may sit in one round is itself the
first question that spec has to answer**, and the labels will have moved again
by the time it starts, so it is designed then rather than now.
