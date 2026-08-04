-- scripts/analysis/16_proper_noun_configs.sql
--
-- Round nine. **The question is the price of `min_word_len`, which has only
-- ever been priced in one direction.**
--
-- CLAUDE.md says the length clause is the sieve — it admits 68 of the 70 drawn
-- words and its precision is the whole sieve's — and that none of the other
-- signals separates the good words inside that group from the bad. What nobody
-- costed is what the clause *rejects*: a two-character word cannot reach the
-- canvas at all, and across the archive's whole history exactly two ever have,
-- 폭염 and 양산, both by hand in migration 0003. 이란, 중국, 미국, 북한, 삼성
-- and every two-syllable place, party and company name go out with the noise.
--
-- Length was always a proxy for "a word in its own right rather than a piece of
-- one". Migration 0017 exposes the direct answer as `proper`, the share of a
-- word's rows the analyser tagged NNP, and the reason to expect it to work is
-- specific rather than hopeful: garu tags 이란, 중국, 미국, 일본, 북한, 삼성,
-- 애플, 서울, 부산, 대구 and 인천 NNP, and **감찰, 윤리, 청문, 초등 and 순회
-- NNG** — the five words CLAUDE.md names as the reason the specificity clause
-- had to be turned off, every one of them scoring a perfect 1.00 on spec.
--
-- Three things are under comparison and they are deliberately separate, because
-- two changes measured together are one measurement:
--
--   130  the shipped sieve, unchanged, as the thing to beat
--   131  min_word_len 2 — the blunt version. Admits every two-character word.
--   132  the proper-noun rescue at 0.50, keeping length at 3
--   133  the same at 1.00, i.e. only words tagged NNP on every single row
--   134  the same at 0.25, the permissive end of the sweep
--   136  the same at 0.75
--   135  the rescue **with the dictionary off**, to see whether it is merely
--        re-catching what word_overrides already catches — the test CLAUDE.md
--        applied to the head_pos demotion and which that signal passed.
--
-- 131 is not expected to win and is here because it is the honest baseline: if
-- admitting all two-character words scored as well as admitting the NNP ones,
-- the tagger would be adding nothing and the simpler rule should win.
--
--   scripts/analysis/run.sh scripts/analysis/16_proper_noun_configs.sql
--
-- **Then re-run 20_unlabeled.sql and 21_unlabeled_category.sql**, both of which
-- read the active rows here. Widening the sweep promotes words that have never
-- been on screen, and two-character words have *never* been on screen, so this
-- round will promote more of them than any round so far. Rule 4, as ever.

alter table analysis.sieve_configs
  add column if not exists min_proper numeric not null default 9.90;

insert into analysis.sieve_configs
  (ord, name, min_headlines, min_standalone, min_word_len, min_spec, max_npd,
   demote_head_pos, min_proper, use_dict)
values
  (130, 'r9: shipped (len3, demote .70)',  3, 0.10, 3, 9.90, -1.0, 0.70, 9.90, true),
  (131, 'r9: min_word_len 2',              3, 0.10, 2, 9.90, -1.0, 0.70, 9.90, true),
  (132, 'r9: len3 or proper >= .50',        3, 0.10, 3, 9.90, -1.0, 0.70, 0.50, true),
  (133, 'r9: len3 or proper = 1.00',        3, 0.10, 3, 9.90, -1.0, 0.70, 1.00, true),
  (134, 'r9: len3 or proper >= .25',        3, 0.10, 3, 9.90, -1.0, 0.70, 0.25, true),
  (135, 'r9: len3 or proper >= .50, no dict', 3, 0.10, 3, 9.90, -1.0, 0.70, 0.50, false),
  (136, 'r9: len3 or proper >= .75',        3, 0.10, 3, 9.90, -1.0, 0.70, 0.75, true)
on conflict (ord) do update set
  name = excluded.name,
  min_headlines = excluded.min_headlines,
  min_standalone = excluded.min_standalone,
  min_word_len = excluded.min_word_len,
  min_spec = excluded.min_spec,
  max_npd = excluded.max_npd,
  demote_head_pos = excluded.demote_head_pos,
  min_proper = excluded.min_proper,
  use_dict = excluded.use_dict;

update analysis.sieve_configs set active = (ord between 130 and 136);

select ord, name, min_word_len, min_proper, use_dict, active
from analysis.sieve_configs where active order by ord;
