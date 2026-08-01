-- scripts/analysis/21_unlabeled_category.sql
--
-- 20_unlabeled.sql for the category views. Same job, same rule: while this
-- returns rows, 11_category_eval.sql is measuring a fraction of the screen.
--
--   scripts/analysis/run.sh scripts/analysis/21_unlabeled_category.sql
--
-- A separate worklist is needed because the category variants reach words the
-- all-categories sweep never draws. A word in three headlines spread over two
-- sections sits deep in the day-wide ranking and never enters the top 70, but it
-- can be third in its own section. Those are exactly the words the category
-- question is about, so they have to be labelled before the answer counts.
--
-- The variant list is duplicated from 11_category_eval.sql for the same reason
-- 20_unlabeled.sql mirrors the harness: a variant present in one and missing
-- from the other reopens the blind spot rule 4 exists to close.

with
params (d) as (values
  ('2026-07-31'::date),
  ('2026-08-01'::date)
),

w as (
  select
    coalesce(max(value) filter (where key = 'min_standalone'), 0.10)       as min_standalone,
    coalesce(max(value) filter (where key = 'min_word_len'), 3)            as min_word_len,
    coalesce(max(value) filter (where key = 'min_spec'), 0.80)             as min_spec,
    coalesce(max(value) filter (where key = 'max_neighbors_per_doc'), 1.8) as max_npd,
    coalesce(max(value) filter (where key = 'node_limit'), 70)             as node_limit
  from scoring_weights
),

sig as (
  select p.d, s.*
  from params p
  cross join lateral keyword_signals(p.d) s
),

scoped as (
  select distinct h.collected_date as d, c.slug as cat, h.id as headline_id, n.word
  from headline_nouns n
  join headlines h on h.id = n.headline_id
  join categories c on c.id = h.category_id
  where h.collected_date in (select d from params)
),

scoped_df as (
  select s.d, s.cat, s.word, count(*)::int as df
  from scoped s
  group by s.d, s.cat, s.word
),

day_pass as (
  select s.d, s.word, s.df as day_df
  from sig s
  cross join w
  left join word_overrides ov on ov.word = s.word
  where s.standalone >= w.min_standalone
    and ov.mode is distinct from 'exclude'
    and (
      char_length(s.word) >= w.min_word_len
      or s.spec >= w.min_spec
      or s.neighbors_per_doc <= w.max_npd
      or ov.mode = 'allow'
    )
),

-- Must match 11_category_eval.sql exactly, including the absence of
-- `scoped >= 2` — a variant in one file and not the other reopens the blind
-- spot rule 4 exists to close.
variants (ord, mode, min_h) as (values
  (1, 'scoped', 3),
  (3, 'day',    3),
  (4, 'both',   3)
),

shown as (
  select
    v.ord, sd.d, sd.cat, sd.word, sd.df, dp.day_df,
    row_number() over (
      partition by v.ord, sd.d, sd.cat order by sd.df desc, sd.word
    ) as rank
  from variants v
  cross join scoped_df sd
  join day_pass dp on dp.d = sd.d and dp.word = sd.word
  where case v.mode
          when 'scoped' then sd.df >= v.min_h
          when 'day'    then dp.day_df >= v.min_h
          else               dp.day_df >= v.min_h and sd.df >= 2
        end
),

drawn as (
  select s.* from shown s cross join w where s.rank <= w.node_limit
)

select
  d.word,
  max(d.day_df)::int                as day_df,
  max(d.df)::int                    as max_cat_df,
  string_agg(distinct d.cat, ' ')   as cats,
  round(max(s.spec), 2)             as spec,
  round(min(s.standalone), 2)       as standalone,
  round(min(s.neighbors_per_doc), 2) as npd
from drawn d
join sig s on s.d = d.d and s.word = d.word
left join analysis.word_labels l on l.word = d.word
where l.word is null
group by d.word
order by max(d.day_df) desc, d.word;
