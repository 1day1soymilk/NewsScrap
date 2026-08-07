-- 0034: keyword_graph_cache stops going stale on a retune it cannot see.
--
-- ## The gap 0032/0033 left open
--
-- `keyword_graph_cache_health` (0033) derives staleness from row timestamps:
-- a cache row is stale when `headlines.created_at` for that date postdates
-- the row's `computed_at`. That is exactly right for "the collector added
-- rows", and exactly blind to "an operator changed `scoring_weights` or
-- `word_overrides`" -- a retune touches neither table's timestamp, so the
-- health view kept saying `current` and every reader kept getting the
-- pre-retune graph. CLAUDE.md says elsewhere that a retune needs no
-- redeploy; since 0032 that has been true of the *computation* and false of
-- the *screen*, and `docs/DEPLOYMENT.md` has had to carry a "call
-- refresh_keyword_graph_cache by hand" step to cover it. This migration
-- removes that step rather than documenting it more clearly.
--
--
-- ## The fix: a config fingerprint, compared on every read
--
-- `keyword_graph_config_fingerprint()` hashes the two tables a retune can
-- touch. `keyword_graph_cache` gains a `config_fingerprint` column written
-- at compute time, `keyword_graph` (the thin reader, 0032) only serves a
-- cached row when its fingerprint matches the *current* fingerprint, and
-- `keyword_graph_cache_health` calls a fingerprint mismatch `stale` too --
-- which is what lets 0033's self-heal pick a retuned date back up with no
-- further change, on its own, within a run or two.
--
-- **A denylist, not an allowlist, and that is the point.** The fingerprint
-- excludes `note` on both tables and `created_at` on `word_overrides` by
-- name; everything else -- including a column added after this migration
-- ships -- is included by default. Listing the columns that *do* matter
-- would silently stop covering the table the day someone adds a new
-- threshold or a new override field and forgets to extend the list. This is
-- the same inversion CLAUDE.md already records for the compound-merge rule:
-- an allowlist of tags that may join a run was replaced by a denylist of
-- what must not, because the denylist survives an analyser it was never
-- written for. `note` is excluded specifically because migration `0026`
-- exists purely to update four `note` columns while deliberately moving no
-- `value` -- hashing documentation would invalidate every cached cell for a
-- comment edit, which is precisely the false invalidation this migration
-- must not introduce while fixing the true one.
--
-- Measured on the live database, second of two runs: hashing 16
-- `scoring_weights` rows and 134 `word_overrides` rows costs **1.6 ms**. A
-- cached `keyword_graph` read was 1.35 ms before this; comparing the
-- fingerprint on every read is expected to roughly double that, to ~3 ms --
-- against the ~2 s `keyword_graph_compute` costs on a thick day, which is
-- what makes checking on every read affordable rather than clever.
--
--
-- ## What changes, in order
--
-- 1. `keyword_graph_config_fingerprint()` -- `language sql`, `stable`,
--    `security invoker`, `set search_path = ''`. It is on the read path
--    (`keyword_graph` calls it on every invocation), so it is granted to
--    `anon, authenticated, service_role` rather than following the
--    writer-functions' `service_role`-only shape.
--
-- 2. `keyword_graph_cache.config_fingerprint` (`text`). Backfilled for every
--    existing row with the *current* fingerprint -- correct rather than a
--    placeholder, since nothing in `scoring_weights` or `word_overrides` has
--    changed between the 0032/0033 backfill and this migration -- then set
--    `not null`. `refresh_keyword_graph_cache` computes the fingerprint once
--    per call (not once per cell -- 7 calls at 1.6 ms each would be a real
--    if small waste) and stamps every row it writes with it.
--
-- 3. `keyword_graph` gains one more condition on its cache-hit branch:
--    `config_fingerprint = keyword_graph_config_fingerprint()`. Everything
--    else about it is unchanged -- still `security invoker`, still never
--    writes on a miss, a miss is still slow but correct. `create or
--    replace` keeps its OID and its existing grant to `anon`.
--
-- 4. `keyword_graph_cache_health`'s `state` gains one more way to read
--    `'stale'`: any of a date's cells carrying a fingerprint that does not
--    match the current one. `'missing'` is still checked first in the
--    `case`, so a wholly uncached date is still reported as `missing` and
--    not `stale`. `create or replace view` -- the output columns are
--    unchanged, only the `case` grows a branch.
--
-- No Edge Function change. `refresh_stale_keyword_graph_cache` (0033) reads
-- `state in ('missing', 'stale')` off the health view without caring *why*
-- a date is stale, so a fingerprint-mismatch date is picked up by the exact
-- same self-heal the collector already calls after every run -- confirmed
-- by reading 0033 and `index.ts` rather than assumed. A retune therefore
-- corrects itself for the current run's date immediately (0032's fallback:
-- a miss falls through to `keyword_graph_compute`) and for up to one more
-- stale/missing date every subsequent run, same as any other staleness.
--
--
-- ## Verification
--
-- `.superpowers/0034-report.md` carries the full record: two single-
-- transaction, rolled-back proofs (a `render_cap` retune changes the
-- returned graph's hash immediately; a `note` edit does not change the
-- fingerprint at all), all 63 cells (9 collected dates x the all-view and 6
-- category slugs -- the live count, not an assumed 9x7) byte-identical
-- before and after, warm second-of-two read timing before and after, five
-- concurrent live REST calls, and the privilege checks (`anon` may execute
-- the fingerprint function and select the health view, and may not execute
-- either refresh function).

-- ---------------------------------------------------------------------------
-- 1. The fingerprint function
-- ---------------------------------------------------------------------------

create function public.keyword_graph_config_fingerprint()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select md5(
    coalesce((select string_agg((to_jsonb(w) - 'note')::text, ',' order by w.key)
                from public.scoring_weights w), '') || '|' ||
    coalesce((select string_agg((to_jsonb(o) - 'note' - 'created_at')::text, ',' order by o.word, o.mode)
                from public.word_overrides o), '')
  );
$$;

comment on function public.keyword_graph_config_fingerprint() is
  'A hash of every scoring_weights and word_overrides row that can change what '
  'keyword_graph draws, excluding note (both tables) and created_at (word_overrides) '
  'by name -- a denylist, so a column added later is covered without editing this '
  'function, the same inversion CLAUDE.md records for the compound-merge denylist. '
  'note is excluded because migration 0026 exists purely to edit four note columns '
  'while moving no value; hashing it would invalidate every cached cell for a comment '
  'edit. Compared on every keyword_graph read (0034) against keyword_graph_cache''s '
  'stored config_fingerprint, so a scoring_weights or word_overrides retune is reflected '
  'on the very next read rather than needing a manual refresh.';

-- On the read path (keyword_graph calls this every time), unlike the writer
-- functions below -- granted the same three roles keyword_signals (0025) is,
-- for the same reason: authenticated is an empty role here (no login), naming
-- it moves nothing about the access model and only keeps this consistent with
-- the rest of the read-path chain. service_role is named explicitly though the
-- default ACL already includes it, same as 0032's explicit anon grant.
grant execute on function public.keyword_graph_config_fingerprint() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. keyword_graph_cache gains config_fingerprint
-- ---------------------------------------------------------------------------

alter table public.keyword_graph_cache add column config_fingerprint text;

-- Backfilled with the *current* fingerprint, not a placeholder: nothing in
-- scoring_weights or word_overrides has moved since 0032/0033's own backfill,
-- so every existing cell genuinely was computed under this configuration.
update public.keyword_graph_cache
   set config_fingerprint = public.keyword_graph_config_fingerprint();

alter table public.keyword_graph_cache alter column config_fingerprint set not null;

comment on column public.keyword_graph_cache.config_fingerprint is
  'keyword_graph_config_fingerprint() at the time this row was computed. keyword_graph '
  '(0034) only serves a cached row when this matches the current fingerprint; a mismatch '
  'falls through to keyword_graph_compute exactly like a missing row does.';

-- ---------------------------------------------------------------------------
-- 3. keyword_graph: one more condition on the cache-hit branch
-- ---------------------------------------------------------------------------

create or replace function public.keyword_graph(p_date date, p_category text default null::text)
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select graph
       from public.keyword_graph_cache
      where collected_date = p_date
        and category_key = coalesce(p_category, '')
        and config_fingerprint = public.keyword_graph_config_fingerprint()),
    public.keyword_graph_compute(p_date, p_category)
  );
$$;

comment on function public.keyword_graph(date, text) is
  'Thin cache reader: returns keyword_graph_cache.graph when a row exists for '
  '(p_date, p_category) AND its config_fingerprint matches the current '
  'keyword_graph_config_fingerprint() (0034), otherwise falls back to '
  'keyword_graph_compute(...). Never writes on a miss -- that would need security '
  'definer and would let anon trigger unbounded ~2s writes. A cache miss (missing row '
  'or stale fingerprint) is slow but correct.';

-- ---------------------------------------------------------------------------
-- 4. refresh_keyword_graph_cache: stamp the fingerprint at compute time
-- ---------------------------------------------------------------------------

create or replace function public.refresh_keyword_graph_cache(p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cat record;
  v_fp text := public.keyword_graph_config_fingerprint();
begin
  insert into public.keyword_graph_cache (collected_date, category_slug, graph, computed_at, config_fingerprint)
  values (p_date, null, public.keyword_graph_compute(p_date, null), now(), v_fp)
  on conflict (collected_date, category_key)
  do update set graph = excluded.graph, computed_at = excluded.computed_at, config_fingerprint = excluded.config_fingerprint;

  for cat in select slug from public.categories order by slug loop
    insert into public.keyword_graph_cache (collected_date, category_slug, graph, computed_at, config_fingerprint)
    values (p_date, cat.slug, public.keyword_graph_compute(p_date, cat.slug), now(), v_fp)
    on conflict (collected_date, category_key)
    do update set graph = excluded.graph, computed_at = excluded.computed_at, config_fingerprint = excluded.config_fingerprint;
  end loop;
end;
$$;

comment on function public.refresh_keyword_graph_cache(date) is
  'Recomputes and upserts all 7 keyword_graph_cache cells (all-categories plus every '
  'categories.slug) for one collected date, stamping each with the current '
  'keyword_graph_config_fingerprint() (0034). Called by the collector after a run, and '
  'no longer needs to be called by hand after a retune -- keyword_graph (0034) already '
  'falls through on a fingerprint mismatch, and keyword_graph_cache_health (0034) marks '
  'the affected dates stale so refresh_stale_keyword_graph_cache (0033) heals them on '
  'its own. security definer, execute granted to service_role only - to anon it would '
  'let anyone queue unbounded ~14s writes (7 cells at ~2s each) over PostgREST.';

-- Privileges are unaffected by create or replace (same signature, same OID),
-- but re-stated for a reader of this file rather than of 0032's.
revoke all on function public.refresh_keyword_graph_cache(date) from public, anon, authenticated;
grant execute on function public.refresh_keyword_graph_cache(date) to service_role;

-- ---------------------------------------------------------------------------
-- 5. keyword_graph_cache_health: a fingerprint mismatch reads 'stale' too
-- ---------------------------------------------------------------------------

create or replace view public.keyword_graph_cache_health
with (security_invoker = on) as
with expected as (
  select count(*)::int + 1 as full_cells from public.categories
),
per_date as (
  select collected_date, max(created_at) as newest_row
  from public.headlines
  group by collected_date
)
select
  d.collected_date,
  count(c.category_key)::int as cells,
  min(c.computed_at) as computed_at,
  d.newest_row,
  case
    when count(c.category_key) < e.full_cells then 'missing'
    when d.newest_row > min(c.computed_at) then 'stale'
    when bool_or(c.config_fingerprint is distinct from public.keyword_graph_config_fingerprint()) then 'stale'
    else 'current'
  end as state
from per_date d
cross join expected e
left join public.keyword_graph_cache c on c.collected_date = d.collected_date
group by d.collected_date, d.newest_row, e.full_cells
order by d.collected_date desc;

comment on view public.keyword_graph_cache_health is
  'One row per collected date: how many of the (categories + 1) cache cells exist, the '
  'oldest computed_at among them, the newest headlines.created_at for that date, and a '
  'derived state (missing / stale / current). Since 0034, state also reads ''stale'' '
  'when any of that date''s cells carries a config_fingerprint that does not match the '
  'current keyword_graph_config_fingerprint() -- a scoring_weights or word_overrides '
  'retune is now visible here, and refresh_stale_keyword_graph_cache (0033) heals it '
  'the same way it heals a missing or timestamp-stale date, with no further change.';

grant select on public.keyword_graph_cache_health to anon, authenticated;
