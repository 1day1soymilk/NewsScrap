# The collector, measured

`CLAUDE.md` carries the rules this function is written to. This file carries the
measurements those rules came from — the same split as `scripts/analysis/README.md`
and `scripts/layout/README.md`, and for the same reason: a rule stops a mistake
without being read in full, a table is what you open when you are about to move
the thing it prices.

Every number here is from the live project, and each is dated because the
collector's own regime has changed three times inside this archive (six runs a
day, then `collect_cap` 150 → 300, then twelve runs a day).

## The morning is thin because the news is not written yet

Measured 2026-08-08 against the live archive, three cron-only days (08-05 /
08-06 / 08-07). `pool` is the words with `df >= 3` — the set the render cap of 70
picks from — counted using only the rows stored up to that hour:

| KST | headlines so far | pool |
| --- | --- | --- |
| 03:00 | 198 / 209 / 237 | **59 / 81 / 74** |
| 07:00 | 592 / 572 / 587 | 269 / 284 / 269 |
| 11:00 | 1224 / 1196 / 1160 | 662 / 670 / 646 |
| day's end | 3077 / 3077 / 3317 | 1640 / 1670 / 1836 |

**At 03:00 the pool is smaller than the render cap.** The canvas cannot fill,
and no cap raise or extra page can change that — the 08-05 table above already
says not one section publishes 150 articles before 07:00. This is not a
collection failure and there is nothing here to fix; it is why the *frontend*
opens on an earlier day when today is still thin (`src/lib/openingDate.ts`).

New rows per run, same days, which is what the schedule was chosen against:

| KST | 03 | 07 | 11 | 15 | 19 | 23 | 23–24 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 08-05 | 198 | 394 | 632 | 703 | 717 | 433 | **lost** |
| 08-06 | 209 | 363 | 624 | 738 | 736 | 407 | **lost** |

**The screen lagged publication by up to four hours, worst exactly where the day
grows fastest** — at 10:59 a reader saw the 07:00 state while the day had gone
from 592 to 1,224. Hence twelve runs: 03, then every two hours to 23, plus 23:50
for the band the day boundary was eating (each day's last row was 23:00:07;
~100 articles a day were never collected at all).

**That makes 2026-08-08 a third regime boundary.** Denser sampling catches
articles that fell past rank 300 between two four-hour runs, so day totals rise
and days must not be compared across it on thickness-sensitive numbers. The five
labelled eval days all predate it.

## One cap cannot serve both ends of the day

`collected_date` is the day of *collection*, and a deeper page is an older
article, so a scrape window wider than the day's own news files yesterday's
articles under today's date. That was assumed to be the cost of raising
`collect_cap`. It was not: **it was already happening at 150, by more than anyone
had counted.**

Every row stored under 2026-08-05 was classified against the live section lists
at 12:30 KST that day, after three runs: 1,224 rows, **129 of them published
before that day**, and a further 88 sitting deeper than a 1,620-article scrape
could reach and so almost certainly older still. **80 of the 129 came from the
03:00 run.**

**The 03:00 and 07:00 regime is measurable without waiting for it**, which is
what turned a standing "cannot be provoked on demand" into a measurement. The
section list is ordered by publication time, so *articles published between
midnight and T* is exactly the rank at which a run starting at T crosses into
yesterday. Counted at 12:30 KST on 2026-08-05:

| section | published by 03:00 | by 07:00 | today by 11:00 |
| --- | --- | --- | --- |
| politics | 17 | 50 | 140 |
| economy | 24 | 120 | 589 |
| society | 42 | 136 | 533 |
| culture | 15 | 52 | 131 |
| world | 15 | 75 | 167 |
| `it` | 1 | 23 | 81 |

**Not one section reaches 150 before 07:00.** At 03:00 a 150-headline window
spends 133 of its 150 slots on yesterday in politics and 149 in `it`. What kept
the damage to 129 rows is only that most of those articles were already held:
`UNIQUE (category_id, link)` is **global rather than per-date**, so a yesterday
article yesterday collected cannot be re-stamped. The 129 are the ones that fell
in a coverage hole.

**The other end of the day says the opposite thing about the same number, and
that is the finding.** Of the articles published on 2026-08-05 before the 11:00
run, **42.9% were never collected at all** — 704 of 1,641, 61% of economy and 53%
of society. Every one of those holes sits between 07:00 and 11:00 and **none at
all between midnight and 05:00**. So 150 is simultaneously far too wide for the
thin hours and less than half of what the busy ones need.

**The boundary stop is what lets one number stop being asked to do both**: in the
thin hours it stops the scrape early, in the busy hours it never fires, so the cap
is free to rise for the case that actually wants it. Verified against live markup
with the shipped parser at cap 300: economy and society stop on the cap, the other
four stop on the boundary.

What the 11:00 run of 2026-08-05 would newly have stored, boundary stop on:

| cap | 150 | 200 | 300 | 450 | 600 |
| --- | --- | --- | --- | --- | --- |
| new rows | 126 | 228 | 426 | 680 | 704 |

**300 is deliberately not the top of that column.** 450 puts a cold all-new run at
~2,700 headlines against the 2,630 that is the deepest anything here has been
measured at, and the worker's CPU budget is cumulative rather than per request.

## Both halves verified live, 2026-08-07

A before/after inside one day rather than a claim. Every row stored under
2026-08-07 was classified against the section lists scraped past the boundary, one
method for both groups:

| | rows | published today | **published another day** | |
| --- | --- | --- | --- | --- |
| the day's four crons, old code | 1,821 | 1,545 | **141** | **8.4%** |
| two runs after the deploy | 937 | 881 | **0** | **0.0%** |

The cap raise showed its own effect within six minutes: a cap-300 run made
directly after a cap-150 run — with the 150-window's 150 economy and 148 society
rows already stored — still found **125 new economy and 157 new society** rows at
ranks 151–300. That is the 07:00-to-11:00 hole, filled while being watched.

That run returned 200 in 6.5 s. `culture` stopped at 236 headlines and `it` at 182
with 18 and 5 off-day — the boundary stop firing in the two thin sections while
the four fast ones took the full 300, the design working in both directions inside
one response.

**2026-08-07 is therefore a collection-regime boundary and days must not be
compared across it.** A day collected at 300 is roughly half as deep again as one
collected at 150, and F1 is not comparable across days of different thickness (the
recall denominator grows while the screen stays at 70). The four labelled
evaluation days all predate it. The surge comparison is unaffected: it divides by
each day's own total, which is exactly what a step change in depth needs.

## What the boundary stop costs

Those ~129 rows a day are genuine articles, and they are now not collected at all
rather than collected under the wrong date. That is the right trade — yesterday's
holes, against 426 correctly dated rows arriving in their place — but it **is** a
trade.

Stamping rows by publication date instead would keep them, at the cost of a closed
day's totals changing afterwards, which invalidates every measurement taken
against that day and is exactly the hazard rule 4 exists for. **Not done.**

## Where the date comes from

**The thumbnail path, not the visible timestamp** —
`/image/origin/{press}/2026/08/05/…`. The visible one is relative ("2시간전",
"1일전"), so it needs a clock and a time zone to become a date, it is hour-grained,
and past a day it stops resolving at all: three ways to be wrong about precisely
the articles the field exists to identify. The thumbnail path is a pure function
of the HTML, which is also what keeps `lib/headlines.ts` testable without a clock.

Coverage is **99.7%** over 676 items, and a missing date **keeps** the article —
the same fail-open choice `canonicalLink` makes.

**The per-article date and the paging stop are separate mechanisms, and page 1 is
why.** A section's first page opens with a curated headline block that is *not* in
publication order: at 12:30 KST on 2026-08-05, politics had three 08-04 articles
inside its first 46 under a cursor still stamped 08-05. A rule that stopped at the
first old article would have cut that page off at rank 3. So `cursorIsBefore` stops
the *paging* once a whole page's oldest article predates the day, and `published`
filters *within* every page, including that one.

**It was checked twice, and the second check is the one that matters.**

- Against the page cursor: over 30 pages of three sections, not one article
  carried a thumbnail date older than its own page's cursor stamp.
- **Against the articles themselves**, which is the only thing that can establish
  this is a *publication* date rather than merely a self-consistent one. The twelve
  politics articles straddling the 2026-08-05 boundary, six each side, were fetched
  and their own timestamps read: **12 agree, 0 disagree**, with the flip in the
  list falling exactly where the articles put it. Agreeing with the cursor would
  have been satisfied by any date the same pipeline stamped on both.

## Deeper paging widens the section gap rather than closing it

The 2026-08-05 recovery above is 359 economy and 285 society against 11 culture,
9 world and 11 `it`.

**Collection cannot be equalised by paging deeper**, and that is why balance was
attempted in the ranking instead. 2026-08-04, counted per run: society took the
whole 150-headline window on both the 11:00 and the 15:00 run while `it` never
passed 98 on any of the five. **The thin section is not being truncated — it
publishes less** — so a deeper page adds rows where there are already rows.
Migration `0025` took the balance into the ranking (`df_balanced`), and round
fourteen then measured that it cannot be priced on the day set the archive has;
see `scripts/analysis/README.md`.

## Raising the cap does not cost CPU — that was diagnosed wrong twice

The 300-over-12-pages failure was first blamed on a wall near 63 s, then on this
function's own CPU cost. A throwaway probe that scrapes and analyses exactly as
`index.ts` does and writes nothing, run 2026-08-04, gives the **all-new** case a
live run cannot be made to take on demand:

| cap | headlines | analysis | wall | result |
| --- | --- | --- | --- | --- |
| 150 | 900 | 816 ms | 2.0 s | 200 |
| 300 | 1,800 | 1,481 ms | 4.2 s | 200 |
| 441 | 2,630 | 2,082 ms | 5.3 s | 200 |

What does kill the function is **cumulative CPU per worker**, which is why the
same call can pass on a fresh worker and return 546 on a warm one. Measured the
same day: a cap-441 scrape-and-analyse of 2,630 headlines returns 200 on a fresh
worker and 546 as a later call on a warm one, and the analyser probe's ladder
(`reps=1` 200, then `reps=2,3,5,7,10,40` all 546) is that artefact in call order
rather than a size limit. **A 546 is evidence about the worker, not about the
run.**
