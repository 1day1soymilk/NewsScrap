-- supabase/migrations/0004_sieve1_day_wide.sql
--
-- Sieve 1 counts headlines for the whole day rather than for the category on
-- screen.
--
-- Every other input to the sieve already worked this way. keyword_signals is
-- computed day-wide on purpose — inside one category every word sits in a single
-- bucket, so specificity would collapse to a perfect 1 for everything — but
-- sieve 1 read the count from the filtered view. The two disagreed, and the
-- filtered side won: a word in three of the day's headlines split across two
-- sections was in neither section's graph.
--
-- What that cost, measured by scripts/analysis/11_category_eval.sql over six
-- categories and two days:
--
--   sieve 1 per category (before)   mean F1 40.4
--   sieve 1 per day     (after)     mean F1 61.2
--
-- It wins in all twelve cells, not on average — the smallest gain is 세계 on
-- 2026-08-01 at 61.5 -> 69.0 and the largest is IT on 2026-07-31 at 20.0 -> 59.0.
-- The category tabs stop being empty as a side effect rather than as the goal:
-- 생활/문화 on 2026-07-31 went from 6 words to 18, IT from 13 to 34.
--
-- Precision falls in some cells (world on 2026-07-31, 90.0 -> 75.8) because
-- recall rises much further (48.6 -> 67.6). README.md rule 5 is explicit that
-- precision alone is the wrong thing to read, and for the reason on display
-- here: the highest-precision setting is the one that draws almost nothing.
--
-- A third variant, requiring the word to appear at least twice in the section as
-- well, sits between the two at 50.7 and is not adopted. A fourth, lowering the
-- per-category cut to 2 instead, is unmeasured: pricing it under rule 4 costs
-- 180 more labels, and a sample of what it draws is mostly Naver's own column
-- titles — 마켓프리즘, 디브리핑, 더차트, 급리포트.
--
-- min_headlines itself does not move. It stays 3 in scoring_weights; only the
-- population it counts over changes. The all-categories view is untouched by
-- construction, since with p_category null the scoped set is the whole day:
-- 2026-07-31 stays at 90 nodes and 47 edges, 2026-08-01 at 130 and 82.

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
    coalesce(max(value) filter (where key = 'max_neighbors_per_doc'), 1.8) as max_neighbors_per_doc,
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
-- Frequency alone decides the order, and it is the category's own count that
-- orders them: the day-wide figure only decides eligibility.
ranked as (
  select s.*, row_number() over (order by s.count desc, s.word) as rank
  from sieved s
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
