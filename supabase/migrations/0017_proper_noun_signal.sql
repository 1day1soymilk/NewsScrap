-- 0017: a sixth signal — is the word a proper noun?
--
-- `proper` is the share of the day's rows for a word that the analyser tagged
-- NNP, so it runs 0.00 to 1.00. Graded rather than boolean because the tagger is
-- contextual: 양산 is NNP in "양산시" headlines and NNG in "양산 체제" ones, and a
-- share says so where a `bool_or` would call it a name on one row in fifty.
--
-- **What it is for.** Sieve 4a cuts every word under `min_word_len` (3), and
-- CLAUDE.md prices that clause carefully in one direction only — it admits 68 of
-- the 70 drawn words and its 84.3% precision is the whole sieve's. The other
-- direction was never priced: **a two-character word cannot reach the canvas at
-- all** unless `word_overrides` rescues it by hand, and in the archive's history
-- exactly two ever have (폭염, 양산, both from migration 0003). 이란, 중국, 미국,
-- 북한, 삼성 and every two-syllable place, party and company name are cut along
-- with the noise.
--
-- Length is a proxy for "a word in its own right rather than a piece of one",
-- and now that the analyser runs in-process it can be asked directly. Measured
-- against garu-ko 0.9.12: 이란, 중국, 미국, 일본, 북한, 삼성, 애플, 서울, 부산,
-- 대구 and 인천 are NNP; **감찰, 윤리, 청문, 초등 and 순회 are NNG** — and those
-- five are exactly the words CLAUDE.md names as the reason the *specificity*
-- clause had to be disabled, all scoring a perfect 1.00 on spec. The
-- discrimination spec could not make is in the tagger's output.
--
-- **This migration changes no behaviour.** `min_proper` is seeded at 9.90, above
-- the signal's maximum of 1, which is how this repository spells "off" (see
-- `min_spec`). The sieve clause is wired but cannot fire, so the drawn 70 must
-- come back byte-identical on all four labelled days. Turning it on is
-- `10_sieve_eval.sql`'s decision and `11_category_eval.sql`'s — never this
-- file's.
--
-- Fails **closed**, unlike head_pos: a row with a null `pos` contributes 0 to
-- the share rather than being skipped, so a word the analyser never tagged is
-- not a proper noun. That is the safe direction here — this clause only ever
-- *admits* words, so an unknown that failed open would be a rescue granted on no
-- evidence. Compare head_pos, which cuts, and therefore fails open.

insert into public.scoring_weights (key, value, note) values
  ('min_proper', 9.90,
   'sieve 4d: DISABLED — share of a word''s rows tagged NNP. Rescues 2-char names (이란, 중국) that min_word_len cuts. 9.9 is above the max of 1.')
on conflict (key) do update set value = excluded.value, note = excluded.note;

-- The return type gains a column, so the function has to be dropped rather than
-- replaced. keyword_graph reads it as `select * from keyword_signals(...)` and
-- builds its JSON from named columns, so a new column passes through untouched —
-- the same note migration 0014 left when it added head_pos.
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
  proper numeric,
  category_slug text
)
language sql
stable
set search_path to ''
as $function$
with
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
-- Share of this day's rows for the word that the analyser tagged NNP. Read off
-- headline_nouns directly rather than from `doc`, because `doc` is distinct on
-- (headline, word) and drops the second tagging of a word that occurs twice in
-- one title — which is exactly the disagreement this share exists to see.
proper as (
  select
    n.word,
    avg(case when n.pos = 'NNP' then 1 else 0 end)::numeric as proper
  from public.headline_nouns n
  join public.headlines h on h.id = n.headline_id
  where h.collected_date = p_date
  group by n.word
),
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
neighbors as (
  select a.word, count(distinct b.word)::numeric as distinct_neighbors
  from doc a
  join doc b on b.headline_id = a.headline_id and b.word <> a.word
  group by a.word
),
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
  coalesce(proper.proper, 0)::numeric as proper,
  top_category.category_slug
from df
join spec on spec.word = df.word
join standalone on standalone.word = df.word
join top_category on top_category.word = df.word
left join neighbors on neighbors.word = df.word
left join assoc on assoc.word = df.word
left join head_pos on head_pos.word = df.word
left join proper on proper.word = df.word;
$function$;

grant execute on function public.keyword_signals(date) to anon;
