-- scripts/analysis/24_cap_and_place_configs.sql
--
-- Round fourteen: the render cap as a measured dimension, and place gating.
--
-- The cap was a literal 70 in 10_sieve_eval.sql and 20_unlabeled.sql. That was
-- honest while it was not under question; it is a knob now, and a knob in two
-- files is the drift 02_sieve_configs.sql's header warns about.
--
-- Words clearing the shipped sieve, per day: 07-31 116, 08-01 108, 08-02 69,
-- 08-03 260, 08-04 130. So 08-02 cannot fill 70 places and the cap does nothing
-- there, while 08-03 has 260 to choose 130 from. The sweep has to be read per
-- day rather than on a mean.
alter table analysis.sieve_configs
  add column if not exists render_cap numeric not null default 70,
  add column if not exists place_gate boolean not null default false;

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
insert into analysis.sieve_configs
  (ord, name, min_headlines, min_standalone, min_word_len, min_spec, max_npd,
   demote_head_pos, min_proper, use_dict, render_cap, place_gate)
values
  (200, 'r14: SHIPPED (cap 70)',      3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  70, false),
  (201, 'r14: cap 85',                3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  85, false),
  (202, 'r14: cap 100',               3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 100, false),
  (203, 'r14: cap 130',               3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 130, false),
  (210, 'r14: place gate, cap 70',    3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true,  70, true),
  (211, 'r14: place gate, cap 100',   3, 0.50, 4, 9.90, -1.0, 0.60, 0.50, true, 100, true)
on conflict (ord) do update set
  name = excluded.name, min_headlines = excluded.min_headlines,
  min_standalone = excluded.min_standalone, min_word_len = excluded.min_word_len,
  min_spec = excluded.min_spec, max_npd = excluded.max_npd,
  demote_head_pos = excluded.demote_head_pos, min_proper = excluded.min_proper,
  use_dict = excluded.use_dict, render_cap = excluded.render_cap,
  place_gate = excluded.place_gate;

update analysis.sieve_configs set active = (ord in (200, 201, 202, 203, 210, 211));

select ord, name, render_cap, place_gate from analysis.sieve_configs
where active order by ord;
