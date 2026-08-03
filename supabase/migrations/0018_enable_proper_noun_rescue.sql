-- 0018: turn the proper-noun rescue on.
--
-- Migration 0017 added `proper` and left it disabled at 9.90. This is
-- 10_sieve_eval.sql's and 11_category_eval.sql's answer, and it is the largest
-- single measured gain the sieve has had.
--
--   day-wide, four days, unlabeled 0, story_rank 1 everywhere:
--     shipped                  mean F1 49.48   mean precision 71.07
--     len3 or proper >= .50    mean F1 52.40   mean precision 75.00
--   category tabs, 24 cells:
--     shipped                  mean F1 55.07
--     len3 or proper >= .50    mean F1 66.44
--
-- **It wins on all four days and on the tabs, which is what distinguishes it
-- from head_pos.** That signal won day-wide and lost 8 of 24 cells while winning
-- none, because it was a *cut* and a tab's render cap never binds, so there was
-- nothing to promote into the hole. This is a *rescue*: it only ever adds words,
-- and a tab has the room, which is why the tabs gain more than the day does.
-- A day-wide win with a category loss is the signature of a mechanism that
-- needs the cap to be binding. This has the opposite signature.
--
-- **`min_word_len 2` is the control, and it is why this is the tagger's win
-- rather than length's.** Admitting every two-character word scores mean F1
-- 31.98 and precision 45.73 — far worse than the shipped sieve, not better.
-- The gain is not "two-character words were being lost"; it is that the
-- analyser can say which of them are names. Of the 44 words a blanket
-- `min_word_len 2` promotes, 8 are good; of the 36 the tagger promotes on the
-- tabs, **31 are good** — 포항, 울산, 통영, 독일, 칠레, 가자, 유엔, 인텔, 쿠팡,
-- 퀄컴, 놀런, 룰라.
--
-- **0.50 is mid-plateau and deliberately not the best cell.** The sweep runs
-- 52.15 / 52.40 / 52.40 / 52.55 day-wide at .25 / .50 / .75 / 1.00 and
-- 66.28 / 66.44 / 66.48 / 66.37 on the tabs — flat to within noise. 1.00 scores
-- 0.15 higher day-wide and is the boundary: it means every row of the word was
-- tagged NNP, so one mistagged row in fifty disqualifies a name. 0.50 means
-- "more often a proper noun than not" and cannot be moved by a single row.
--
-- **The dictionary stays load-bearing.** With `word_overrides` off, the rescue
-- alone scores 49.58 — about what the shipped sieve scores with the dictionary
-- on, so it is not merely re-catching what the dictionary catches. But that
-- configuration drops the day's biggest story on three of four days, because
-- 폭염 is two characters and NNG, and lives on its `allow` entry from 0003.
-- 양산 likewise. Both entries are still the only thing holding those two words
-- on the canvas.

update public.scoring_weights
   set value = 0.50,
       note  = 'sieve 4d: share of a word''s rows tagged NNP. Rescues 2-char names (이란, 중국, 포항) that min_word_len cuts. Mid-plateau; .25-1.00 are flat.'
 where key = 'min_proper';

create or replace function keyword_graph(p_date date, p_category text default null)
returns json
language sql
stable
set search_path = ''
as $fn$
with w as (
  -- One row even when the table is empty, so the defaults here are the single
  -- source of truth if a key is ever missing.
  select
    coalesce(max(value) filter (where key = 'min_headlines'), 3)           as min_headlines,
    coalesce(max(value) filter (where key = 'min_standalone'), 0.10)       as min_standalone,
    coalesce(max(value) filter (where key = 'min_word_len'), 3)            as min_word_len,
    coalesce(max(value) filter (where key = 'min_spec'), 0.80)             as min_spec,
    -- Sieve 4d. 9.9 disables it, the convention min_spec uses, since the
    -- signal maxes at 1.
    coalesce(max(value) filter (where key = 'min_proper'), 9.90)           as min_proper,
    coalesce(max(value) filter (where key = 'max_neighbors_per_doc'), 1.8) as max_neighbors_per_doc,
    -- Sieve 5, as a demotion rather than a cut. 9.9 disables it.
    coalesce(max(value) filter (where key = 'demote_head_pos'), 9.90)      as demote_head_pos,
    coalesce(max(value) filter (where key = 'node_limit'), 70)             as node_limit,
    coalesce(max(value) filter (where key = 'render_cap'), 130)            as render_cap,
    coalesce(max(value) filter (where key = 'edge_min_cooc'), 2)           as edge_min_cooc,
    coalesce(max(value) filter (where key = 'edge_min_npmi'), 0.3)         as edge_min_npmi,
    coalesce(max(value) filter (where key = 'edge_limit'), 150)            as edge_limit
  from public.scoring_weights
),
sig as (
  select * from public.keyword_signals(p_date)
),
-- What the viewer is actually looking at. Counts and edges come from here; the
-- signals above deliberately do not.
scoped as (
  select distinct h.id as headline_id, n.word
  from public.headline_nouns n
  join public.headlines h on h.id = n.headline_id
  join public.categories c on c.id = h.category_id
  where h.collected_date = p_date
    and (p_category is null or c.slug = p_category)
),
scoped_df as (
  select s.word, count(*)::int as df from scoped s group by s.word
),
corpus as (
  select count(distinct s.headline_id)::numeric as n from scoped s
),
pairs as (
  select a.word as a, b.word as b, count(*)::int as cooc
  from scoped a
  join scoped b on b.headline_id = a.headline_id and b.word > a.word
  group by a.word, b.word
),
scored_pairs as (
  select
    p.a, p.b, p.cooc,
    ln((p.cooc * c.n) / (da.df * db.df)) / nullif(-ln(p.cooc / c.n), 0) as npmi
  from pairs p
  cross join corpus c
  join scoped_df da on da.word = p.a
  join scoped_df db on db.word = p.b
),
candidates as (
  select
    sd.word,
    sd.df as count,
    -- The day's headline count, which is what sieve 1 now reads. Distinct from
    -- `count` above, which is the figure the label is sized by and stays scoped
    -- to the category on screen.
    sig.df as day_df,
    sig.spec,
    sig.standalone,
    sig.neighbors_per_doc,
    sig.assoc,
    sig.head_pos,
    sig.proper,
    sig.category_slug,
    ov.mode as override_mode
  from scoped_df sd
  join sig on sig.word = sd.word
  left join public.word_overrides ov on ov.word = sd.word
),
-- passed_by names the sieve-4 clause that actually let the word through, in a
-- fixed order, so tuning can tell which rescue is carrying the day. 'allow' only
-- appears for a word that would otherwise have failed.
sieved as (
  select
    c.*,
    case
      when char_length(c.word) >= w.min_word_len then 'length'
      when c.proper >= w.min_proper then 'proper'
      when c.spec >= w.min_spec then 'spec'
      when c.neighbors_per_doc <= w.max_neighbors_per_doc then 'neighbors'
      when c.override_mode = 'allow' then 'allow'
    end as passed_by
  from candidates c
  cross join w
  where c.day_df >= w.min_headlines
    and c.standalone >= w.min_standalone
    and c.override_mode is distinct from 'exclude'
),
-- Frequency decides the order, and it is the category's own count that orders
-- them: the day-wide figure only decides eligibility.
--
-- The one thing allowed to disturb that is head_pos, and it is a **demotion**
-- rather than a cut: a word that trails the headline sorts below every word
-- that leads one, so it falls off only when the render cap is binding. As a
-- cut the same signal won day-wide and lost 8 of 24 category cells while
-- winning none, because a tab draws 5 to 46 words and the cap never binds
-- there, so a cut had nothing to promote in the removed word's place. The
-- gain was always the substitution and never the removal.
--
-- head_pos is day-wide, like every other sieve signal since migration 0004:
-- the category filter decides what is shown and how big, never what qualifies.
ranked as (
  select s.*, row_number() over (
    order by (s.head_pos > w.demote_head_pos) asc, s.count desc, s.word) as rank
  from sieved s
  cross join w
  where s.passed_by is not null
),
nodes as (
  select
    r.word, r.count, r.spec, r.standalone, r.neighbors_per_doc, r.assoc,
    r.passed_by, r.category_slug, r.rank,
    -- is not distinct from, not =: override_mode is null for most words, and
    -- `false or null` is null, which would ship a null faded flag to the client.
    (r.rank > w.node_limit or r.override_mode is not distinct from 'demote') as faded
  from ranked r
  cross join w
  where r.rank <= w.render_cap
),
edges as (
  select sp.a, sp.b, sp.cooc, sp.npmi
  from scored_pairs sp
  cross join w
  where sp.cooc >= w.edge_min_cooc
    and sp.npmi >= w.edge_min_npmi
    and exists (select 1 from nodes n where n.word = sp.a)
    and exists (select 1 from nodes n where n.word = sp.b)
  order by sp.npmi desc, sp.cooc desc
  limit (select edge_limit::int from w)
)
select json_build_object(
  'nodes', coalesce((
    select json_agg(json_build_object(
      'word', n.word,
      'count', n.count,
      'spec', round(n.spec, 3),
      'standalone', round(n.standalone, 3),
      'neighbors_per_doc', round(n.neighbors_per_doc, 3),
      'assoc', round(n.assoc, 3),
      'passed_by', n.passed_by,
      'category_slug', n.category_slug,
      'faded', n.faded
    ) order by n.rank)
    from nodes n
  ), '[]'::json),
  'edges', coalesce((
    select json_agg(json_build_object(
      'a', e.a,
      'b', e.b,
      'cooc', e.cooc,
      'npmi', round(e.npmi, 3)
    ) order by e.npmi desc, e.cooc desc)
    from edges e
  ), '[]'::json)
);
$fn$;

-- create or replace keeps the existing grants, but re-stating them costs
-- nothing and makes a fresh database built from migrations alone come out the
-- same as one that was migrated.
grant execute on function keyword_graph(date, text) to anon, authenticated;
