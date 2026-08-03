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
  -- Sieve 5, added in round five: where in the headline the word sits. 9.9
  -- disables it, the same convention min_spec uses, since the signal maxes at 1.
  max_head_pos   numeric not null default 9.90,
  -- The same signal used as a **demotion** rather than a cut: a word above this
  -- sorts below every word under it, so it falls out only when the render cap is
  -- binding. 9.9 disables it. See round six for why both forms are here.
  demote_head_pos numeric not null default 9.90,
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

-- Round five: the fifth signal, `head_pos`, added by migration 0014.
--
-- The question this round exists to answer is the one CLAUDE.md left open —
-- the length clause is effectively the whole sieve, and none of the four
-- existing signals separates the good words inside it from the bad ones, so
-- the dictionary has been doing that work. `head_pos` is the first signal that
-- is not a restatement of frequency, length or category: Korean headlines are
-- topic-first, so a story's names lead and generic qualifiers trail.
--
-- Measured over the 280 drawn word-days across the four labelled days before
-- any of these rows existed: mean 0.347 for good, 0.466 for bad. Above 0.70 it
-- catches 가능성, 시험대(×2), 승부수, 변동성, 무방비, 막바지, 월요일, 테러범,
-- 수도권 and 로보틱스 — eleven bad — against six good. That ratio is the whole
-- case for the clause, and it is not enough on its own to justify one, because
-- cutting a word promotes a deeper-ranked one into its place. What that trade
-- is actually worth is what these rows measure.
--
-- Everything is held at config 60's values, so the only thing moving is the new
-- cut. Swept from 0.50 (well below the good mean, where it must start costing
-- real words) to 0.90, plus off, so an optimum at the edge would be visible as
-- one — rule 2.
insert into analysis.sieve_configs
  (ord, name, min_headlines, min_standalone, min_word_len, min_spec, max_npd, max_head_pos, use_dict)
values
  (100, 'r5: head_pos <= .50',             3, 0.10,  3, 9.90, -1.0, 0.50, true),
  (101, 'r5: head_pos <= .60',             3, 0.10,  3, 9.90, -1.0, 0.60, true),
  (102, 'r5: head_pos <= .65',             3, 0.10,  3, 9.90, -1.0, 0.65, true),
  (103, 'r5: head_pos <= .70',             3, 0.10,  3, 9.90, -1.0, 0.70, true),
  (104, 'r5: head_pos <= .75',             3, 0.10,  3, 9.90, -1.0, 0.75, true),
  (105, 'r5: head_pos <= .80',             3, 0.10,  3, 9.90, -1.0, 0.80, true),
  (106, 'r5: head_pos <= .90',             3, 0.10,  3, 9.90, -1.0, 0.90, true),
  -- Does the clause do anything the dictionary is not already doing? The same
  -- question migration 0005's measurement asked of the sieve as a whole, and the
  -- one that matters most here: the dictionary exists because there was no
  -- signal. If a signal now exists, some of those entries may be redundant.
  (107, 'r5: head_pos <= .70, no dict',    3, 0.10,  3, 9.90, -1.0, 0.70, false),
  (108, 'r5: head_pos off, no dict',       3, 0.10,  3, 9.90, -1.0, 9.90, false);

-- Round six: the same signal as a **demotion** instead of a cut.
--
-- Round five said head_pos <= .70 wins day-wide (+2.25 mean F1, three days of
-- four, none lost, top story kept on all four) and then 11_category_eval.sql
-- said it **loses 8 of 24 category cells and wins none**. Both are true, and the
-- reason they are both true is the render cap.
--
-- Day-wide the cap binds at 70, so cutting a word promotes a deeper one, and the
-- promoted words are about as good as the screen average — the gain is the
-- substitution, not the removal. A category tab draws 5 to 42 words and the cap
-- never binds, so there is nothing to promote and the cut is pure loss.
--
-- So the mechanism has to be one that only acts where a substitution is
-- available. A demotion is exactly that: a trailing word sorts below every other
-- eligible word and falls off only if 70 better ones exist. On a tab it is a
-- no-op by construction.
insert into analysis.sieve_configs
  (ord, name, min_headlines, min_standalone, min_word_len, min_spec, max_npd, demote_head_pos, use_dict)
values
  (110, 'r6: demote head_pos > .60',      3, 0.10,  3, 9.90, -1.0, 0.60, true),
  (111, 'r6: demote head_pos > .65',      3, 0.10,  3, 9.90, -1.0, 0.65, true),
  (112, 'r6: demote head_pos > .70',      3, 0.10,  3, 9.90, -1.0, 0.70, true),
  (113, 'r6: demote head_pos > .75',      3, 0.10,  3, 9.90, -1.0, 0.75, true),
  (114, 'r6: demote head_pos > .50',      3, 0.10,  3, 9.90, -1.0, 0.50, true);

-- Round seven: a floor under promotion.
--
-- The demotion frees places under the cap, and whatever sits at rank 71 rises
-- into them whatever it is. The question here is whether those places should be
-- filled at all — a word with three headlines is thin, and the words that sat at
-- ranks 71 to 78 across the four days are all exactly df 3.
--
-- `min_headlines` **is** that floor; there is no second knob to invent. What is
-- new is that it now has to be judged with the render cap in mind rather than
-- against it. At 4 the eligible set falls to 51 / 54 / 63 / 71 words on the four
-- days, so three of them can no longer fill 70 places and the graph draws fewer.
-- That is the cost, and the harness prices it directly: the recall denominator
-- is fixed at df >= 3, so a day that draws 51 words is scored on the same pool
-- as one that draws 70.
--
-- 122 separates the floor from the demotion, because two changes measured
-- together are one measurement.
insert into analysis.sieve_configs
  (ord, name, min_headlines, min_standalone, min_word_len, min_spec, max_npd, demote_head_pos, use_dict)
values
  (120, 'r7: floor df>=4, demote .70',   4, 0.10,  3, 9.90, -1.0, 0.70, true),
  (121, 'r7: floor df>=5, demote .70',   5, 0.10,  3, 9.90, -1.0, 0.70, true),
  (122, 'r7: floor df>=4, no demote',    4, 0.10,  3, 9.90, -1.0, 9.90, true),
  (123, 'r7: floor df>=6, demote .70',   6, 0.10,  3, 9.90, -1.0, 0.70, true);

-- The round under comparison, plus the shipped configuration it is compared
-- against. 112 is the sieve as deployed after migration 0015: min_headlines 3,
-- standalone .10, length 3, specificity off, neighbours off, dictionary on,
-- head_pos demoted above 0.70. 60 is what shipped before it.
update analysis.sieve_configs
   set active = true
 where ord in (60, 112, 120, 121, 122, 123);

select count(*) filter (where active) as active,
       count(*)                       as total
from analysis.sieve_configs;
