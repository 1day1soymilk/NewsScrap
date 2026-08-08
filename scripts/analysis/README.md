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

## Round eight — the analyser changed underneath everything

ETRI's WiseNLU was replaced by `garu-ko` running inside the Edge Function and
the whole archive was re-derived from its titles (`scripts/reanalyze/`). **The
sieve was not touched, the sweep was not widened and no day was added**, and
rule 4 still fired harder than it ever has: `20_unlabeled.sql` returned 38 words
and `21_unlabeled_category.sql` returned 232. Both had been empty.

Labelled in `14_labels_after_reanalysis.sql` (38: 14 good, 24 bad) and
`15_labels_category_after_reanalysis.sql` (234: 75 good, 159 bad, the two extra
caught by re-running the worklist after the first pass — which is why the
worklist is a query and not a list anyone keeps).

**The shipped configuration still wins, and that is the whole verdict of the
round.** Day-wide it beats length-only on all four days (F1 57.3 / 51.6 / 65.8 /
47.1 against 55.1 / 48.4 / 61.7 / 45.1) and beats every `min_headlines` floor;
on the 24 category cells it means 57.20 against 48.52 for the pre-`0004` scoped
count, so migration `0004` survives the analyser change intact. No threshold was
moved, deliberately: changing the analyser and a threshold in one step would
leave no way to attribute the difference.

**The absolute numbers fell and mostly not for the reason they look like.**
Precision went 85.7 / 84.3 / 70.0 / 67.1 to 75.7 / 70.0 / 70.0 / 68.6. But
2026-08-03 drew none of the newly labelled words and *rose*, while 07-31 and
08-01 drew 8 and 7 of them and fell hardest — a newly labelled bad word lowers
precision the instant it is labelled, whatever the analyser did. Rule 4's own
warning, arriving as data.

Two tells worth carrying forward:

- **A section tag is not a subject.** 뉴시스Pic, 배틀라인, 이슈톺, 손바닥, 종합2,
  주末머니 and Y녹취록 all reached the screen; every headline carrying one *ends*
  in it, bracketed. `spec` 1.00 plus a shared bracketed suffix is the signature.
  Y녹취록 was labelled good first, on the reading that it named one recording in
  one case; it is a standing column at YTN.
- **The line, in operational form, is a question**: would this word appear in a
  randomly chosen other week's news? 압수수색 and 유상증자 and 본회의 would, so
  they are bad however particular the story behind them; 문자통보 and 미장착 and
  보릿돌교 would not. That question decided the ~50 cases the prose definition
  left genuinely open.

## Round nine — the price of `min_word_len`, at last

**The largest single measured gain the sieve has had.** `min_proper` 0.50 shipped
in migration `0018`: a word is admitted if the analyser tagged it a proper noun
on more than half its rows, whatever its length.

| | day-wide, 4 days | category, 24 cells |
| --- | --- | --- |
| shipped before | mean F1 49.48, precision 71.07 | mean F1 55.07 |
| `len3 or proper >= .50` | **52.40**, precision **75.00** | **66.44** |
| `min_word_len 2` (control) | 31.98, precision 45.73 | — |

`unlabeled` 0 on every row and `story_rank` 1 on all four days.

**The question nobody had asked.** This directory and CLAUDE.md both record the
length clause as *the* sieve — it admits 68 of 70 and its precision is the
sieve's — and both price it only by what it lets through. What it rejects had
never been costed: **a two-character word could not reach the canvas at all.**
Across the archive's entire history exactly two ever did, 폭염 and 양산, both by
hand in migration `0003`. 이란, 미국, 중국, 일본, 북한, 한국, 서울, 부산, 대구,
인천, 삼성, 애플, 구글, 기아 — all cut with the noise.

**Length was a proxy; the analyser answers the real question.** Now that it runs
in-process it can be asked directly, and the reason to expect it to work was
specific rather than hopeful: garu tags 이란 NNP and **감찰, 윤리, 청문, 초등 and
순회 NNG** — the five words this repository names as the reason the *specificity*
clause had to be disabled, each scoring a perfect 1.00 on spec. The
discrimination spec could not make is sitting in the tagger's output.

**`min_word_len 2` is in the sweep as the control, and it is the finding.**
Admitting every two-character word scores 31.98 — far *worse* than the shipped
sieve, not better. So the gain is not "two-character words were being lost"; it
is that the analyser can say which of them are names. Of the 44 words a blanket
`min_word_len 2` promotes, 8 are good; of the 36 the tagger promotes on the tabs,
**31** are — 포항, 울산, 통영, 경주, 원주, 독일, 칠레, 가자, 유엔, 인텔, 쿠팡,
퀄컴, 놀런, 룰라.

**It has the opposite signature to head_pos, which is the reusable part.** That
signal won day-wide and lost 8 of 24 cells while winning none, because it is a
cut and a tab's cap never binds. This is a rescue: it only adds, a tab has the
room, and the tabs therefore gain more than the day. *A day-wide win with a
category loss means the mechanism needs the cap binding; a win on both, larger on
the tabs, means it does not.*

0.50 is mid-plateau and deliberately not the best cell — .25/.50/.75/1.00 give
52.15/52.40/52.40/52.55 day-wide and 66.28/66.44/66.48/66.37 on the tabs. 1.00
wins by 0.15 and is the boundary, demanding every row be tagged NNP, so one
mistagged row in fifty would disqualify a name.

The dictionary is **not** replaced. Rescue-only scores 49.58, about what the
shipped sieve scored with the dictionary on — so it is not re-catching the same
words — but it drops the day's biggest story on three of four days, because 폭염
is two characters and NNG and lives on its `allow` entry.

Cost, accepted on the numbers: 닉스 (from 삼전닉스) and 어스 (from 구글 어스) are
tagged NNP and arrive as fragments; 유럽, 남미, 중동 and 호남 arrive as regions.

## Round ten — the rescue invalidated the fragment cut's tuning

`min_standalone` 0.10 → **0.50** (migration `0019`), and the interesting part is
why it was allowed to move at all.

Round four swept .05 to .30, found them identical, recorded 0.10 as mid-plateau
and concluded the clause cost nothing either way — six words kept off screen by
it, all six labelled bad. **That measurement was taken when nothing under three
characters could reach the canvas**, so the cut only ever saw long words, and
long words are rarely fragments.

Round nine's rescue admits a word on the tagger's say-so at any length, and the
tagger has no opinion about whether a string is a piece of something bigger.
닉스 (`삼전닉스`, NNP, standalone 0.14) reached the screen on two of four days.
So the threshold had to be re-swept:

| min_standalone | day-wide F1 | day-wide precision | category F1 |
| --- | --- | --- | --- |
| 0.10 (was) | 52.40 | 75.00 | 66.44 |
| 0.30 | 52.87 | 75.70 | — |
| **0.50** | **53.12** | **76.05** | **67.02** |
| 0.70 | 52.55 | 75.35 | — |

Wins on both surfaces; the peak is interior, which is rule 2. `unlabeled` 0 and
`story_rank` 1 throughout, and nothing new needed labelling — a tightening
promotes rank 71, and those were already labelled.

Cost, named: ten words go, seven bad (닉스 ×2, 수도권, 최고위원, 경찰관, 한국 ×2)
and three good — 우크라, 충청, 해남. Those three are the **조사 blind spot**:
Korean attaches a particle without a space, so 해남에 scores as a fragment
exactly as 도체 inside 반도체 does. 오만 is the sharpest loss, a country scoring
0.00 because every headline writes 오만과. Round four's instruction **not** to
build a particle-aware variant still stands — this moves a number the harness can
price rather than adding a rule it cannot.

**The transferable lesson is not the threshold.** A measurement is only valid
under the circumstance it was taken in, and a clause that admits a *new kind* of
word invalidates every threshold tuned when that kind could not appear. Round
nine should have triggered this re-sweep on its own; it took noticing 닉스 on the
canvas.

## Round eleven — the third threshold the rescue invalidated

`demote_head_pos` 0.70 → **0.60** (migration `0020`). By this round the pattern
had become the finding rather than any one number: round nine's proper-noun
rescue admits a *new kind* of word, so every threshold tuned before it is
suspect, and this is the third one to move.

| demote_head_pos | day-wide mean F1 |
| --- | --- |
| 0.50 | 53.30 |
| 0.55 | 54.12 |
| **0.60** | **54.10** |
| 0.65 | 54.18 |
| 0.70 (was) | 53.02 |
| off | 51.40 |

0.55–0.65 are one plateau, flat to within 0.08 and all about a point of F1 and
two of precision above 0.70.

**0.50 scores well and is rejected outright**, because it sinks 폭염 off
2026-07-31's screen — the cliff round six had already recorded, still exactly
where it was. What moved was the plateau, down onto the edge of it.

**0.60 is taken over 0.65's marginally better F1** because it is mid-plateau and a
full 0.10 clear of that cliff. Rule 5 is not a tie-break to be spent, and a
threshold one step from dropping the day's biggest story is not worth 0.08.

No category measurement accompanies this round, and that is correct rather than
missing: a demotion reorders and removes nothing, so it can only act where the
render cap binds. **Round thirteen then found that the cap does bind on fat days'
tabs**, which does not change this verdict but does mean the sentence "a tab
draws at most 46 against a cap of 70" was only true of the days measured here.

## Round thirteen — `min_word_len` 4, and a harness that was scoring the wrong screen

**The lead closed, and closing it turned up a measurement bug worth more than the
threshold.**

The length bar was doing two jobs: keeping fragments out and keeping names in.
Round nine's rescue took the second away, so the bar can rise and catch the
three-character common nouns it had always been set too low to reach.

| min_word_len | day-wide F1 | precision | shown | category F1 |
| --- | --- | --- | --- | --- |
| 3 (was) | 62.03 | 90.35 | 70.0 | 73.21 |
| **4** | **63.70** | **93.53** | 69.8 | **78.58** |
| 5 | 63.58 | 97.00 | 65.8 | 77.80 |

One label run, both worklists empty, `story_rank` 1 throughout. 5 reaches 97%
precision and is rejected on `shown` — 65.8 of 70 places is less news on screen,
and the recall denominator is fixed so F1 already prices it.

**The bug.** At length 4 the tabs first reported `unlab` 30, which should be
impossible: raising a length bar can only remove words. It is possible, and the
reason is that **the render cap binds on category tabs** — 2026-08-03 puts 95 to
163 qualifying words on each of its six tabs against a cap of 70, and
2026-08-01's society tab 77. Seven of the 24 cells bind. So removing a word
promotes a deeper one, exactly as day-wide.

That made a second disagreement visible. `11_category_eval.sql` and
`21_unlabeled_category.sql` ranked by `df desc, word`, while `keyword_graph`
ranks by the head_pos demotion first. Harmless while a tab draws everything that
qualifies; on the seven binding cells the harness was scoring a screen the app
does not draw. Both files now model the demotion, and the shipped tab number
moved 71.80 → 73.21 — **a measurement error, not an improvement.**

**And it undercuts a standing claim.** head_pos ships as a demotion rather than a
cut because "a tab draws at most 46 words, the cap never binds, so a cut there is
loss with nothing to fill the hole". On a fat day the cap binds, so a cut would
substitute there too. The demotion still wins; its stated reason is now only
partly right, and the question deserves re-measuring on fat days.

Labels: `22_labels_after_demotion_fix.sql` (26, in two passes — the demotion fix
promoted 14 and the length bar another 12).

## Round twelve — the dictionary, re-derived against the new screen

36 exclusions (migration `0021`). The largest of the four post-`0018` changes and
the cheapest: no threshold moves, no signal is added.

| | day-wide F1 | day-wide precision | category F1 |
| --- | --- | --- | --- |
| before | 54.10 | 77.85 | 67.02 |
| after | **62.43** | **90.35** | **71.80** |

Chosen the way `0005` chose its 26 — from the query "labelled bad, drawn by the
shipped sieve on at least one day, not already in the dictionary", which returned
44 — and **not** by looking at the canvas.

**The eight left in are the exercise.** 부동산, 아파트, 에너지, 스마트폰, 무인기,
요양병원, 재선거, 개정안 can each head a real story; excluding them would use the
dictionary to paper over where the good-word line sits, which is a labelling
question. Same call `0005` made about 공습, 압박, 배터리, 클라우드, 바이오.

Seven entries exist because of round nine, reaching the canvas through
`passed_by = 'proper'`: 유럽, 남미, 중동, 한국 as backdrop, and 어스, 모스, 민주 —
the halves of 구글 어스, 모스크바 and 민주당 that the tagger calls proper nouns.

`20_unlabeled.sql` returned nothing afterwards, which is luck rather than design:
`0005` excluded 26 and promoted 7, all bad and all unlabelled. Re-run it after
every dictionary edit regardless.

Labels: `17_labels_two_character.sql` (44) and
`18_labels_two_character_category.sql` (36). Both worklists empty afterwards.

## Round fourteen — three mechanisms measured, none shipped

Migrations `0023`–`0025` wired a place gate, a render cap the harness could
sweep, and a category-balance exponent α, and shipped all three switched off
pending this measurement. Migration `0026` is the verdict: **nothing moved.**
No threshold in `scoring_weights` changes value; four `note` columns change so
the database carries the reason.

Both worklists returned nothing before the harness was read and again after
`24_cap_and_place_configs.sql`'s `active` list was narrowed, and `unlab` is 0 on
every row quoted below — 40 day-wide, 120 category, and all 28 live-RPC cells in
both gate states. `story_rank` is 1 in every one of them, so rule 5 disqualifies
nothing and each verdict below is decided on the numbers rather than on the
safety net.

### The render cap: the harness structurally cannot price it

| cap | mean shown | mean precision | mean F1 |
| --- | --- | --- | --- |
| **70 (ships)** | 69.75 | **93.53** | 63.70 |
| 85 | 81.00 | 88.80 | 66.38 |
| 100 | 92.25 | 87.75 | 70.60 |
| 130 | 105.75 | 85.40 | **73.80** |

**F1 rises monotonically with the cap, and that is the metric misbehaving rather
than a result.** `10_sieve_eval.sql` holds the recall denominator fixed — every
labelled-good word on the day with `df >= 3` — while the cap *is* how many words
the screen shows. Widening therefore always buys recall, and F1 turns over only
when precision collapses, which at these caps it never does. The optimum sits at
the edge of the sweep, and rule 2's instruction to widen is useless here: the
limit of this metric is "draw every word that qualifies".

**Rule 3 is the rule that applies — the metric does not match the question.**
Migration `0006` already said so in one line, "render_cap is not a sieve
threshold, so this does not go through `10_sieve_eval.sql`". Round fourteen put
it through anyway and found out why that sentence was there. **This is the first
time a quantity has been swept in this harness that the harness cannot decide**,
and the tell is the shape: a monotone column with no interior turn. Any future
knob whose sweep looks like that should be checked for the same defect before
its best cell is believed.

Precision is what reads a fixed screen honestly, and it decides: **93.53 at 70
against 85.40 at 130**. The marginal bands say it more sharply. Over the three
days where the cap binds the top 70 are 201 good / 9 bad (95.7%), and what each
widening adds is:

| band | good | bad | precision |
| --- | --- | --- | --- |
| ranks 71–85 | 27 | 18 | 60.0% |
| ranks 86–100 | 36 | 9 | 80.0% |
| ranks 101–130 | 36 | 18 | 66.7% |
| ranks 71–end | 99 | 45 | **68.8%** |

Every band is drawn from a population far worse than what is already on screen,
and they are **not even monotone** — 71–85 is worse than 86–100 — so there is no
rank at which the screen cleanly stops being worth widening. Bad words on the
canvas go 3 → 16 on 2026-07-31 and 2 → 23 on 2026-08-03.

The cap is read **per day** and not on a mean, because it can only act where it
binds. Qualifying words: 07-31 116, 08-01 108, 08-02 **69**, 08-03 260.
2026-08-02 is identical in all four rows by construction.

And nothing in this round re-measures the picture, which is what `0006` decided
on: ranks 71–130 arrived faded at the minimum font size and sat in every gap
between the words worth reading. `scripts/layout/` measures crossings, overlap
and height at 70 and none of it has been re-run. **A cap change is a canvas
change** and needs that harness plus a judgement about the picture.

### The place gate: the premise failed, not the threshold

`place_needs_edge` draws a `word_overrides` place only when a line joins it to a
non-place.

| surface | gate off (ships) | gate on | wins / losses |
| --- | --- | --- | --- |
| all-categories, 4 days | F1 **63.70**, prec 93.53 | F1 62.67, prec 92.05 | 0 wins, 3 losses, 1 tie |
| category tabs, 24 cells | F1 **78.58**, prec 85.40 | F1 75.22, prec 84.48 | 1 win, 17 losses, 6 ties |

At cap 100 the same comparison gives 70.60 → 69.98 day-wide, so a wider canvas
does not rescue it either.

**Name the cost, and it is one-sided.** Diffing the drawn word set day-wide, gate
on against gate off, over the four days: the gate removes **eleven words and
every one of them is labelled good** — 서울 ×2, 울산 ×2, 제주, 강남, 부산, 강원,
광주, 인천, 포항 — and promotes ten, six good (경계작전, 공화당, 김동관, 김병기,
김용, 한반도) and four bad (단일종목, 반도체주, 고속도로, 대공습). Net five good
words off the screen and four bad ones onto it. Round ten could name three good
words as the price of a real gain; here there is no gain to price.

**So the premise is what failed.** The gate was built on "a place with no line to
a non-place is backdrop". A place can be the story and still hold no *drawn*
line, because its partner sits below the render cap. 부산 on 2026-08-02 is the
clean case — a day qualifying only 69 words, where the gate drops it and promotes
nothing at all. There is no threshold to retune: the gate is already at its
weakest setting, one edge.

**Do not re-file this as head_pos and reach for a demotion.** That signature is a
day-wide *win* with a category loss, which says the mechanism needs the cap to be
binding, so a demotion keeps the win and drops the loss. This gate loses on
**both** surfaces, and day-wide it loses precisely where the cap binds. A
demotion is a no-op where the cap does not bind and identical to the cut where it
does, so its day-wide mean is arithmetically 62.88 — 67.3 (tie) / 64.3 / 77.9
restored / 42.0 — still below the shipped 63.70. Worth stating as the general
form: **a demotion can only rescue a mechanism whose losses are in the
non-binding cells.** The single cell the gate wins, 2026-08-03 politics
(70.3 → 71.5), is a binding cell, which is the same mechanism seen from the other
side and does not carry the other 23.

**The tab numbers came from the deployed RPC rather than from a variant in
`11_category_eval.sql`, on purpose.** The gate needs a per-(day, category) edge
set and `analysis.day_edges` is day-wide, so a variant there would have been a
third copy of sieve 6 plus a fourth copy of the pair/NPMI arithmetic. Instead:
flip `place_needs_edge`, pull `keyword_graph`'s node array for all 28 cells, flip
back, score against the same labels and the same pool definition
`11_category_eval.sql` uses — the method Task 3 used to validate the harness's own
copy of sieve 6. **The gate-off run reproduces both harnesses to the digit**
(24-cell mean 78.58, all-view 63.70 / 93.53 on all four days), which is what makes
the gate-on run comparable.

### α: not measurable on this day set

| α | mean F1 | mean precision | story_rank |
| --- | --- | --- | --- |
| **0.00 (ships)** | **63.70** | **93.53** | 1/1/1/1 |
| 0.25 | 63.20 | 92.83 | 1/1/1/1 |
| 0.50 | 63.20 | 92.83 | 1/1/1/1 |
| 0.75 | 63.20 | 92.83 | 1/1/1/1 |
| 1.00 | 63.20 | 92.83 | 1/1/1/1 |

Out of band — deliberately **not** in `analysis.sieve_configs`, because α > 1 is
outside the estimator's meaning and adding the rows would cost every future
harness run two more `keyword_signals` calls and put two more values under rule
4 permanently:

| α | 07-31 | 08-01 | 08-02 | 08-03 | mean F1 | story_rank |
| --- | --- | --- | --- | --- | --- | --- |
| 1.50 | 65.3 | 64.3 | 77.9 | 42.7 | 62.55 | 1/1/1/1 |
| 2.00 | 65.3 | 64.3 | 77.9 | 42.0 | 62.38 | 1/**2**/1/1 |
| 4.00 | 65.3 | 64.3 | 77.9 | 40.8 | 61.98 | 1/**4**/**5**/1 |

Monotonically non-increasing, and past 2.00 rule 5 begins to bite, so the curve
does not turn around above the named range. α = 0 is the identity and α = 1 is
the estimator migration `0025` set out to build, so the named sweep spans the
parameter's whole meaningful domain rather than a window inside it — which is
rule 2 answered by the domain rather than by widening.

**The honest one-line summary is "α is not measurable on this day set", not "α
costs 0.5 F1".** It loses on exactly one day, and the balance factors say why:

| day | min factor | max factor | section totals |
| --- | --- | --- | --- |
| 2026-07-31 | 0.999 | 1.006 | 150/149/150/150/150/150 |
| 2026-08-01 | 0.742 | 1.869 | 167/207/102/210/257/201 |
| 2026-08-02 | 0.773 | 1.294 | 89/114/89/149/149/101 |
| 2026-08-03 | 0.808 | 1.201 | 313/445/309/372/453/305 |
| *2026-08-04, 11:00 KST* | *0.741* | *1.790* | *322/561/241/479/582/403* |
| *2026-08-04, 20:24 KST* | *0.756* | *1.563* | *391/710/354/629/732/503* |

**The last two rows are the same day and they are stamped for that reason.** The
four days above them are settled and reproducible; 2026-08-04 is still being
collected, and in the nine hours between those two readings it went from 130
qualifying words to **240** and from 2,4xx headlines to 3,319. Any 08-04 figure
in this repository is a snapshot. Quoting one without its clock time next to four
settled days is how it gets read as a measurement, and this table is the one
place the difference is visible.

2026-07-31 is a single capped collection run, balanced to within 0.6% of 1 — so α
cannot correct anything there and all it does is break a raw-`df` tie by a
third-decimal hair. **That is the only day it loses on.** The two days with real
imbalance are label-neutral at every α, and 2026-08-02 draws 69 words against a
cap of 70 so no substitution is available at all.

**Rule 5 holds at α = 1, and the denominator is why.** The top story from
`analysis.eval_days` keeps rank 1 on every eval day, and the reason is that the
divisor is the word's *own* section distribution rather than its top category —
a spread word gets a blend of factors, so a word that spans sections is not
charged the largest section's divisor:

| day | word | df | df_balanced (α = 1) | rank α = 0 | rank α = 1 |
| --- | --- | --- | --- | --- | --- |
| 2026-07-31 | 폭염 | 38 | 38.0 | 1 | 1 |
| 2026-08-01 | 폭염 | 42 | 42.0 | 1 | 1 |
| 2026-08-02 | 김민석 | 45 | 34.8 | 1 | 1 |
| 2026-08-03 | 폭염 | 121 | **125.6** | 1 | 1 |

폭염 in fact *gains*: 121 → 125.6 on 2026-08-03. On 07-31 and 08-01 those days
were collected evenly enough that N̄/N_c ≈ 1 for its sections and the number does
not move at all. The same reading taken on *2026-08-04 at 11:00 KST* gives
113 → 118.3, and is a snapshot rather than a measurement for the reason the
balance-factor table above states — that day was still collecting.

This table is here because CLAUDE.md's "Word scoring" section quotes the
121 → 125.6 figure, and a figure quoted in a tracked file has to be traceable to
a tracked one.

**The day the mechanism was built for is 2026-08-04 and it is not in
`analysis.eval_days`.** Not an oversight: it is *today*, the cron collects again
at 15, 19 and 23 KST, and a day that is still moving cannot carry a label set —
rule 4's second trigger, which has already fired once on this branch. Adding it
was considered and declined for exactly that reason.

**Diagnostic, out of band and label-free**, α 0 against α 0.50 on 2026-08-04,
**taken at 20:24 KST** against that reading's section totals. Four words of
seventy swap, in the designed direction:

| move | word | count | top section (total at 20:24) |
| --- | --- | --- | --- |
| leaves | 강도살인 | 6 | society (732) |
| leaves | 오토바이 | 6 | society (732) |
| leaves | 고려아연 | 5 | economy (710) |
| leaves | 근원물가 | 5 | economy (710) |
| enters | 기아 | 5 | culture (391) |
| enters | 무장해제안 | 5 | world (503) |
| enters | 미일 | 5 | world (503) |
| enters | 아이디어 | 5 | world (503) |

The two thickest sections lose four words and two thinner ones gain them; the
thinnest, it at 354, gains nothing. Whether the trade is an improvement is the
question labels answer and this day has none, so **this moves nothing** — it is a
diagnostic in the sense `30_word_scores.sql` is one. It is written down so a
future round knows the effect is real, small and correctly directed before it
pays for the labels, **not so that anyone reproduces these eight words**: the day
is still collecting and the table above shows how far it moved in nine hours.

### What is left active

`24_cap_and_place_configs.sql` now sets `active = (ord in (200))` — the shipped
sieve alone — the way `19_rounds_ten_to_twelve_configs.sql` narrows at its tail.
The nine declined rows stay in the file. Keeping them active is not free: the
four α rows put four more distinct α values into the harness's `alphas` CTE and
each costs one `keyword_signals` call per day. **Round thirteen's own sitting**
measured that as `10_sieve_eval.sql` 4.2s → 24.8s and `20_unlabeled.sql`
4.1s → 23.3s when the four rows went in; **this round's sitting** measures
`10_sieve_eval.sql` at **6.2s** with 200 alone. Those are two sittings and the
pairs are only comparable inside each — the shape they agree on is that the cost
tracks the distinct α count, not the configuration count. And worse than the
seconds, every active row carries a permanent rule-4 obligation, since a later
collection can promote a word onto *its* screen and the worklist will then demand
it be labelled before any row can be read.

Nothing is deleted from the database either. `place_gate` and `balance_alpha`
stay as columns, `analysis.day_edges` stays as a table, and re-activating a row
is one `UPDATE`. The α arm in particular is expected to be re-run once
2026-08-04 stops collecting and can be labelled.

### Migration `0028` turned the place gate on anyway — the round's sharpest finding

The heading above says "none shipped" and it was true for one release cycle.
Migration `0028` turns the place gate **on**. **None of the measurement above is
retracted**: the gate still costs F1 on both surfaces and every word it removes
is still labelled good. What overruled it was looking at the screen.

`0026` shipped the gate off because a measurement is what this project moves a
threshold on. `0028` turns it on because the screen was then looked at and showed
what the labels structurally cannot. Two views of 2026-08-03 one flip apart: the
gate removes 서울, 광주, 인천, 포항, 울산 and 강원 and keeps 부산, 대구, 경남 and
충청 — and **the four it keeps are exactly the four that sit inside a story**
(부산 with 노무현·김용민·돌려차기, 대구 with 경산·경북, 경남 with 양산, 충청 with
김민석), while the six it drops touched nothing or touched only each other.

**The decisive difference is in the event list, not on the canvas.** With the
gate off, that day's **fourth-largest event is "서울 · 광주" at 66 headlines** —
two place names joined to each other and to nothing else, so nothing on the page
can say what those 66 articles are about. With the gate on the row is gone and
"미국 · 중국 · 기아 · 정의선 외 2" at 57 headlines takes its place. That one can be
read. The F1 loss is real and is the price of removing it: 서울 and 광주 are each
independently worth showing, which is precisely why the labels defend them.

So the standing lesson is not "the gate was wrong" or "the harness was wrong" —
it is that **the two were answering different questions, and this file records
which one each can settle.** `analysis.word_labels` answers "is this a word worth
showing". Anything that changes what a word *means on the page* rather than
whether it deserves a place is outside what any label set can price, and has to
be decided by looking. It is the same mismatch that stops the harness pricing the
render cap, one section above.

`word_overrides` mode 'place' is now load-bearing rather than a labelled fact in
reserve: the 45 rows are the gate's whole input.

The gate costs about **1.5×** on the RPC (one sitting, 2026-08-03, all-categories
view: `0018` 1,403 ms, gate off 1,342 ms, gate on 2,056 ms — those three may be
read against each other and against nothing else). Since migration `0032` the
graph is cached, so a reader pays that on a cache miss rather than per request.

### The two wiring migrations were checked rather than asserted

`0024` (the plpgsql fixed-point restructure) and `0025` (`df_balanced` and its α
parameter) both claim to change nothing while α is 0 and the gate is off, and
both were checked: `keyword_graph` is byte-identical to what it drew before on
all **35** cells (five collected days × the all view and six tabs) after `0024`,
and again after `0025`.

Only the edge *ordering* moved, on 18 of the 35 — `0024` added `, a, b` to the
edge sort, and three pairs on 2026-07-31 carry `cooc` 3 and `npmi`
0.80097396756174372838 equal to the last digit, so which came first had been
decided by the query plan. Running both orders through the frontend's own code
moved the Louvain partition on **0** cells, merged events on **0**, and drawn
geometry on 7 — six of them sub-pixel. The one real move is 2026-08-02's all
view, where one region rearranges internally and 전남 travels 137.6 px with the
same partition and the same events; the cause is `forceLink` applying its
velocity updates in link order, not the tie rule.

### The four-day numbers before migrations `0018`–`0022`

Kept because several paragraphs in this file are about that run. Top-70 precision
over the four eval days as of 2026-08-04, the first run on an archive analysed
end to end by one analyser: **75.7 / 70.0 / 70.0 / 68.6**, mean F1 **55.45**, the
drawn set 199 good and 81 bad, and the 24 category cells meaning **57.20**.

The shipped sieve now scores per-day precision **95.7 / 94.3 / 87.0 / 97.1** and
F1 **67.3 / 66.3 / 77.9 / 43.3** on those same four days — mean 93.53 and 63.70,
78.58 on the tabs. Note 2026-08-02 draws **69** words and not 70: at
`min_word_len` 4 only 69 qualify on the archive's thinnest day, so its cap does
not bind and it is not word-count-comparable with anything above.

What that pre-`0018` run establishes, because it is internal to itself: the
shipped configuration beat length-only on all four days day-wide
(57.3/51.6/65.8/47.1 against 55.1/48.4/61.7/45.1) and every `min_headlines`
floor, and on the tabs led at 57.20 against 48.52 for the pre-`0004` scoped
count — so migration `0004`'s finding survived the analyser change intact.

**Do not read the 2026-08-03 column against the one that preceded it** (71.4,
mean F1 67.3). That move was the collector going to six runs a day and the day
going from 900 headlines to 2,197 — not the sieve, and not the analyser.

## Round fifteen — both open questions answered, and neither changes a value

`OPEN.md` items 2 and 3 were both blocked on the same thing: a fat, closed,
labelled day. 2026-08-04 is now all three, so it joined `analysis.eval_days` and
both arms ran. **No `scoring_weights` value moves.** What the round produces is
two sharper statements of rules this file already carried, and one correction.

`unlab` is 0 on every row quoted here, on all three surfaces —
`10_sieve_eval.sql`, all 270 cells of `11_category_eval.sql`, and both
worklists — after two labelling passes (`26_labels_round_fifteen.sql`, 224
words).

### The correction: the harness's shipped row had the place gate off

Migration `0028` turned the gate on. Config 200, named `r14: SHIPPED (cap 70)`,
still carried `place_gate false`. **Since that migration the harness had been
scoring a screen the app does not draw** — the same defect round thirteen found
in this file's own ranking, in a different place. Config **300** is the shipped
sieve as `scoring_weights` actually holds it, and every number below is against
that. 200 is left unedited as "round fourteen's control, gate off", because
several recorded comparisons were taken against it.

This is worth stating as a habit rather than as an incident: **a migration that
changes `scoring_weights` has to change the harness's shipped row in the same
breath**, or the next round measures against a control that no longer exists.

### Question 1 — head_pos as a cut, re-measured on fat days. The demotion stays.

Round five shipped the demotion because the cut won day-wide and lost 8 of 24
category cells, and explained the split by the render cap: a tab drew at most 46
words against a cap of 70, so a cut there was loss with nothing to promote.
Round thirteen then found **the cap does bind on a fat day's tabs**, which
undercut that explanation and reopened the question.

Day-wide, 5 days:

| configuration | mean F1 | mean precision |
| --- | --- | --- |
| **300 SHIPPED (demote .60)** | 55.88 | 87.36 |
| cut .60, no demote | 55.98 | 88.38 |
| cut .65, no demote | 56.20 | 88.66 |
| **cut .70, no demote** | **56.24** | 88.42 |
| head_pos off entirely | 55.80 | 87.36 |

Category tabs, 30 cells (5 days × 6 sections):

| configuration | mean F1 | mean precision | mean shown |
| --- | --- | --- | --- |
| **300 SHIPPED (demote .60)** | **73.04** | 79.55 | 43.8 |
| cut .70, no demote | 72.62 | 81.06 | 42.3 |
| cut .65, no demote | 72.08 | 81.52 | 41.5 |
| cut .60, no demote | 71.59 | 82.25 | 40.4 |
| head_pos off entirely | 71.87 | 78.21 | 43.8 |

**The signature is exactly round five's — a day-wide win with a category loss —
and it survives the fat day.** The cut takes +0.36 F1 day-wide and gives back
0.42 on the tabs.

**But the reason round five gave is not the reason it happens**, and this is the
finding. Per day on the tabs, cut .70 against the shipped demotion:

| day | cells at the cap | cut .70 | ships | |
| --- | --- | --- | --- | --- |
| 2026-07-31 | 0/6 | 80.80 | 81.62 | cut loses |
| 2026-08-01 | 0/6 | 79.73 | 80.57 | cut loses |
| 2026-08-02 | 0/6 | 80.60 | 80.40 | cut wins |
| 2026-08-03 | 3/6 | 71.77 | 71.72 | cut wins |
| **2026-08-04** | **5/6** | **50.18** | **50.88** | **cut loses** |

On the fattest day, where five of six tabs fill the cap, the cut still loses.
The prediction "give the cut a binding cap and it will win on the tabs too" is
**measured and false**, and `shown` says why: 69.2 under the demotion against
67.8 under the cut. **A cut cannot rely on the cap binding, because cutting is
what stops it binding.** Removing words shrinks the qualifying pool; where the
pool sat just above 70, the cut takes it under, and from there the cut is pure
loss with nothing to promote — the same mechanism as a thin day, now arriving on
a fat one through the cut's own action.

That is the general form worth keeping, and it is stronger than the render-cap
argument it replaces: **a mechanism that removes candidates cannot be justified
by the substitution it enables, because it is also spending the surplus that
substitution depends on.** A demotion has no such feedback — it reorders and
removes nothing, so the pool it draws from is the pool it found.

### Question 2 — α on the day it was built for. Still does not ship, and now we know why.

Round fourteen recorded α as *not measurable on this day set*. It is measurable
now, and the answer is specific.

| α | mean F1 | mean precision |
| --- | --- | --- |
| **0 (ships)** | **55.88** | **87.36** |
| .25 | 55.28 | 86.50 |
| .50 | 55.28 | 86.50 |
| .75 | 55.40 | 86.78 |
| 1.00 | 55.54 | 87.06 |

α loses at every setting. **And the whole loss is on one day — the one day with
nothing to correct.** Balance factors per eval day, at α = 1:

| day | min | max | spread | F1 at α 0 → α 1 |
| --- | --- | --- | --- | --- |
| 2026-07-31 | 0.999 | 1.006 | **1.01** | 67.3 → **64.3** |
| 2026-08-01 | 0.742 | 1.869 | 2.52 | 64.3 → 64.3 |
| 2026-08-02 | 0.773 | 1.294 | 1.67 | 77.1 → 77.1 |
| 2026-08-03 | 0.808 | 1.201 | 1.49 | 42.0 → **42.7** |
| 2026-08-04 | 0.690 | 1.686 | 2.44 | 28.7 → **29.3** |

2026-07-31 collected 150/149/150/150/150/150 in a single capped run, so its
factors sit within 0.6% of 1 and α has nothing to do there but perturb a `df`
tie in the third decimal — and it costs three good words. On the three days with
real imbalance α is neutral or **positive**, including the day the mechanism was
built for.

**So α is not wrong; applying it to days that do not need it is.** Gating it on
the day's own spread scores **56.14 / 87.92** against the shipped 55.88 / 87.36
— but that figure is *arithmetic over rows already measured*, the way round
fourteen scored the demotion at 62.88, not a run of its own. **+0.26 F1 does not
buy a new threshold**: the spread cut-off would need tuning, would carry its own
permanent rule-4 obligation, and sits inside the noise of a five-day mean. The
shape is recorded so the next attempt starts from it rather than from α applied
flat.

### Two notes on the instruments

`11_category_eval.sql` gained a head_pos axis — `max_hp` and `demote_hp` per
variant, both null meaning "whatever ships" — because the cut and the demotion
had only ever been readable from `scoring_weights`, so no variant could move
them. The five pre-existing variants are **byte-identical** before and after the
patch, checked row by row.

**It still has no sieve 6**, so every row in it is gate-free. That is sound for
this round's question, where both arms are equally gate-free and the comparison
is internal, but it is not the shipped screen. The gate's own tab numbers came
from the deployed RPC for that reason, and still would. That limitation is now
stated in `11_category_eval.sql`'s own header rather than only here.

## Round sixteen — α earns its place, and two silent holes turn up on the way

`OPEN.md`'s one reopenable item was α gated on the day's own imbalance. Round
fifteen scored it **56.14 / 87.92** against the shipped 55.88 / 87.36 and
declined it, on two grounds worth restating because only one of them survives:
the figure was *arithmetic over rows measured for another question*, and +0.26
mean F1 looked too thin to buy a threshold.

Both grounds are answerable now, and the answers came in the order the objection
was made. 2026-08-05 (spread 2.48) and 08-06 (2.21) joined `analysis.eval_days` —
closed days, same `collect_cap` 150 regime — and `analysis.sieve_configs` gained
`alpha_min_spread`, which makes the α slice a function of (configuration, **day**)
so a gated row is **run** rather than inferred.

`unlab` is 0 on every row quoted here: `10_sieve_eval.sql`'s 63 rows, all 378
cells of `11_category_eval.sql`, and both worklists, after `28_labels_round_sixteen.sql`
(304 words).

### The measurement

Seven days. Configurations 310-313 are round fifteen's flat sweep, reactivated so
this run carries its own control; 320-323 gate it. Balance spread per day —
`max/min` over `category_balance_factors(d, 1)` — is on the last line.

| configuration | 07-31 | 08-01 | 08-02 | 08-03 | 08-04 | 08-05 | 08-06 | mean F1 | mean prec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **300 SHIPPED (α 0)** | 67.3 | 64.3 | 77.1 | 42.0 | 26.8 | 38.1 | 35.8 | 50.20 | 86.49 |
| 310 flat α .25 | **64.3** | 64.3 | 77.1 | 42.0 | 26.8 | 38.7 | 35.8 | 49.86 | 86.07 |
| 311 flat α .50 | **64.3** | 64.3 | 77.1 | 42.0 | 26.3 | 39.4 | 35.8 | 49.89 | 86.07 |
| 312 flat α .75 | **64.3** | 64.3 | 77.1 | 42.0 | 26.8 | 39.4 | 35.8 | 49.96 | 86.29 |
| 313 flat α 1.00 | **64.3** | 64.3 | 77.1 | 42.7 | 26.8 | 39.4 | 36.4 | 50.14 | 86.69 |
| **320 α 1.00, spread ≥ 1.2** | 67.3 | 64.3 | 77.1 | **42.7** | 26.8 | **39.4** | **36.4** | **50.57** | **87.30** |
| 321 α .50, spread ≥ 1.2 | 67.3 | 64.3 | 77.1 | 42.0 | 26.3 | 39.4 | 35.8 | 50.31 | 86.69 |
| 322 α 1.00, spread ≥ 1.6 | 67.3 | 64.3 | 77.1 | 42.0 | 26.8 | 39.4 | 36.4 | 50.47 | 87.10 |
| 323 α 1.00, spread ≥ 2.0 | 67.3 | 64.3 | 77.1 | 42.0 | 26.8 | 39.4 | 36.4 | 50.47 | 87.10 |
| *spread* | *1.01* | *2.52* | *1.67* | *1.49* | *2.44* | *2.48* | *2.21* | | |

`shown` is 69.7 for every row — α reorders and removes nothing — and
`story_rank` is 1 on all 63 rows, so rule 5 is clear throughout.

### The verdict is not the mean, and saying why matters more than the number

**Adding two imbalanced days makes the day set six-to-one imbalanced, so any
mechanism that helps on imbalanced days and is the identity elsewhere will lift a
seven-day mean almost by construction.** That number is close to tautological and
is not what this round rests on. Three things are:

- **320 equals 300 exactly on 2026-07-31.** By construction it must — spread 1.01
  is below every threshold here, so the gated rows fall back to α = 0 that day —
  and a single word of difference would have meant the fallback was miswired.
  It is the implementation check, and it passes.
- **320 does not lose a single day.** Per-day against the shipped row:
  +0.0 / +0.0 / +0.0 / **+0.7** / +0.0 / **+1.3** / **+0.6**. Three days better,
  four identical, none worse. **Weak dominance is a different kind of fact from a
  better average**, and round fifteen never had one — its flat α lost 3.0 points
  on 07-31 to buy its gains.
- **It strictly dominates flat α too.** 320 against 313 is +3.0 on 07-31 and
  identical on all six other days. So the gain is the *gating*, not the exponent.

### The threshold is not "how imbalanced" — it is "imbalanced at all"

The sweep says something sharper than "1.2 works". 322 and 323 lift the threshold
to 1.6 and 2.0 and both score **50.47**, below 320's 50.57, because they take
2026-08-03 (spread 1.49) out of α and α is worth +0.7 there. Meanwhile anything
at or below 1.01 is flat α, which is worse again.

So the optimum is any value in **(1.01, 1.49]** and it is an interior one in the
sense rule 2 asks for: **both directions are worse.** 1.2 is mid-plateau, the same
way `min_standalone` sits at 0.10 because .05–.30 are identical — it is a plateau
midpoint and must not be quoted as a tuned number.

What that shape means is the finding: the only day α damages is the one whose six
sections collected 150/149/150/150/150/150 in a single capped run, where the
balance factors span 0.6% and α does nothing but perturb a `df` tie in the third
decimal — at a cost of three good words. **Every day with any real imbalance at
all wants α, including the mildest one in the archive.** The gate is a guard
against a degenerate input, not a dosage.

α .50 gated (321) scores 50.31 and loses 0.5 on 08-04, so the magnitude is not
free either: gated **α = 1.00** is the configuration, not gating on its own.

### It is earned and it is not shipped yet — deliberately

No `scoring_weights` value moves in this round. Turning it on means the gating
has to exist **database-side**, where `keyword_signals`' α default is a single
constant with no per-day branch, and that is its own change with its own
migration: a `category_balance_alpha_min_spread` key, an α resolution that reads
`category_balance_factors(p_date, 1)`, and — by this file's own standing rule —
the harness's shipped configuration row moved in the same breath. `OPEN.md`
carries it as the one open item this round leaves.

### Two silent holes, both found by instruments rather than by reading

Neither was what the round was looking for, and both are the same species: a
derived thing that did not follow the thing it derives from.

**`analysis.day_edges` did not follow `analysis.eval_days`.** It is a base table
built from that day list, and round fifteen added 2026-08-04 without rebuilding
it. Sieve 6 reads "no edge" as "drop this place", so on that day every gated
configuration dropped all three of its places and promoted three deeper words.
Measured by deleting the day again to reproduce the state exactly: **6 of 45 cells
move, all 08-04, each by one word.** The shipped row does not move at all — 55.88
either way — and neither of round fifteen's conclusions changes; α still loses
flat, by slightly more once corrected. The table is built at the foot of
`12_eval_days.sql` now, beside the list it derives from, so the two cannot part
company again.

**`21_unlabeled_category.sql` did not follow `11_category_eval.sql`.** Round
fifteen added the head_pos axis (`max_hp` / `demote_hp`, variants 10-13) to the
harness and not to its worklist, so the worklist could not see the cut variants'
screens. **The harness reported `unlab` 6 on variant 13 while the worklist
returned nothing** — which is the only way this is findable, because *a worklist
cannot report its own blind spot.* Five words came out once the axis was
restored, all bad, one of them (`비즈360`) another bracketed section tag.

The general form is worth more than either case: **the instrument that detects a
missing worklist entry is the harness's own `unlab` column, not the worklist.**
Read `unlab` on the harness even when the worklist is empty — an empty worklist
is evidence about the worklist.

### The tabs, on seven days

`11_category_eval.sql` is this round's control and not its measurement: α is the
identity inside a category tab at every α by construction, so the file carries no
α axis. What it does say is that round fifteen's other conclusion survives two
more days — the demotion still beats the cut on the tabs.

| variant | cells | prec | F1 | shown |
| --- | --- | --- | --- | --- |
| **sieve1 day >= 3 (ships)** | 42 | 77.55 | **70.94** | 50.7 |
| ships, standalone >= .50 | 42 | 77.55 | 70.94 | 50.7 |
| ships, standalone off | 42 | 76.35 | 70.92 | 51.7 |
| r15: cut .70, no demote | 42 | 78.49 | 70.36 | 49.3 |
| r15: cut .65, no demote | 42 | 78.91 | 69.82 | 48.4 |
| r15: cut .60, no demote | 42 | 79.83 | 69.66 | 47.4 |
| r15: head_pos off entirely | 42 | 75.57 | 69.25 | 50.7 |
| sieve1 day >= 3 and scoped >=2 | 42 | 77.47 | 60.83 | 42.5 |
| sieve1 scoped >= 3 (pre-0004) | 42 | 77.74 | 53.21 | 35.4 |

**These are gate-free numbers and are not the shipped tab** — see the next
section for that.

### The shipped tab, measured for the first time

`29_gate_on_category.sql` reads `keyword_graph_compute(d, cat)` for every eval
day and section and scores the result with **the metric formulas above,
unchanged**, so the two tables are the same measurement of two different screens.
This is what a reader of a category tab actually sees.

| section | cells | shown | prec | recall | F1 |
| --- | --- | --- | --- | --- | --- |
| world | 7 | 52.7 | 84.97 | 73.42 | **78.65** |
| it | 7 | 47.1 | 71.78 | 72.19 | 71.83 |
| culture | 7 | 37.7 | 76.41 | 63.81 | 68.76 |
| politics | 7 | 54.0 | 78.94 | 59.82 | 67.96 |
| economy | 7 | 50.7 | 73.13 | 59.50 | 64.96 |
| society | 7 | 53.3 | 74.93 | 48.09 | **58.50** |
| **all 42 cells** | 42 | 49.3 | **76.69** | 62.80 | **68.44** |

**Do not put this table beside the one above it, or beside round fourteen's
78.58 → 75.22.** Different screen in the first case; a label set that has grown
twice in the second. The rule is unchanged — compare configurations inside one
run, never against a number someone wrote down.

What it does support, because it is internal to one run, is the spread across
sections: **world scores 78.65 and society 58.50**, and the gap is recall
(73.42 against 48.09) rather than precision (84.97 against 74.93). Society is
the section that collects most — 1,019 headlines on 2026-08-04 against `it`'s
417 — so its good pool is largest while its tab still holds at most 70 words.
That is the same thickness effect this file already records for F1 across days,
appearing across *sections* within a day. It is not evidence that the sieve is
worse at society.

### It needed a third worklist, and finding that out was the third instance

The first run reported `unlab` **6** while both existing worklists returned
nothing. Neither can cover this screen, and the reason is structural rather than
an oversight: **the gate does not only remove places — freeing a slot under the
render cap promotes a deeper word into it**, and a promoted word can be one no
gate-free screen has ever drawn. `23_unlabeled_gate_on.sql` is that worklist. It
returned five words (구로, 변희재, 현대百 good; 위기상황, 정년연장 bad), and
`unlab` is 0 on all 42 cells above.

Three holes of one species in one round — `day_edges` not following `eval_days`,
`21` not following `11`, and now no worklist following the gated screen — is
enough to state the rule plainly: **every screen the harness scores needs a
worklist that draws the same screen, and the thing that detects a missing one is
the harness's own `unlab` column.** An empty worklist is evidence about the
worklist.

## Labels

**1,532 words as of round sixteen** (608 good, 924 bad), covering everything
drawn by every **active** configuration in `analysis.sieve_configs`, every
variant in `11_category_eval.sql`, and the deployed gated screen, across the
seven days in `analysis.eval_days` — 2026-07-31 through 08-06. All three
worklists — `20_unlabeled.sql`, `21_unlabeled_category.sql` and
`23_unlabeled_gate_on.sql` — return nothing, so rule 4 is satisfied.

Round sixteen alone added 304, which is what two new days plus two worklists
that had never run against those screens cost.

The paragraph below is kept as written, at 891 and four days, because the
figures it explains were taken then. **That is the rule this section is about:
every percentage in this file moves when the label set grows, so a number is only
comparable to others from its own run.**

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
| `12_eval_days.sql` | The days under test, each one's biggest story, **and `analysis.day_edges` derived from that list** — apply before everything below it |
| `13_labels_wider_collection.sql` | Labels the six-runs-a-day collection promoted, and the four ambiguous ones re-decided |
| `14_labels_after_reanalysis.sql` | Labels the garu re-analysis of the whole archive promoted |
| `15_labels_category_after_reanalysis.sql` | The same for the category variants |
| `16_proper_noun_configs.sql` | Round ten: the `min_proper` rescue, and the column it needed |
| `17_labels_two_character.sql` | Labels the two-character control (`min_word_len` 2) exposed |
| `18_labels_two_character_category.sql` | The same for the category variants |
| `19_rounds_ten_to_twelve_configs.sql` | Rounds ten to twelve, and the old sieve kept as a live row so the decomposition stays measurable |
| `20_unlabeled.sql` | Words on the all-categories screens with no label — must be empty before the harness counts |
| `21_unlabeled_category.sql` | The same worklist for `11_category_eval.sql`'s tab variants |
| `22_labels_after_demotion_fix.sql` | Labels the head_pos demotion fix promoted |
| `23_unlabeled_gate_on.sql` | The same worklist for the **gated** screen `29` scores — the other two cannot see it |
| `24_cap_and_place_configs.sql` | Round fourteen: the render cap, the place gate and α, and the columns they needed |
| `25_round_fifteen_configs.sql` | Round fifteen: head_pos as a cut on a fat day, α re-run, and the shipped-row correction |
| `26_labels_round_fifteen.sql` | Labels round fifteen exposed |
| `27_round_sixteen_configs.sql` | Round sixteen: `alpha_min_spread`, and α gated on the day's own imbalance |
| `28_labels_round_sixteen.sql` | Labels round sixteen exposed — two new days and three worklists |
| `29_gate_on_category.sql` | The **shipped** tab, read from the deployed RPC because sieve 6 must not be copied a third time |
| `30_word_scores.sql` | One day's words with every signal and the sieve's verdict beside each |
| `31_fragments.sql` | Words that look like pieces of longer words, with the longer word beside them |

**The three worklists are not interchangeable and each covers a screen the others
cannot.** `20` covers `analysis.sieve_configs`' all-categories screens, `21`
covers `11_category_eval.sql`'s gate-free tabs, `23` covers the deployed gated
screen. Round sixteen found all three of those boundaries the hard way, each time
by reading `unlab` on a harness while the worklist beside it said nothing.

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
