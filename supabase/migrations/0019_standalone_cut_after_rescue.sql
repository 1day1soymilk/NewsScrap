-- 0019: raise the fragment cut from 0.10 to 0.50.
--
-- **This reverses a finding, and the reason it is allowed to is that the
-- circumstance it was measured under no longer exists.**
--
-- Round four measured `min_standalone` across .05 to .30 and found them
-- identical, so 0.10 was recorded as mid-plateau and the clause as costing
-- nothing either way: six words were kept off screen by it and nothing else, and
-- all six were labelled bad. That measurement was taken when **no word under
-- three characters could reach the canvas at all**, so the cut was only ever
-- looking at long words, and long words are rarely fragments.
--
-- Migration `0018` changed exactly that. The proper-noun rescue admits a word on
-- the tagger's say-so regardless of length, and the tagger has no opinion about
-- whether the string is a piece of something bigger: 닉스 is `삼전닉스` cut at
-- the second syllable, tagged NNP, `standalone` 0.14, and it reached the screen
-- on two of the four days. 어스 is `구글 어스`. **The rescue gave the fragment
-- cut new work to do, so the threshold had to be re-swept.**
--
-- Measured, four days and 24 category cells, `unlabeled` 0 and `story_rank` 1
-- throughout:
--
--   min_standalone   day-wide F1   day-wide precision   category F1
--     0.10 (was)         52.40           75.00             66.44
--     0.30               52.87           75.70               —
--     0.50 (this)        53.12           76.05             67.02
--     0.70               52.55           75.35               —
--
-- **Wins on both surfaces and the peak is interior**, 0.30 and 0.70 falling away
-- on either side — not a boundary optimum, which is rule 2 of
-- `scripts/analysis/README.md`.
--
-- **The cost is named rather than hidden.** Ten words leave the screen across the
-- four days: seven bad (닉스 twice, 수도권, 최고위원, 경찰관, 한국 twice) and
-- three good — 우크라, 충청 and 해남. The three are the 조사 blind spot this
-- signal is known to have: Korean attaches a particle without a space, so 해남에
-- and 우크라의 score as fragments exactly as 도체 inside 반도체 does. Round four
-- said not to build a particle-aware variant because it would rescue three bad
-- words and carry no measurement; that is still true, and this migration does not
-- build one. It moves a number, which the harness can price.
--
-- 오만 is the sharpest single loss and worth knowing about: it is the country in
-- the Hormuz story, labelled good, and scores 0.00 because every one of its
-- headlines writes 오만과. It was never on screen before `0018` and is not on
-- screen after this.

update public.scoring_weights
   set value = 0.50,
       note  = 'sieve 2: fragments score 0.00, whole words 0.85-1.00. Raised from 0.10 in 0019 — the 0018 rescue admits NNP words of any length, so this clause now has fragments to catch (닉스, 어스).'
 where key = 'min_standalone';
