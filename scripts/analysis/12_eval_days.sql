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
insert into analysis.eval_days (d, top_story) values
  ('2026-07-31', '폭염'),
  ('2026-08-01', '폭염'),
  ('2026-08-02', '김민석'),
  ('2026-08-03', '폭염'),
  ('2026-08-04', '폭염');

select d::text as day, top_story from analysis.eval_days order by d;
