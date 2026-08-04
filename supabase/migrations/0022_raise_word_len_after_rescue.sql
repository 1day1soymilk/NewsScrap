-- 0022: `min_word_len` 3 -> 4.
--
-- The fourth threshold invalidated by migration `0018`, and the one that started
-- the whole sequence — the rescue was built to pay the length clause's price and
-- it turns out to have changed what the clause should charge.
--
-- **The length bar was doing two jobs.** It kept fragments out, and it kept
-- names in, because a name is usually long enough to clear it. The proper-noun
-- rescue took the second job away. Freed of it, the bar can rise: three-character
-- common nouns were what it had always been set too low to catch, and it could
-- not be raised before without throwing 이란 and 서울 out with them.
--
-- Measured in one label run, both worklists empty, `story_rank` 1 throughout:
--
--   min_word_len   day-wide F1   precision   shown   category F1
--     3 (was)         62.03         90.35     70.0      73.21
--     4 (this)        63.70         93.53     69.8      78.58
--     5               63.58         97.00     65.8      77.80
--
-- Wins on both surfaces. 5 reaches 97% precision and is rejected on `shown`: it
-- cannot fill the canvas, which is round seven's cost exactly — a configuration
-- that draws 65.8 of 70 places is showing less news, and the recall denominator
-- is fixed so F1 already prices that.
--
-- **The category number only became measurable because the harness was wrong,
-- and the reason it was wrong is worth more than this threshold.**
-- `11_category_eval.sql` ranked by `df desc, word` while `keyword_graph` ranks
-- by the head_pos demotion first. That disagreement was invisible while the
-- standing claim held that a tab never fills the render cap — a reordering that
-- changes no membership cannot change a screen that draws everything. **The
-- claim is false on a fat day.** 2026-08-03 puts 95 to 163 qualifying words on
-- each of its six tabs against a cap of 70, and 2026-08-01's society tab 77;
-- seven of the 24 cells bind. On those seven the harness had been scoring a
-- screen the app does not draw.
--
-- That also means the argument for shipping head_pos as a demotion rather than a
-- cut — "a tab draws at most 46 words, the cap never binds, so a cut there is
-- loss with nothing to fill the hole" — **is not true on fat days and should be
-- re-measured** rather than assumed. The demotion is not wrong; its stated
-- reason is now only partly right, and CLAUDE.md says so.

update public.scoring_weights
   set value = 4,
       note  = 'sieve 4a: raised from 3 in 0022. The 0018 rescue carries names now, so the length bar no longer has to be low enough to admit them and can catch 3-character common nouns instead. len 5 scores 97% precision and is rejected on shown — it cannot fill the canvas.'
 where key = 'min_word_len';
