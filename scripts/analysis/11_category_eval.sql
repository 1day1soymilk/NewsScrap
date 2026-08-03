-- scripts/analysis/11_category_eval.sql
--
-- 10_sieve_eval.sql measures the all-categories view. This one measures what a
-- category tab draws, which is a different question and has a different answer:
-- on 2026-08-01 the economy tab drew 8 words and 1 edge.
--
--   scripts/analysis/run.sh scripts/analysis/11_category_eval.sql
--
-- The cause is that sieve 1 is the only clause computed on the filtered view.
-- Every other signal keyword_graph reads comes from keyword_signals(), which is
-- deliberately day-wide — inside one category every word sits in one bucket, so
-- specificity would collapse to a perfect 1 for everything. Sieve 1 alone counts
-- headlines *within* the category, so a word in three of the day's headlines
-- spread across two sections is in neither section's graph.
--
-- Three ways to set that cut, measured against the same labels:
--
--   scoped >= 3   what shipped before migration 0004
--   day >= 3      sieve 1 moves day-wide, like every other clause; the category
--                 filter then only decides which of the day's words are shown.
--                 **This is what ships** — 0004 adopted it at 61.2 mean F1
--                 against 40.4, winning in all twelve cells
--   day >= 3 and scoped >= 2   the same, but a word must recur in the section
--
-- Two further variants hold sieve 1 at what ships and move the fragment cut
-- instead, because a category tab is where that cut should hurt most if it
-- hurts: a tab draws far fewer than node_limit words, so a word the cut removes
-- is not replaced by a deeper one the way it is in the all-categories view.
-- 10_sieve_eval.sql asks the same question of the day as a whole.
--
-- A fourth, `scoped >= 2`, is deliberately absent: it draws words appearing
-- twice in the day, and pricing it under rule 4 costs 180 more labels. See
-- README.md, which records what a sample of those 180 turned out to be.
--
-- Read `unlab` first, exactly as in 10_sieve_eval.sql. Variants that reach
-- deeper than the day-wide top 70 can surface words the label set never covered,
-- and a row with unlabelled words in it is measuring a fraction of the screen.
--
-- Thresholds come from scoring_weights so this cannot drift from what ships.
-- Signals come from keyword_signals() for the same reason. The days come from
-- analysis.eval_days (12_eval_days.sql), so this file and its worklist
-- 21_unlabeled_category.sql cannot drift apart on which days they cover.

with
params as (select d from analysis.eval_days),

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

-- One row per (day, category, headline, word), so a word stored twice for one
-- headline is not counted twice — the same reason keyword_signals has its own
-- distinct.
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

-- Sieves 3 and 4 — everything except the two clauses under test. Identical to
-- the shipped sieve, thresholds and all. Sieve 2 moved out of here and into the
-- variant list, so a variant can turn it off; `standalone` is carried through
-- for that.
day_pass as (
  select s.d, s.word, s.df as day_df, s.standalone
  from sig s
  cross join w
  left join word_overrides ov on ov.word = s.word
  where ov.mode is distinct from 'exclude'
    and (
      char_length(s.word) >= w.min_word_len
      or s.spec >= w.min_spec
      or s.neighbors_per_doc <= w.max_npd
      or ov.mode = 'allow'
    )
),

-- `min_sa` of null means "whatever ships", so the three sieve-1 variants stay
-- exactly what they were and only rows 5 and 6 move the fragment cut.
--
-- Variant 1 is what shipped *before* migration 0004, not what ships now: that
-- migration moved sieve 1 day-wide after this file measured it at 40.4 mean F1
-- against 61.2. It is kept as the losing baseline it is.
variants (ord, name, mode, min_h, min_sa) as (values
  (1, 'sieve1 scoped >= 3 (pre-0004)', 'scoped', 3, null::numeric),
  (3, 'sieve1 day >= 3       (ships)', 'day',    3, null::numeric),
  (4, 'sieve1 day >= 3 and scoped >=2','both',   3, null::numeric),
  (5, 'ships, standalone off',         'day',    3, 0.00),
  (6, 'ships, standalone >= .50',      'day',    3, 0.50)
),

shown as (
  select
    v.ord, v.name, sd.d, sd.cat, sd.word, sd.df,
    row_number() over (
      partition by v.ord, sd.d, sd.cat order by sd.df desc, sd.word
    ) as rank
  from variants v
  cross join scoped_df sd
  cross join w
  join day_pass dp on dp.d = sd.d and dp.word = sd.word
  where dp.standalone >= coalesce(v.min_sa, w.min_standalone)
    and case v.mode
          when 'scoped' then sd.df >= v.min_h
          when 'day'    then dp.day_df >= v.min_h
          else               dp.day_df >= v.min_h and sd.df >= 2
        end
),

drawn as (
  select s.* from shown s cross join w where s.rank <= w.node_limit
),

-- Fixed per (day, category) so the variants stay comparable: every labelled-good
-- word that is in this section at all and clears the day-wide count. Held at the
-- shipped min_headlines rather than at each variant's own cut, the same way
-- 10_sieve_eval.sql holds its pool at df >= 3.
pool as (
  select sd.d, sd.cat, count(*)::int as good_pool
  from scoped_df sd
  join sig s on s.d = sd.d and s.word = sd.word
  join analysis.word_labels l on l.word = sd.word
  where l.label = 'good' and s.df >= 3
  group by sd.d, sd.cat
),

metrics as (
  select
    d.ord, d.name, d.d, d.cat,
    count(*)::int                                 as drawn,
    count(*) filter (where l.label = 'good')::int  as good,
    count(*) filter (where l.label = 'bad')::int   as bad,
    count(*) filter (where l.label is null)::int   as unlabeled
  from drawn d
  left join analysis.word_labels l on l.word = d.word
  group by d.ord, d.name, d.d, d.cat
)

select
  m.name,
  m.d::text as day,
  m.cat,
  m.drawn,
  m.unlabeled as unlab,
  m.good,
  m.bad,
  round(100.0 * m.good / nullif(m.good + m.bad, 0), 1) as prec_pct,
  round(100.0 * m.good / nullif(p.good_pool, 0), 1)    as recall_pct,
  round(200.0 * m.good / nullif(2 * m.good + m.bad + (p.good_pool - m.good), 0), 1) as f1_pct
from metrics m
join pool p on p.d = m.d and p.cat = m.cat
order by m.d, m.cat, m.ord;
