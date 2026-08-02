-- supabase/migrations/0009_disable_neighbors_clause.sql
--
-- Turn sieve 4c off. max_neighbors_per_doc goes from 1.8 to -1, which nothing
-- can satisfy — the same "push it out of range" convention min_spec already
-- uses at 9.9, and the one 02_sieve_configs.sql documents.
--
-- Sieve 4 is a disjunction of three rescues and this is the second of them to
-- be retired. What is left is the length clause, plus 'allow' entries.
--
-- Measured with scripts/analysis/10_sieve_eval.sql, unlabeled 0 on both days
-- after 08_labels_after_dedup.sql:
--
--   config                          07-31 good/bad  F1     08-01 good/bad  F1
--   no spec, npd 1.8   (shipped)      59 / 11      70.7      57 / 13      65.5
--   no spec, no npd  (this)           59 / 11      70.7      59 / 11      67.8
--
-- Tied on one day, +2.3 F1 on the other, and the day's biggest story holds
-- rank 1 in both — never worse. The exact exchange on 2026-08-01 is 공습 and
-- 버블 out, 이탈리아 and 장동혁 in; 2026-07-31 does not move at all. It is a
-- small clause: it was the only thing admitting 2 or 3 words a day.
--
-- 'no spec, no npd, standal .30' scores identically (59/11 on both days), and
-- the simpler of two tied configurations wins. Raising min_standalone as well
-- would be a second change buying nothing.
--
-- **The insurance placed in 0003 is what makes this safe.** 폭염 and 양산 are
-- the two words a retune of this clause was most likely to lose, and they carry
-- 'allow' entries written for exactly this moment. They keep their place; their
-- passed_by simply becomes 'allow' instead of 'neighbors'.
--
-- One cost, recorded rather than argued away. On 2026-08-02 — not a labelled
-- day, so not evidence — 탈당 leaves along with 자폭 and 흉기, and 무인기,
-- 미사일 and 반대표 arrive. 탈당 was the hub of that day's second event
-- (권영진 · 탈당 · 지도부, 36 headlines), and with 지도부 already removed by
-- 0008 the event leaves the canvas entirely. The labelled days govern the
-- decision, but the shape of the loss is worth knowing.
--
-- Reversible with one update; no redeploy is involved.

update scoring_weights
set value = -1,
    note = 'sieve 4c: DISABLED — 0009. 1.8 lost 2 good words on 2026-08-01 and gained nothing on 07-31'
where key = 'max_neighbors_per_doc';

select key, value, note from scoring_weights order by key;
