-- 0025: df_balanced — what the count would have been under equal collection.
--
-- 2026-08-04 collected society 582 and it 241, and that gap is not a cap doing
-- its job. Counted per run that day (rows inserted, by KST hour): society took
-- the whole 150-headline window on both the 11:00 and the 15:00 run, while it
-- never passed 98 on any of the five. The thin section is not being truncated —
-- it publishes less — so **paging deeper would widen the gap rather than close
-- it**. Balance cannot be had at collection time, and is taken here instead.
--
--   df_balanced(α) = Σ_c  df_c × (N̄ / N_c)^α
--
-- df_c is the word's headline count inside section c, N_c that section's day
-- total, N̄ the mean of the sections collected that day. At α = 1 this is the
-- count under equal collection — the estimator the request actually asked for.
-- At α = 0 it is the count itself, so the shipped configuration enters its own
-- sweep as the control.
--
-- **The denominator is the word's own section distribution, not its top
-- category.** 폭염 spans sections and its top category is society, the largest —
-- a single denominator would charge it the largest divisor and put rule 5 (never
-- drop the day's biggest story) directly at risk. A spread word gets a blend.
--
-- **Size is untouched.** The label stays proportional to the raw headline count;
-- only the order moves. Same shape as the head_pos demotion.
--
-- α is a **parameter** on keyword_signals rather than only a weight because the
-- harness has to sweep it, and a second copy of the formula in 10_sieve_eval.sql
-- is exactly what this repository forbids. The default reads
-- scoring_weights.category_balance_alpha, so all five existing callers keep
-- working unchanged.
--
--
-- ## The balance is taken over the rows on screen, not over the day
--
-- The task brief put df_balanced on keyword_signals — which is day-wide, by the
-- design migration 0004 settled — and then pointed the node ranking at it. That
-- is right for the all-categories view and **wrong for a category tab**, and the
-- brief's own closing note is what says so: "inside one category the denominator
-- is a constant multiple, so the ranking there is mathematically unchanged;
-- 11_category_eval.sql must not move by a digit."
--
-- That property only holds if the balanced count is computed over the rows in
-- scope. Take one tab, section c. Every drawn row is in c, so
--
--   count_balanced(word) = df_c(word) × (N̄ / N_c)^α
--
-- and the second factor does not depend on the word. Ordering by it is ordering
-- by df_c, which is what `count` already is. **α is the identity on a tab, at
-- every α, by construction** — no measurement needed, and 11_category_eval.sql
-- needs no edit.
--
-- A day-wide df_balanced has no such property: on a tab it still blends all six
-- sections, so it is not a constant multiple of anything, and pointing the
-- ranking at it would silently replace "the category's own count orders the tab"
-- (CLAUDE.md, migration 0004) with "the day-wide count orders the tab" — a
-- behaviour change shipped at the α that is supposed to change nothing. Measured
-- consequence if it had been done that way: the tab hashes move at α = 0.
--
-- So the ranking reads a **scoped** balanced count and keyword_signals keeps a
-- **day-wide** one. They are the same formula over different row sets, exactly as
-- `count` and `df` already are, and they agree by construction on the
-- all-categories view where the scope is the whole day. The names follow the
-- distinction this file already uses: `count`/`count_balanced` is what is on
-- screen, `df`/`df_balanced` is the day.
--
-- **What is not duplicated is the formula.** `(N̄ / N_c)^α` lives once, in
-- public.category_balance_factors, and both callers do the same one-line
-- weighted sum over their own rows. Summing the per-row factor is the whole of
-- it: each row of `doc` / `scoped` is one headline holding the word, so
-- Σ_rows factor(row's section) is Σ_c df_c × f_c with no intermediate grouping.
--
--
-- ## Shipped at α = 0, and checked rather than asserted
--
-- keyword_graph is byte-identical on **all 35 cells** — five collected days
-- across the all-categories view and all six tabs — before and after. Same gate
-- 0023 and 0024 passed. The identity is arithmetic, not luck: at α = 0 every
-- factor is exactly numeric 1, so a sum of factors over a word's rows is that
-- word's row count, and `count_balanced desc, count desc` is `count desc` twice.

insert into public.scoring_weights (key, value, note) values
  ('category_balance_alpha', 0,
   'sieve ranking: 0 = raw frequency (identity), 1 = the count under equal collection. Set after measurement.')
on conflict (key) do update set value = excluded.value, note = excluded.note;

-- The one copy of the balance formula. Six rows out; called once per query
-- because it is stable, and joined to rather than recomputed by either caller.
--
-- α is resolved here rather than by the callers, so "null means whatever ships"
-- is also stated once. A category that collected nothing on p_date is absent
-- from cat_totals and so absent from N̄ — the mean is over the sections the day
-- actually has, which is the only reading under which N̄ / N_c is finite.
create or replace function public.category_balance_factors(
  p_date date,
  p_alpha numeric default null
)
returns table (category_slug text, factor numeric)
language sql
stable
security invoker
set search_path = ''
as $fn$
with alpha as (
  select coalesce(
    p_alpha,
    (select sw.value from public.scoring_weights sw
      where sw.key = 'category_balance_alpha'),
    0) as a
),
cat_totals as (
  select c.slug, count(*)::numeric as n
  from public.headlines h
  join public.categories c on c.id = h.category_id
  where h.collected_date = p_date
  group by c.slug
),
cat_mean as (select avg(ct.n) as nbar from cat_totals ct)
-- power(x, 0) is exactly 1 in numeric, which is what makes α = 0 the identity
-- rather than something that rounds to it.
select ct.slug, power(cm.nbar / ct.n, al.a)::numeric
from cat_totals ct
cross join cat_mean cm
cross join alpha al;
$fn$;

-- Both roles, explicitly, and this differs from 0024 on purpose. That file
-- granted its six to `anon` alone and defended it on the ground that a grant
-- there documents intent rather than confers access — which is true, because
-- Postgres leaves `=X` for PUBLIC on a newly created function. But both
-- functions in this file sit on a SECURITY INVOKER chain that `keyword_graph`
-- reaches, so it is the *calling* role's privilege that is checked, and a chain
-- whose last link works only through the PUBLIC default is a chain nobody has
-- actually granted. Naming both roles costs nothing and cannot narrow anything.
-- 0024's six are left as they are; this is not a re-litigation of them.
grant execute on function public.category_balance_factors(date, numeric) to anon, authenticated;

-- The return type gains a column and the signature gains a parameter, so the
-- function has to be dropped rather than replaced. Postgres does not track the
-- dependency through the graph functions' string bodies, so this drop succeeds
-- silently and they would break at runtime until the replacements below land —
-- which is fine inside one transaction and is the reason this file must not be
-- split.
drop function if exists public.keyword_signals(date);

create or replace function public.keyword_signals(p_date date, p_alpha numeric default null)
returns table(
  word text,
  df integer,
  df_balanced numeric,
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

-- The drop above discarded 0017's grant, so this re-issues it — to both roles,
-- for the reason given over category_balance_factors. Same chain, same argument.
grant execute on function public.keyword_signals(date, numeric) to anon, authenticated;

-- The ranking key has to ride on the candidate row, because keyword_graph_rank
-- sees nothing but the array — that is the price migration 0024 accepted for
-- running keyword_signals once instead of eight times.
--
-- Added rather than dropping and recreating the type: `drop type … cascade`
-- would take keyword_graph_rank's ACL with it, and an ADD ATTRIBUTE appends,
-- so the only cost is that `count_balanced` sits last in the composite and
-- therefore last in keyword_graph_candidates' select list. Guarded so a re-push
-- of this file is idempotent the way 0024's drops are.
do $$
begin
  if not exists (
    select 1 from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'keyword_candidate'
      and a.attname = 'count_balanced' and not a.attisdropped
  ) then
    alter type public.keyword_candidate add attribute count_balanced numeric;
  end if;
end
$$;

-- Sieves 1 to 4: may this word be drawn at all? Independent of `p_banned` by
-- construction — this is the expensive half, and it runs once per RPC call.
--
-- Replaced here only to carry `count_balanced`. Every sieve clause and every
-- threshold is unchanged from 0024.
create or replace function public.keyword_graph_candidates(
  p_date date,
  p_category text
)
returns setof public.keyword_candidate
language sql
stable
security invoker
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
    coalesce(max(value) filter (where key = 'max_neighbors_per_doc'), 1.8) as max_neighbors_per_doc
  from public.scoring_weights
),
sig as (
  select * from public.keyword_signals(p_date)
),
-- What the viewer is actually looking at. Counts come from here; the signals
-- above deliberately do not.
--
-- `scoped` and `scoped_df` are also spelled out in keyword_graph_pick_edges, and
-- the two must agree about which of the day's rows are on screen. 0018 had this
-- predicate once; splitting the node and edge halves made it twice. No threshold
-- or formula is duplicated — this is a selection — but a change to the scoping
-- rule has to be made in both places.
--
-- 0025 adds `scoped_category` to the projection. The predicate, and therefore
-- the row set, is untouched: a headline has exactly one category, so carrying
-- its slug through cannot change what `distinct` collapses or what
-- `scoped_df` counts. That is why pick_edges is not replaced by this migration.
scoped as (
  select distinct h.id as headline_id, c.slug as scoped_category, n.word
  from public.headline_nouns n
  join public.headlines h on h.id = n.headline_id
  join public.categories c on c.id = h.category_id
  where h.collected_date = p_date
    and (p_category is null or c.slug = p_category)
),
scoped_df as (
  select s.word, count(*)::int as df from scoped s group by s.word
),
-- The ranking key: `count` under equal collection. Scoped, exactly as `count`
-- is — see this migration's header. On the all-categories view the scope is the
-- whole day and this equals keyword_signals' df_balanced; on a tab every row
-- carries the same factor, so it is `count` times a constant and the order there
-- cannot move at any α.
scoped_balanced as (
  select s.word, sum(f.factor)::numeric as count_balanced
  from scoped s
  join public.category_balance_factors(p_date) f
    on f.category_slug = s.scoped_category
  group by s.word
),
candidates as (
  select
    sd.word,
    sd.df as count,
    sb.count_balanced,
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
  join scoped_balanced sb on sb.word = sd.word
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
)
-- Positional against public.keyword_candidate, so count_balanced is last
-- because ADD ATTRIBUTE appends.
select
  s.word, s.count, s.spec, s.standalone, s.neighbors_per_doc, s.assoc,
  s.head_pos, s.passed_by, s.category_slug, s.override_mode, s.count_balanced
from sieved s
where s.passed_by is not null;
$fn$;

-- Which of the candidates are drawn, in what order, and how they are flagged.
-- Cheap, and the only part of the node rule that `p_banned` can reach.
--
-- Replaced here only for the ranking key. The return type is unchanged —
-- count_balanced decides the order and is not itself reported, the same way
-- head_pos and override_mode are not.
create or replace function public.keyword_graph_rank(
  p_cands public.keyword_candidate[],
  p_banned text[]
)
returns table (
  word              text,
  count             int,
  spec              numeric,
  standalone        numeric,
  neighbors_per_doc numeric,
  assoc             numeric,
  passed_by         text,
  category_slug     text,
  is_place          boolean,
  faded             boolean,
  rank              bigint
)
language sql
stable
security invoker
set search_path = ''
as $fn$
-- Every reference below is qualified. RETURNS TABLE columns are output
-- parameters and are in scope in the body, so a bare `word` or `count` here
-- would be ambiguous rather than merely untidy.
with w as (
  select
    -- Sieve 5, as a demotion rather than a cut. 9.9 disables it.
    coalesce(max(value) filter (where key = 'demote_head_pos'), 9.90) as demote_head_pos,
    coalesce(max(value) filter (where key = 'node_limit'), 70)        as node_limit,
    coalesce(max(value) filter (where key = 'render_cap'), 130)       as render_cap
  from public.scoring_weights
),
-- Sieve 6's only foothold. The caller decides what is banned; with an empty
-- array — which is what an off gate always passes — this admits everything.
kept as (
  select c.* from unnest(p_cands) c
  where not (c.word = any (coalesce(p_banned, '{}'::text[])))
),
-- Frequency decides the order, and it is the category's own count that orders
-- them: the day-wide figure only decides eligibility.
--
-- Since 0025 that frequency is the count under equal collection rather than the
-- raw count — a word from a thinly collected section is not outranked for its
-- section's depth. At category_balance_alpha = 0 the two are the same number, so
-- this is the raw count until something measures otherwise; and inside one
-- category they differ by a constant factor at every α, so a tab's order cannot
-- move whatever α becomes. The raw count stays as the tie-break beneath it, and
-- **size on screen is still the raw count** — only the order moves.
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
  select k.*, row_number() over (
    order by (k.head_pos > w.demote_head_pos) asc,
             k.count_balanced desc, k.count desc, k.word) as rank
  from kept k
  cross join w
)
select
  r.word, r.count, r.spec, r.standalone, r.neighbors_per_doc, r.assoc,
  r.passed_by, r.category_slug,
  -- is not distinct from, not =, for both flags: override_mode is null for most
  -- words, and `false or null` is null, which would ship a null flag to the
  -- client.
  (r.override_mode is not distinct from 'place') as is_place,
  (r.rank > w.node_limit or r.override_mode is not distinct from 'demote') as faded,
  r.rank
from ranked r
cross join w
where r.rank <= w.render_cap;
$fn$;
