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

## The dictionary is measured too

`word_overrides` is not a threshold, so it is not gated the way `scoring_weights`
is — but it changes what reaches the screen, so it gets measured all the same.
Twenty-six entries added in migration `0005`, chosen from the 61 labelled-bad
words that clear the shipped sieve rather than from whatever looked wrong on
screen:

| | before | after |
| --- | --- | --- |
| top-70 precision, 2026-07-31 | 71.4 | **84.3** |
| top-70 precision, 2026-08-01 | 65.7 | **75.7** |
| top-70 F1, 2026-07-31 | 59.9 | **70.7** |
| top-70 F1, 2026-08-01 | 49.2 | **56.7** |
| category mean F1 | 61.2 | **67.7** |

폭염 stays first on both days, and all twelve category cells improve. Recall is
unchanged in every one of them, which is the expected shape: removing bad words
cannot lose good ones.

Rule 4 fired again here, and from a third cause — not a widened sweep, not a new
collection, but the dictionary itself. Taking 26 words off the screen pulled 7
deeper ones up to fill the gap, and all 7 turned out to be bad. **The exclusions
removed 26 bad words and the screen refilled with 7 more**, so the gain is real
but smaller than the entry count suggests. Expect this every time: an exclusion
does not empty a slot, it promotes whatever was next.

Thirty-five of the 61 candidates were left in on purpose. 공습, 압박, 배터리,
클라우드, 바이오, 휴머노이드, 부동산 and 아파트 can each head a real story, and
excluding them would be using the dictionary to paper over where the good-word
line sits — which is a labelling question, not a dictionary one.

## Labels

459 words, covering everything drawn by every configuration in
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
| `07_labels_dictionary.sql` | Labels the `0005` dictionary additions promoted |
| `10_sieve_eval.sql` | The harness: precision, recall, F1 and the 폭염 rank per configuration |
| `11_category_eval.sql` | The same for one category tab at a time |
| `20_unlabeled.sql` | Words on screen with no label — must be empty before the harness counts |
| `21_unlabeled_category.sql` | The same worklist for `11_category_eval.sql` |
| `30_word_scores.sql` | One day's words with every signal and the sieve's verdict beside each |
| `31_fragments.sql` | Words that look like pieces of longer words, with the longer word beside them |

## The two dumps are diagnostics, not evidence

`10_sieve_eval.sql` answers "is this configuration better than that one" and is
the only thing that may move a threshold. `30_word_scores.sql` and
`31_fragments.sql` answer the different question of **why a particular word is
on screen or missing from it**, for the shipped configuration on one day.

Reading a dump of one day and adjusting a threshold because a word in it looks
wrong is precisely the habit rule 3 and rule 5 exist to stop. Use them to find
out what is happening; use the harness to decide whether to change anything.

`30_word_scores.sql` carries a `chk` column, and it is there for the same reason
the harness carries `unlabeled`. The file has to work out the `cut: …` reasons
itself, because `keyword_graph` returns the survivors and says nothing about the
rest — so that second copy of the sieve is cross-checked against the RPC's own
node list on every row. **Any `!` means the dump has drifted from the shipped
sieve and its verdicts are worthless.** It caught a real drift on the first run:
`ov.mode = 'allow'` is null for the words with no override, `false or null` is
null, and 이란 — the day's second most frequent word — was reported as merely
outranked when sieve 4 had cut it. Migration `0003` warns about this exact null
in its `faded` flag; it still happened.

## What the fragment report found, 2026-08-01

The compound-noun merge in `lib/nouns.ts` glues adjacent `NNG`/`NNP`/`SL`/`SH`/
`SN` morphemes inside one eojeol, and its own comment cites 반도체 as the case it
restores. It does not: 반도체 appears nowhere in the archive on either collected
day, while 도체 appears 17 and 29 times. Asking ETRI directly says why —

| written | ETRI returns | kept |
| --- | --- | --- |
| 반도체 | 반/**XPN** + 도체/NNG | 도체 |
| 무인기 | 무인/NNG + 기/**XSN** | 무인 |
| 상한가 | 상한/NNG + 가/**XSN** | 상한 |
| 유조선 | 유조/NNG + 선/**XSN** | 유조 |
| 특별감찰관 | 특별/NNG + 감찰/NNG + 관/**XSN** | 특별감찰 |
| 형소법 | 형소/NNG + 법/NNG | 형소법 |

Prefixes (`XPN`) and noun-forming suffixes (`XSN`) are not in `MERGEABLE_TYPES`,
so the run breaks at them. `형소법` merges because both halves are `NNG`, which is
why it is the one of the six that reaches the screen.

**The archive spans the merge's deploy, and only the last of three runs is on the
current side of it.** `created_at` splits it into 2026-07-31 16:00 KST (900
headlines), 2026-08-01 08:00 (873, the manual run) and 2026-08-01 13:00 (509, the
cron), and the words fall either side of the last boundary exactly:

| | 07-31 16:00 | 08-01 08:00 | 08-01 13:00 |
| --- | --- | --- | --- |
| 형소 / 형소법 | 6 / – | 14 / – | – / 9 |
| 소리 / 목소리 | 4 / – | 2 / – | – / 2 |
| 검찰 / 검찰개혁 | 6 / – | 13 / – | 3 / 2 |
| 도체 | 17 | 16 | 13 |

So 1,773 of the 2,282 archived headlines were analysed by the pre-merge function
and 509 by the current one, and a word can be a fragment in one row and whole in
the next — the duplicate title `“검찰개혁 끝내 완성”… 여권, 형소법 통과에
한목소리` is stored twice, once each way. Two consequences: any per-word count
that spans the boundary is a blend of two analysers, and 도체 surviving all three
runs is what makes the `XPN` failure a live bug rather than an artefact of old
data.

The report's other half is the `standalone` signal's own blind spot, and it is
larger than the fragments. Nine words below the cut on 2026-08-01 clear every
other clause, so the cut alone is keeping them off screen — and six of them are
whole words followed by a 조사 rather than pieces of anything: 유시민 (labelled
good), 골리앗, 앤트로픽, 호실적, 폭등장, 세탁. Only 입주, 특별감찰 and 한화에어
are real fragments. `post` in the report names the difference: a particle there
means the word is complete.

Neither of these is fixed. Both are collection- and signal-side changes rather
than threshold changes, so both have to be measured before and after.

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
