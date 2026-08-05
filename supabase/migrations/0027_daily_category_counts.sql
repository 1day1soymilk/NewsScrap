-- 0027: what each section actually produced, per day.
--
-- The counts are the real proportions rather than an artefact of the cap: on
-- 2026-08-04 at 07:00 no section reached its 150-headline window (society 99
-- new, it 24), so what is stored is what was published. That is exactly why
-- collection cannot be equalised by paging deeper, and it is why this view can
-- be read as a share at all.
--
-- `capped` is the caveat made machine-readable. After a gap the window does
-- bind — 2026-08-03 07:00 stored exactly 150 for all six — and that section's
-- share is then a lower bound. A pie chart that cannot say so is not worth
-- drawing.
--
-- **`capped` is per run, never per day.** A day's rows are the sum of six runs
-- (and of any hand invocation), so a day-wide count crosses the cap without any
-- run having reached it: 2026-08-04's 02:00 hour holds 174 society rows against
-- a cap of 150, and that is 124+33+9+8 — five hand calls inside fourteen minutes
-- plus the 03:00 cron, none of them capped. An hour spent on that once is why
-- the run key is here rather than a `sum(...) >= cap`.
--
-- **`capped` counts rows stored, not the window scraped, and that is the larger
-- of its two blind spots.** `index.ts` upserts with `ignoreDuplicates: true`, so
-- a run that filled its whole 150-headline window and re-saw a single article it
-- already held stores 149 and gets no flag. This is not hypothetical: on
-- 2026-08-04 economy's biggest run is **exactly 149**, and its 948 headlines are
-- published here with no caveat although that run almost certainly did bind.
-- The collector records no scraped count anywhere, so there is nothing to
-- compare against and this cannot be fixed here — it would take the Edge
-- Function storing what it fetched alongside what it kept. Until then: a flag
-- means the share is a lower bound, and **the absence of a flag means nothing**.
--
-- The run key is `date_trunc('minute', created_at)`. A run stores its six
-- sections in 4-5 seconds, so a minute is coarse enough to hold one whole run
-- and fine enough to separate two crons four hours apart. The one thing it
-- cannot do is keep a run that straddles :59/:00 together, and that splits a
-- capped run into two uncapped halves — the second way this under-reports.
-- Both failures point the same way, which is the direction a caveat flag should
-- fail in: it never claims a cap that did not bind.
--
-- The comparison is `>=` rather than `=` because a run made under a different
-- cap is still evidence the window bound: 2026-08-03 07:32 UTC stored 275, 242
-- and 208 in one minute, one run at a deeper cap. The flag is therefore "may
-- have reached the limit", never "reached exactly this limit", and the UI says
-- it that way.
--
-- **Read it filtered by date.** Six rows a day reaches PostgREST's 1,000-row cap
-- in 166 days, and a silently truncated denominator is the failure this
-- repository has already paid for once.

create or replace view public.daily_category_counts
with (security_invoker = on) as
with per_run as (
  select h.collected_date as date, c.slug,
         date_trunc('minute', h.created_at) as run,
         count(*) as n
  from public.headlines h
  join public.categories c on c.id = h.category_id
  group by 1, 2, 3
)
select date, slug,
       sum(n)::int as headlines,
       -- The cap is read rather than written down. Task 8 retunes it in
       -- scoring_weights and the Edge Function reads the same row, so this
       -- cannot drift out of agreement with what the collector actually did.
       bool_or(n >= coalesce(
         (select value from public.scoring_weights where key = 'collect_cap'), 150)) as capped
from per_run
group by date, slug;

comment on view public.daily_category_counts is
  'Per-day, per-section headline counts with a per-run cap flag. Always filter by date. '
  'capped counts rows STORED, not the window scraped: index.ts upserts with '
  'ignoreDuplicates, so a run that filled its window and re-saw one held article '
  'stores 149 and is not flagged (2026-08-04 economy is exactly this). A flag means '
  'the share is a lower bound; the absence of a flag means nothing.';

grant select on public.daily_category_counts to anon;
