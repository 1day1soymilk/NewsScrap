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
--
-- **What `chk` cannot see, and it is two things.** It compares membership of the
-- drawn set against sieves 1 to 4, so:
--
--   * **Sieve 6, the place gate, is invisible to it.** `is_place` is deliberately
--     absent from keyword_graph's JSON (migration 0024's tail comment says why),
--     so a place dropped by the gate arrives here looking exactly like a word
--     that lost on rank, and this file would report `cut: rank` with a clean
--     `chk`. Round fourteen left `place_needs_edge` at 0, so nothing is wrong
--     today; **a later round that turns the gate on must add the clause here by
--     hand, because the cross-check will not demand it.** What does check that
--     copy is the procedure in 10_sieve_eval.sql's `gate_fail` comment.
--   * **The α ordering is invisible to it too.** `rank` is read out of the RPC's
--     own JSON rather than recomputed, so a disagreement about `count_balanced`
--     could not show up as a `!` — it would simply be inherited. That is the
--     right trade for a diagnostic, but it means this file cannot be used to
--     verify migration 0025's ranking key.
--
-- Both blind spots are membership-vs-order in shape: `chk` tests *whether* a word
-- may be drawn, never *why it placed where it did*.

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
    -- Sieve 4d, migration 0018. 9.9 disables it, the convention min_spec uses,
    -- since the signal maxes at 1.
    coalesce(max(value) filter (where key = 'min_proper'), 9.90)           as min_proper,
    coalesce(max(value) filter (where key = 'demote_head_pos'), 9.90)      as demote_head_pos,
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
    -- Carried out of `w` explicitly: `s.*` is the signals and the cross join
    -- does not put w's columns into `a.*`.
    w.demote_head_pos,
    (s.df >= w.min_headlines)                                as ok_headlines,
    (s.standalone >= w.min_standalone)                       as ok_standalone,
    (ov.mode is distinct from 'exclude')                     as ok_dictionary,
    -- is not distinct from, not =: override_mode is null for most words, and
    -- `false or null` is null, which falls out of the CASE below and reports a
    -- word cut by sieve 4 as merely outranked. Same trap as the `faded` flag in
    -- migration 0003, and it was walked into here before the cross-check found
    -- it — which is what the cross-check is for.
    -- Sieve 4d belongs in this disjunction and was missing from it from the day
    -- migration 0018 shipped until round fourteen ran this file and read `chk`.
    -- It is exactly the drift the cross-check exists to catch, and it caught it:
    -- **every word admitted by `passed_by = 'proper'` was reported `!`**, because
    -- this copy had no clause that could admit it. On the run that found it —
    -- 2026-08-04 at 20:0x KST, a day still collecting, so the count is a snapshot
    -- and not a figure to reproduce — that was 12 of 70 drawn words. Nothing
    -- about the sieve was wrong; this copy of it was, which is what a `!` always
    -- means.
    (char_length(s.word) >= w.min_word_len
      or s.proper >= w.min_proper
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
      -- A word that cleared every clause and still lost its place. Splitting the
      -- two reasons matters: 'cut: rank' means plain frequency, while 'demoted'
      -- means the word trails its headlines and was sorted below everything that
      -- leads one, so it lost to words it outranks on count (migration 0015).
      when a.head_pos > a.demote_head_pos     then 'demoted: trails'
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
  round(l.head_pos, 2)          as hpos,
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
