-- scripts/analysis/02_sieve_configs.sql
--
-- The sieve configurations under comparison. Both 10_sieve_eval.sql and
-- 20_unlabeled.sql read this table.
--
-- They have to agree exactly. 20_unlabeled.sql finds the words that need
-- labelling before the harness means anything (rule 4), so a configuration
-- present in one and missing from the other silently reintroduces the very
-- blind spot the rule exists to close — that already happened once here, and
-- adding a second file's worth of configurations turned 127 unlabelled words
-- into 215.
--
-- To disable a sieve-4 clause, push it out of range: min_word_len 99,
-- min_spec 9.9, max_npd -1. To disable sieve 4 entirely (the frequency-only
-- baseline), set min_word_len to 1 — every word clears it.

create schema if not exists analysis;

drop table if exists analysis.sieve_configs;
create table analysis.sieve_configs (
  ord            int primary key,
  name           text not null,
  min_headlines  numeric not null,
  min_standalone numeric not null,
  min_word_len   numeric not null,
  min_spec       numeric not null,
  max_npd        numeric not null,
  use_dict       boolean not null
);

insert into analysis.sieve_configs values
  -- Baselines.
  ( 1, 'frequency only (current app)',     3, 0.00,  1, 9.90, -1.0, false),
  ( 2, 'standalone >= .10 only',           3, 0.10,  1, 9.90, -1.0, false),
  ( 3, 'spec >= .40 only',                 3, 0.00, 99, 0.40, -1.0, false),
  ( 4, 'standalone + spec >= .40',         3, 0.10, 99, 0.40, -1.0, false),
  ( 5, 'standalone + spec >= .80',         3, 0.10, 99, 0.80, -1.0, false),
  ( 6, 'len3 | spec.80  (no neighbours)',  3, 0.10,  3, 0.80, -1.0, true),

  -- Neighbour cut. 1.8 came from the planning stage, where the neighbour count
  -- was on a different scale to the one keyword_signals computes, so it is
  -- re-derived here rather than trusted.
  ( 7, 'npd <= 1.8',                       3, 0.10,  3, 0.80,  1.8, true),
  ( 8, 'npd <= 2.0',                       3, 0.10,  3, 0.80,  2.0, true),
  ( 9, 'npd <= 2.2',                       3, 0.10,  3, 0.80,  2.2, true),
  (10, 'npd <= 2.5',                       3, 0.10,  3, 0.80,  2.5, true),
  (11, 'npd <= 2.8',                       3, 0.10,  3, 0.80,  2.8, true),
  (12, 'npd <= 3.0',                       3, 0.10,  3, 0.80,  3.0, true),
  (13, 'npd <= 3.5',                       3, 0.10,  3, 0.80,  3.5, true),
  (14, 'npd <= 4.0',                       3, 0.10,  3, 0.80,  4.0, true),

  -- Specificity cut, holding the neighbour cut at its own best value.
  (20, 'spec .60, npd 2.5',                3, 0.10,  3, 0.60,  2.5, true),
  (21, 'spec .70, npd 2.5',                3, 0.10,  3, 0.70,  2.5, true),
  (22, 'spec .90, npd 2.5',                3, 0.10,  3, 0.90,  2.5, true),
  (23, 'spec 1.00, npd 2.5',               3, 0.10,  3, 1.00,  2.5, true),
  (24, 'spec off, npd 2.5',                3, 0.10,  3, 9.90,  2.5, true),

  -- Word-length rescue. Swept wide enough that an optimum at the edge would be
  -- visible as one (rule 2): 2 lets every two-character word through, 99 turns
  -- the clause off entirely.
  (30, 'len2, spec .80, npd 2.5',          3, 0.10,  2, 0.80,  2.5, true),
  (31, 'len4, spec .80, npd 2.5',          3, 0.10,  4, 0.80,  2.5, true),
  (32, 'len5, spec .80, npd 2.5',          3, 0.10,  5, 0.80,  2.5, true),
  (33, 'len off, spec .80, npd 2.5',       3, 0.10, 99, 0.80,  2.5, true),

  -- Standalone cut. The plan warns this one is a hard cut only: legitimate words
  -- such as 수사 (0.17) and 뉴스 (0.19) score low, so raising it should start
  -- costing good words quickly.
  (40, 'standalone off',                   3, 0.00,  3, 0.80,  2.5, true),
  (41, 'standalone >= .20',                3, 0.20,  3, 0.80,  2.5, true),
  (42, 'standalone >= .30',                3, 0.30,  3, 0.80,  2.5, true),
  (43, 'standalone >= .50',                3, 0.50,  3, 0.80,  2.5, true),

  -- Minimum headline count.
  (50, 'min_headlines 2',                  2, 0.10,  3, 0.80,  2.5, true),
  (51, 'min_headlines 4',                  4, 0.10,  3, 0.80,  2.5, true),
  (52, 'min_headlines 5',                  5, 0.10,  3, 0.80,  2.5, true),

  -- Round two. The first round found that turning the specificity clause off
  -- beats every value of it, on both days and by a wide margin — specificity
  -- rescues words that sit in one section but say nothing (감찰, 윤리, 청문, 초등
  -- and 순회 all score a perfect 1.00). Every other threshold interacts with it,
  -- so they are all re-swept with it off.
  (60, 'no spec, no npd (length only)',    3, 0.10,  3, 9.90, -1.0, true),
  (61, 'no spec, npd 1.8',                 3, 0.10,  3, 9.90,  1.8, true),
  (62, 'no spec, npd 2.0',                 3, 0.10,  3, 9.90,  2.0, true),
  (63, 'no spec, npd 3.0',                 3, 0.10,  3, 9.90,  3.0, true),
  (64, 'no spec, npd 3.5',                 3, 0.10,  3, 9.90,  3.5, true),
  (65, 'no spec, npd 4.0',                 3, 0.10,  3, 9.90,  4.0, true),
  (66, 'no spec, npd 2.5, standal .20',    3, 0.20,  3, 9.90,  2.5, true),
  (67, 'no spec, npd 2.5, standal .30',    3, 0.30,  3, 9.90,  2.5, true),
  (68, 'no spec, npd 2.5, standal .50',    3, 0.50,  3, 9.90,  2.5, true),
  (69, 'no spec, npd 3.0, standal .30',    3, 0.30,  3, 9.90,  3.0, true),
  (70, 'no spec, npd 2.5, len2',           3, 0.10,  2, 9.90,  2.5, true),
  (71, 'no spec, npd 2.5, len4',           3, 0.10,  4, 9.90,  2.5, true),
  (72, 'no spec, npd 2.5, mh 4',           4, 0.10,  3, 9.90,  2.5, true),
  (73, 'no spec, npd 2.5, no dict',        3, 0.10,  3, 9.90,  2.5, false),

  -- Round three. Round two left two knobs unsettled and both were still rising
  -- at the edge of their swept range, which is exactly the trap rule 2 names.
  -- Standalone is pushed past 0.50 and the neighbour cut past 2.5 to find where
  -- each turns over.
  (80, 'no spec, npd 2.5, standal .40',    3, 0.40,  3, 9.90,  2.5, true),
  (81, 'no spec, npd 2.5, standal .60',    3, 0.60,  3, 9.90,  2.5, true),
  (82, 'no spec, npd 2.5, standal .70',    3, 0.70,  3, 9.90,  2.5, true),
  (83, 'no spec, npd 2.5, standal .85',    3, 0.85,  3, 9.90,  2.5, true),
  (84, 'no spec, npd 2.6, standal .30',    3, 0.30,  3, 9.90,  2.6, true),
  (85, 'no spec, npd 2.8, standal .30',    3, 0.30,  3, 9.90,  2.8, true),
  (86, 'no spec, npd 2.9, standal .30',    3, 0.30,  3, 9.90,  2.9, true),
  (87, 'no spec, no npd, standal .30',     3, 0.30,  3, 9.90, -1.0, true),

  -- Does the sieve keep the day's biggest story on its own, or only because a
  -- human whitelisted 폭염? 2.8 is the first cut above its 2.733 neighbour count.
  (88, 'npd 2.5, standal .30, no dict',    3, 0.30,  3, 9.90,  2.5, false),
  (89, 'npd 2.8, standal .30, no dict',    3, 0.30,  3, 9.90,  2.8, false);

select count(*) as configs from analysis.sieve_configs;
