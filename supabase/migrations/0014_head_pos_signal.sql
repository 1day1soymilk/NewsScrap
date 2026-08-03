-- 0014: a fifth signal — where in the headline the word sits.
--
-- CLAUDE.md records that the length clause is effectively the whole sieve (it
-- admits 68 of the 70 drawn words) and that **none of the four existing signals
-- separates the good words inside that group from the bad ones**: character
-- length runs the wrong way, headline count is flat, and recurrence across the
-- archive's days measures "story still running" rather than "generic word".
-- The dictionary has been doing that work because there was no signal left.
--
-- This is a signal the four did not use: **position**. Korean headlines are
-- topic-first. A story's proper nouns and event names lead; generic qualifiers
-- trail. Measured over the 280 drawn word-days across the four labelled days,
-- the mean relative start position is 0.347 for words labelled good and 0.466
-- for words labelled bad, and above 0.70 the words it catches are almost
-- exactly the family that means nothing on its own — 가능성, 시험대, 승부수,
-- 변동성, 무방비, 막바지, 월요일, 테러범, 수도권.
--
-- **This migration changes no behaviour.** It adds the column and nothing else:
-- no threshold in scoring_weights reads it and keyword_graph's sieve is
-- untouched, so the drawn 70 must come back byte-identical on all four days.
-- Whether a clause is worth adding is 10_sieve_eval.sql's decision, not this
-- file's — the rule this repository has already broken five times.
--
-- The return type gains a column, so the function has to be dropped rather than
-- replaced. keyword_graph reads it as `select * from keyword_signals(...)` into
-- a CTE and builds its JSON from named columns, so a new column passes through
-- it untouched.

drop function if exists public.keyword_signals(date);

create or replace function public.keyword_signals(p_date date)
returns table(
  word text,
  df integer,
  spec numeric,
  standalone numeric,
  neighbors_per_doc numeric,
  assoc numeric,
  head_pos numeric,
  category_slug text
)
language sql
stable
set search_path to ''
as $function$
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
-- Where in the headline the word starts, averaged over the day's headlines that
-- hold it, as a fraction of the room it could have started in: 0 leads the
-- title, 1 ends it.
--
-- The denominator is the title length minus the word's own length rather than
-- the title length, so a six-character word at the very end of a short title
-- scores 1 and not 0.7 — otherwise the score would say more about how long the
-- word is than about where it sits.
--
-- **Fails open.** A headline whose title does not contain the word literally
-- contributes nothing (ETRI hands back a lemma, and a conjugated or spaced
-- form will not match), and a word with no measurable position at all scores 0
-- — the permissive end. A signal that cannot see a word must not be the thing
-- that cuts it; the same reasoning as canonicalLink returning an unparseable
-- href unchanged.
head_pos as (
  select
    d.word,
    avg(
      (position(d.word in d.title) - 1.0)
        / greatest(1, char_length(d.title) - char_length(d.word))
    ) filter (where position(d.word in d.title) > 0) as head_pos
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
  coalesce(head_pos.head_pos, 0)::numeric as head_pos,
  top_category.category_slug
from df
join spec on spec.word = df.word
join standalone on standalone.word = df.word
join top_category on top_category.word = df.word
left join neighbors on neighbors.word = df.word
left join assoc on assoc.word = df.word
left join head_pos on head_pos.word = df.word;
$function$;

grant execute on function public.keyword_signals(date) to anon;
