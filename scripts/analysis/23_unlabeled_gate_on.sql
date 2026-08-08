-- scripts/analysis/23_unlabeled_gate_on.sql
--
-- The third worklist: every word the **deployed, gated** sieve draws that
-- carries no label yet.
--
--   scripts/analysis/run.sh scripts/analysis/23_unlabeled_gate_on.sql
--
-- 20_unlabeled.sql covers the all-categories screens of `analysis.sieve_configs`
-- and 21_unlabeled_category.sql covers `11_category_eval.sql`'s tab variants.
-- **Neither can cover the screen 29_gate_on_category.sql scores, and the reason
-- is structural rather than an oversight.** Both of those files are gate-free —
-- 21 because sieve 6 needs a (day, category) edge set that `analysis.day_edges`
-- does not hold, 20 because it applies the gate against a day-wide reference set
-- rather than a scoped one. The gate does not merely remove places: removing
-- them frees slots under the render cap and **promotes deeper words into them**,
-- and a promoted word can be one that no gate-free screen has ever drawn.
--
-- That is exactly the class of word rule 4 exists to catch, so it needs a
-- worklist of its own. Found the only way it could be: 29_gate_on_category.sql
-- reported `unlab` 6 while both existing worklists returned nothing — the same
-- lesson round sixteen learned twice already, that **an empty worklist is
-- evidence about the worklist.**
--
-- This one reads the deployed function rather than reimplementing anything,
-- which is what makes it right where a fourth copy of sieve 6 would be wrong.
-- `keyword_graph_compute`, never `keyword_graph`: the latter serves
-- `keyword_graph_cache` and would ask "what was on screen at the last collector
-- run" instead of "what does the configuration produce".
--
-- Run it after 12_eval_days.sql and before reading 29_gate_on_category.sql.
-- While it returns rows, that file is scoring a fraction of the screen.

with
params as (select d from analysis.eval_days),
views (cat) as (
  values (null::text),('politics'),('economy'),('society'),('culture'),('world'),('it')
),

drawn as (
  select p.d, v.cat, (e->>'word')::text as word
  from params p
  cross join views v
  cross join lateral keyword_graph_compute(p.d, v.cat) g(j)
  cross join lateral json_array_elements(g.j->'nodes') e
),

-- Signals for the evidence columns, the same ones 20_unlabeled.sql prints so a
-- judgement call has its numbers beside it: a low `standalone` usually means the
-- word is a piece of a compound, and `days` says whether it recurs or belongs to
-- one day's news.
sig as (
  select p.d, s.*
  from params p
  cross join lateral keyword_signals(p.d) s
)

select
  d.word,
  max(s.df)::int                      as max_df,
  count(distinct d.d)::int            as days,
  string_agg(distinct coalesce(d.cat, 'ALL'), ' ' order by coalesce(d.cat, 'ALL')) as views,
  round(max(s.spec), 2)               as spec,
  round(min(s.standalone), 2)         as standalone,
  round(min(s.neighbors_per_doc), 2)  as npd,
  round(max(s.proper), 2)             as proper
from drawn d
join sig s on s.d = d.d and s.word = d.word
left join analysis.word_labels l on l.word = d.word
where l.word is null
group by d.word
order by max_df desc, d.word;
