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
--
-- `active` is what scopes a round without deleting its history. Both files read
-- only the active rows, so rule 4 stays satisfiable: a configuration nobody is
-- going to adopt still puts words on screen, and each of those words has to be
-- labelled before any row means anything. Rounds one to three sweep min_spec and
-- max_npd, and migrations 0003 and 0009 turned both of those clauses off after
-- measuring them — keeping their rows scored costs 116 further labels and
-- decides nothing. They stay in this file, inactive, and flipping one back to
-- true re-opens it (then re-run 20_unlabeled.sql, as ever).

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
  use_dict       boolean not null,
  active         boolean not null default false
);

insert into analysis.sieve_configs
  (ord, name, min_headlines, min_standalone, min_word_len, min_spec, max_npd, use_dict)
values
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
  (89, 'npd 2.8, standal .30, no dict',    3, 0.30,  3, 9.90,  2.8, false),

  -- Round four: the standalone cut, re-swept over what actually ships. Every
  -- earlier standalone sweep (66-68, 80-83) lays npd 2.5 underneath, and
  -- migration 0009 turned that clause off — so those rows measure a sieve no
  -- longer in use. The shipped configuration is config 60 above, and these hold
  -- everything at its values and move min_standalone alone.
  --
  -- 60 itself is the baseline (standalone >= .10) and is not repeated here.
  -- The sweep opens on both sides of it so an optimum at the edge of the range
  -- would be visible as one (rule 2).
  --
  -- What the cut is worth is a much smaller question than README.md records.
  -- Measured on 2026-08-03 across all four collected days, six words are kept
  -- off screen by this clause and nothing else, and five of those reach the top
  -- 70: 춘천시, 한화에어 and 폭등장 (all labelled bad), 골리앗 and 자국민 (both
  -- unlabelled at the time, and what this round is really asking about). The
  -- fragments the clause was built for — 도체, 무인, 상한, 유조 — are all two
  -- characters and fail the length clause first.
  (90, 'r4: standalone off',               3, 0.00,  3, 9.90, -1.0, true),
  (91, 'r4: standalone >= .05',            3, 0.05,  3, 9.90, -1.0, true),
  (92, 'r4: standalone >= .20',            3, 0.20,  3, 9.90, -1.0, true),
  (93, 'r4: standalone >= .30',            3, 0.30,  3, 9.90, -1.0, true),
  (94, 'r4: standalone >= .50',            3, 0.50,  3, 9.90, -1.0, true),
  -- Does the dictionary catch what the cut would have, if the cut goes? The
  -- same question migration 0005's measurement asked of the sieve as a whole.
  (95, 'r4: standalone off, no dict',      3, 0.00,  3, 9.90, -1.0, false);

-- The round under comparison, plus the shipped configuration it is compared
-- against. 60 is the sieve as deployed: min_headlines 3, standalone .10, length
-- 3, specificity off, neighbours off, dictionary on.
update analysis.sieve_configs
   set active = true
 where ord in (60, 90, 91, 92, 93, 94, 95);

select count(*) filter (where active) as active,
       count(*)                       as total
from analysis.sieve_configs;
