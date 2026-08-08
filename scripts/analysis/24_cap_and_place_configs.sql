-- scripts/analysis/24_cap_and_place_configs.sql
--
-- Round fourteen: the render cap as a measured dimension, and place gating.
--
-- The cap was a literal 70 in 10_sieve_eval.sql and 20_unlabeled.sql. That was
-- honest while it was not under question; it is a knob now, and a knob in two
-- files is the drift 02_sieve_configs.sql's header warns about.
--
-- Words clearing the shipped sieve, per day: 07-31 116, 08-01 108, 08-02 69,
-- 08-03 260. So 08-02 cannot fill 70 places and the cap does nothing there, while
-- 08-03 has 260 to choose 130 from. The sweep has to be read per day rather than
-- on a mean.
--
-- **2026-08-04 is quoted nowhere in this file without a stamp, and it is not in
-- analysis.eval_days.** It is the day still being collected: 130 words qualifying
-- at 11:00 KST and **240 at 20:24 KST** on the same date, from 3,319 headlines.
-- A number from a day the cron is still writing to is a snapshot, and putting one
-- in a table beside four settled days is how it gets read as reproducible.
--
-- `balance_alpha` joins them as the round's third dimension (migration 0025).
-- It is the exponent in df_balanced(α) = Σ_c df_c × (N̄/N_c)^α, and 0 is the
-- identity, so every row added above enters the α sweep as its own control
-- without being restated. The formula itself is **not** copied into the
-- harness: 10_sieve_eval.sql passes this column to keyword_signals(d, α) and
-- reads the df_balanced that comes back, the same way it refuses to
-- reimplement the other five signals.
alter table analysis.sieve_configs
  add column if not exists render_cap numeric not null default 70,
  add column if not exists place_gate boolean not null default false,
  add column if not exists balance_alpha numeric not null default 0;

-- **analysis.day_edges is built in 12_eval_days.sql now, not here.** It used
-- to be created at this point, and that was the wrong home: it is derived from
-- analysis.eval_days, so a day added to that list and not rebuilt here is a day
-- on which sieve 6 finds no edges and therefore drops every place. Round
-- fifteen added 2026-08-04 and hit exactly that. The table lives beside the
-- list it derives from now, and this file simply reads it — the reasoning about
-- temp tables and the planner moved with it, unchanged.
--
-- Run 12_eval_days.sql before this file. It already had to be run first, since
-- the configurations below are scored against those days.

-- 200/201/202/203 sweep the cap alone, place_gate off, to answer "how many
-- words should the screen hold" on its own before it is asked alongside the
-- place gate. 210/211 turn the gate on at two of those caps, since a dropped
-- place promotes a deeper word and whether that promotion is worth having
-- depends on how much room the promoted word has to land in.
--
-- 200 ('r14: SHIPPED (cap 70)') is deliberately not config 180. 180 is frozen
-- at what shipped after migration 0021 (min_word_len 3) and reproducing it is
-- Step 4's inertness check; 200 carries the values scoring_weights holds today
-- (min_word_len 4, min_standalone .50, min_proper .50, demote_head_pos .60 —
-- round thirteen's sieve), which is the row this round's cap and place-gate
-- sweeps are actually measured against.
-- 220/221/222/223 sweep the balance exponent alone — cap 70, gate off, every
-- other threshold identical to 200 — so α is read against the row it would
-- replace and nothing else moves underneath it. 200 is α 0 and is therefore
-- this arm's control as well as the cap arm's; a fifth row for it would be the
-- same configuration twice.
--
-- The named sweep is 0 / .25 / .50 / .75 / 1.00. Rule 2 wants the optimum
-- interior, so if 1.00 wins this list has to grow upward before the answer
-- counts — α is an exponent, not a probability, and nothing caps it at 1.
-- Extending it costs a re-run of 20_unlabeled.sql, because a new α reorders
-- the ranking and can promote a word that has never been on screen.
insert into analysis.sieve_configs
  (ord, name, min_headlines, min_standalone, min_word_len, min_spec, max_npd,
   demote_head_pos, min_proper, use_dict, render_cap, place_gate, balance_alpha)
values
  (200, 'r14: SHIPPED (cap 70)',      3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  70, false, 0.00),
  (201, 'r14: cap 85',                3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  85, false, 0.00),
  (202, 'r14: cap 100',               3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 100, false, 0.00),
  (203, 'r14: cap 130',               3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 130, false, 0.00),
  (210, 'r14: place gate, cap 70',    3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  70, true,  0.00),
  (211, 'r14: place gate, cap 100',   3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 100, true,  0.00),
  (220, 'r14: alpha .25',             3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  70, false, 0.25),
  (221, 'r14: alpha .50',             3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  70, false, 0.50),
  (222, 'r14: alpha .75',             3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  70, false, 0.75),
  (223, 'r14: alpha 1.00',            3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  70, false, 1.00)
on conflict (ord) do update set
  name = excluded.name, min_headlines = excluded.min_headlines,
  min_standalone = excluded.min_standalone, min_word_len = excluded.min_word_len,
  min_spec = excluded.min_spec, max_npd = excluded.max_npd,
  demote_head_pos = excluded.demote_head_pos, min_proper = excluded.min_proper,
  use_dict = excluded.use_dict, render_cap = excluded.render_cap,
  place_gate = excluded.place_gate, balance_alpha = excluded.balance_alpha;

-- The round under comparison, narrowed now that round fourteen has reported —
-- the same move 19_rounds_ten_to_twelve_configs.sql makes at its own tail, and
-- for the same reason: an inactive row costs nothing and a deleted one loses the
-- history of what was already ruled out.
--
-- **200 alone, and it is the shipped sieve.** Migration 0026 kept the cap at 70,
-- the place gate off and α at 0, so 201-203, 210, 211 and 220-223 are all
-- measured-and-declined and have no further question to answer. What they cost
-- while active is not nothing: 220-223 put four more distinct α values into
-- `alphas`, and the harness pays one keyword_signals call per (day, α). Round
-- thirteen's sitting measured that as 4.2s → 24.8s for 10_sieve_eval.sql and
-- 4.1s → 23.3s for 20_unlabeled.sql as the four rows went in; this round's
-- sitting measures 6.2s with 200 alone. Two sittings, comparable only inside
-- each — what they agree on is that the cost tracks the distinct α count rather
-- than the configuration count. Worse than the seconds, every active row
-- carries a permanent rule-4 obligation: a collection or a dictionary edit can
-- promote a word onto *its* screen, and the worklist then demands that word be
-- labelled before any row of the harness can be read.
--
-- **A round that wants a control adds one back**, the way 19 keeps 181
-- (dictionary off) and 182 (pre-0018) beside its shipped row. None is activated
-- here, because 180-182 carry min_word_len 3 and min_standalone 0.10 — the sieve
-- as it stood before round thirteen — so switching one on is a label question
-- under rule 4 rather than a free comparison. Whoever needs it should flip the
-- flag and re-run 20_unlabeled.sql, as ever.
--
-- The two mechanisms 0026 declined are not deleted from the database either:
-- `place_gate` and `balance_alpha` stay as columns and `analysis.day_edges` stays
-- as a table, so re-activating 210 or 220-223 is one UPDATE. In particular, the
-- α arm is expected to be re-run once 2026-08-04 stops collecting and can be
-- labelled — that is the day the exponent was built for and the day this round
-- could not see.
update analysis.sieve_configs
  set active = (ord in (200));

-- The distinct α count is what the harness pays for, not the configuration
-- count: 10_sieve_eval.sql evaluates keyword_signals once per (day, α) and
-- joins the configurations onto that, so ten rows over five α values cost five
-- calls a day rather than ten. With 200 alone there is one α, and
-- 10_sieve_eval.sql measures **6.2s in this round's sitting**. Do not read that
-- against the 4.2s the file cost before the α column existed: different sitting,
-- and the α machinery is in the query path now even when the α list has one
-- element.
select ord, name, render_cap, place_gate, balance_alpha
from analysis.sieve_configs where active order by ord;
