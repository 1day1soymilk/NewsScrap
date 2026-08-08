-- scripts/analysis/27_round_sixteen_configs.sql
--
-- Round sixteen: α, gated on the day's own imbalance, as a **measured
-- configuration** rather than as arithmetic over rows measured for something
-- else.
--
--   scripts/analysis/run.sh scripts/analysis/12_eval_days.sql          -- 7 days now
--   scripts/analysis/run.sh scripts/analysis/27_round_sixteen_configs.sql
--   scripts/analysis/run.sh scripts/analysis/20_unlabeled.sql          -- must be empty
--   scripts/analysis/run.sh scripts/analysis/21_unlabeled_category.sql -- must be empty
--   scripts/analysis/run.sh scripts/analysis/10_sieve_eval.sql
--
-- ---------------------------------------------------------------------------
--
-- **What round fifteen actually established, and what it could not.** α loses
-- at every flat setting, and the entire loss sits on 2026-07-31 — the one day
-- that collected 150/149/150/150/150/150 in a single capped run, so its balance
-- factors span 0.999–1.006 and α has nothing there to correct but a `df` tie in
-- the third decimal. On days with real imbalance α was neutral or positive.
--
-- The conclusion drawn was "α is not wrong; applying it to days that do not
-- need it is", and gating it on the day's spread was scored **56.14 / 87.92**
-- against the shipped 55.88 / 87.36. But that figure was *arithmetic over rows
-- already measured* — the same move round fourteen used to score the head_pos
-- demotion at 62.88 without running it — and +0.26 F1 was judged too little to
-- buy a threshold that would need tuning and carry a permanent rule-4
-- obligation.
--
-- Two things have changed since, and both were needed:
--
--   * **The day set can now see the mechanism.** 2026-08-05 (spread 2.48) and
--     2026-08-06 (2.21) are closed, collected under the same `collect_cap` 150
--     regime, and are in analysis.eval_days as of this round.
--   * **The harness can now express it.** `alpha_min_spread` below makes the α
--     slice a function of (configuration, day) instead of configuration alone,
--     so a gated row is run rather than inferred.
--
-- ---------------------------------------------------------------------------
--
-- **The column, and why null is the whole compatibility story.**
--
-- 10_sieve_eval.sql and 20_unlabeled.sql pick their α slice with
--
--     when alpha_min_spread is null       then balance_alpha       -- old behaviour
--     when spread >= alpha_min_spread     then balance_alpha
--     else 0
--
-- so every configuration written before this round takes the first branch and
-- is bit-for-bit what it was. That is checked rather than asserted: run the
-- harness on the previous active set before and after this file and diff.
alter table analysis.sieve_configs
  add column if not exists alpha_min_spread numeric;

-- ---------------------------------------------------------------------------
--
-- **The threshold is a plateau and is reported as one.** Spread over the seven
-- eval days is
--
--     07-31  1.01     08-04  2.44
--     08-01  2.52     08-05  2.48
--     08-02  1.67     08-06  2.21
--     08-03  1.49
--
-- so *any* value in (1.01, 1.49] splits the set the same way — one balanced day
-- out, six imbalanced days in. 320/321 sit in the middle of that plateau at 1.2.
-- They are not a tuned number and must not be quoted as one; the same shape as
-- `min_standalone` sitting at 0.10 because .05 through .30 are identical.
--
-- 322 and 323 are the two thresholds that actually move the partition — 1.6
-- drops 08-03 out of α as well, 2.0 drops 08-02 and 08-03 — and they are here
-- to show that shape, not to find an optimum. If one of them wins by enough to
-- matter, that is a finding about *which* days want α and not a licence to
-- tune the number.
--
-- 321 exists because α's magnitude and α's gating are separate questions and
-- the round should not confound them: if gating helps, it should help at .50
-- as well as at 1.00.
--
-- 310-313 are round fifteen's flat sweep, reactivated so the seven-day run
-- carries its own control instead of being compared to a written-down number —
-- rule: compare configurations inside one run.
--
-- **Cost is unchanged.** The distinct α count is what the harness pays for, and
-- it is still {0, .25, .50, .75, 1.00}: the gated rows reuse slices the flat
-- rows already ask for. What grows is the day count, 5 → 7.
insert into analysis.sieve_configs
  (ord, name, min_headlines, min_standalone, min_word_len, min_spec, max_npd,
   demote_head_pos, min_proper, use_dict, render_cap, place_gate, balance_alpha,
   alpha_min_spread)
values
  -- **320 is the shipped sieve since migration 0035**, which is why its name
  -- says so. It was written as a sweep row and won, and renaming it in place is
  -- right where round fifteen minted a new row instead: 300 and 200 carry
  -- *different values* from the rows beside them, so they had to exist
  -- separately; a 330 here would be 320 twice over, and one row per
  -- configuration is what makes `active` mean anything.
  --
  -- 300 keeps its name and its values as round fifteen's shipped row — several
  -- recorded comparisons were taken against it, and rewriting it would make
  -- those numbers unreproducible. Read it as "the sieve before α" from here on.
  (320, 'r16: SHIPPED (gated α 1.00)',    3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 70, true, 1.00, 1.2),
  (321, 'r16: alpha .50, spread >= 1.2',  3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 70, true, 0.50, 1.2),
  (322, 'r16: alpha 1.00, spread >= 1.6', 3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 70, true, 1.00, 1.6),
  (323, 'r16: alpha 1.00, spread >= 2.0', 3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 70, true, 1.00, 2.0)
on conflict (ord) do update set
  name = excluded.name, min_headlines = excluded.min_headlines,
  min_standalone = excluded.min_standalone, min_word_len = excluded.min_word_len,
  min_spec = excluded.min_spec, max_npd = excluded.max_npd,
  demote_head_pos = excluded.demote_head_pos, min_proper = excluded.min_proper,
  use_dict = excluded.use_dict, render_cap = excluded.render_cap,
  place_gate = excluded.place_gate, balance_alpha = excluded.balance_alpha,
  alpha_min_spread = excluded.alpha_min_spread;

-- **Narrowed to the shipped row now that the round has reported**, the way 19
-- and 24 both do at their tails. The round ran with
--
--     active = (ord in (300, 310, 311, 312, 313, 320, 321, 322, 323))
--
-- and restoring that line is how to reproduce it — after re-running
-- 20_unlabeled.sql, because a later collection can promote a word onto one of
-- those screens and rule 4 fires on moved data.
--
-- Leaving them active is not free: five distinct α values cost one
-- keyword_signals call per (day, α), and this round's sitting measured
-- 10_sieve_eval.sql at **48s** across seven days against 19s across five with
-- the same five α — the day count is what grew, not the α count.
--
-- **320 shipped, as migration 0035**, and this line is the other half of that
-- change rather than a follow-up to it: the standing rule is that a migration
-- touching `scoring_weights` moves the harness's shipped row **in the same
-- breath**, because `0028` did not and the harness spent a release cycle scoring
-- a screen the app does not draw.
--
-- The gate itself lives in `category_balance_factors`' `alpha` CTE, which is
-- where α was already resolved, so the database has one definition of "what α is
-- in force" and this file has one of "which α slice does this configuration
-- read". They are different questions; the *formula* is still only in
-- `keyword_signals`.
update analysis.sieve_configs
  set active = (ord in (320));

-- **How to read the run, and it is not off the mean.** Adding 08-05 and 08-06
-- makes the day set six imbalanced against one balanced, so a mechanism that
-- helps on imbalanced days and is the identity elsewhere will lift a seven-day
-- mean almost by construction. That number is close to tautological and must
-- not be the verdict. Three things are:
--
--   1. **320 must equal 300 exactly on 2026-07-31.** Spread 1.01 is below every
--      threshold here, so the gated rows fall back to α = 0 on that day. A
--      difference of even one word means the fallback is not wired the way this
--      file claims.
--   2. **Per-day, per-cell, against 313.** The question is whether gating beats
--      *flat* α — that is the whole mechanism — and only then whether it beats
--      α = 0.
--   3. **story_rank.** Rule 5. A configuration that drops the day's biggest
--      story is rejected whatever its F1 says.
select ord, name, active, balance_alpha, alpha_min_spread, place_gate, render_cap
from analysis.sieve_configs
where active
order by ord;
