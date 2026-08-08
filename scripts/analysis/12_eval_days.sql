-- scripts/analysis/12_eval_days.sql
--
-- The days the harness measures, and the biggest story on each of them.
--
--   scripts/analysis/run.sh scripts/analysis/12_eval_days.sql
--
-- Apply this **before** 10_sieve_eval.sql, 11_category_eval.sql,
-- 20_unlabeled.sql or 21_unlabeled_category.sql. All four read it, the same way
-- the harness and its worklist both read analysis.sieve_configs — and for the
-- same reason. Each of those four used to carry its own copy of the date list,
-- and 02_sieve_configs.sql's header already says what a second copy costs: a
-- day present in the harness and missing from the worklist reintroduces rule
-- 4's blind spot silently, because the words that day promotes never reach the
-- list of things to label.
--
-- `top_story` is the second reason this table exists. 10_sieve_eval.sql used to
-- hardcode '폭염' as the day's biggest story, which is rule 5's safety catch: a
-- configuration that drops it is rejected whatever its precision. That word is
-- right for three of the four days and wrong for 2026-08-02, where 김민석 leads
-- with 45 headlines and 폭염 is third at 21. Widening the harness to four days
-- without a per-day story would have made the catch lie about that day.
--
-- Adding a day means adding a row here, then re-running 20_unlabeled.sql and
-- 21_unlabeled_category.sql and labelling what they return. A new day moves the
-- data, and README.md rule 4 fires on moved data exactly as it does on a
-- widened sweep.
--
-- **And it means rebuilding analysis.day_edges, which is why that table is now
-- built at the foot of this file rather than in 24_cap_and_place_configs.sql.**
-- It is a base table derived from this day list, so a day added here and not
-- there is a day on which sieve 6 sees no edges at all — and sieve 6 reads
-- "no edge" as "drop this place", so every place on that day silently vanishes
-- from every gated configuration.
--
-- That is not hypothetical. Round fifteen added 2026-08-04 and did not rebuild
-- the table, so its gated rows dropped all three of that day's places and
-- promoted three deeper words in their place. Measured afterwards by deleting
-- the day from day_edges to reproduce the state exactly: **6 of 45 cells move,
-- all of them 08-04, each by one word.** The shipped row does not move at all
-- (55.88 either way) and neither conclusion of that round changes — α still
-- loses at every setting, and by slightly more once corrected. The defect was
-- real, its blast radius was small, and nothing in the harness could have said
-- so, because a missing day looks exactly like a day with no edges.
--
-- The fix is the one this repository reaches for every time: **do not keep a
-- second copy of the day list — derive from it, here, in the same breath.**
-- Same shape as `word_directory` being re-derived rather than typed
-- independently, and as `keyword_graph_config_fingerprint` hashing a denylist
-- so a column added later is covered without editing the function.

create schema if not exists analysis;

drop table if exists analysis.eval_days;
create table analysis.eval_days (
  d          date primary key,
  top_story  text not null
);

-- Each top_story is the day's most frequent word under the shipped sieve,
-- read off the ranking rather than chosen: 폭염 45, 폭염 47, 김민석 45, 폭염 60,
-- 폭염 194.
--
-- **2026-08-04 is here for round fifteen and it is a different kind of day.**
-- The four days above are 691 to 2,197 headlines; this one is 4,218, which is
-- what both of round fifteen's questions need. head_pos as a cut was declined on
-- the reading that a tab's render cap never binds, and on a fat day it does;
-- α was measured as unpriceable because the only day it lost on had collected
-- 150/149/150/150/150/150 in a single capped run, and this is the imbalanced day
-- the mechanism was built for.
--
-- **It does not make the days F1-comparable with each other, and they never
-- were.** Recall's denominator is every labelled-good word with df >= 3, which
-- grows with the day while the screen stays at 70, so a fat day scores worse on
-- F1 while showing strictly more of the news. Configurations are compared
-- against each other inside one run; that is what this table is for.
--
-- It is deliberately the last day before the collection-regime boundary.
-- 2026-08-07 raised collect_cap 150 → 300, and 08-08 was still collecting when
-- this row went in — rule 4's second trigger, and the reason 08-04 could not be
-- added when round fourteen wanted it.
--
-- **Round sixteen adds 2026-08-05 and 08-06**, and adds them for one reason:
-- α could only ever be priced against days whose sections actually collected
-- unequally, and until now the day set held one balanced day against four
-- imbalanced ones. Balance spread — max/min of `category_balance_factors(d, 1)`
-- — runs 1.01 / 2.52 / 1.67 / 1.49 / 2.44 for the five days above, and 2.48 and
-- 2.21 for these two. Both were collected under `collect_cap` 150, the same
-- regime as the rest.
--
-- **2026-08-07 is deliberately not here**, on the same rule that put 08-04 in:
-- it is the first day past the collection-regime boundary (cap 150 → 300) and a
-- day collected half again as deep is not the same kind of day.
--
-- Their top_story is read off the deployed ranking, not chosen: 폭염 at 169 and
-- 180 headlines.
insert into analysis.eval_days (d, top_story) values
  ('2026-07-31', '폭염'),
  ('2026-08-01', '폭염'),
  ('2026-08-02', '김민석'),
  ('2026-08-03', '폭염'),
  ('2026-08-04', '폭염'),
  ('2026-08-05', '폭염'),
  ('2026-08-06', '폭염');

-- --------------------------------------------------------------------------
-- analysis.day_edges — derived from the list above, in the same breath.
--
-- Moved here from 24_cap_and_place_configs.sql, which is where it was written
-- and where it could go stale without anything noticing. The header of this
-- file says what that cost. Everything below is that file's block verbatim; its
-- reasoning about temp tables and the planner is unchanged and still applies.
-- --------------------------------------------------------------------------

-- The harness's own copy of "does this word have a line to something that is
-- not a place" — the same question migration 0024's fixed-point loop asks
-- inside keyword_graph, materialised once here rather than recomputed per
-- (config, word) pair the way 21_unlabeled_category.sql's day_pass is. Every
-- active sieve_configs row that turns the gate on shares this one table.
--
-- cooc >= 2 and, below, npmi >= 0.3 mirror scoring_weights.edge_min_cooc and
-- .edge_min_npmi as they stand today (queried, not assumed) — the same
-- convention 21_unlabeled_category.sql's `w` CTE uses for its other defaults.
-- This file does not read scoring_weights directly because the value has to be
-- fixed at build time for a table, not a view; a threshold change there means
-- re-running this file, the same obligation a scoring_weights edit already
-- places on every harness script that hardcodes a default.
--
-- Built from temp tables staged one at a time, ANALYZEd between stages,
-- rather than as one CTE. The equivalent single query — doc/df/corpus/pairs as
-- CTEs, joined in one statement — is logically identical and was tried first;
-- the planner has no row-count statistics for a CTE it has not yet run, so it
-- estimated the doc-self-join at 3.0M rows against an actual 74k and chose a
-- 64-way partitioned hash aggregate to match, which spills to disk on this
-- project's small temp allocation and fails with `53100 No space left on
-- device` — confirmed by reproducing it standalone and watching it clear once
-- `pairs` filtered to cooc >= 2 before the join to df/corpus rather than
-- after. Nothing here changes what a pair or its npmi is; only when the
-- planner learns how big each step actually is.
drop table if exists analysis.day_edges;

create temp table t24_doc as
  select distinct h.id as headline_id, n.word, h.collected_date as d
  from public.headline_nouns n
  join public.headlines h on h.id = n.headline_id
  where h.collected_date in (select d from analysis.eval_days);
analyze t24_doc;

create temp table t24_pairs as
  select a.d, a.word as a, b.word as b, count(*)::int as cooc
  from t24_doc a join t24_doc b on b.headline_id = a.headline_id and b.word > a.word
  group by 1, 2, 3
  having count(*) >= 2;
analyze t24_pairs;

create temp table t24_df as
  select d, word, count(*)::numeric as df from t24_doc group by 1, 2;
analyze t24_df;

create temp table t24_corpus as
  select d, count(distinct headline_id)::numeric as n from t24_doc group by 1;
analyze t24_corpus;

create table analysis.day_edges as
select p.d, p.a, p.b, p.cooc,
       ln((p.cooc * c.n) / (da.df * db.df)) / nullif(-ln(p.cooc / c.n), 0) as npmi,
       (ovb.mode is distinct from 'place') as b_is_place_false,
       (ova.mode is distinct from 'place') as a_is_place_false
from t24_pairs p
join t24_corpus c on c.d = p.d
join t24_df da on da.d = p.d and da.word = p.a
join t24_df db on db.d = p.d and db.word = p.b
left join public.word_overrides ova on ova.word = p.a
left join public.word_overrides ovb on ovb.word = p.b;

drop table t24_doc, t24_pairs, t24_df, t24_corpus;

select d::text as day, top_story,
       (select count(*) from analysis.day_edges de where de.d = ed.d) as day_edges
from analysis.eval_days ed order by d;
