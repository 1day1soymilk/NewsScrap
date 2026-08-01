# Sieve tuning

The thresholds in `scoring_weights` decide which words reach the screen. They were
fitted on a single day of news against labels that are one person's judgement, so
they are provisional by construction. This directory is how they get changed.

## The rule

**Run the harness first. Change a threshold only when the measurement improves.**

Not "when it looks better on screen" — the planning stage was fooled five separate
times by exactly that, and each of the rules below is one of those failures.

```bash
scripts/analysis/run.sh scripts/analysis/00_labels.sql       # once, to seed labels
scripts/analysis/run.sh scripts/analysis/10_sieve_eval.sql   # every time
```

`run.sh` goes through the Management API because this project has no local
Postgres — see CLAUDE.md. It needs `.env.supabase`.

## Five rules, each one a mistake already made

1. **Expand the labels before tuning, not after.** 25 labels gave AUC 0.929. The
   same formula on 160 labels gave 0.605. The small set was biased: it held the
   words that had been stared at during review, so the bad ones were too obvious.

2. **Sweep wide enough that the optimum is not at the edge of the range.** A
   weight capped at 2.0 put the optimum at 2.0 and reversed a verdict about χ².
   Widening the range to 20 flipped its contribution negative.

3. **Match the metric to the question.** AUC ranks one ordering, so it cannot
   compare sieves — a sieve is a filter, not a ranking. Precision and recall over
   the words actually drawn is the right measure, which is what `10_sieve_eval.sql`
   reports.

4. **Every word on screen must be labelled.** Rank inside a labelled subset and a
   tighter sieve looks better for free: labelled words get filtered out, unlabelled
   ones move up to fill the gap, and they are invisible to the metric. The harness
   prints `unlabeled` for this reason. **If it is not 0, throw the row away.**

5. **Never optimise precision alone.** Precision does not punish discarding good
   words, so maximising it converges on a degenerate answer: on 7/31 the
   highest-precision configuration (91.4%) dropped 폭염, the day's biggest story at
   45 headlines. The harness prints `recall_pct`, `f1_pct` and `heatwave` — a
   configuration reading `DROPPED` is rejected regardless of its precision.

## Labels

452 words, covering everything drawn by every configuration in
`02_sieve_configs.sql` and every variant in `11_category_eval.sql`, across
2026-07-31 and 2026-08-01. `20_unlabeled.sql` and `21_unlabeled_category.sql`
both return nothing, so rule 4 is satisfied.

**Rule 4 breaks when the data moves, not only when the sweep widens.** 2026-08-01
was collected twice — once by hand and once by the 13:00 KST cron, since the
150-per-category cap applies per run — and the day went from 873 headlines to
1,382 partway through a session. The harness immediately started reporting up to
13 unlabelled words per row. Re-run `20_unlabeled.sql` after any collection, not
just after editing `02_sieve_configs.sql`.

Only about 60 of them survive from the planning stage — those were recovered by
reading the plan document, because the 343 labels it cites lived in a chat
transcript and are gone. The rest were labelled here, which is why the absolute
percentages are not comparable to the ones in the plan: **the label set is
stricter**, so the same sieve scores lower. Compare configurations against each
other within one run, never against a figure quoted elsewhere.

Widening the sweep promotes deeper-ranked words onto the screen, so
**after any edit to `02_sieve_configs.sql`, re-run `20_unlabeled.sql` and label
what it finds before trusting the harness.** That happened three times here:
127 unlabelled words, then 68 more, then 27, then 3.

## Files

| File | Purpose |
| --- | --- |
| `run.sh` | Runs a `.sql` file against the deployed database and tabulates the result |
| `00_labels.sql` | Creates `analysis.word_labels`, seeds what the plan recorded |
| `01_labels_expansion.sql` | Labels for the words the first sweep drew |
| `02_sieve_configs.sql` | The configurations under comparison — read by both scripts below |
| `03_labels_wide_sweep.sql` | Labels the widened sweep exposed |
| `04_labels_round2.sql` | Labels the specificity-off round exposed |
| `05_labels_second_collection.sql` | Labels the second collection of 2026-08-01 exposed |
| `06_labels_category.sql` | Labels the category variants exposed |
| `10_sieve_eval.sql` | The harness: precision, recall, F1 and the 폭염 rank per configuration |
| `11_category_eval.sql` | The same for one category tab at a time |
| `20_unlabeled.sql` | Words on screen with no label — must be empty before the harness counts |
| `21_unlabeled_category.sql` | The same worklist for `11_category_eval.sql` |

## The category question, settled

The category tabs used to draw almost nothing — 생활/문화 showed 6 words on
2026-07-31, 경제 showed 8 on the first collection of 2026-08-01. Sieve 1 was the
only clause counting headlines *within* the filtered view while every other
signal was day-wide, so a word in three of the day's headlines split across two
sections was in neither section's graph.

`11_category_eval.sql` measured three ways to set that cut over six categories
and two days:

| sieve 1 counts | mean F1 |
| --- | --- |
| headlines in the category (before) | 40.4 |
| **headlines in the day** ← adopted, migration `0004` | **61.2** |
| headlines in the day, and at least 2 in the category | 50.7 |

Day-wide wins in all twelve cells rather than on average. Precision drops in some
of them — 세계 on 2026-07-31 goes 90.0 to 75.8 — while recall rises much further,
48.6 to 67.6, which is rule 5 doing its job.

A fourth option, lowering the per-category cut to 2, is **unmeasured**. Pricing
it under rule 4 costs 180 more labels, and a sample of what it draws is mostly
Naver's own column titles: 마켓프리즘, 디브리핑, 더차트, 급리포트,
데일리국제금융. Measure it before adopting it; the sample is a reason to
prioritise it low, not a result.

`analysis` is a separate schema, so none of this is reachable from the browser —
PostgREST only exposes `public`.
