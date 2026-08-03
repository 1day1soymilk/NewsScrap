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
scripts/analysis/run.sh scripts/analysis/12_eval_days.sql    # the days under test
scripts/analysis/run.sh scripts/analysis/02_sieve_configs.sql
scripts/analysis/run.sh scripts/analysis/20_unlabeled.sql    # must be empty
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
   45 headlines. The harness prints `recall_pct`, `f1_pct`, `story` and
   `story_rank` — a configuration reading `DROPPED` is rejected regardless of its
   precision. The story is **per day**, read from `analysis.eval_days`: 폭염 leads
   three of the four days and 김민석 leads 2026-08-02, where 폭염 is only third.
   This column was a hardcoded `heatwave` while the harness measured two days,
   and leaving it that way would have quietly excused a configuration that
   dropped 08-02's real story.

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

**Migration `0013` added two more**, 이용자 and 피해자, on 2026-08-03 after they
were seen on the day's canvas at ranks 67 and 41. Both were already labelled bad
in the group holding 국민, 외국인, 사망자 and 투표자: they name a role rather than
anyone in it, and the word carrying the story is the crime or the person beside
them. Not part of the 35 above — a role noun cannot head a headline on its own,
so excluding it settles nothing about the good-word line.

Measured, and only 2026-08-03 moves because neither reaches the top 70 on the
other three days:

| 2026-08-03 | before | after |
| --- | --- | --- |
| top-70 precision | 62.9 | **65.7** |
| top-70 F1 | 56.1 | **58.6** |

The two words promoted into the freed slots are 탄도미사일 (69) and 합수본 (70),
**both labelled good** — two bad out, two good in, and `unlabeled` stays 0 on
every row. That last part is luck rather than design: `0005` excluded 26 and
promoted 7, all bad. Re-run `20_unlabeled.sql` after every dictionary edit.

## Labels

606 words, covering everything drawn by every **active** configuration in
`02_sieve_configs.sql` and every variant in `11_category_eval.sql`, across the
four days in `analysis.eval_days` — 2026-07-31, 08-01, 08-02 and 08-03.
`20_unlabeled.sql` and `21_unlabeled_category.sql` both return nothing, so rule 4
is satisfied.

**The harness measured two days until 2026-08-03**, and widening it to four cost
139 labels (`09_labels_four_days.sql`). Two things made it worth paying for.
08-02 and 08-03 are the only days collected after both the noun-merge fix and the
canonical-link dedup, so they are the cleanest evidence there is; and a word that
matters can live on a day the harness cannot see, which is what happened to
자국민 — it sits 29th on 08-02 and was invisible to a two-day run.

`active` is what keeps that bill payable. Rounds one to three of
`02_sieve_configs.sql` sweep `min_spec` and `max_neighbors_per_doc`, and
migrations `0003` and `0009` turned both clauses off after measuring them.
Scoring those rows as well would have cost 116 further labels — 187 rather than
71 from `20_unlabeled.sql` — to make rows meaningful for configurations nobody
will adopt. They stay in the file, inactive. Flip one back to `true` and re-run
`20_unlabeled.sql`, as ever.

**Rule 4 breaks when the data moves, not only when the sweep widens.** 2026-08-01
was collected twice — once by hand and once by the 13:00 KST cron, since the
150-per-category cap applies per run — and the day went from 873 headlines to
1,382 partway through a session. The harness immediately started reporting up to
13 unlabelled words per row. Re-run `20_unlabeled.sql` after any collection, not
just after editing `02_sieve_configs.sql`. Migration `0007` (2026-08-02) is
another instance of this: it removed 386 duplicate rows and moved both labelled
days, so the counts recorded above are stale, and both scripts must be re-run
before trusting them again.

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
| `08_labels_after_dedup.sql` | Labels migration `0007` promoted by moving the data |
| `09_labels_four_days.sql` | Labels the widening to four days and round four exposed |
| `10_sieve_eval.sql` | The harness: precision, recall, F1 and the day's top-story rank per configuration |
| `11_category_eval.sql` | The same for one category tab at a time |
| `12_eval_days.sql` | The days under test and each one's biggest story — **apply before 10, 11, 20 and 21**, all four read it |
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

Prefixes (`XPN`) and noun-forming suffixes (`XSN`) were not in the merge's list of
joinable tags, so the run broke at them. `형소법` merged because both halves are
`NNG`, which is why it was the one of the six that reached the screen.

**Fixed by inverting the rule rather than by extending the list.** The headline's
own spacing already says what belongs together, so `lib/nouns.ts` now keeps an
eojeol whole and breaks only on what is not part of the word — particles,
endings, verbs and adjectives, adverbs, bound nouns and punctuation. Naming the
noun tags instead was tried first and fixes the same 66 of 150 sampled headlines,
but it has to enumerate the tagset to say what the spacing said already, and it
loses 한마디 to 마디.

Measured over 150 real headlines, replayed through the real ETRI responses: 66 of
145 distinct titles change, 87 words appear and 78 disappear. 도체 → 반도체,
보완수사 → 보완수사권, 거부 → 거부권, 상한 → 상한가, 전투 → 전투기, 행랑 →
줄행랑, 구름 → 먹구름, 염색 → 염색체.

Two suffixes are held out by hand, and they are the only hand-maintained part:
`들` and `적`. Both inflect rather than compound — 개미 and 개미들 would be two
words, and 기록적 is an adnominal where 기록 is the keyword. They were picked from
the `XSN` lemmas the sample actually produced. `님` was considered and rejected:
선배님 would read better as 선배, but holding 님 out turns 손님 into 손, and a
wrong word costs more than a redundant one.

**The archive spans the merge's deploy, and only the last of three runs is on the
current side of it.** `created_at` splits it into 2026-07-31 16:00 KST, 2026-08-01
08:00 (the manual run) and 2026-08-01 13:00 (the cron), and the words fall either
side of the last boundary exactly:

| | 07-31 16:00 | 08-01 08:00 | 08-01 13:00 |
| --- | --- | --- | --- |
| 형소 / 형소법 | 6 / – | 14 / – | – / 9 |
| 소리 / 목소리 | 4 / – | 2 / – | – / 2 |
| 검찰 / 검찰개혁 | 6 / – | 13 / – | 3 / 2 |
| 도체 | 17 | 16 | 13 |

So most of the archive was analysed by the pre-merge function and only the last
run by the current one, and a word can be a fragment in one row and whole in the
next — the duplicate title `“검찰개혁 끝내 완성”… 여권, 형소법 통과에 한목소리`
was stored twice, once each way. Two consequences: any per-word count that spans
the boundary is a blend of two analysers, and 도체 surviving all three runs is
what makes the `XPN` failure a live bug rather than an artefact of old data.

The counts in the table above, and the split they came from, were measured
**before** migration 0007 (2026-08-02) collapsed the archive onto one row per
article, and that duplicate title is exactly the kind of row it removed. The
ratio moved with it, and not evenly: keeping the earliest sighting cost the
13:00 cron 509 → 327 rows against the 08:00 manual run's 873 → 817, so the
surviving corpus leans further toward the pre-merge analyser than it did. The
measured split now is **1,716 of the 2,043 rows on the two labelled days**
(1,716 of 2,734 across the whole table). The boundary itself is unchanged —
only how much sits on each side of it.

The merge fix only affects **future** collections: the archived days keep the
fragments they were stored with.

## The `standalone` blind spot, measured and closed

The signal asks whether a word appears in the title as a run of Hangul with
non-Hangul on both sides. Korean attaches 조사 with no space, so 유시민이,
골리앗의 and 자국민에 all score 0.00 — indistinguishable from 도체 inside 반도체.
The blind spot is real and this file used to record it as the larger half of the
fragment report: nine words below the cut on 2026-08-01 cleared every other
clause, six of them whole words followed by a particle.

**That reading is superseded and was already stale when it was written.**
Migrations `0007` (duplicate rows) and `0009` (neighbours clause off) moved the
data under it. Measured across all four collected days on 2026-08-03, six words
are kept off screen by this clause and nothing else, and five reach the top 70:

| day | word | df | rank without the cut | enclosing | label |
| --- | --- | --- | --- | --- | --- |
| 07-31 | 춘천시 | 5 | 36 | 춘천시**의원** | bad |
| 07-31 | 한화에어 | 5 | 39 | 한화에어**로**스페이스 | bad |
| 08-01 | 폭등장 | 6 | 38 | 폭등장**에도** (particle) | bad |
| 08-01 | 골리앗 | 3 | 57 | 골리앗**의** (particle) | bad |
| 08-01 | 특별감찰 | 3 | 81 — off screen day-wide, 3rd in 정치 | 특별감찰**관** | bad |
| 08-02 | 자국민 | 6 | 29 | 자국민**에** (particle) | bad |

**Every one of the three the signal is wrong about is a word that should not be
drawn anyway.** 골리앗 looked like the clearest case for fixing the signal and is
the clearest case against: four of its five headlines across three days are the
same book, 『골리앗의 저주』, in [북리뷰], [북스&] and [Book] — and 북리뷰 and 저주
were already labelled bad. 자국민 goes with 국민, 폭등장 with 폭등.

The other four clauses this file has swept were each turned off or left alone by
measurement, and round four asked the same question of this one:

| configuration | 07-31 | 08-01 | 08-02 | 08-03 | mean F1 |
| --- | --- | --- | --- | --- | --- |
| **standalone >= .10 — ships** | 70.7 | 67.8 | 63.1 | 56.1 | **64.4** |
| standalone off | 68.3 | 65.5 | 63.1 | 56.1 | 63.3 |
| >= .05, >= .20, >= .30 | 70.7 | 67.8 | 63.1 | 56.1 | 64.4 |
| >= .50 | 71.9 | 69.0 | 61.7 | 56.1 | 64.7 |
| off, no dictionary | 57.5 | 57.5 | 57.7 | 49.7 | 55.6, story `DROPPED` ×3 |

Turning it off never wins a day. `.05` through `.30` are identical, so 0.10 sits
in the middle of a plateau rather than at the edge of one — rule 2 satisfied
without moving anything. `.50` is +0.3 on the mean and −1.4 on 08-02, which is
inside the noise this file has always refused to fit. The no-dictionary row is
rejected outright by rule 5.

The category harness agrees and more cleanly, over 24 cells:

| variant | mean F1 | mean precision | mean recall |
| --- | --- | --- | --- |
| **ships (standalone >= .10)** | **63.4** | 66.5 | 65.1 |
| standalone off | 63.0 | 65.1 | 65.1 |
| standalone >= .50 | 63.1 | 67.6 | 63.5 |

Recall is *identical* with the cut off and precision is the only thing that
moves. Removing the clause admits bad words and rescues no good ones, which is
exactly what the six labels above predict.

**So no particle-aware variant of the signal was built.** It would rescue
골리앗, 자국민 and 폭등장, all three of them bad. The blind spot is real, the
words behind it are not worth having, and a second signal would be code carrying
no measurement. Revisit only if a labelled-good word ever turns up cut by this
clause alone — `31_fragments.sql` is the report that would show it.

The label set moved during this round: 윤리위, 반도체 and 李대통령 were proposed
bad and overruled to good, 여의도 and 형사사법체계 the other way. Every figure
above is from after that. **Nothing in the ranking moved** — the same
configuration wins by the same margin — which is the claim this file has always
made about where the good-word line sits, reproduced on purpose rather than by
assertion.

### A collection defect found on the way, and fixed

`李대통령` existed in `headline_nouns` as **two different strings**: `李` U+674E
and the CJK compatibility ideograph `李` U+F9E1, which Naver's headlines use
interchangeably. They render identically and were two separate words to every
count here — 15 rows between them, and `李정부` splitting the same way over 3.
Five compatibility ideographs occur in this archive: 李 U+F9E1, 金 U+F90A,
勞 U+F92F, 盧 U+F933, 女 U+F981.

The canonical-link bug in a different alphabet: one thing, two keys, silently
splitting counts. Fixed by migration `0012` plus normalisation in
`extractHeadlines` and `filterNouns` — see `CLAUDE.md` for why it takes both
places and why NFC rather than NFKC.

**The measurement above survived it unchanged.** The archive moved under a label
set that was already complete, which is rule 4's second trigger, so both
worklists and the whole harness were re-run after the backfill: both worklists
empty, every figure byte-identical. `李대통령` went from two words of df 6 and 5
to one of df 7 on 08-02 and 08-03 and still does not reach the top 70. Recorded
because "we re-ran it and nothing moved" is the only version of that claim worth
anything.

```sql
select normalize(word, nfc) as nfc_form, count(distinct word) as forms
from (select distinct word from headline_nouns) t
group by 1 having count(distinct word) > 1;
```

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

**Re-measured on four days on 2026-08-03**, over 24 cells and the extended label
set: 46.1 for the pre-`0004` cut, **63.4** for the day-wide one, 52.8 for the
day-wide-plus-scoped variant. The gap held, and grew. The 61.2 above is the
two-day figure and is kept as the number the migration was decided on.

A fourth option, lowering the per-category cut to 2, is **unmeasured**. Pricing
it under rule 4 costs 180 more labels, and a sample of what it draws is mostly
Naver's own column titles: 마켓프리즘, 디브리핑, 더차트, 급리포트,
데일리국제금융. Measure it before adopting it; the sample is a reason to
prioritise it low, not a result.

## Rounds five and six: the fifth signal, and why it is not a sieve clause

The open question this directory carried for a long time was the one `CLAUDE.md`
stated: the length clause is effectively the whole sieve, and **none of the four
signals separates the good words inside it from the bad ones**, so the dictionary
was doing that work for want of anything better.

A fifth signal exists. `head_pos` (migration `0014`) is where in the headline the
word starts, averaged over the day's headlines holding it, as a fraction of the
room it could have started in — 0 leads, 1 trails. Korean headlines are
topic-first, so a story's names lead and generic qualifiers trail. Over the 280
drawn word-days of the four labelled days the mean is **0.347 for good and 0.466
for bad**, and above 0.70 what it catches is almost exactly the family that means
nothing on its own: 가능성, 시험대, 승부수, 변동성, 무방비, 막바지, 월요일,
테러범, 수도권, 로보틱스.

**Round five ran it as a hard cut and got a split verdict**, which is the part
worth carrying forward:

| | `10_sieve_eval.sql`, 4 days | `11_category_eval.sql`, 24 cells |
| --- | --- | --- |
| shipped | 65.05 | 65.08 |
| `head_pos <= 0.70` as a cut | **67.30** (3 wins, 0 losses) | **63.42** (0 wins, 8 losses) |

Both numbers are real, and the render cap explains both. Day-wide the cap binds
at 70, so cutting a word promotes a deeper one — and the promoted words are about
as good as the screen average, so **the gain was the substitution and never the
removal**. A category tab draws at most 46 words, the cap never binds, and there
a cut is loss with nothing to fill the hole.

**So round six changed the mechanism rather than the threshold.** A demotion —
sorting a trailing word below every leading one instead of dropping it — can only
act where a substitution is available, and is a no-op on a tab by construction.
Measured, it reproduces the cut's day-wide numbers *exactly*
(71.9 / 67.8 / 65.8 / 63.7) and leaves the category mean at 65.08 to the decimal.
Shipped as `demote_head_pos` in migration `0015`.

Three things follow that are easy to get wrong later:

- **A day-wide win with a category loss is a signature, not a tuning problem.**
  It says the mechanism needs the cap to be binding. Reach for the mechanism, not
  for another threshold.
- **0.70 is interior to its sweep** (rule 2): 0.65 gives mean 66.68, 0.75 gives
  65.68, and at 0.50 폭염 sinks to rank 66 on 2026-07-31 and off the screen on
  08-03.
- **`rank` in `10_sieve_eval.sql` is no longer purely `df desc`.** With
  `demote_head_pos` at its 9.9 default the expression is identical to the old one
  and every earlier round reproduces, but it is a knob now and the comment above
  it says so.

**This round moved the drawn words**, from 211 good / 69 bad to 218 / 62 across
the four days. Anything measured against the drawn set is now stale — including
the canvas-layout harness, whose fixture is a copy of `keyword_graph`'s output
and must be re-pulled before its numbers mean anything again.

## Round seven: the floor that turned out to be unnecessary

The natural next question after round six was whether the places the demotion
frees should be filled at all. A word with three headlines is thin, and the
words sitting at ranks 71 to 78 across the four days were all exactly df 3, so
a floor under promotion looked obviously right.

`min_headlines` **is** that floor; there is no second knob to invent. Measured:

| floor | mean F1, 4 days |
| --- | --- |
| 3 (ships) | **67.30** |
| 4 | 59.20 |
| 5 | 52.98 |
| 6 | 45.35 |

Precision barely moves (84.3 to 84.3, 71.4 to 65.7) while recall collapses
(61.9 to 44.3). That is rule 5 in its purest form: a floor does not punish
discarding good words, and this one discards them wholesale.

**The reason is the corpus, and the reason is measurable.** At 700 to 1,100
headlines a day only 51 to 63 words clear df >= 4, so three of the four days can
no longer fill the 70 places on the canvas. The collector then went from one
cron run a day to six and 2026-08-03 went from 900 headlines to 2,197 in an
afternoon — and on that day the floor changes **nothing at all**:

| day | headlines | eligible df>=3 | >=4 | >=5 | >=6 | >=8 | df at rank 70 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-31 | 899 | 75 | 51 | 38 | 33 | 19 | **3** |
| 2026-08-01 | 1,144 | 85 | 54 | 46 | 37 | 28 | **3** |
| 2026-08-02 | 691 | 99 | 63 | 51 | 33 | 18 | **3** |
| 2026-08-03 | 2,197 | 386 | 244 | 170 | 124 | 81 | **8** |

The last column is the finding. On a thin day the word that just makes the
canvas has three headlines, so the floor *is* the screen and raising it starves
the canvas. On a fat day that word already has eight, so a floor of 4, 5 or even
6 never reaches it — the drawn 70 come back identical at every one of them.

**So the floor is not adopted, and not deferred either: it is unnecessary.**
There is no corpus size at which it helps. On a thin day it hurts; on a fat day
the ranking has already done its work. `min_headlines` stays at 3 as a safety
net for a day whose collection failed, where it costs nothing.

What the round actually bought is the collection change, which is real: six
runs a day at four-hour spacing rather than one. See the header of
`supabase/functions/collect-headlines/index.ts` for why the runs are spread
rather than the per-run cap raised.

`analysis` is a separate schema, so none of this is reachable from the browser —
PostgREST only exposes `public`.
