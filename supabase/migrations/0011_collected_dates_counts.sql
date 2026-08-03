-- The day's headline total is a denominator the surge comparison needs for both
-- the day on screen and the previous collected day, and it was being fetched as
-- two `HEAD ... count=exact` requests per view. This view is already read once
-- per load for the date picker and holds exactly one row per collected day, so
-- it can carry the number instead.
--
-- `create or replace view` may only append columns — never rename, reorder or
-- drop them — and `collected_date` stays first, so every existing
-- `select('collected_date')` keeps working. Replacing in place rather than
-- dropping preserves the grant and the security_invoker setting from
-- 0001_init_schema.sql.
--
-- count(*) grouped by collected_date is exactly what fetchHeadlineCount counted:
-- every headline of that day, all six sections, no category filter. Postgres
-- computes it, so this is not the forbidden pattern of summing a response.
create or replace view collected_dates with (security_invoker = on) as
select collected_date, count(*)::bigint as headline_count
from headlines
group by collected_date;
