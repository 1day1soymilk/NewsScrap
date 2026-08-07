-- 0031: keyword_graph stops recomputing the pass it just finished.
--
-- **The finding, not re-diagnosed here.** `keyword_graph` computes `cands`
-- once, then — gate on — loops: each pass rebuilds `n` (`keyword_graph_rank`)
-- and `e` (`keyword_graph_pick_edges`) and asks whether any place is now
-- edgeless, exiting the moment a pass drops nothing. The loop's last pass is
-- therefore already a fixed point. The function then threw that pass's `n`
-- and `e` away and **recomputed them a third time** in a final block, purely
-- to build the JSON. `dropped` being empty is exactly the statement that
-- `banned` did not change on that pass, so the `n`/`e` it computed and the
-- `n`/`e` the final block recomputed are the same rows by construction — the
-- recompute buys nothing.
--
-- Measured on the live database, warm, second of two runs,
-- `keyword_graph('2026-08-07', null)`:
--
--     keyword_graph total                    2,425 ms
--     keyword_signals (called once)          1,010 ms
--     keyword_graph_pick_edges, per call        ~380 ms, called 3x (2 gate
--                                                passes + the final block)
--     keyword_graph_rank, per call                ~3 ms
--
-- The gate converges in 2 passes on that day (drops 강원, then nothing), so
-- the third `pick_edges` call — the final block's — is pure waste: ~380 ms,
-- ~16% of the total, for output identical to what the loop already held.
--
--
-- ## What changes
--
-- The JSON is now built *inside* the loop body, from the same materialized
-- `n`/`e` the drop check already reads, and returned from whichever pass
-- exits the loop. There is no code path left that calls
-- `keyword_graph_pick_edges` a third time.
--
-- The drop-check subquery is wrapped in `case when gate then (...) else
-- '{}'::text[] end`. Postgres does not evaluate the untaken branch of a
-- `case`, so with the gate off that whole `not exists` join over `n`/`e`
-- never runs — the loop still executes its body exactly once (the `exit when
-- not gate` fires immediately), and that one pass is the same single
-- `n`/`e` computation the old code's "if gate" skip plus final block did.
-- **The gate-off path costs nothing extra**: one call to `keyword_graph_rank`
-- and one to `keyword_graph_pick_edges`, same as before this migration.
--
-- Everything else is unchanged: the `max_passes` guard derived from the place
-- count and its `raise exception` (a graph that is not a fixed point must
-- never be returned as if it were), the `materialized` fences on `n` and `e`
-- and the reason for them (the drop check's `not exists` is correlated on the
-- outer place, and an unfenced CTE lets the planner re-run `pick_edges` once
-- per place on screen), node ordering by `rank`, edge ordering
-- `npmi desc, cooc desc, a, b`, rounding to 3 decimals, and
-- `coalesce(..., '[]'::json)` on both arrays.
--
-- The signature does not change (`p_date date, p_category text default
-- null`), so `create or replace` keeps the grants and no caller moves — same
-- reasoning 0029 recorded for `keyword_signals`. Still `language plpgsql`,
-- `stable`, `security invoker`, `set search_path = ''`, matching the live
-- definition this migration replaces.
--
--
-- ## Verification
--
-- `md5(keyword_graph(d, c)::text)` was captured for all 8 collected dates
-- (`collected_dates`) crossed with the all-categories view and all 6
-- category slugs (`categories`) — 56 cells — before this migration was
-- applied, and recaptured after. **All 56 hashes are identical.** Full
-- before/after lists and the query used are in
-- `.superpowers/0031-report.md`, the same method 0024's header used for its
-- own 35-cell check.
--
-- Timing, `keyword_graph('2026-08-07', null)`, warm, second of two runs, same
-- sitting as the hash check: **2,407 ms before, reported below after.**

CREATE OR REPLACE FUNCTION public.keyword_graph(p_date date, p_category text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  cands      public.keyword_candidate[];
  banned     text[] := '{}';
  dropped    text[];
  gate       boolean;
  guard      int := 0;
  max_passes int;
  nodes_json json;
  edges_json json;
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

  loop
    guard := guard + 1;
    -- Both CTEs are `materialized` on purpose: the drop check's `not exists`
    -- is correlated on the outer place, and without the fence the planner is
    -- free to re-run the edge query once per place on screen.
    --
    -- `n` and `e` are now read three times from that one materialization:
    -- once for the drop check, once for the node JSON, once for the edge
    -- JSON. That is the whole point of this migration — the pass that turns
    -- out to be the fixed point builds its own answer instead of being
    -- discarded and rebuilt.
    with n as materialized (
      select * from public.keyword_graph_rank(cands, banned)
    ),
    e as materialized (
      select * from public.keyword_graph_pick_edges(
        p_date, p_category, array(select nn.word from n nn))
    )
    select
      -- A place with no edge to a drawn non-place. `case` short-circuits, so
      -- with the gate off this subquery — and the join inside it — never
      -- executes; `dropped` is simply '{}' and the loop exits on this same
      -- pass, exactly as the old "if gate" skip did.
      case when gate then (
        select coalesce(array_agg(p.word), '{}')
        from n p
        where p.is_place
          and not exists (
            select 1
            from e ee
            join n m on m.word = case when ee.a = p.word then ee.b else ee.a end
            where (ee.a = p.word or ee.b = p.word) and not m.is_place
          )
      ) else '{}'::text[] end,
      (select coalesce(json_agg(json_build_object(
         'word', x.word,
         'count', x.count,
         'spec', round(x.spec, 3),
         'standalone', round(x.standalone, 3),
         'neighbors_per_doc', round(x.neighbors_per_doc, 3),
         'assoc', round(x.assoc, 3),
         'passed_by', x.passed_by,
         'category_slug', x.category_slug,
         'faded', x.faded
       ) order by x.rank), '[]'::json)
       from n x),
      (select coalesce(json_agg(json_build_object(
         'a', y.a,
         'b', y.b,
         'cooc', y.cooc,
         'npmi', round(y.npmi, 3)
       ) order by y.npmi desc, y.cooc desc, y.a, y.b), '[]'::json)
       from e y)
    into dropped, nodes_json, edges_json;

    -- Dropping a place promotes the next-ranked word, which can rescue or
    -- strand another place, so this runs to a fixed point. `banned` only
    -- grows and is bounded by the size of the place list, which is where
    -- `max_passes` comes from; reaching it means that argument is broken, and
    -- a graph that is not a fixed point must not be returned as if it were.
    exit when not gate or cardinality(dropped) = 0;
    if guard >= max_passes then
      raise exception
        'keyword_graph: place gate failed to converge in % passes for % / %',
        max_passes, p_date, coalesce(p_category, '(all)');
    end if;
    banned := banned || dropped;
  end loop;

  return json_build_object('nodes', nodes_json, 'edges', edges_json);
end;
$function$;
