-- 0024: wire the place gate, and ship it switched off.
--
-- Migration 0023 named the places and changed no behaviour. This one gives the
-- sieve a way to read them and leaves `place_needs_edge` at 0, so the graph this
-- migration draws is the graph 0018 drew. That was checked rather than asserted,
-- because a refactor of the RPC that thirteen later measurements read from is
-- worth nothing if it moves a word: **the node array is byte-identical to
-- 0018's on all 35 cells** — five collected days across the all-categories view
-- and all six tabs — **and the edge set is identical on all 35 too**, hashed
-- after sorting each edge array by its own text.
--
-- **The edge *ordering* did move, on 7 of the first 10 cells hashed, and that is
-- the one thing here not lifted verbatim.** The differences were permutations of
-- exactly-tied edges and nothing else: on 2026-07-31, 박지원·한동훈 /
-- 세우타·스페인 / 머스크·중간선거 all carry cooc 3 and npmi
-- 0.80097396756174372838 — equal to the last digit, not merely equal once
-- rounded to the three places the JSON ships.
--
-- The cause is that `order by npmi desc, cooc desc` **is not a total order**, so
-- which of a set of tied edges came out first was never decided by this function;
-- it was decided by the plan, and lifting the edge query into a function of its
-- own changed the plan. That is not a property to chase back. It is a bug that
-- was invisible while the plan happened to be stable, and it is load-bearing:
-- `detectCommunities` in graphLayout.ts builds its neighbour lists in the order
-- the edges arrive, so a permutation of tied edges can move the Louvain
-- partition, which moves which box a word is laid out in and which stories the
-- event list names. CLAUDE.md already claims the picture is reproducible because
-- ties are "broken on the word server side" — which was true of the nodes and
-- not of the edges.
--
-- So the ordering gains `, a, b`, the same tie-break the node ranking already
-- uses, and the gate was then re-run against 0018's own body **with that same
-- tie-break applied to it**: byte-identical on all 35 cells. The two statements
-- together are the real gate — the edge sets match the untouched 0018 exactly,
-- and the bytes match a 0018 whose only change is the tie-break. The hashes that
-- moved are a total ordering replacing an accidental one, and the baseline tasks
-- 3 to 15 measure against is the one recorded after this migration.
--
-- **Why plpgsql, when every other function here is `language sql`.** The rule is
-- a fixed point, not a filter. Dropping a place promotes the word ranked 71 onto
-- the canvas, and that word can be the only non-place partner some *other* place
-- was holding on by — or, going the other way, can itself be the partner that
-- rescues one. So the answer has to be iterated to a fixed point. A recursive CTE
-- cannot express it: Postgres forbids window functions in the recursive term and
-- the ranking is `row_number()`. Hence a loop, and hence plpgsql.
--
-- **Why the node and edge queries move into helper functions.** The loop needs
-- the node set and the edge set on every pass, and the final JSON needs both
-- again. Inlining them would put two copies of the sieve in one file, and this
-- project has already paid for a second copy of a formula more than once —
-- `keyword_signals` exists as one function for the same reason, and CLAUDE.md
-- records what measuring a hand-copied sieve costs. `keyword_graph_nodes` and
-- `keyword_graph_edges` are lifted verbatim out of 0018; the node query gains
-- exactly two things, a `p_banned` filter and an `is_place` column, and the edge
-- query gains the redirect of its `exists` clause onto the node function, the
-- tie-break above, and the `materialized` fence noted at the CTE itself.
--
-- `scoped` and `scoped_df` appear in both helpers. That is duplication of a
-- *selection* — which of the day's rows the viewer is looking at — and not of a
-- threshold or a formula, and the alternative is a third function returning a
-- set that both would have to re-join anyway.
--
-- **Termination is by monotonicity, not by the guard.** `banned` only ever grows,
-- and it can only ever hold words carrying a `word_overrides` 'place' entry, of
-- which there are 45. So the loop ends. `guard > 50` is a backstop against a bug
-- in that reasoning, not the mechanism — do not replace it with a fixed number of
-- passes. Measured with the gate switched on across all 35 cells: the fixed point
-- is reached after a **single** productive pass everywhere, so `guard` exits at 2
-- where anything was dropped and at 1 where nothing was, against a bound of 45.
-- That the second pass has never yet found a word is not a licence to drop it —
-- it is the check that the first pass was a fixed point, and it costs one query.
--
-- **It is a fixed point that really does substitute.** On 2026-08-03 the gate
-- drops 서울, 인천, 포항, 울산, 강원, 광주 and pulls 한반도, 고속도로, 김동관,
-- 김병기, 김용, 대공습 up under the cap in their place. 2026-08-02 is the
-- exception worth knowing: it drops 부산 and promotes nothing, because that day
-- qualifies only 69 words and the render cap was never binding — the same
-- cap-binding argument CLAUDE.md makes about head_pos, seen from the other side.
--
-- **"Has an edge" means "has a line on screen".** The loop asks
-- `keyword_graph_edges` — the same function the JSON's `edges` array comes from,
-- so the same `edge_min_cooc`, the same `edge_min_npmi`, and both endpoints drawn.
-- A pair that co-occurs in the data but is not drawn does not rescue a place; the
-- reader cannot see it.
--
-- All three functions stay SECURITY INVOKER (the SQL default, stated anyway) with
-- `set search_path = ''`. RLS is the whole access model here — there is no login
-- and `anon` reaches these functions directly — so a SECURITY DEFINER in this
-- chain would hand out the service role's view of the tables.

create or replace function public.keyword_graph_nodes(
  p_date date,
  p_category text,
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
-- would be ambiguous rather than wrong-looking.
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
    coalesce(max(value) filter (where key = 'render_cap'), 130)            as render_cap
  from public.scoring_weights
),
sig as (
  select * from public.keyword_signals(p_date)
),
-- What the viewer is actually looking at. Counts come from here; the signals
-- above deliberately do not.
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
  -- Sieve 6's only foothold in the node query. The caller decides what is
  -- banned; with an empty array — which is what an off gate always passes —
  -- this clause admits everything and the plan is the one 0018 had.
  where not (sd.word = any (coalesce(p_banned, '{}'::text[])))
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

create or replace function public.keyword_graph_edges(
  p_date date,
  p_category text,
  p_banned text[]
)
returns table (
  a    text,
  b    text,
  cooc int,
  npmi numeric
)
language sql
stable
security invoker
set search_path = ''
as $fn$
with w as (
  select
    coalesce(max(value) filter (where key = 'edge_min_cooc'), 2)   as edge_min_cooc,
    coalesce(max(value) filter (where key = 'edge_min_npmi'), 0.3) as edge_min_npmi,
    coalesce(max(value) filter (where key = 'edge_limit'), 150)    as edge_limit
  from public.scoring_weights
),
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
-- `materialized` is load-bearing, not decoration. The two `exists` clauses below
-- both need the node set, and written against the function directly the planner
-- evaluated it once per clause — three runs of `keyword_signals` per
-- `keyword_graph` call against 0018's one, measured at 3,099ms on 2026-08-03
-- where 0018 took 1,408ms. Pinning it to a materialized CTE takes it to two.
-- Two is the floor while the node set reaches this function through its
-- arguments rather than as an argument.
node_words as materialized (
  select n.word from public.keyword_graph_nodes(p_date, p_category, p_banned) n
),
pairs as (
  select x.word as a, y.word as b, count(*)::int as cooc
  from scoped x
  join scoped y on y.headline_id = x.headline_id and y.word > x.word
  group by x.word, y.word
),
scored_pairs as (
  select
    p.a, p.b, p.cooc,
    ln((p.cooc * c.n) / (da.df * db.df)) / nullif(-ln(p.cooc / c.n), 0) as npmi
  from pairs p
  cross join corpus c
  join scoped_df da on da.word = p.a
  join scoped_df db on db.word = p.b
)
-- An edge is drawn only between two drawn words, which is what makes this the
-- honest answer to "does this place have a line on screen". The node set is
-- asked for, never re-derived.
select sp.a, sp.b, sp.cooc, sp.npmi
from scored_pairs sp
cross join w
where sp.cooc >= w.edge_min_cooc
  and sp.npmi >= w.edge_min_npmi
  and exists (select 1 from node_words nw where nw.word = sp.a)
  and exists (select 1 from node_words nw where nw.word = sp.b)
-- The word is the tie-break, exactly as it is in the node ranking, and it is
-- the one thing here that is not lifted verbatim from 0018. See the migration
-- header: `npmi desc, cooc desc` is not a total order, so which of a set of
-- exactly-tied edges came out first was decided by the plan.
order by sp.npmi desc, sp.cooc desc, sp.a, sp.b
limit (select w2.edge_limit::int from w w2);
$fn$;

create or replace function public.keyword_graph(p_date date, p_category text default null)
returns json
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  banned  text[] := '{}';
  dropped text[];
  gate    boolean;
  guard   int := 0;
begin
  select coalesce(max(value), 0) = 1 into gate
  from public.scoring_weights where key = 'place_needs_edge';

  if gate then
    loop
      guard := guard + 1;
      -- A place with no edge to a drawn non-place. The edges asked for here are
      -- the same ones the JSON below emits, so "has an edge" means "has a line
      -- on screen" rather than "co-occurs somewhere in the data".
      select coalesce(array_agg(n.word), '{}') into dropped
      from public.keyword_graph_nodes(p_date, p_category, banned) n
      where n.is_place
        and not exists (
          select 1
          from public.keyword_graph_edges(p_date, p_category, banned) e
          join public.keyword_graph_nodes(p_date, p_category, banned) m
            on m.word = case when e.a = n.word then e.b else e.a end
          where (e.a = n.word or e.b = n.word) and not m.is_place
        );
      -- Dropping a place promotes the next-ranked word, which can rescue or
      -- strand another place, so this runs to a fixed point. `banned` only
      -- grows and is bounded by the size of the place list; the guard is a
      -- backstop against a bug in that argument, not the reason it stops.
      exit when cardinality(dropped) = 0 or guard > 50;
      banned := banned || dropped;
    end loop;
  end if;

  return (
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
        from public.keyword_graph_nodes(p_date, p_category, banned) n
      ), '[]'::json),
      'edges', coalesce((
        select json_agg(json_build_object(
          'a', e.a,
          'b', e.b,
          'cooc', e.cooc,
          'npmi', round(e.npmi, 3)
        ) order by e.npmi desc, e.cooc desc, e.a, e.b)
        from public.keyword_graph_edges(p_date, p_category, banned) e
      ), '[]'::json)
    )
  );
end;
$fn$;

-- `is_place` is deliberately not in the JSON. Nothing on the client needs it —
-- the gate's whole effect is which words arrive — and adding a field to the node
-- shape would mean touching src/lib/types.ts, which is a change this migration
-- promised not to make.

insert into public.scoring_weights (key, value, note) values
  ('place_needs_edge', 0,
   'sieve 6: DISABLED. 1 draws a word_overrides place only when a line joins it to a non-place. 0 draws every place. Turned on by 0025 after measurement.')
on conflict (key) do update set value = excluded.value, note = excluded.note;

-- create or replace keeps the existing grants, but re-stating them costs nothing
-- and makes a fresh database built from migrations alone come out the same as
-- one that was migrated. The helpers get the same grantees as keyword_graph
-- rather than only anon: it is SECURITY INVOKER and calls them as the caller, so
-- a role that may execute it and not them would get a permission error instead
-- of a graph.
grant execute on function public.keyword_graph_nodes(date, text, text[]) to anon, authenticated;
grant execute on function public.keyword_graph_edges(date, text, text[]) to anon, authenticated;
grant execute on function public.keyword_graph(date, text) to anon, authenticated;
