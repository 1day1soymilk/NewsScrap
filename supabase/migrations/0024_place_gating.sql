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
-- **The edge *ordering* did move, and that is the one thing here not lifted
-- verbatim.** It moved on 18 of the 35 cells, and every difference was a
-- permutation of exactly-tied edges and nothing else: on 2026-07-31,
-- 박지원·한동훈 / 세우타·스페인 / 머스크·중간선거 all carry cooc 3 and npmi
-- 0.80097396756174372838 — equal to the last digit, not merely equal once
-- rounded to the three places the JSON ships.
--
-- The cause is that `order by npmi desc, cooc desc` **is not a total order**. When
-- two edges tie on both keys nothing in the query says which comes first, so the
-- answer was decided by the query plan; lifting the edge query into a function of
-- its own changed the plan, and the tied pairs came back permuted. That is not a
-- property to chase back into place. It is a latent bug that was invisible only
-- while the plan happened to be stable, and CLAUDE.md already claims the picture
-- is reproducible because ties are "broken on the word server side, so the same
-- day always renders the same picture and the e2e suite can assert on it". That
-- was true of the nodes and quietly untrue of the edges. So the ordering gains
-- `, a, b`, the same tie-break the node ranking already uses — the stated
-- constraint being enforced for the first time rather than a new rule.
--
-- **What the reorder actually moved was measured, not assumed**, by running both
-- edge arrays through the frontend's own code on all 18 cells
-- (`scripts/layout/edgeOrderPartition.ts`):
--
--     Louvain partition   0 of 18 moved
--     merged events       0 of 18 moved
--     drawn geometry      7 of 18 moved
--
-- **The partition does not move, and the reason first written here for why it
-- might was wrong.** `detectCommunities` does not keep the first-seen best move:
-- `graphLayout.ts` breaks a gain tie with `candidate < best`, the lowest
-- community id, which is order-independent. Neighbour-list order cannot decide a
-- move. Anyone later wondering whether this tie-break can be removed should start
-- from that fact rather than from the Louvain story.
--
-- **The geometry does move, by a different route**, and it is the reason the
-- tie-break stays: d3's `forceLink` applies its velocity updates walking the link
-- array in order, so a permutation changes the floating-point accumulation and
-- the simulation lands somewhere slightly different. Six of the seven are
-- sub-pixel (0.06 to 0.54px) and invisible. **The seventh is not**: 2026-08-02's
-- all-categories view rearranges one event internally — 강릉·돌핀·서울·열대야·
-- 전남·초열대야·폭염 — moving 전남 137.6px and 서울 131.6px, 4 words past 10px
-- and 11 past 1px, with the region 149.9x155.5 → 148.5x159.2 and every box to its
-- right shifted about a pixel by the repacking. Same partition, same event
-- membership, different picture.
--
-- So `scripts/layout/README.md`'s table is stale for exactly one cell, 2026-08-02
-- desktop, and re-measuring it is cheap. That it is *that* cell is not a
-- coincidence worth ignoring: CLAUDE.md records 2026-08-02 as holding the
-- archive's only non-planar event and sitting on the `PLANAR_AREA_PER_CROSSING`
-- cliff, and a cliff is exactly where a last-bit difference gets amplified into
-- 137px. Everywhere else the day was flat enough that nothing moved at all.
--
-- The gate was then re-run against 0018's own body **with that same tie-break
-- applied to it**: byte-identical on all 35 cells. The two statements together
-- are the real gate — the edge sets match the untouched 0018 exactly, and the
-- bytes match a 0018 whose only change is the tie-break. The hashes that moved
-- are a total ordering replacing an accidental one, and the baseline tasks 3 to
-- 15 measure against is the one recorded after this migration.
--
-- **Why plpgsql, when every other function here is `language sql`.** The rule is
-- a fixed point, not a filter. Dropping a place promotes the word ranked 71 onto
-- the canvas, and that word can be the only non-place partner some *other* place
-- was holding on by — or, going the other way, can itself be the partner that
-- rescues one. So the answer has to be iterated to a fixed point. A recursive CTE
-- cannot express it: Postgres forbids window functions in the recursive term and
-- the ranking is `row_number()`. Hence a loop, and hence plpgsql.
--
-- **Termination is by monotonicity, not by the guard.** `banned` only ever grows,
-- and it can only ever hold words carrying a `word_overrides` 'place' entry, so
-- the loop ends after at most one pass per place plus the pass that confirms it.
-- The guard is a backstop against a bug in that reasoning, not the mechanism — do
-- not replace it with a fixed number of passes. It is **derived from the place
-- count rather than hardcoded**, because a hardcoded 50 against 45 places is a
-- margin of four: grow the dictionary past ~49 places and the backstop becomes
-- reachable, at which point the function would quietly return a set that is not a
-- fixed point. And when it does fire it now `raise`s, because a silently wrong
-- graph is the one outcome worse than an error.
--
-- Measured with the gate switched on across all 35 cells: the fixed point is
-- reached after a **single** productive pass everywhere, so the loop runs twice
-- where anything was dropped and once where nothing was. That the second pass has
-- never yet found a word is not a licence to drop it — it is the check that the
-- first pass was a fixed point, and it costs one query.
--
-- **It is *a* fixed point, not *the* fixed point**, and the difference is worth
-- stating. Each pass bans every unsupported place at once, so a place dropped in
-- pass 1 is never reconsidered even though the promotions that drop causes only
-- ever add words and edges — a later pass could in principle have handed it a
-- non-place partner. Dropping them one at a time, cheapest first, would find a
-- different and larger surviving set. The batch drop is what the task specified
-- and it cannot bite while one productive pass suffices, but if a day ever needs
-- three passes this is the assumption to re-examine first.
--
-- **It is a fixed point that really does substitute.** On 2026-08-03 the gate
-- drops 서울, 인천, 포항, 울산, 강원, 광주 and pulls 한반도, 고속도로, 김동관,
-- 김병기, 김용, 대공습 up under the cap in their place. 2026-08-02 is the
-- exception worth knowing: it drops 부산 and promotes nothing, because that day
-- qualifies only 69 words and the render cap was never binding — the same
-- cap-binding argument CLAUDE.md makes about head_pos, seen from the other side.
--
-- **"Has an edge" means "has a line on screen".** The loop asks for the drawn
-- edges — the same `edge_min_cooc`, the same `edge_min_npmi`, and both endpoints
-- among the drawn nodes — because a pair that co-occurs in the data but is not
-- drawn cannot be seen by the reader and so cannot be a place's reason to be
-- there.
--
--
-- ## How the work is split, and why it is split that way
--
-- The first version of this migration had one helper for nodes and one for edges,
-- each taking `(p_date, p_category, p_banned)`, and the loop called them. It was
-- correct and far too slow: **13 seconds with the gate on**, against 1,417ms for
-- 0018. Profiling put essentially all of it in one place:
--
--     keyword_signals('2026-08-03')            951 ms
--     the whole pair/npmi arithmetic           144 ms
--     keyword_graph_nodes  (signals + sieve)   982 ms
--     keyword_graph_edges  (nodes + pairs)   1,156 ms
--
-- The sieve, the ranking, the cap and the pair arithmetic together are noise
-- beside `keyword_signals`, and the loop was paying for it eight times over — two
-- passes at three node evaluations each, plus two more for the final JSON.
--
-- **This is the second time in this project that a cost turned out to be round
-- trips rather than computation.** `supabase/functions/collect-headlines/index.ts`
-- records the same shape from the other side: the morphological analyser costs
-- 0.88ms a headline, and it was the ~2,700 round trips around it that killed the
-- function, so batching them took a run from 44.9s to 4-5s. Same finding here,
-- one layer up — nothing was made faster, something expensive was simply stopped
-- from being asked eight times. Measure which half the time is in before tuning
-- either half.
--
-- **`keyword_signals` does not depend on `banned`.** Neither does the scoped
-- count, the sieve verdict, the `passed_by` reason, or the raw pair list. All
-- `banned` can do is remove rows, and removing rows changes only the ranking and
-- what fits under the cap. So the split is by *what a thing depends on*:
--
--   * `keyword_graph_candidates(p_date, p_category)` — expensive, banned-blind.
--     Runs `keyword_signals` once and applies sieves 1 to 4. The one and only
--     place that decides **whether a word may be drawn at all**.
--   * `keyword_graph_rank(p_cands, p_banned)` — cheap, banned-aware. Ranking,
--     the head_pos demotion, the render cap and the `faded` / `is_place` flags.
--     The one and only place that decides **which of them are drawn and in what
--     order**. It takes the candidate set as an array of composite values so the
--     loop can hand it the same set repeatedly without paying for it again.
--   * `keyword_graph_pick_edges(p_date, p_category, p_words)` — the one and only
--     place that decides **what an edge is**: both thresholds, both endpoints
--     drawn, the ordering and the limit. It takes the drawn words as an argument
--     rather than computing them, which is what keeps it off `keyword_signals`.
--
-- The node rule is therefore in two functions rather than one, split along the
-- `banned` dependency — but each half exists exactly once, which is the rule that
-- matters. Nothing is duplicated; a threshold still lives in one place.
--
-- `keyword_graph_nodes` and `keyword_graph_edges` survive with the signatures they
-- were specified with, as thin wrappers, because `scripts/analysis/` and later
-- tasks want the whole answer from a date. `keyword_graph` itself does not use
-- them: it holds the candidate array across the loop and calls
-- `keyword_graph_rank` and `keyword_graph_pick_edges` directly, so
-- **`keyword_signals` runs exactly once per `keyword_graph` call, gate on or
-- off**. Measured on 2026-08-03: 1,417ms for 0018, 1,096ms with the gate off,
-- 1,340ms with it on.
--
-- All functions are SECURITY INVOKER (the SQL default, stated anyway) with
-- `set search_path = ''`. RLS is the whole access model here — there is no login
-- and `anon` reaches these functions directly — so a SECURITY DEFINER anywhere in
-- this chain would hand out the service role's view of the tables.

-- Dropped in dependency order so a re-push is idempotent. `drop type … cascade`
-- takes `keyword_graph_rank` with it, which is why that one is not named here.
drop function if exists public.keyword_graph_nodes(date, text, text[]);
drop function if exists public.keyword_graph_edges(date, text, text[]);
drop function if exists public.keyword_graph_pick_edges(date, text, text[]);
drop function if exists public.keyword_graph_candidates(date, text);
drop type if exists public.keyword_candidate cascade;

-- The candidate set, as a value that can be carried across loop iterations.
--
-- `override_mode` rides along rather than the two flags derived from it, because
-- `faded` also needs the rank and so cannot be settled here. `head_pos` rides
-- along because the demotion is a ranking decision, not a sieve one.
--
-- A migration that adds a column to `keyword_signals` and wants it on the node
-- row has to add it here too (`alter type … add attribute`). That is the cost of
-- carrying the set by value, and it is cheap beside eight runs of the signal
-- query.
create type public.keyword_candidate as (
  word              text,
  count             int,
  spec              numeric,
  standalone        numeric,
  neighbors_per_doc numeric,
  assoc             numeric,
  head_pos          numeric,
  passed_by         text,
  category_slug     text,
  override_mode     text
);

-- Sieves 1 to 4: may this word be drawn at all? Independent of `p_banned` by
-- construction — this is the expensive half, and it runs once per RPC call.
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
select
  s.word, s.count, s.spec, s.standalone, s.neighbors_per_doc, s.assoc,
  s.head_pos, s.passed_by, s.category_slug, s.override_mode
from sieved s
where s.passed_by is not null;
$fn$;

-- Which of the candidates are drawn, in what order, and how they are flagged.
-- Cheap, and the only part of the node rule that `p_banned` can reach.
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
    order by (k.head_pos > w.demote_head_pos) asc, k.count desc, k.word) as rank
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

-- What an edge is: both thresholds, both endpoints drawn, the ordering and the
-- limit. `p_words` is the drawn node set, passed in rather than computed, which
-- is the whole reason this function never touches `keyword_signals`.
create or replace function public.keyword_graph_pick_edges(
  p_date date,
  p_category text,
  p_words text[]
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
-- The same `scoped` / `scoped_df` pair keyword_graph_candidates defines. Two
-- copies of the scoping predicate, one selection — see the note there.
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
select sp.a, sp.b, sp.cooc, sp.npmi
from scored_pairs sp
cross join w
where sp.cooc >= w.edge_min_cooc
  and sp.npmi >= w.edge_min_npmi
  -- An edge is drawn only between two drawn words, which is what makes this the
  -- honest answer to "does this place have a line on screen".
  and sp.a = any (coalesce(p_words, '{}'::text[]))
  and sp.b = any (coalesce(p_words, '{}'::text[]))
-- The word is the tie-break, exactly as it is in the node ranking. See the
-- migration header: without it this is not a total order.
order by sp.npmi desc, sp.cooc desc, sp.a, sp.b
limit (select w2.edge_limit::int from w w2);
$fn$;

-- The whole-answer forms. `keyword_graph` does not call these — it holds the
-- candidate array itself — but `scripts/analysis/` and later tasks want a node
-- set or an edge set from a date, and this is the one place composing the halves
-- above into that.
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
  select
    r.word, r.count, r.spec, r.standalone, r.neighbors_per_doc, r.assoc,
    r.passed_by, r.category_slug, r.is_place, r.faded, r.rank
  from public.keyword_graph_rank(
    array(select c from public.keyword_graph_candidates(p_date, p_category) c),
    p_banned) r
  -- Row order out of a function scan is not contractual, so it is stated. This
  -- is the order keyword_graph's own json_agg uses.
  order by r.rank;
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
  select e.a, e.b, e.cooc, e.npmi
  from public.keyword_graph_pick_edges(
    p_date, p_category,
    array(select n.word from public.keyword_graph_nodes(p_date, p_category, p_banned) n)) e
  -- As above: stated rather than inherited, and the same keys the JSON uses.
  order by e.npmi desc, e.cooc desc, e.a, e.b;
$fn$;

create or replace function public.keyword_graph(p_date date, p_category text default null)
returns json
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  cands   public.keyword_candidate[];
  banned  text[] := '{}';
  dropped text[];
  gate    boolean;
  guard   int := 0;
  max_passes int;
  result  json;
begin
  select coalesce(max(value), 0) = 1 into gate
  from public.scoring_weights where key = 'place_needs_edge';

  -- The bound, derived rather than guessed: at most one pass per place, plus the
  -- pass that finds nothing and stops. `+ 2` rather than `+ 1` so the confirming
  -- pass is never itself what trips the backstop.
  select count(*)::int + 2 into max_passes
  from public.word_overrides where mode = 'place';

  -- The expensive half, once. Everything below is arithmetic over a few hundred
  -- rows, so the loop is affordable however many times it goes round.
  cands := array(select c from public.keyword_graph_candidates(p_date, p_category) c);

  if gate then
    loop
      guard := guard + 1;
      -- Both CTEs are `materialized` on purpose: the `not exists` below is
      -- correlated on the outer place, and without the fence the planner is free
      -- to re-run the edge query once per place on screen.
      with n as materialized (
        select * from public.keyword_graph_rank(cands, banned)
      ),
      e as materialized (
        select * from public.keyword_graph_pick_edges(
          p_date, p_category, array(select nn.word from n nn))
      )
      -- A place with no edge to a drawn non-place.
      select coalesce(array_agg(p.word), '{}')
      into dropped
      from n p
      where p.is_place
        and not exists (
          select 1
          from e ee
          join n m on m.word = case when ee.a = p.word then ee.b else ee.a end
          where (ee.a = p.word or ee.b = p.word) and not m.is_place
        );
      -- Dropping a place promotes the next-ranked word, which can rescue or
      -- strand another place, so this runs to a fixed point. `banned` only
      -- grows and is bounded by the size of the place list, which is where
      -- `max_passes` comes from; reaching it means that argument is broken, and
      -- a graph that is not a fixed point must not be returned as if it were.
      exit when cardinality(dropped) = 0;
      if guard >= max_passes then
        raise exception
          'keyword_graph: place gate failed to converge in % passes for % / %',
          max_passes, p_date, coalesce(p_category, '(all)');
      end if;
      banned := banned || dropped;
    end loop;
  end if;

  with n as materialized (
    select * from public.keyword_graph_rank(cands, banned)
  ),
  e as materialized (
    select * from public.keyword_graph_pick_edges(
      p_date, p_category, array(select nn.word from n nn))
  )
  select json_build_object(
    'nodes', coalesce((
      select json_agg(json_build_object(
        'word', x.word,
        'count', x.count,
        'spec', round(x.spec, 3),
        'standalone', round(x.standalone, 3),
        'neighbors_per_doc', round(x.neighbors_per_doc, 3),
        'assoc', round(x.assoc, 3),
        'passed_by', x.passed_by,
        'category_slug', x.category_slug,
        'faded', x.faded
      ) order by x.rank)
      from n x
    ), '[]'::json),
    'edges', coalesce((
      select json_agg(json_build_object(
        'a', y.a,
        'b', y.b,
        'cooc', y.cooc,
        'npmi', round(y.npmi, 3)
      ) order by y.npmi desc, y.cooc desc, y.a, y.b)
      from e y
    ), '[]'::json)
  )
  into result;

  return result;
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

-- The functions were dropped above, so a grant here is not a restatement the way
-- 0018's was: a drop discards grants.
--
-- **These grants document intent; they are not what confers access, and the live
-- ACLs say so.** All six functions come out carrying
--
--     =X/postgres  postgres=X/postgres  anon=X/postgres
--     authenticated=X/postgres  service_role=X/postgres
--
-- of which this file wrote only `anon=X`. The rest arrives on its own: Postgres
-- grants EXECUTE on a new function to PUBLIC (`=X/postgres`), and Supabase's
-- default privileges add `anon`, `authenticated` and `service_role` to every
-- function created in `public`. So naming one role here cannot half-break the
-- SECURITY INVOKER chain — which is the thing worth checking before writing a
-- grant for a call tree — and equally, naming one role cannot *narrow* anything.
-- `authenticated` keeps its explicit grant whatever this file says.
--
-- `anon` is named alone because it is the only role this project can ever arrive
-- as: there is no login, `src/lib/supabaseClient.ts` builds a `PostgrestClient` by
-- hand with the anon key in both the `apikey` and `Authorization` headers, and
-- there is no auth-js in the bundle. Narrowing the ACL for real would take a
-- `revoke`, and that is not done here — it would fight the platform's defaults to
-- close a door nothing can reach.
grant execute on function public.keyword_graph_candidates(date, text) to anon;
grant execute on function public.keyword_graph_rank(public.keyword_candidate[], text[]) to anon;
grant execute on function public.keyword_graph_pick_edges(date, text, text[]) to anon;
grant execute on function public.keyword_graph_nodes(date, text, text[]) to anon;
grant execute on function public.keyword_graph_edges(date, text, text[]) to anon;
grant execute on function public.keyword_graph(date, text) to anon;
