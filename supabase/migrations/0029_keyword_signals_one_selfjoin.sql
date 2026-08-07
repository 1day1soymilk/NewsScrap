-- 0029: keyword_signals stops paying for a second self-join, and hands the
-- regex its rows in an order the pattern cache can use.
--
-- **Nothing about the scoring moves.** Every one of the ten returned columns is
-- byte-identical on 2026-08-01, 2026-08-03 and 2026-08-04 — checked with a
-- symmetric EXCEPT over all ten, which returned 0 rows on each day. This is a
-- plan change, not a formula change, and the rule that `keyword_signals` is the
-- single copy of the formulas is why it had to be checked that way rather than
-- reasoned about.
--
--
-- ## Why now
--
-- `collect_cap` went to 300 on 2026-08-07, so a day is about 4,000 headlines
-- rather than 2,200, and the graph's first paint went with it: one sitting,
-- all-categories view, place gate on — 2,197 headlines 2,103 ms, 3,077 2,614 ms,
-- 4,218 3,299 ms, near-linear. `keyword_signals` was 2,034 ms of that 3,299.
--
-- Node-level attribution on the 4,218-headline day, taken by running the
-- function's own body as a plain query (a `language sql` function with
-- RETURNS TABLE is a black box to EXPLAIN otherwise):
--
--   standalone, the regex        524 ms
--   neighbors, 152,368-row sort  542 ms
--   pairs + assoc               ~350 ms
--   doc, df and the rest        ~600 ms
--
--
-- ## What was tried and did not work, so nobody repeats it
--
-- **Hoisting `regexp_replace` out of the row loop does nothing.** The obvious
-- read of the 524 ms is that the pattern is rebuilt per doc row (26,341) rather
-- than per distinct word (7,749), so a `word_re` CTE joined on word should cut
-- it by 3.4x. Measured: 1,900 ms against a 1,903 ms baseline, output identical.
-- The cost is the *match*, not the building of the pattern.
--
-- **An earlier per-CTE timing table was wrong and is not in this file.** The
-- pieces were retyped as standalone queries to time them, and the escaping of
-- the standalone regex came out different, so it measured a cheaper pattern —
-- 103 ms where the real node is 524 ms. The same sitting also read a cold-cache
-- first query as a signal. Both are the reason the attribution above comes from
-- the deployed body rather than from a copy of it, and the reason every timing
-- here is the second of two runs.
--
--
-- ## What ships
--
-- 1,873 ms -> 1,276 ms on the 4,218-headline day, both the second of two runs in
-- one sitting. The signature does not change, so `create or replace` keeps the
-- grants and no caller moves — `neighbors_per_doc` is still returned, still
-- computed, and still reaches the frontend tooltip that reads it.

CREATE OR REPLACE FUNCTION public.keyword_signals(p_date date, p_alpha numeric DEFAULT NULL::numeric)
 RETURNS TABLE(word text, df integer, df_balanced numeric, spec numeric, standalone numeric, neighbors_per_doc numeric, assoc numeric, head_pos numeric, proper numeric, category_slug text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
-- The day-wide balanced count. One row of `doc` is one headline holding the
-- word, so summing that headline's section factor over them is
-- Σ_c df_c × (N̄/N_c)^α. The join cannot miss a row: doc.category_slug comes
-- from public.categories through a headline, and every such section has at
-- least that headline on p_date, so it is in cat_totals.
balanced as (
  select d.word, sum(f.factor)::numeric as df_balanced
  from doc d
  join public.category_balance_factors(p_date, p_alpha) f
    on f.category_slug = d.category_slug
  group by d.word
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
  -- Rows arrive ordered by word so the regex cache sees each pattern in one
  -- run. The pattern is built per row and varies by word, and Postgres keeps
  -- only a small compiled-regex cache, so unordered input recompiles nearly
  -- every row. Worth 183ms of the 597 this migration saves; the values are
  -- unchanged, which is the point of it being an ORDER BY and nothing else.
  from (select * from doc order by word) d
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
pairs as (
  select a.word as a, b.word as b, count(*)::int as cooc
  from doc a
  join doc b on b.headline_id = a.headline_id and b.word > a.word
  group by a.word, b.word
),
-- The neighbour count comes out of `pairs`, which is the same self-join over
-- `doc` that the association signal already runs. It used to be a second one.
-- `pairs` is grouped and keeps `b.word > a.word`, so each distinct partner of
-- a word appears exactly once across the two sides of the union — which is what
-- count(distinct b.word) was counting. Worth 414ms.
neighbors as (
  select t.word, count(*)::numeric as distinct_neighbors
  from (select p.a as word from pairs p union all select p.b as word from pairs p) t
  group by t.word
),
top_category as (
  select distinct on (t.word) t.word, t.category_slug
  from (select d.word, d.category_slug, count(*) as c from doc d group by d.word, d.category_slug) t
  order by t.word, t.c desc, t.category_slug
),
corpus as (
  select count(distinct d.headline_id)::numeric as n from doc d
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
  balanced.df_balanced,
  spec.spec,
  standalone.standalone,
  coalesce(neighbors.distinct_neighbors, 0) / df.df as neighbors_per_doc,
  assoc.assoc,
  coalesce(head_pos.head_pos, 0)::numeric as head_pos,
  coalesce(proper.proper, 0)::numeric as proper,
  top_category.category_slug
from df
join balanced on balanced.word = df.word
join spec on spec.word = df.word
join standalone on standalone.word = df.word
join top_category on top_category.word = df.word
left join neighbors on neighbors.word = df.word
left join assoc on assoc.word = df.word
left join head_pos on head_pos.word = df.word
left join proper on proper.word = df.word;
$function$;
