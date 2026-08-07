-- 0032: keyword_graph stops being recomputed on every page load.
--
-- **The measured defect, not re-diagnosed here.** `keyword_graph('2026-08-07',
-- null)` (3,224 headlines) costs 1,976 ms warm even after 0031 dropped the
-- loop's redundant third pass — `keyword_signals` (~1,010 ms) plus two
-- `keyword_graph_pick_edges` passes (~380 ms each), and nothing further inside
-- the query is cheap to cut. `anon`'s `statement_timeout` is 3 s. Measured
-- against the live project: one call alone returns 200 in 2,637 ms (before
-- 0031); five concurrent calls all return 500, SQLSTATE 57014 (statement
-- timeout). A handful of simultaneous readers on a thick day all get an error
-- page.
--
-- The graph is a pure function of `(p_date, p_category)` and that day's
-- stored rows, and those rows change only when the collector runs — not on
-- every page load. Recomputing it per request is the thing being fixed, not
-- the query itself.
--
--
-- ## What changes
--
-- 1. **The existing computation is renamed, not deleted.** `alter function
--    ... rename to keyword_graph_compute` keeps the OID, so its ACL survives
--    untouched — a `create or replace` under the old name would have kept the
--    grants too, but a *rename* is what lets a brand-new function take the
--    name `keyword_graph` afterwards. Nothing about its body, its
--    `language plpgsql`/`stable`/`security invoker`/`set search_path = ''`,
--    or the place-gate fixed-point loop CLAUDE.md documents changes at all.
--
-- 2. **A cache table, not a materialized view.** A matview refreshes as one
--    unit; the collector only ever has one new day to add, and refreshing all
--    of history on every run would be the exact inversion of the point.
--    `word_directory` (0030) is a matview because *searching* it has to be
--    one relation; this cache is written one `(date, category)` cell at a
--    time and a plain table is what makes that possible.
--
--    `category_slug` is `null` for the all-categories view, and a `null`
--    cannot appear in a primary-key column. Solved with a generated,
--    always-non-null `category_key` (`coalesce(category_slug, '')`) that
--    carries the primary key instead, so `category_slug` itself stays a true
--    `null` for anything that wants to filter or read it directly — the
--    alternative, keying the PK straight off `coalesce(category_slug, '')`
--    with no `category_slug` column at all, would lose that.
--
-- 3. **`keyword_graph` becomes a thin reader.** It returns the cached
--    `graph` when a row exists for `(p_date, p_category)`, and falls back to
--    `keyword_graph_compute(p_date, p_category)` when it does not. It stays
--    `security invoker` — **it must never write on a miss**: a writing miss
--    would need `security definer` to get past the cache table's select-only
--    RLS, and that would let `anon` trigger an unbounded ~2 s write on every
--    uncached request, which is strictly worse than today. A miss is slow but
--    correct; that is the failure direction this keeps.
--
-- 4. **`refresh_keyword_graph_cache(p_date date)`** recomputes and upserts
--    all 7 cells for one date — the all-categories view plus one row per
--    `categories.slug` — and is what the collector calls after a run. It is
--    `security definer` for the same reason `refresh_word_directory` (0030)
--    is: writing to a table under RLS from a function needs the owner's
--    privileges, the migration runs as the owner, and the Edge Function
--    itself already connects as `service_role`, so there is no `anon` view of
--    the tables being handed out — the thing the `keyword_graph`-chain rule
--    in CLAUDE.md actually protects. `set search_path = ''` all the same, on
--    principle. Execute is granted to `service_role` alone: over PostgREST,
--    granting it to `anon` would let anyone queue unbounded ~14 s writes (7
--    cells x ~2 s).
--
--
-- ## The consequence this buys, and it must not be discovered later
--
-- **Today, retuning `scoring_weights` or `word_overrides` takes effect on the
-- next page load with no redeploy, and CLAUDE.md documents that as a
-- feature.** With this cache, a retune is invisible until the affected dates
-- are refreshed — a page load now reads whatever `keyword_graph_cache` last
-- stored, not the current thresholds. `docs/DEPLOYMENT.md` gets an operator
-- line: call `refresh_keyword_graph_cache(date)` for every affected collected
-- date after changing either table. This is the real cost of the design and
-- is written down here so it is not re-discovered as a bug.
--
--
-- ## Backfill
--
-- Not run inside this migration — 56 existing cells (8 collected dates x 7
-- views) at ~2 s each is on the order of two minutes, and `db push` should
-- not be made to wait on it. Run separately, once per collected date, after
-- this migration is applied:
--
--     select public.refresh_keyword_graph_cache(collected_date)
--     from public.collected_dates;
--
--
-- ## Verification
--
-- `md5(keyword_graph(d, c)::text)` was captured for all 8 collected dates x
-- the all-categories view x all 6 category slugs (56 cells) before and after
-- this migration and the backfill — the method 0029 and 0031 both used.
-- Timings, the 5-concurrent-call re-test and the privilege checks are in
-- `.superpowers/0032-report.md`.

alter function public.keyword_graph(date, text) rename to keyword_graph_compute;

comment on function public.keyword_graph_compute(date, text) is
  'The actual computation: place-gate fixed-point loop over keyword_graph_candidates '
  '/ keyword_graph_rank / keyword_graph_pick_edges. Renamed from keyword_graph by 0032 '
  'so that name could become a thin cache reader; this function is what a cache miss, '
  'or refresh_keyword_graph_cache, falls back to. Unchanged otherwise.';

-- `graph` is `json`, not `jsonb`, and that is not a stylistic choice: `jsonb`
-- reparses and canonicalizes on write (keys sorted, whitespace and numeric
-- formatting normalised), while `json` stores the exact input text verbatim.
-- Verification here is `md5(keyword_graph(d, c)::text)` byte-identity, the
-- same method 0029 and 0031 used, and `keyword_graph_compute`'s
-- `json_build_object` calls emit keys in a fixed, deliberate order (word,
-- count, spec, standalone, ...) that is not alphabetical. Routing that text
-- through `jsonb` on the way into this table was tried and measured: all 56
-- cells' hashes changed, none stayed. `json` round-trips the same bytes back
-- out, so a cache hit is indistinguishable from a live compute at the byte
-- level, which is the property this whole migration is judged on.
create table public.keyword_graph_cache (
  collected_date date not null,
  category_slug  text,
  category_key   text generated always as (coalesce(category_slug, '')) stored,
  graph          json not null,
  computed_at    timestamptz not null default now(),
  primary key (collected_date, category_key)
);

comment on table public.keyword_graph_cache is
  'One row per (collected_date, category_slug) holding keyword_graph''s precomputed '
  'output, written by refresh_keyword_graph_cache() after the collector stores a day''s '
  'headlines. category_slug is null for the all-categories view; category_key is the '
  'non-null coalesce that actually carries the primary key, since a null cannot sit in '
  'one. A retune of scoring_weights or word_overrides does not take effect here until '
  'the affected dates are refreshed — see docs/DEPLOYMENT.md.';

alter table public.keyword_graph_cache enable row level security;

create policy "public read keyword_graph_cache"
  on public.keyword_graph_cache for select using (true);

-- `security invoker` on purpose — see the header. A miss falls back to the
-- expensive path rather than writing the cache, so this function can stay
-- exactly as safe to expose to `anon` as keyword_graph_compute already was.
create function public.keyword_graph(p_date date, p_category text default null::text)
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
        and category_key = coalesce(p_category, '')),
    public.keyword_graph_compute(p_date, p_category)
  );
$$;

comment on function public.keyword_graph(date, text) is
  'Thin cache reader: returns keyword_graph_cache.graph when a row exists for '
  '(p_date, p_category), otherwise falls back to keyword_graph_compute(...). Never '
  'writes on a miss — that would need security definer and would let anon trigger '
  'unbounded ~2s writes. A cache miss is slow but correct.';

-- This is a brand-new function (the old OID kept the name keyword_graph_compute),
-- so Postgres and Supabase's default privileges already add PUBLIC execute plus
-- anon/authenticated/service_role on creation, the same as every function created
-- here — see 0024's header for the live ACL this produces. Named explicitly to
-- document intent, not because it is what confers access.
grant execute on function public.keyword_graph(date, text) to anon;

-- security definer for the same reason refresh_word_directory() (0030) is: this
-- writes to a table under RLS and the migration runs as the table owner, while
-- the Edge Function already connects as service_role — there is no anon view of
-- the tables being handed out, so this does not touch what the keyword_graph-chain
-- security-invoker rule protects.
create function public.refresh_keyword_graph_cache(p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cat record;
begin
  insert into public.keyword_graph_cache (collected_date, category_slug, graph, computed_at)
  values (p_date, null, public.keyword_graph_compute(p_date, null), now())
  on conflict (collected_date, category_key)
  do update set graph = excluded.graph, computed_at = excluded.computed_at;

  for cat in select slug from public.categories order by slug loop
    insert into public.keyword_graph_cache (collected_date, category_slug, graph, computed_at)
    values (p_date, cat.slug, public.keyword_graph_compute(p_date, cat.slug), now())
    on conflict (collected_date, category_key)
    do update set graph = excluded.graph, computed_at = excluded.computed_at;
  end loop;
end;
$$;

comment on function public.refresh_keyword_graph_cache(date) is
  'Recomputes and upserts all 7 keyword_graph_cache cells (all-categories plus every '
  'categories.slug) for one collected date. Called by the collector after a run, and '
  'by hand after retuning scoring_weights or word_overrides for any date whose cache '
  'should reflect the change. security definer, execute granted to service_role only '
  '- to anon it would let anyone queue unbounded ~14s writes (7 cells at ~2s each) '
  'over PostgREST.';

revoke all on function public.refresh_keyword_graph_cache(date) from public, anon, authenticated;
grant execute on function public.refresh_keyword_graph_cache(date) to service_role;
