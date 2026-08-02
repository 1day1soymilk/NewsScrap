# Headline counts on the date list, and an expandable event list

Date: 2026-08-03
Branch: `canonical-links`

## Why

Two unrelated things, small enough to ship together, both of which follow from
work already on this branch.

**The day's headline total is fetched twice per view and it is already in the
database.** `fetchHeadlineCount(date)` is a `HEAD … count=exact` request, and
the surge comparison needs two of them — today's and the previous collected
day's — as the denominators that make two days comparable. Meanwhile
`fetchAvailableDates` reads `collected_dates`, a view that is one row per
collected day and could carry that count itself. Measured on a cold load, the
app issues 9 requests; two of them are those HEADs. The response cache took
repeat visits to zero, so what is left to remove is the first visit to a day.

**Two thirds of the day's events are not on screen.** The list shows five;
after merging, a day holds 14 to 17. The `pinned` option added earlier already
appends one out-of-rank event when a clicked word belongs to it, so the list is
already a variable-length thing — a reader who wants the rest has no way to ask
for it.

## Part 1 — `collected_dates` carries `headline_count`

### The migration

```sql
create or replace view collected_dates with (security_invoker = on) as
select collected_date, count(*)::bigint as headline_count
from headlines
group by collected_date;
```

`create or replace view` may only append columns, never rename, reorder or drop
them, and `collected_date` stays first — so it is accepted, and every existing
`select('collected_date')` keeps working unchanged. It replaces the view in
place rather than dropping it, so the `grant select … to anon, authenticated`
from `0001_init_schema.sql` and the `security_invoker = on` setting both
survive. Rolling back is one more `create or replace` with the old body.

`count(*)` grouped by `collected_date` is exactly what `fetchHeadlineCount`
counts today: every headline of that day, across all six sections, with no
category filter. This is not the forbidden pattern of summing a response to get
a denominator — Postgres computes the count and returns it as a number.

### The frontend

- `fetchAvailableDates` becomes `fetchCollectedDates`, returning
  `{ date: string; headlines: number }[]`, newest first.
- `App.tsx` derives `availableDates` (a `string[]`, for `adjacentDate` and the
  masthead's min/max) and `headlinesByDate` (a `Map<string, number>`) from it.
- The surge effect reads the map instead of issuing two `fetchHeadlineCount`
  calls.

### The truncation guard

The view is one row per collected day, so PostgREST's 1,000-row cap is roughly
2.7 years away — and `fetchAvailableDates` already carries exactly that exposure
for the date list itself. It is still guarded, because a silently truncated
denominator is the specific failure this codebase has already paid for once:

**a date missing from the map falls back to `fetchHeadlineCount(date)`.** Being
truncated then costs one request rather than producing a wrong ratio, and
`fetchHeadlineCount` keeps both its reason to exist and its tests.

## Part 2 — Expanding the event list

The cut stays in `src/lib/events.ts`; `EventList` stays presentational.

- `App.tsx` holds `expanded` state and passes
  `{ limit: expanded ? Infinity : DEFAULT_LIMIT, pinned }` to `topEvents`. When
  expanded every event is present, so pinning becomes a no-op by construction
  rather than by a branch.
- `EventList` gains `total` (how many events the day holds), `expanded` and
  `onToggle`, and renders one trailing row: `더 보기 10개` when collapsed with
  more to show, `접기` when expanded. It carries `aria-expanded`. When the day
  holds no more than the collapsed limit, no toggle is rendered at all.
- **Changing the day or the category collapses the list again.** Event counts
  differ per day, so an expanded list carried across a change leaves the page
  at the previous day's height with a different day's content.
- **The expansion is not in the URL.** It is not a shareable claim about the
  data, and the query string already carries a mutual-exclusion rule between
  `?word=` and `?event=` that a third axis would only complicate.

The dimming rule from the canvas→list highlight is unchanged: with 15 rows and
one lit event, 14 rows recede. That is the same statement the collapsed list
makes, only longer.

## Verification

- `src/lib/events.test.ts` — `topEvents` with no limit returns every event, in
  rank order, with `pinned` adding nothing.
- `src/components/EventList.test.tsx` — the toggle appears only when the day
  holds more than is shown, carries `aria-expanded`, and calls `onToggle`.
- `src/lib/queries.test.ts` — `fetchCollectedDates` maps rows to
  `{ date, headlines }`; the surge path falls back to `fetchHeadlineCount` for a
  date the map does not hold.
- `e2e/eventList.spec.ts` — expanding shows rows that were not there, and
  switching category collapses it again.
- After deploying the migration, re-run the request count that measured 9 on a
  cold load and confirm 7.
- Full gate: `npm run build`, `npm test`, `npm run test:e2e`, `npm run lint`.

## Out of scope

- Event-level surge markers (needs the previous day's partition).
- Keyboard date stepping.
- Any change to thresholds, the dictionary or the sieve, so
  `scripts/analysis/10_sieve_eval.sql` is not involved.
- The branch's existing blocker — the canonical-link duplicate check after the
  07:00 KST cron — is untouched and still gates the merge.
