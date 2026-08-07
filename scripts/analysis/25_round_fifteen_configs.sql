-- scripts/analysis/25_round_fifteen_configs.sql
--
-- Round fifteen: the two questions OPEN.md left open, plus one correction that
-- has to land before either of them can be read.
--
--   scripts/analysis/run.sh scripts/analysis/25_round_fifteen_configs.sql
--
-- **The correction first, because it invalidates round fourteen's own shipped
-- row.** Migration 0028 turned the place gate on. Config 200 — the row named
-- 'r14: SHIPPED (cap 70)' — still carries `place_gate false`, so since that
-- migration the harness has been scoring a screen the app does not draw. That is
-- exactly the defect round thirteen found in 11_category_eval.sql's ranking, in
-- a different place, and it means every number taken against 200 after 0028 is
-- measuring the wrong control. 300 below is the shipped sieve as
-- `scoring_weights` actually holds it today.
--
-- Read 200 as "round fourteen's control, gate off" from here on. It is left
-- active-able and unedited for the same reason 180 is: it is what several
-- recorded comparisons were taken against, and rewriting it would make those
-- numbers unreproducible.
--
-- ---------------------------------------------------------------------------
--
-- **Question 1 (OPEN.md item 2): is head_pos better as a cut than as a
-- demotion, now that fat days exist?**
--
-- Round five measured the cut winning day-wide (65.05 → 67.30, three wins, no
-- losses) and losing on the tabs (65.08 → 63.42, eight losses, no wins), and
-- read the split off the render cap: day-wide the cap binds, so a cut promotes a
-- deeper word and the *substitution* is the gain; a tab drew at most 46 words
-- against a cap of 70, so a cut there was loss with nothing to fill the hole.
-- The demotion ships because it can only act where a substitution exists.
--
-- Round thirteen then found that **the cap does bind on a fat day's tabs** —
-- 2026-08-03 puts 95 to 163 qualifying words on each of its six. So the second
-- half of that argument is now only true of thin days, and the question is open
-- again on its own terms rather than as a matter of taste.
--
-- 301/302/303 are the cut at three thresholds with the demotion off; 304 is
-- neither, as the floor that says how much either mechanism is worth. All four
-- carry the gate, so they are read against 300 and nothing else moves.
--
-- **Both arms are meaningless without a fat day**, which is why 12_eval_days.sql
-- gains 2026-08-04 in the same change.
--
-- ---------------------------------------------------------------------------
--
-- **Question 2 (OPEN.md item 3): α, re-run on the day it was built for.**
--
-- 24_cap_and_place_configs.sql's tail says α should be re-measured once
-- 2026-08-04 stops collecting and can be labelled. It has, and it is. Round
-- fourteen's finding was not "α costs something" but "α is not measurable on
-- this day set": the only day it lost on collected 150/149/150/150/150/150 in a
-- single capped run, so its balance factors sit within 0.6% of 1 and there is
-- nothing there to correct. 2026-08-04 is the imbalanced day — society took its
-- whole 150-headline window twice while `it` never passed 98 on any of five
-- runs — and it is now closed.
--
-- 310-313 sweep α on top of **300**, not 200, for the reason the correction
-- above exists.
--
-- **α is the identity inside a category tab, at every α, by construction**, so
-- 11_category_eval.sql is this arm's control rather than its measurement: every
-- drawn row in section c carries the same factor, making `count_balanced` a
-- constant times `count`. If its number moves, α has reached a scoped count
-- where it should have been day-wide.
--
-- ---------------------------------------------------------------------------
--
-- **Cost.** Every distinct α in the active set costs one `keyword_signals` call
-- per day. 300-304 share α 0; 310-313 add four more. Activate one arm at a time
-- — the tail of this file does the head_pos arm, and the α arm is one UPDATE.
-- And every active row carries a permanent rule-4 obligation, so narrow back to
-- 300 when the round reports.

insert into analysis.sieve_configs
  (ord, name, min_headlines, min_standalone, min_word_len, min_spec, max_npd,
   max_head_pos, demote_head_pos, min_proper, use_dict, render_cap, place_gate,
   balance_alpha)
values
  -- The shipped sieve as scoring_weights holds it today: gate ON since 0028.
  (300, 'r15: SHIPPED (gate on)',      3, 0.50, 4, 9.90, -1.0, 9.90, 0.60, 0.50, true, 70, true, 0.00),
  -- head_pos as a cut, demotion off, at three thresholds around round five's 0.70.
  (301, 'r15: cut .60, no demote',     3, 0.50, 4, 9.90, -1.0, 0.60, 9.90, 0.50, true, 70, true, 0.00),
  (302, 'r15: cut .65, no demote',     3, 0.50, 4, 9.90, -1.0, 0.65, 9.90, 0.50, true, 70, true, 0.00),
  (303, 'r15: cut .70, no demote',     3, 0.50, 4, 9.90, -1.0, 0.70, 9.90, 0.50, true, 70, true, 0.00),
  -- Neither. The floor that prices the mechanism rather than the threshold.
  (304, 'r15: head_pos off entirely',  3, 0.50, 4, 9.90, -1.0, 9.90, 9.90, 0.50, true, 70, true, 0.00),
  -- α on top of the real shipped row. 300 is α 0 and is this arm's control too.
  (310, 'r15: alpha .25 (gate on)',    3, 0.50, 4, 9.90, -1.0, 9.90, 0.60, 0.50, true, 70, true, 0.25),
  (311, 'r15: alpha .50 (gate on)',    3, 0.50, 4, 9.90, -1.0, 9.90, 0.60, 0.50, true, 70, true, 0.50),
  (312, 'r15: alpha .75 (gate on)',    3, 0.50, 4, 9.90, -1.0, 9.90, 0.60, 0.50, true, 70, true, 0.75),
  (313, 'r15: alpha 1.00 (gate on)',   3, 0.50, 4, 9.90, -1.0, 9.90, 0.60, 0.50, true, 70, true, 1.00)
on conflict (ord) do update set
  name = excluded.name, min_headlines = excluded.min_headlines,
  min_standalone = excluded.min_standalone, min_word_len = excluded.min_word_len,
  min_spec = excluded.min_spec, max_npd = excluded.max_npd,
  max_head_pos = excluded.max_head_pos, demote_head_pos = excluded.demote_head_pos,
  min_proper = excluded.min_proper, use_dict = excluded.use_dict,
  render_cap = excluded.render_cap, place_gate = excluded.place_gate,
  balance_alpha = excluded.balance_alpha;

-- **Narrowed to 300 now that the round has reported.** Both arms were run — arm
-- one as `(300, 301, 302, 303, 304)`, arm two as `(300, 310, 311, 312, 313)` —
-- and neither moved a value in `scoring_weights`. Every extra active row costs a
-- permanent rule-4 obligation and every extra distinct α costs one
-- `keyword_signals` call a day, so the round leaves one row behind, the way
-- 19_ and 24_ narrow at their tails. Re-activating either arm is one UPDATE.
update analysis.sieve_configs
  set active = (ord in (300));

select ord, name, max_head_pos, demote_head_pos, render_cap, place_gate, balance_alpha
from analysis.sieve_configs where active order by ord;
