-- 0015: head_pos ships — as a demotion, not a cut.
--
-- Migration 0014 added the signal and changed nothing. This turns it on, and
-- what it turns on is not the obvious thing, which is the point of the two
-- rounds behind it (scripts/analysis/02_sieve_configs.sql, rounds five and six).
--
-- **As a hard cut it was right day-wide and wrong on the category tabs.**
-- head_pos <= 0.70 took mean F1 from 65.05 to 67.30 over the four labelled days,
-- winning three and losing none with the top story held at rank 1 throughout —
-- and then 11_category_eval.sql put it at 63.42 against 65.08 over 24 category
-- cells, losing 8 of them and **winning not one**.
--
-- Both figures are real and the reason is the render cap. Day-wide it binds at
-- 70, so cutting a word promotes a deeper one, and the promoted words are about
-- as good as the screen average — the gain came from the substitution, not from
-- the removal. A category tab draws at most 46 words, the cap never binds, and
-- a cut there is pure loss with nothing to fill the hole.
--
-- So the mechanism has to be one that can only act where a substitution exists.
-- A demotion is exactly that. Round six measured it and it reproduces the cut's
-- day-wide numbers **exactly** — 71.9 / 67.8 / 65.8 / 63.7 against the shipped
-- 70.7 / 67.8 / 63.1 / 58.6 — while being a no-op on every tab by construction.
--
-- 0.70 is interior to its sweep, not at the edge (rule 2): 0.65 gives mean 66.68
-- and 0.75 gives 65.68. At 0.50 폭염 sinks to rank 66 on 2026-07-31 and off the
-- screen entirely on 08-03, which is what the bottom of the range looks like.
--
-- This is the first thing ever allowed to disturb "ranking is by frequency
-- alone". Size stays proportional to headline count, untouched; what moves is
-- only which words fill the last places under the cap.

insert into public.scoring_weights (key, value, note)
values ('demote_head_pos', 0.70,
        'sieve 5: a word trailing the headline is a qualifier, not the story. A demotion, not a cut — see 0015.')
on conflict (key) do update set value = excluded.value, note = excluded.note;

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
