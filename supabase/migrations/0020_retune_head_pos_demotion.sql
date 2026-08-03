-- 0020: `demote_head_pos` 0.70 -> 0.60.
--
-- The third threshold in a row invalidated by migration `0018`, and by now the
-- pattern is the finding rather than any one number: **a clause that admits a
-- new kind of word invalidates every threshold tuned when that kind could not
-- appear.** The proper-noun rescue put 13 to 21 two-character names on each
-- day's canvas, and `demote_head_pos` was fitted in round six on a screen that
-- had none of them.
--
-- Re-swept, four days, `unlabeled` 0:
--
--   demote_head_pos   mean F1   mean precision   story_rank
--     0.50             53.30        77.15        **DROPPED** on 2026-07-31
--     0.55             54.12        78.22        1 1 1 1
--     0.60 (this)      54.10        77.85        1 1 1 1
--     0.65             54.18        77.85        1 1 1 1
--     0.70 (was)       53.02        76.05        1 1 1 1
--     off              51.40        73.58        1 1 1 1
--
-- 0.55, 0.60 and 0.65 are one plateau, flat to within 0.08, and all of them beat
-- 0.70 by about a point of F1 and nearly two of precision. **0.50 is a cliff and
-- not a continuation of the slope**: it scores well and is rejected outright,
-- because it sinks 폭염 off 2026-07-31's screen. Round six recorded exactly that
-- ("at 0.50 폭염 sinks to rank 66 on 2026-07-31 and off the screen on 08-03"),
-- so the cliff is where it always was — what moved is the plateau, from 0.70
-- down to the edge of it.
--
-- 0.60 rather than 0.65's marginally better F1: mid-plateau, and a full 0.10
-- clear of the cliff. Rule 5 of `scripts/analysis/README.md` is not a tie-break
-- to be spent, and a threshold one step from dropping the day's biggest story is
-- not worth 0.08 of F1.
--
-- **No category measurement accompanies this, and that is correct rather than an
-- omission.** A demotion reorders; it removes nothing. It can only change what
-- is drawn where the render cap is binding, and a tab draws at most 46 words
-- against a cap of 70, so it never binds there. Round six measured this and
-- found the category mean unchanged to the decimal. `11_category_eval.sql` does
-- not model the demotion at all, for the same reason.

update public.scoring_weights
   set value = 0.60,
       note  = 'sieve 5: a word trailing the headline is a qualifier, not the story. A demotion, not a cut — see 0015. Retuned from 0.70 in 0020 after the 0018 rescue changed what fills the cap.'
 where key = 'demote_head_pos';
