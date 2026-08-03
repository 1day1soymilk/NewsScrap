# The `standalone` cut — design

2026-08-03. Closes the second of the two items parked on 2026-08-02 for a full
brainstorm → spec → plan pass.

## 1. The problem as it was recorded

`scripts/analysis/README.md` and `CLAUDE.md` both carried this claim: sieve 2
(`min_standalone`) drops six whole words for every three real fragments it
catches, because the signal cannot tell a fragment from a word wearing a 조사.

The signal asks whether the word appears in the title as a run of Hangul with
non-Hangul on both sides:

```
(^|[^가-힣]) 단어 ($|[^가-힣])
```

Korean attaches 조사 with no space. 골리앗의, 자국민에 and 유시민이 therefore
score 0.00 — the same score 도체 gets for only ever occurring inside 반도체. The
blind spot is real and not in dispute.

Fixing it would change a **signal**, not a threshold, which is why the item was
parked rather than done: `CLAUDE.md` forbids reimplementing `keyword_signals`'
formulas anywhere else, and README rule 1 says expand the labels before tuning.

## 2. What measurement found instead

The claim no longer held. It was written against an archive that migrations
`0007` (386 duplicate rows removed) and `0009` (neighbours clause disabled) have
since moved.

Measured across all four collected days, six words are kept off screen by this
clause **and nothing else**, of which five reach the top 70:

| day | word | df | rank without the cut | enclosing | verdict |
| --- | --- | --- | --- | --- | --- |
| 07-31 | 춘천시 | 5 | 36 | 춘천시의원 | fragment |
| 07-31 | 한화에어 | 5 | 39 | 한화에어로스페이스 | fragment |
| 08-01 | 폭등장 | 6 | 38 | 폭등장에도 | whole word + 조사 |
| 08-01 | 골리앗 | 3 | 57 | 골리앗의 | whole word + 조사 |
| 08-01 | 특별감찰 | 3 | 81 day-wide, 3rd in 정치 | 특별감찰관 | fragment |
| 08-02 | 자국민 | 6 | 29 | 자국민에 | whole word + 조사 |

Two further facts reframed the item:

- **The words the README cited are gone from the question.** 유시민 scores 0.67
  on 07-31 and 0.92 on 08-02 and clears the cut; 앤트로픽, 호실적, 세탁 and 입주
  all sit below `min_headlines` and never reach sieve 2.
- **The fragments the clause was built for are stopped by the length clause
  first.** 도체, 무인, 상한 and 유조 are all two characters and fail
  `min_word_len` 3. Sieve 2's only unique catches on this archive are three
  words of three characters or more.

So the question reduced to a labelling question — are 골리앗, 자국민 and
특별감찰 words worth drawing — and that is settled by measurement, not design.

## 3. Requirements

1. Answer whether sieve 2 earns its place, on evidence, and change the threshold
   only if the harness says so.
2. Satisfy rule 4 before believing any number: `20_unlabeled.sql` and
   `21_unlabeled_category.sql` both empty.
3. Do not reimplement `keyword_signals`. Any signal variant is a database change
   the harness reads, never a second copy in a script.
4. Judge on F1 **and** the day's top story together (rule 5), never precision
   alone.
5. Build a particle-aware signal only if the measurement asks for one.

## 4. Design

### 4.1 Widen the harness to four days

The archive holds four collected days; the harness measured two. 자국민 is on
08-02 and was invisible. 08-02 and 08-03 are also the only days collected after
both the noun-merge fix and the canonical-link dedup, so they are the cleanest
evidence the project has.

`analysis.eval_days` (`12_eval_days.sql`) names the days once. `10_sieve_eval`,
`11_category_eval`, `20_unlabeled` and `21_unlabeled_category` each carried their
own copy of the date list; four copies is the hazard `02_sieve_configs.sql`'s
header already describes for configurations, applied to days.

The table also carries each day's `top_story`, because rule 5's safety catch was
a hardcoded `'폭염'`. That is right for three of the four days and wrong for
08-02, where 김민석 leads at 45 and 폭염 is third at 21. Widening without it would
have made the catch lie about that day. The column becomes `story` / `story_rank`.

### 4.2 Scope the round with an `active` flag

Rounds one to three of `02_sieve_configs.sql` sweep `min_spec` and
`max_neighbors_per_doc`, both of which measurement has since turned off
(`0003`, `0009`). Scoring them over four days costs 116 further labels — 187
rather than 71 from `20_unlabeled.sql` — to make rows meaningful for
configurations nobody will adopt.

`analysis.sieve_configs.active` scopes the round without deleting the history.
Both the harness and its worklist read it, preserving the invariant that the two
must agree on what is in play.

### 4.3 Round four

Hold everything at the shipped configuration (config 60: `min_headlines` 3,
length 3, specificity off, neighbours off, dictionary on) and move
`min_standalone` alone: off, .05, .20, .30, .50, plus an off-and-no-dictionary
arm. Earlier standalone sweeps (66–68, 80–83) all lay `npd 2.5` underneath and
measure a sieve no longer in use.

The category harness gets the same question as two extra variants holding sieve 1
at what ships, because a tab draws far fewer than `node_limit` words — a word the
cut removes there is not replaced by a deeper one, so the effect should be larger
if it exists at all.

### 4.4 The signal variant, conditional

A particle-tolerant `standalone` would be a second column on `keyword_signals`
with a boolean in `sieve_configs` choosing between them, and a 조사 list that
counts only when the **entire** trailing Hangul run is a particle — otherwise
한화에어**로스페이스** would be rescued by its 로. It is built only if the
measurement asks for it.

## 5. Success criteria

- Both worklists empty, every harness row `unlab` 0.
- A verdict on `min_standalone` supported by four days on two harnesses.
- Whatever the verdict, the stale claim in `README.md` and `CLAUDE.md` replaced
  by what was measured.

## 6. Out of scope

The frontend; `word_overrides` (using the dictionary to settle a labelling
question is the habit README rule 5 exists to stop); every other threshold.

## 7. Result

The baseline held and nothing shipped but documentation.

| configuration | 07-31 | 08-01 | 08-02 | 08-03 | mean F1 |
| --- | --- | --- | --- | --- | --- |
| **standalone >= .10 — ships** | 70.7 | 67.8 | 63.1 | 56.1 | **64.4** |
| standalone off | 68.3 | 65.5 | 63.1 | 56.1 | 63.3 |
| >= .05 / .20 / .30 | 70.7 | 67.8 | 63.1 | 56.1 | 64.4 |
| >= .50 | 71.9 | 69.0 | 61.7 | 56.1 | 64.7 |
| off, no dictionary | 57.5 | 57.5 | 57.7 | 49.7 | 55.6, story `DROPPED` ×3 |

Category harness, 24 cells: ships 63.4, off 63.0, `.50` 63.1 — and recall is
*identical* with the cut off while precision alone falls, 66.5 to 65.1. The
clause admits bad words and rescues no good ones.

All six words behind the blind spot were labelled bad. 골리앗 is the one to
remember: it looked like the strongest case for fixing the signal and is the
strongest against, because four of its five headlines across three days are the
same book — 『골리앗의 저주』 in [북리뷰], [북스&] and [Book] — and 북리뷰 and 저주
were already labelled bad.

**No particle-aware signal was built.** It would rescue 골리앗, 자국민 and
폭등장, all three bad. Revisit only if a labelled-good word ever appears cut by
this clause alone; `31_fragments.sql` is the report that would show it.

Found on the way and **not fixed**: `李대통령` exists in `headline_nouns` as two
strings, `李` U+674E and the CJK compatibility ideograph U+F7A1, splitting 15
rows across two words that render identically. Recorded in `CLAUDE.md` beside the
canonical-link invariant it resembles.
