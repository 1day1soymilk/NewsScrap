# Place gating, category-balanced ranking, a wider canvas and scattered words — design

2026-08-04. Four changes asked for together, split into two rounds because the
first moves the words on the canvas and the second measures the canvas.

## 1. What was asked

1. A place name (서울, 경기, 광주) should not reach the screen unless a line
   joins it to a word that names an event.
2. The word-cloud feel has gone. Keep the region format, but stop herding every
   edgeless word into a band at the bottom.
3. Widen the canvas, and raise the 70-word cap.
4. Collect the same number of articles per section, and disclose the real
   proportion with a pie chart — estimated from how much extra searching each
   section needed.

## 2. What was measured before designing anything

Two measurements decided the shape of this.

### 2.1 Collection cannot be equalised by paging deeper

The section list is paginated in time order, so the natural reading of request 4
is "page further for the thin sections until they match". That does not work,
and the reason is visible in one run. On 2026-08-04 at 07:00 KST each section's
150-headline window was scraped and what came back **new** was:

| section | new rows |
| --- | --- |
| society | 99 |
| economy | 83 |
| world | 54 |
| politics | 44 |
| culture | 31 |
| **it** | **24** |

**Nobody reached the 150 cap.** The window already reaches back past the point
where the articles are ones we hold, so paging deeper returns articles that are
already stored — or, worse, articles from before the archive, which would be
written with today's `collected_date`. IT publishes 24 articles in four hours;
there is no depth at which that becomes society's 99.

Day totals follow from that rather than from any cap:

| date | society | economy | politics | world | culture | it |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-04 | 282 | 265 | 226 | 218 | 157 | **96** |
| 2026-08-03 | 453 | 445 | 372 | 305 | 313 | 309 |
| 2026-08-01 | 257 | 207 | 210 | 201 | 167 | **102** |

**So the balancing moves from collection to ranking**, and the pie chart keeps
its job unchanged — it discloses the real proportion, which is exactly what
those numbers are.

The cap does bind after a gap: on 2026-08-03 at 07:00 all six sections stored
exactly 150. That is missed news, and recovering it is a separate question from
balance (§3.4).

### 2.2 The cap can only rise on thick days

Words clearing the shipped sieve, counted per day:

| date | headlines | qualifying words |
| --- | --- | --- |
| 2026-07-31 | 899 | 116 |
| 2026-08-01 | 1,144 | 108 |
| 2026-08-02 | 691 | **69** |
| 2026-08-03 | 2,197 | 260 |
| 2026-08-04 | 1,244 | 130 |

2026-08-02 cannot fill 70 places, let alone 100. Raising `render_cap` is
therefore a change that does nothing on a thin day and a lot on a thick one, and
the harness has to price it that way rather than on an average.

### 2.3 The place rule bites, and it keeps the right words

Run against 2026-08-04's drawn 70:

| word | df | degree | edges |
| --- | --- | --- | --- |
| 강남 | 7 | 0 | — |
| 대구 | 7 | 0 | — |
| 전남 | 6 | 0 | — |
| 인천 | 5 | 0 | — |
| 경기 | 9 | 1 | 서울 |
| 광주 | 7 | 1 | 서울 |
| 부산 | 7 | 2 | 돌려차기, 대통령님 |
| 서울 | 48 | 3 | 극한폭염, 경기, 광주 |
| 호남 | 13 | 3 | 김민석, 정청래, 송영길 |

Under "a place needs an edge to a **non-place**", six words leave and three
stay. 서울 survives on 극한폭염 alone — its other two edges are to places.

## 3. Design

### 3.1 Place gating

`word_overrides` gains a fourth mode, `'place'`, beside `exclude` / `demote` /
`allow`. Hand-maintained, like the rest of that table.

**The list holds domestic administrative names and broad regions only**: the 17
시·도, major 시·군·구, and 호남 · 충청 · 영남 · 수도권 · 강남. Countries and
foreign regions are out of scope — 유럽, 남미, 중동 and 한국 are already
`exclude` entries from migration `0021` and stay that way.

**경기 is deliberately not on the list.** 경기도 and 경기(match, or 景氣) are the
same string, so gating it would cut a word that is usually not a place at all.
It is the general case of what this list cannot hold: a place name that is also
an ordinary noun.

The node selection in `keyword_graph` becomes a **fixed point**:

> The drawn set is the top `render_cap` by rank, minus every `place` word
> holding no edge (`cooc >= edge_min_cooc`, `npmi >= edge_min_npmi`) to a drawn
> **non-place** word. Removing one promotes the next rank, so repeat until
> nothing more is removed.

One pass is not enough: a promoted word can be the only partner of another
place, and a demoted place can have been the only partner of a third. The loop
is bounded so it terminates, and the ranking is deterministic so the result is.

Shipped **off** — `place_needs_edge` = 0 in `scoring_weights` — exactly as
migration `0017` wired `min_proper` at 9.9 and `0018` turned it on. The check on
deployment is that the drawn words do not move at all.

### 3.2 Category-balanced ranking

Rank on **what the word's frequency would have been if every section had been
collected to the same depth**:

```
df_balanced(α) = Σ_c  df_c × (N̄ / N_c)^α
```

where `df_c` is the word's headline count inside section `c`, `N_c` that
section's headline count for the day, and `N̄` the day's mean over the six.

Three properties decided this form over `df / N_(top category)`:

- **It is the estimator request 4 actually asked for.** At α = 1 it is the count
  under equal collection, which is what the pie chart's proportions describe.
- **It protects a story that spans sections.** 폭염's top category is society —
  the largest section — so a single denominator would charge it the largest
  divisor and put rule 5 (never drop the day's biggest story) directly at risk.
  A word spread across sections gets a blend of large and small denominators
  instead.
- **α = 0 is the identity**, so the shipped configuration enters the sweep as its
  own control.

`df_balanced` is added to `keyword_signals`, which stays the single copy of every
signal formula — `keyword_graph` and `scripts/analysis/` both read it there. The
return type changes, so the function is dropped and recreated, as `0017` noted.
`ranked` orders by the head_pos demotion, then `df_balanced desc`, then
`count desc`, then the word.

**Size is untouched** and stays proportional to the raw headline count. This is
the `head_pos` demotion's shape: disturb the order, never the size.

**The implementation check is free.** Inside one category the denominator is a
constant multiple, so the ranking is mathematically unchanged. `11_category_eval.sql`
must not move by a digit; if it moves, the implementation is wrong.

α is `category_balance_alpha` in `scoring_weights`, shipped at 0, swept over
{0, 0.25, 0.5, 0.75, 1.0}.

### 3.3 The cap

`render_cap` and `node_limit` rise together, keeping them equal so `faded`
continues to mean a `demote` entry and nothing else (migration `0006`). The value
comes out of the harness over {70, 85, 100, 130}.

Ranks 71–130 hold no labels, so **240-odd words across the four evaluation days
must be labelled first** (rule 4). Labelling to 130 in one pass makes all four
caps comparable in a single run.

### 3.4 Collection

No equalisation. Two things do change:

- `MAX_HEADLINES_PER_CATEGORY` and `MAX_LIST_PAGES` are re-tested, because the
  cap binds after a gap and that is news being missed. `index.ts` already carries
  the note that the 300-over-12-pages failure was misread as a wall-clock wall
  when it was CPU.
- Judged on **CPU**, not the wall clock: `elapsedMs` in the response and
  `CPU Time exceeded` in the function log. A killed run returns no body, so the
  `CHK` lines are the only evidence.

### 3.5 Scattering the edgeless words

Today `flowRows` sends all 23–28 of them to a band under the packed regions. The
replacement is the user's own formulation, and the material for it is already in
the file:

> Place a word where its label box **(a)** overlaps no placed label and **(b)**
> contains no sampled point of any edge curve, plus `LABEL_CLEARANCE`. Inside a
> region or outside it, indifferently.

- **The order matters.** Edges are routed first, and the resulting curves are
  obstacles for the words. Nothing is re-routed, so every curve's `clear` verdict
  stays true and **`crowded` cannot rise** — the exact failure that sank the old
  inner-ring placement becomes an invariant here.
- Curve sampling reuses `intrusion()`'s existing 32-point walk. No second copy.
- Candidate positions come from a grid scan with a uniform-bucket index over the
  obstacles. Largest word first; among passing candidates take the one whose
  **minimum distance to any placed label is greatest**. That is what "scatter
  evenly" means arithmetically, and it is deterministic.
- Whatever does not fit falls back to the band. On a phone there is little slack,
  so most will — an acceptable degradation rather than a special case.
- Landing inside a region is allowed. `measure.ts` gains an `inRegion` column so
  the decision to keep allowing it is taken on four days of numbers.

`graphLayout.test.ts` asserts the invariant directly: no scattered label box
contains a sampled point of any curve; `overlap` stays 0; regions still do not
overlap.

### 3.6 Canvas width

The graph area alone widens; the masthead, the event list and the header keep
`max-w-6xl`, because prose has no reason to grow a longer measure.

CLAUDE.md's "widening buys nothing" is about spreading words sideways **within**
a container — the SVG is drawn at its cropped size and scaled by `max-w-full`, so
that is true and stays true. Growing the container is a different act: the layout
runs at a larger width and is scaled down less. It also creates the slack §3.5
needs, so the two changes help each other.

### 3.7 The pie chart

A view `daily_category_counts (date, slug, headlines, capped)`, read **filtered
by date** — six rows a day reaches PostgREST's 1,000-row cap in 166 days
otherwise. `capped` is true when any run that day stored exactly
`MAX_HEADLINES_PER_CATEGORY` for that section, which makes its share a lower
bound; a pie that cannot say so is not worth drawing.

`fetchCategoryShare(date)` goes through `queryCache` like the other five.
`CategoryShare.tsx` reads its colours from `sectionColors.ts` and nowhere else —
the tab row and the canvas already share that one definition and a third copy is
how the palette drifted before. Drawn on the all-categories view only.

## 4. Order, and why

Data first, canvas second.

The sieve decides which words are drawn, and edges exist only between drawn
words, so changing the sieve changes the edge set too. `scripts/layout/graphDays.json`
is a copy of `keyword_graph`'s output; every layout number measured against a
stale fixture is measuring a screen the app does not draw. Migration `0007`
recorded that trap once already.

So: round 1 lands and is measured through `scripts/analysis/`, the fixture is
re-pulled, and only then does round 2 start with a fresh `measure.ts` baseline.

## 5. Risks

- **Place gating is a cut.** Cuts have a signature in this repository: a day-wide
  win with a category loss means the mechanism needs the render cap to be
  binding. If `11_category_eval.sql` loses cells while `10_sieve_eval.sql` wins,
  the answer is to make it a demotion, not to move a threshold. Rounds five and
  six are the precedent.
- **α could sink 폭염.** It is on an `allow` entry and is the day's biggest story
  on three of four days. `story_rank` is checked on every row.
- **The deep ranks are unlabelled and will lower every percentage** the moment
  they are labelled, whatever the change did. Round eight is the precedent, and
  the defence is the same: compare configurations inside one run, never against a
  number written down earlier.
- **Scattering inside regions may make a region unreadable** even with the lines
  respected. `inRegion` is measured for exactly this, and closing it is one
  condition.
