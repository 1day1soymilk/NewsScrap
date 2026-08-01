-- supabase/migrations/0003_keyword_scoring.sql
--
-- Word quality scoring and the keyword graph the frontend draws.
--
-- Pure frequency carries no information about whether a word is a keyword: on
-- 2026-07-31 the frequency ranking scored AUC 0.499 against a hand-labelled set,
-- which is exactly a coin flip. Blending signals into one weighted score made it
-- worse, not better, because each signal catches a different kind of bad word and
-- averaging dilutes each one where it is strong. So this is a sieve — thresholds
-- in series — rather than a score:
--
--   sieve 1  headline count  >= min_headlines
--   sieve 2  standalone      >= min_standalone   drops fragments (도체, 무인, 알뜰)
--   sieve 3  not in word_overrides as 'exclude'
--   sieve 4  any one of:  char_length >= min_word_len          (proper nouns)
--                         spec        >= min_spec              (트럼프, 국힘, 날씨)
--                         neighbours  <= max_neighbors_per_doc (폭염, 양산, 경남)
--            words listed as 'allow' are exempt from sieve 4
--
-- Sieve 4 is a disjunction because specificity and neighbour count rescue
-- different good words and neither alone is enough. The day's biggest story
-- spreads across sections, so its words look generic to a category-entropy
-- measure — 폭염 scored 0.478 there, below any useful cut — while its tight
-- neighbourhood gives it away. Nationally recurring names invert that: 트럼프 has
-- 0.819 specificity but sits among the loosest neighbourhoods of the day.
--
-- Ranking is by frequency alone and never by these signals. The sieve decides
-- whether a word is drawn; size stays proportional to headline count, because
-- "bigger means more common" is the one thing a word cloud reader already knows.
-- Words past node_limit are faded rather than dropped.
--
-- All thresholds were fitted on a single day of data with labels that are one
-- person's judgement, which is why they live in a table instead of in this file.
-- Re-measure with scripts/analysis/ before changing any of them.

create table word_overrides (
  word text primary key,
  mode text not null check (mode in ('exclude', 'demote', 'allow')),
  factor numeric not null default 0.3,   -- demote only; per-word opacity
  note text,
  created_at timestamptz not null default now()
);

comment on table word_overrides is
  'Hand maintained. exclude: never draw. demote: draw faded. allow: exempt from sieve 4.';

create table scoring_weights (
  key text primary key,
  value numeric not null,
  note text
);

comment on table scoring_weights is
  'Sieve thresholds, kept out of the code so they can be retuned without a redeploy.';

alter table word_overrides enable row level security;
alter table scoring_weights enable row level security;

create policy "public read word_overrides" on word_overrides for select using (true);
create policy "public read scoring_weights" on scoring_weights for select using (true);

insert into scoring_weights (key, value, note) values
  ('min_headlines',         3,    'sieve 1: fewer headlines than this and the word is noise'),
  ('min_standalone',        0.10, 'sieve 2: fragments score 0.00, whole words 0.85-1.00'),
  ('min_word_len',          3,    'sieve 4a: len 2 collapses to 24% F1, len 4 to 16% recall'),
  ('min_spec',              9.90, 'sieve 4b: DISABLED — see the note below'),
  ('max_neighbors_per_doc', 1.8,  'sieve 4c: flat from 1.8 to 2.5, degrades past 2.8'),
  ('node_limit',            70,   'drawn at full opacity; the rest fade'),
  ('render_cap',            130,  'hard stop on how many words reach the canvas'),
  ('demote_factor',         0.3,  'default opacity for faded words'),
  ('edge_min_cooc',         2,    'a single shared headline is a coincidence'),
  ('edge_min_npmi',         0.3,  'below this the graph turns into a hairball'),
  ('edge_limit',            150,  'strongest edges only');

-- min_spec is disabled rather than deleted. Specificity is a real signal for
-- ranking — 트럼프 0.819 and 국힘 0.893 against 한국 0.039 — but as a *rescue*
-- clause it backfires, and measurably so: turning it off gained 6.8 F1 points on
-- 2026-07-31 and 14.2 on 2026-08-01, the largest and most consistent effect in
-- the whole sweep.
--
-- The reason is the observation the plan recorded about fragments and then did
-- not carry through: a word trapped in a single context scores a perfect 1.00.
-- That is true of 알뜰 (a fragment of 알뜰폰) and equally true of 감찰, 윤리, 청문,
-- 초등 and 순회 — all 1.00, all meaningless on their own. Admitting a word
-- *because* it is confined to one section admits exactly those.
--
-- Any value above 1.0 disables the clause, since spec is bounded at 1. It is
-- kept in the sieve so it can be re-measured once more days accumulate; the
-- verdict rests on two days.
--
-- Everything else was swept and left alone. min_standalone is flat from 0.10 to
-- 0.60 (and drops 폭염 at 0.70), max_neighbors_per_doc is flat from 1.8 to 2.5
-- and degrades past 2.8, min_headlines is identical at 2, 3 and 4. Moving any of
-- them would be fitting noise — the differences are 1 to 3 points, and on two
-- days of one person's labels only the large gaps mean anything.

-- Only words the 2026-07-31 measurements actually caught. The sieve already
-- removes most generic words on its own; seeding a large dictionary up front
-- would be guessing, and every entry here is a threshold that failed.
--
-- These 12 passed the sieve and are generic in Korean generally, not just on the
-- day they were measured — which is why listing them is not overfitting.
insert into word_overrides (word, mode, note) values
  ('최고', 'exclude', 'passed the sieve on 2026-07-31; generic'),
  ('관측', 'exclude', 'passed the sieve on 2026-07-31; generic'),
  ('추천', 'exclude', 'passed the sieve on 2026-07-31; generic'),
  ('파괴', 'exclude', 'passed the sieve on 2026-07-31; generic'),
  ('해제', 'exclude', 'passed the sieve on 2026-07-31; generic'),
  ('폐지', 'exclude', 'passed the sieve on 2026-07-31; generic'),
  ('생산', 'exclude', 'passed the sieve on 2026-07-31; generic'),
  ('예약', 'exclude', 'passed the sieve on 2026-07-31; generic'),
  ('주장', 'exclude', 'passed the sieve on 2026-07-31; generic'),
  ('처리', 'exclude', 'passed the sieve on 2026-07-31; generic'),
  ('발언', 'exclude', 'passed the sieve on 2026-07-31; generic'),
  ('문자', 'exclude', 'passed the sieve on 2026-07-31; generic'),
  -- Site furniture and calendar words: never about the news itself.
  ('뉴스', 'exclude', 'site furniture'),
  ('자막', 'exclude', 'site furniture'),
  ('오늘', 'exclude', 'calendar word'),
  ('다음', 'exclude', 'calendar word'),
  ('이유', 'exclude', 'generic'),
  ('하루', 'exclude', 'generic'),
  ('시간', 'exclude', 'generic');

-- Insurance, not a correction. passed_by reports the natural clause first, so an
-- allow entry only shows up for a word that would otherwise have failed. These
-- are the two words a retune of max_neighbors_per_doc is most likely to lose,
-- and losing the day's biggest story is the failure mode worth guarding against.
insert into word_overrides (word, mode, note) values
  ('폭염', 'allow', 'specificity 0.478 — biggest story of 2026-07-31, spread across sections'),
  ('양산', 'allow', 'specificity 0.418 — same story');

-- The four per-word signals, plus the two fields the graph needs for display.
--
-- Split out from keyword_graph so that scripts/analysis/ measures exactly what
-- ships. Threshold tuning that reads a second, hand-copied implementation of
-- these formulas is measuring the wrong thing, and the same hazard as the
-- schema-in-three-places rule in CLAUDE.md.
--
-- Everything here is computed over the whole day, deliberately ignoring which
-- category is on screen: inside one category every word sits in one bucket, so
-- entropy collapses to zero and every word would score a perfect specificity.
create function keyword_signals(p_date date)
returns table (
  word text,
  df int,
  spec numeric,
  standalone numeric,
  neighbors_per_doc numeric,
  assoc numeric,
  category_slug text
)
language sql
stable
set search_path = ''
as $fn$
with
-- One row per (headline, word). headline_nouns can hold the same word twice for
-- one headline, and counting those twice would say 폭염 appeared 46 times in 45
-- headlines. Document frequency is what every signal below is defined on.
doc as (
  select distinct h.id as headline_id, h.title, c.slug as category_slug, n.word
  from public.headline_nouns n
  join public.headlines h on h.id = n.headline_id
  join public.categories c on c.id = h.category_id
  where h.collected_date = p_date
),
df as (
  select d.word, count(*)::int as df from doc d group by d.word
),
-- 1 - normalised category entropy. A word confined to one section scores 1, one
-- spread evenly across all six scores 0.
spec as (
  select
    p.word,
    1 - sum(-p.share * ln(p.share))
        / ln(nullif((select count(*)::numeric from public.categories), 1)) as spec
  from (
    select d.word, count(*)::numeric / sum(count(*)) over (partition by d.word) as share
    from doc d
    group by d.word, d.category_slug
  ) p
  group by p.word
),
-- Share of the word's headlines whose title contains it as a standalone run of
-- Hangul. This is what separates a real word from a piece of one: 도체 only ever
-- occurs inside 반도체 and scores 0.00, while whole words score 0.85-1.00.
--
-- Used as a hard cut and never as a graded penalty — 수사 (0.17) and 뉴스 (0.19)
-- are legitimate words that score low, so the cut sits low enough to catch only
-- the unambiguous 0.00 cases.
standalone as (
  select
    d.word,
    avg(
      case
        when d.title ~ ('(^|[^가-힣])' ||
                        regexp_replace(d.word, '([\\^$.|?*+()\[\]{}-])', '\\\1', 'g') ||
                        '($|[^가-힣])')
        then 1 else 0
      end
    )::numeric as standalone
  from doc d
  group by d.word
),
-- Distinct co-occurring words per headline. YAKE's term-relatedness-to-context:
-- a word that turns up beside a different set of words every time is carrying
-- grammar, not meaning.
--
-- The numerator is a raw count of distinct neighbours, so it grows with corpus
-- size rather than saturating. Compare this figure only across days of similar
-- headline volume, and re-sweep the threshold whenever that volume shifts.
neighbors as (
  select a.word, count(distinct b.word)::numeric as distinct_neighbors
  from doc a
  join doc b on b.headline_id = a.headline_id and b.word <> a.word
  group by a.word
),
-- Whichever section ran the word most often, for colouring the all-categories view.
top_category as (
  select distinct on (t.word) t.word, t.category_slug
  from (select d.word, d.category_slug, count(*) as c from doc d group by d.word, d.category_slug) t
  order by t.word, t.c desc, t.category_slug
),
corpus as (
  select count(distinct d.headline_id)::numeric as n from doc d
),
pairs as (
  select a.word as a, b.word as b, count(*)::int as cooc
  from doc a
  join doc b on b.headline_id = a.headline_id and b.word > a.word
  group by a.word, b.word
),
-- Normalised PMI: +1 if the two words only ever appear together, 0 if
-- independent, negative if they avoid each other. Normalising is what lets one
-- threshold serve both a 45-headline word and a 3-headline one.
scored_pairs as (
  select
    p.a, p.b, p.cooc,
    ln((p.cooc * c.n) / (da.df * db.df)) / nullif(-ln(p.cooc / c.n), 0) as npmi
  from pairs p
  cross join corpus c
  join df da on da.word = p.a
  join df db on db.word = p.b
  where p.cooc >= coalesce(
    (select value from public.scoring_weights where key = 'edge_min_cooc'), 2)
),
-- Strongest association the word has, carried purely so threshold tuning can see
-- it. Not part of the sieve: on this data it filtered nothing the other signals
-- had not already removed.
assoc as (
  select t.word, max(t.npmi) as assoc
  from (
    select sp.a as word, sp.npmi from scored_pairs sp
    union all
    select sp.b as word, sp.npmi from scored_pairs sp
  ) t
  group by t.word
)
select
  df.word,
  df.df,
  spec.spec,
  standalone.standalone,
  coalesce(neighbors.distinct_neighbors, 0) / df.df as neighbors_per_doc,
  assoc.assoc,
  top_category.category_slug
from df
join spec on spec.word = df.word
join standalone on standalone.word = df.word
join top_category on top_category.word = df.word
left join neighbors on neighbors.word = df.word
left join assoc on assoc.word = df.word;
$fn$;

-- The graph is an RPC rather than a view because the node and edge cuts and the
-- NPMI arithmetic have to happen server side: a day's word pairs run to several
-- thousand rows even after grouping, and PostgREST would truncate that at 1000.
-- SQL functions are SECURITY INVOKER by default, so the select-only policies
-- above still apply to everything it reads.
create function keyword_graph(p_date date, p_category text default null)
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
  where c.count >= w.min_headlines
    and c.standalone >= w.min_standalone
    and c.override_mode is distinct from 'exclude'
),
-- Frequency alone decides the order. Ties break on the word so the same day
-- always renders the same graph.
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

-- keyword_graph calls keyword_signals as the invoker, so anon needs both.
grant execute on function keyword_signals(date) to anon, authenticated;
grant execute on function keyword_graph(date, text) to anon, authenticated;
