-- scripts/analysis/19_rounds_ten_to_twelve_configs.sql
--
-- The sweeps that followed migration `0018`, written down so a fresh database
-- reproduces them. `02_sieve_configs.sql`'s header says why this file has to
-- exist at all: **the configurations under measurement are named in one place**,
-- because `10_sieve_eval.sql` and `20_unlabeled.sql` both read the table and a
-- configuration present in one and missing from the other reintroduces rule 4's
-- blind spot silently.
--
-- All of these carry `min_standalone` 0.50 and `min_proper` 0.50 unless they are
-- sweeping that very thing, so each row differs from the shipped sieve in one
-- dimension only. Two changes measured together are one measurement.
--
--   scripts/analysis/run.sh scripts/analysis/19_rounds_ten_to_twelve_configs.sql
--   scripts/analysis/run.sh scripts/analysis/20_unlabeled.sql   # must be empty
--   scripts/analysis/run.sh scripts/analysis/10_sieve_eval.sql

-- Round ten: the fragment cut, re-swept because the rescue gave it fragments to
-- catch. 0.50 won on both surfaces and the peak is interior — see migration 0019.
insert into analysis.sieve_configs
  (ord, name, min_headlines, min_standalone, min_word_len, min_spec, max_npd,
   demote_head_pos, min_proper, use_dict)
values
  (140, 'r10: standalone .10', 3, 0.10, 3, 9.90, -1.0, 0.70, 0.50, true),
  (141, 'r10: standalone .30', 3, 0.30, 3, 9.90, -1.0, 0.70, 0.50, true),
  (142, 'r10: standalone .50', 3, 0.50, 3, 9.90, -1.0, 0.70, 0.50, true),
  (143, 'r10: standalone .70', 3, 0.70, 3, 9.90, -1.0, 0.70, 0.50, true),

  -- Round eleven: the head_pos demotion, re-swept for the same reason. 0.55 to
  -- 0.65 are one plateau; 0.50 scores well and is **rejected by rule 5**,
  -- because it sinks 폭염 off 2026-07-31's screen. 0.60 ships — mid-plateau and
  -- a full 0.10 clear of that cliff. See migration 0020.
  (160, 'r11: demote .50',        3, 0.50, 3, 9.90, -1.0, 0.50, 0.50, true),
  (161, 'r11: demote .55',        3, 0.50, 3, 9.90, -1.0, 0.55, 0.50, true),
  (162, 'r11: demote .60',        3, 0.50, 3, 9.90, -1.0, 0.60, 0.50, true),
  (163, 'r11: demote .65',        3, 0.50, 3, 9.90, -1.0, 0.65, 0.50, true),
  (164, 'r11: demote .70',        3, 0.50, 3, 9.90, -1.0, 0.70, 0.50, true),
  (165, 'r11: demote off',        3, 0.50, 3, 9.90, -1.0, 9.90, 0.50, true),

  -- The rescue threshold itself, re-swept once the fragment cut had moved: still
  -- a plateau, still nothing to choose between .25 and 1.00, so 0.50 stays.
  (170, 'r11: proper .25',        3, 0.50, 3, 9.90, -1.0, 0.60, 0.25, true),
  (171, 'r11: proper .75',        3, 0.50, 3, 9.90, -1.0, 0.60, 0.75, true),
  (172, 'r11: proper 1.00',       3, 0.50, 3, 9.90, -1.0, 0.60, 1.00, true),

  -- The shipped sieve after all of it, as the thing every future round is
  -- compared against. Round twelve moved no threshold at all — it added 36
  -- dictionary exclusions (migration 0021), which this row picks up through
  -- `use_dict` without needing a configuration of its own.
  (180, 'SHIPPED after 0021',     3, 0.50, 3, 9.90, -1.0, 0.60, 0.50, true),
  (181, 'SHIPPED, dictionary off',3, 0.50, 3, 9.90, -1.0, 0.60, 0.50, false),
  -- The pre-0018 sieve, kept as the baseline the four changes are measured
  -- against: day-wide F1 49.48 / precision 71.07 against 180's 62.43 / 90.35.
  (182, 'pre-0018 (len3 only)',   3, 0.10, 3, 9.90, -1.0, 0.70, 9.90, true)
on conflict (ord) do update set
  name = excluded.name,
  min_headlines = excluded.min_headlines,
  min_standalone = excluded.min_standalone,
  min_word_len = excluded.min_word_len,
  min_spec = excluded.min_spec,
  max_npd = excluded.max_npd,
  demote_head_pos = excluded.demote_head_pos,
  min_proper = excluded.min_proper,
  use_dict = excluded.use_dict;

-- The round under comparison. Everything else stays in the file, inactive, the
-- way rounds one to three do: an inactive row costs nothing and a deleted one
-- loses the history of what was already ruled out.
update analysis.sieve_configs set active = (ord in (180, 181, 182));

select ord, name, min_standalone, demote_head_pos, min_proper, use_dict
from analysis.sieve_configs where active order by ord;
