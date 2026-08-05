-- 0028: the place gate goes on, against the harness and on purpose.
--
-- **This overrules 0026, which is two migrations old and was right about what it
-- measured.** Nothing about that measurement has been retracted: the gate still
-- costs day-wide mean F1 63.70 -> 62.67 and the 24 category cells 78.58 -> 75.22,
-- and every one of the eleven words it removes is still labelled good. What
-- changed is that the screen was finally looked at, and the labels turned out to
-- be answering a different question from the one the gate was built for.
--
-- The owner asked for the gate in the first place, on this rule, which is his
-- wording and is the rule implemented: **a place is drawn only when a line joins
-- it to a word that is not a place.** Place-to-place is not a reason to stay.
--
--
-- ## What the screen showed that the harness could not
--
-- Two views of 2026-08-03, all categories, live data, one flip apart. The gate
-- removes 서울, 광주, 인천, 포항, 울산 and 강원 and keeps 부산, 대구, 경남 and
-- 충청 — and the four it keeps are exactly the four that sit inside a story
-- (부산 with 노무현·김용민·돌려차기, 대구 with 경산·경북, 경남 with 양산, 충청
-- with 김민석), while the six it drops touched nothing or touched only each other.
--
-- **The decisive difference is in the event list rather than on the canvas.**
-- With the gate off, the day's **fourth-largest event is "서울 · 광주", 66
-- headlines** — two place names joined to each other and to nothing else. There
-- is no way to find out what those 66 articles are about: the list does not say,
-- and the canvas does not either, because neither word is attached to anything
-- that names a subject. With the gate on that row is gone and
-- "미국 · 중국 · 기아 · 정의선 외 2", 57 headlines, takes its place. That one can
-- be read.
--
-- `analysis.word_labels` cannot see any of this. It answers "is this a word worth
-- showing", and 서울 and 광주 are each independently worth showing, which is
-- exactly why removing them costs F1. The question the gate was asked on is "can
-- a reader do anything with a word no line touches", and no label set prices it.
-- 0026 says this in as many words and still declines the gate, because a
-- measurement is what this project moves thresholds on. This file is the case
-- where the judgement is taken instead — knowingly, with the cost stated, and
-- reversible in one row.
--
--
-- ## What it costs, restated so nobody has to re-derive it
--
-- - **F1 and precision**, as above. The gate loses at every cap measured.
-- - **The promoted words are not free.** Over the four evaluation days it
--   promotes ten: six good (경계작전, 공화당, 김동관, 김병기, 김용, 한반도) and
--   four bad (단일종목, 반도체주, 고속도로, 대공습).
-- - **A thin day pays and gains nothing.** 2026-08-02 qualifies only 69 words
--   against a cap of 70, so the cap does not bind: dropping 부산 there promotes
--   nobody and simply leaves the screen one word shorter. That is the clean case
--   0024's header already named.
-- - **About 1.5x on the all-categories view** — 2026-08-03, one sitting:
--   0018 1,403 ms, gate off 1,342 ms, gate on 2,056 ms. Those three may be read
--   against each other and against nothing else.
--
-- Turning it back off is this file's own statement with the value inverted, and
-- needs no redeploy. `docs/DEPLOYMENT.md` carries the one-liner both ways.

update public.scoring_weights
set value = 1,
    note = 'sieve 6: ON since 0028. A word_overrides place is drawn only when a '
        || 'drawn line joins it to a non-place; place-to-place does not count. '
        || 'Shipped AGAINST the harness and deliberately: it costs day-wide mean '
        || 'F1 63.70 -> 62.67 and the 24 category cells 78.58 -> 75.22, and all '
        || 'eleven words it removes are labelled good. The harness cannot price '
        || 'the question it was built for — analysis.word_labels answers "is this '
        || 'word worth showing", not "can a reader do anything with a word no '
        || 'line touches". On 2026-08-03 the gate removes the day''s '
        || 'fourth-largest event, "서울 · 광주" at 66 headlines, which is two '
        || 'places joined only to each other and names no subject a reader could '
        || 'follow. Costs about 1.5x on the all view (1,342 ms -> 2,056 ms, one '
        || 'sitting). See 0026 for the measurement it overrules and 0024 for the '
        || 'fixed point that implements it.'
where key = 'place_needs_edge';

-- The measurement that lost is not deleted, only overruled: 0026's own note on
-- the other three keys stands untouched, and this row's previous text survives in
-- 0026 for anyone reading the migrations in order.
