# The `standalone` cut — plan

Spec: `docs/superpowers/specs/2026-08-03-standalone-cut-design.md`.
Executed 2026-08-03. Recorded with outcomes, because the value of this file is
the recipe for the next round rather than the intent of this one.

## Task 1 — name the days once

`scripts/analysis/12_eval_days.sql` creates `analysis.eval_days (d, top_story)`
and seeds the four collected days with their biggest word: 폭염, 폭염, 김민석,
폭염. Replace the `params (d) as (values …)` block in `10_sieve_eval.sql`,
`11_category_eval.sql`, `20_unlabeled.sql` and `21_unlabeled_category.sql` with
`params as (select d from analysis.eval_days)`, and turn `10`'s hardcoded
`heatwave` into `story` / `story_rank` joined from the table.

**Done.** Apply this file before any of the four; all of them read it.

## Task 2 — scope the round

Add `active boolean not null default false` to `analysis.sieve_configs`, add
round four (ords 90–95: standalone off, .05, .20, .30, .50, and off-with-no-dict,
everything else at shipped config 60's values), and mark 60 and 90–95 active.
`10_sieve_eval.sql` and `20_unlabeled.sql` both gain `where c.active`.

**Done.** 7 of 60 configurations active. Without this the worklist returned 187
words instead of 71, all the extra ones needed only by configurations sweeping
clauses that migrations `0003` and `0009` already turned off.

## Task 3 — labels

Run both worklists, propose a label and a one-line justification for every word,
name the precedent each follows, stop for review, apply only what survives it,
re-run both worklists until empty.

**Done.** 138 words from the two worklists, plus 특별감찰 which only appeared once
task 4's standalone variants were added to `11`/`21` — 139 in
`09_labels_four_days.sql`. Five reversed on review: 윤리위, 반도체 and 李대통령 to
good, 여의도 and 형사사법체계 to bad. Label set 467 → 606.

Two rulings decided the round: 골리앗 is bad (four of its five headlines are the
same book in a book-review column, and 북리뷰 and 저주 were already bad) and
자국민 is bad (following 국민).

## Task 4 — measure

`10_sieve_eval.sql` over four days × seven configurations, then
`11_category_eval.sql` — which needed the standalone question added to it first,
since it swept sieve 1 only and held `min_standalone` at the shipped value.
Moving sieve 2 out of `day_pass` and into the variant list (`min_sa`, null
meaning "whatever ships") is the whole change.

**Done, both `unlab` 0 throughout.** Baseline wins on both harnesses. Numbers are
in the spec's section 7.

While editing `11` its variant 1 was found labelled `(ships)`, which migration
`0004` made false — it is the pre-`0004` cut. Corrected to
`sieve1 scoped >= 3 (pre-0004)`, and the day-wide variant now says `(ships)`.

## Task 5 — record

`scripts/analysis/README.md` gains a "The `standalone` blind spot, measured and
closed" section replacing the stale claim, the four-day re-measurement of the
category question (61.2 → 63.4), the new label count and file list, and the
`李대통령` defect. `CLAUDE.md` gains the verdict, the "do not build a
particle-aware variant" instruction, and the defect beside the canonical-link
invariant it resembles.

**Done.**

## Not done, on purpose

- **The particle-aware signal.** Spec section 4.4, conditional on the
  measurement, which came back the other way.
- **The `李대통령` U+F7A1 split.** Recorded, not fixed: it needs NFC
  normalisation in `lib/nouns.ts` plus a backfill, and nothing measured here
  depends on it.
- **Any threshold change.** The round's output is that the deployed value is
  right, which is a result rather than a non-event.

## Running the next round

```bash
scripts/analysis/run.sh scripts/analysis/12_eval_days.sql      # days change? edit first
scripts/analysis/run.sh scripts/analysis/02_sieve_configs.sql  # then set `active`
scripts/analysis/run.sh scripts/analysis/20_unlabeled.sql      # must be empty
scripts/analysis/run.sh scripts/analysis/21_unlabeled_category.sql
scripts/analysis/run.sh scripts/analysis/10_sieve_eval.sql
scripts/analysis/run.sh scripts/analysis/11_category_eval.sql
```
