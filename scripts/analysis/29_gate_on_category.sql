-- scripts/analysis/29_gate_on_category.sql
--
-- What a category tab actually draws, **with the place gate on**, scored against
-- analysis.word_labels.
--
--   scripts/analysis/run.sh scripts/analysis/29_gate_on_category.sql
--
-- ---------------------------------------------------------------------------
--
-- **Why this file exists rather than a variant in 11_category_eval.sql.** Sieve
-- 6 asks whether a place holds a line to a drawn non-place, which needs the edge
-- set of a **(day, category)** pair; `analysis.day_edges` is day-wide. A scoped
-- variant of it would make the harness the third copy of sieve 6, after the
-- deployed `keyword_graph_compute` and `10_sieve_eval.sql`'s `gate_fail` — and
-- this directory has already paid for a second copy twice, once when
-- 30_word_scores.sql's sieve 4d drifted for four rounds and once when
-- 11_category_eval.sql's own ranking disagreed with the RPC until round
-- thirteen. The clause that needs a circular fixed point is the worst candidate
-- there is for a third hand-written copy.
--
-- So the gate's tab numbers come from the deployed function, and this file is
-- the recorded way to take them. `OPEN.md` item C said they "came from the
-- deployed RPC for that reason, and still would"; this is that sentence made
-- runnable.
--
-- **Read `unlab` first, and run 23_unlabeled_gate_on.sql before trusting it.**
-- That worklist exists because of this file: neither 20_unlabeled.sql nor
-- 21_unlabeled_category.sql can cover a gated screen, since the gate frees slots
-- under the render cap and promotes deeper words into them — words no gate-free
-- screen has ever drawn. On this file's first run `unlab` was 6 while both
-- existing worklists returned nothing.
--
-- **`keyword_graph_compute`, never `keyword_graph`.** The latter reads
-- `keyword_graph_cache` since migration 0032, so it answers "what is on screen"
-- rather than "what does the configuration currently produce" — the same
-- distinction 30_word_scores.sql and scripts/layout/pullFixture.mjs both turn on.
--
-- **The metric formulas are 11_category_eval.sql's, unchanged**, so the two are
-- the same measurement of two different screens. Restating them differently
-- would make the comparison meaningless in exactly the way this directory keeps
-- warning about:
--
--   prec   = good / (good + bad)
--   recall = good / good_pool
--   f1     = 2·good / (2·good + bad + (good_pool − good))
--
-- with `good_pool` fixed per (day, category): every labelled-good word present in
-- that section at all which clears the **day-wide** df >= 3.
--
-- **Do not put this table beside 11_category_eval.sql's.** They are different
-- screens, not two measurements of one. And do not put it beside round
-- fourteen's 78.58 → 75.22 either: the label set has grown twice since, and this
-- directory's standing rule is to compare configurations inside one run and
-- never against a number someone wrote down.

with
params as (select d from analysis.eval_days),
cats (cat) as (values ('politics'),('economy'),('society'),('culture'),('world'),('it')),

-- One call per (day, category). This is the deployed sieve end to end — sieves
-- 1-5, the head_pos demotion, the render cap and sieve 6's fixed-point loop.
drawn as (
  select p.d, c.cat, (e->>'word')::text as word
  from params p
  cross join cats c
  cross join lateral keyword_graph_compute(p.d, c.cat) g(j)
  cross join lateral json_array_elements(g.j->'nodes') e
),

-- The signals, for the pool's df >= 3 only. One call per day, not per cell.
sig as (
  select p.d, s.word, s.df
  from params p
  cross join lateral keyword_signals(p.d) s
),

-- Which words are in a section at all. Mirrors 11_category_eval.sql's
-- `scoped_df` — the same "present in this section" test the pool needs.
scoped as (
  select distinct h.collected_date as d, cat.slug as cat, n.word
  from headline_nouns n
  join headlines h on h.id = n.headline_id
  join categories cat on cat.id = h.category_id
  where h.collected_date in (select d from params)
),

pool as (
  select sc.d, sc.cat, count(*)::int as good_pool
  from scoped sc
  join sig s on s.d = sc.d and s.word = sc.word
  join analysis.word_labels l on l.word = sc.word
  where l.label = 'good' and s.df >= 3
  group by sc.d, sc.cat
),

metrics as (
  select
    d.d, d.cat,
    count(*)::int                                 as drawn,
    count(*) filter (where l.label = 'good')::int as good,
    count(*) filter (where l.label = 'bad')::int  as bad,
    count(*) filter (where l.label is null)::int  as unlabeled
  from drawn d
  left join analysis.word_labels l on l.word = d.word
  group by d.d, d.cat
)

-- Aggregated to one row per section over the eval days, plus an ALL row. The
-- per-cell form is 42 rows and the Management API truncates a response that
-- size; the cells are recoverable by dropping the grouping if a section looks
-- wrong.
select
  coalesce(m.cat, 'ALL (42 cells)')                as cat,
  count(*)::int                                    as cells,
  sum(m.unlabeled)::int                            as unlab,
  round(avg(m.drawn), 1)                           as shown,
  round(avg(100.0 * m.good / nullif(m.good + m.bad, 0)), 2) as prec_pct,
  round(avg(100.0 * m.good / nullif(p.good_pool, 0)), 2)    as recall_pct,
  round(avg(200.0 * m.good
            / nullif(2 * m.good + m.bad + (p.good_pool - m.good), 0)), 2) as f1_pct
from metrics m
join pool p on p.d = m.d and p.cat = m.cat
group by rollup (m.cat)
order by (m.cat is null), f1_pct desc;
