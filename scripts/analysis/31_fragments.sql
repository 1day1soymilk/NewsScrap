-- scripts/analysis/31_fragments.sql
--
-- Words that look like pieces of longer words, with the longer word beside them.
--
--   scripts/analysis/run.sh scripts/analysis/31_fragments.sql
--
-- `standalone` is the share of a word's headlines where it appears as a run of
-- Hangul on its own rather than buried inside a longer one. 도체 scores 0.00
-- because it only ever occurs inside 반도체. The sieve cuts anything below
-- `min_standalone`, and this report shows what that cut is catching plus the
-- band just above it, so the threshold can be judged against words rather than
-- against a number.
--
-- The `enclosing` column is the point of the report. keyword_signals computes
-- the ratio but not the word behind it, so this file re-reads the titles to
-- pull out the whole Hangul run around each occurrence and reports the most
-- common one. Two different findings come out of the same column:
--
--   * `pre`/`post` holding real syllables — 도체 inside 반도체, 유조 inside
--     유조선 — is a **compound the noun merge in lib/nouns.ts failed to
--     restore**. That is a collection bug, not a threshold question: the word
--     the graph should be drawing does not exist in headline_nouns at all.
--   * `post` holding a particle — 이제 inside 이제는 — is the ratio's own blind
--     spot. The word is whole and Korean simply attached a 조사 to it, so a low
--     score there is not evidence of a fragment. This is why `min_standalone`
--     sits low enough to catch only the unambiguous 0.00 cases.
--
-- `otherwise` says whether the fragment cut is doing any work for that word. It
-- reads `would draw` on a below-cut word that clears every other clause, so
-- lifting the cut would put it on screen — those rows are the ones to read
-- first, since a whole word among them is a word the graph is losing. On an
-- above-cut word the cut is not applying at all and the column reads `drawn`.
-- Blank means the word fails some other clause and says nothing about this
-- threshold either way.

with
-- The most recent collected day, and how far above the cut to look. Replace with
-- literals to look at another day: params (d, band) as (values ('2026-07-31'::date, 0.30)).
params (d, band) as (values (
  (select max(collected_date) from headlines),
  0.30   -- upper edge of the reported band; the cut itself is min_standalone
)),

w as (
  select
    coalesce(max(value) filter (where key = 'min_headlines'), 3)           as min_headlines,
    coalesce(max(value) filter (where key = 'min_standalone'), 0.10)       as min_standalone,
    coalesce(max(value) filter (where key = 'min_word_len'), 3)            as min_word_len,
    coalesce(max(value) filter (where key = 'min_spec'), 0.80)             as min_spec,
    coalesce(max(value) filter (where key = 'max_neighbors_per_doc'), 1.8) as max_neighbors_per_doc
  from scoring_weights
),

sig as (
  select s.* from params p cross join lateral keyword_signals(p.d) s
),

-- Below min_headlines a word never reaches the screen whatever its standalone
-- ratio is, and those are most of the day's vocabulary.
cand as (
  select s.*, ov.mode as override_mode
  from sig s
  cross join w
  cross join params p
  left join word_overrides ov on ov.word = s.word
  where s.df >= w.min_headlines
    and s.standalone < p.band
),

doc as (
  select distinct c.word, h.title
  from cand c
  join headline_nouns n on n.word = c.word
  join headlines h on h.id = n.headline_id
  where h.collected_date = (select d from params)
),

-- The whole Hangul run containing the word. The escape is the same one
-- keyword_signals uses on the word before building its pattern; the pattern
-- itself is different because that function asks whether the word stands alone
-- and this one asks what it is standing inside.
runs as (
  select
    d.word,
    substring(d.title from ('[가-힣]*' ||
      regexp_replace(d.word, '([\\^$.|?*+()\[\]{}-])', '\\\1', 'g') ||
      '[가-힣]*')) as run
  from doc d
),
run_counts as (
  select r.word, r.run, count(*)::int as hits
  from runs r
  where r.run is not null and r.run <> r.word
  group by r.word, r.run
),
-- Ties break on the shorter run and then on the run itself, so a rerun of the
-- same day names the same word.
top_run as (
  select distinct on (rc.word) rc.word, rc.run, rc.hits
  from run_counts rc
  order by rc.word, rc.hits desc, char_length(rc.run), rc.run
),
-- One dominant container is the compound-merge case. A word wrapped in a dozen
-- different runs is a common syllable pair rather than a piece of one word.
form_counts as (
  select rc.word, count(*)::int as forms from run_counts rc group by rc.word
)

select
  c.word,
  c.df,
  round(c.standalone, 2) as sa,
  case when c.standalone < w.min_standalone then 'below cut' else 'above cut' end as zone,
  t.run                  as enclosing,
  case when t.run is null then ''
       else left(t.run, position(c.word in t.run) - 1) end as pre,
  case when t.run is null then ''
       else substring(t.run from position(c.word in t.run) + char_length(c.word)) end as post,
  t.hits,
  f.forms,
  -- Every clause except the fragment cut, so the column says what lifting that
  -- one cut would do. Sieve 4 is null-safe for the reason migration 0003 gives:
  -- override_mode is null for most words and `false or null` is null.
  case when c.override_mode is distinct from 'exclude'
        and (char_length(c.word) >= w.min_word_len
             or c.spec >= w.min_spec
             or c.neighbors_per_doc <= w.max_neighbors_per_doc
             or c.override_mode is not distinct from 'allow')
       then case when c.standalone < w.min_standalone then 'would draw' else 'drawn' end
       else '' end as otherwise,
  coalesce(lab.label, '') as label
from cand c
cross join w
left join top_run t on t.word = c.word
left join form_counts f on f.word = c.word
left join analysis.word_labels lab on lab.word = c.word
order by c.df desc, c.word;
