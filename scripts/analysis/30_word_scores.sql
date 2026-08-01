-- scripts/analysis/30_word_scores.sql
--
-- One day's screen, word by word, with every signal and the sieve's verdict
-- beside it. This is the "why is that word there, and why is that one not"
-- report — the companion to 10_sieve_eval.sql, which answers the different
-- question of whether a whole configuration is better than another one.
--
--   scripts/analysis/run.sh scripts/analysis/30_word_scores.sql
--
-- It reports the shipped configuration only. It is a diagnostic, never a
-- justification for moving a threshold: a threshold moves when
-- 10_sieve_eval.sql says the labelled metrics improved, and reading a dump of
-- one day is exactly the "it looks better on screen" habit README.md exists to
-- prevent.
--
-- Where the numbers come from, and why it matters:
--
--   * the four signals come from keyword_signals(), the same function
--     keyword_graph() calls, so the values here are the ones that shipped;
--   * `rank`, `by` and `faded` come from keyword_graph() itself, expanded out
--     of its JSON, so the drawn set is not re-derived here either.
--
-- Only the `cut: …` reasons are worked out in this file, since keyword_graph
-- returns the survivors and says nothing about the rest. That is a second copy
-- of the sieve's clauses, and a second copy drifts — so `chk` cross-checks it
-- against the node list and prints `!` on any word the two disagree about.
-- **A single `!` means this file is wrong, not the sieve.** Fix it here.

with
-- The most recent collected day. Replace with a literal date to look at another
-- one: params (d, cut_n) as (values ('2026-07-31'::date, 40)).
params (d, cut_n) as (values (
  (select max(collected_date) from headlines),
  40   -- how many cut words to list, highest frequency first
)),

-- Same keys and same fallbacks as keyword_graph. The fallbacks only apply to a
-- key missing from the table, which is not the case today.
w as (
  select
    coalesce(max(value) filter (where key = 'min_headlines'), 3)           as min_headlines,
    coalesce(max(value) filter (where key = 'min_standalone'), 0.10)       as min_standalone,
    coalesce(max(value) filter (where key = 'min_word_len'), 3)            as min_word_len,
    coalesce(max(value) filter (where key = 'min_spec'), 0.80)             as min_spec,
    coalesce(max(value) filter (where key = 'max_neighbors_per_doc'), 1.8) as max_neighbors_per_doc,
    coalesce(max(value) filter (where key = 'node_limit'), 70)             as node_limit,
    coalesce(max(value) filter (where key = 'render_cap'), 130)            as render_cap
  from scoring_weights
),

sig as (
  select s.* from params p cross join lateral keyword_signals(p.d) s
),

-- json_agg preserved keyword_graph's own ordering, so ordinality recovers the
-- rank the RPC assigned. The JSON carries no rank field of its own.
graph as (
  select keyword_graph((select d from params), null) as j
),
nodes as (
  select
    t.ord::int                as rank,
    (t.n->>'word')::text      as word,
    (t.n->>'passed_by')::text as passed_by,
    (t.n->>'faded')::boolean  as faded
  from graph g
  cross join json_array_elements(g.j->'nodes') with ordinality as t(n, ord)
),

-- The clauses, in the order the sieve applies them. `passes` is what the sieve
-- would say; `chk` below is what tests it against what the sieve did say.
annotated as (
  select
    s.*,
    ov.mode as override_mode,
    n.rank, n.passed_by, n.faded,
    (s.df >= w.min_headlines)                                as ok_headlines,
    (s.standalone >= w.min_standalone)                       as ok_standalone,
    (ov.mode is distinct from 'exclude')                     as ok_dictionary,
    -- is not distinct from, not =: override_mode is null for most words, and
    -- `false or null` is null, which falls out of the CASE below and reports a
    -- word cut by sieve 4 as merely outranked. Same trap as the `faded` flag in
    -- migration 0003, and it was walked into here before the cross-check found
    -- it — which is what the cross-check is for.
    (char_length(s.word) >= w.min_word_len
      or s.spec >= w.min_spec
      or s.neighbors_per_doc <= w.max_neighbors_per_doc
      or ov.mode is not distinct from 'allow')               as ok_sieve4
  from sig s
  cross join w
  left join word_overrides ov on ov.word = s.word
  left join nodes n on n.word = s.word
),

verdicts as (
  select
    a.*,
    -- coalesced so a null from any clause reads as "did not pass" rather than
    -- as a null that makes the `chk` comparison below quietly untestable.
    coalesce(a.ok_headlines and a.ok_standalone and a.ok_dictionary and a.ok_sieve4,
             false) as passes,
    case
      when a.rank is not null and a.faded     then 'drawn (faded)'
      when a.rank is not null                 then 'drawn'
      when not a.ok_headlines                 then 'cut: headlines'
      when not a.ok_standalone                then 'cut: fragment'
      when not a.ok_dictionary                then 'cut: dictionary'
      when not a.ok_sieve4                    then 'cut: generic'
      else                                         'cut: rank'
    end as verdict
  from annotated a
),

-- Everything drawn, plus the most frequent words that were not. The cut side is
-- capped because a day holds ~3,300 distinct words and all but a few hundred are
-- cut by frequency alone.
listed as (
  select v.*
  from verdicts v
  where v.rank is not null
  union all
  (select v.*
   from verdicts v
   where v.rank is null
   order by v.df desc, v.word
   limit (select cut_n from params))
)

select
  l.rank,
  l.word,
  l.df,
  round(l.spec, 2)              as spec,
  round(l.standalone, 2)        as sa,
  round(l.neighbors_per_doc, 2) as npd,
  round(l.assoc, 2)             as assoc,
  l.category_slug               as cat,
  coalesce(l.override_mode, '') as ov,
  l.verdict,
  coalesce(l.passed_by, '')     as by,
  -- Drawn but annotated as cut, or annotated as passing while a free slot went
  -- unused. Either way this file has drifted from keyword_graph.
  case
    when l.rank is not null and not l.passes then '!'
    when l.rank is null and l.passes
         and (select count(*) from nodes) < (select render_cap from w) then '!'
    else ''
  end                           as chk,
  coalesce(lab.label, '')       as label
from listed l
left join analysis.word_labels lab on lab.word = l.word
order by l.rank nulls last, l.df desc, l.word;
