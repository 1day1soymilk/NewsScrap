-- supabase/migrations/0013_dictionary_person_categories.sql
--
-- 이용자 and 피해자 to the exclusion list.
--
-- Both were drawn on 2026-08-03 — 피해자 at rank 41 and 이용자 at 67 — and both
-- were already labelled bad by 09_labels_four_days.sql, in the group that holds
-- 국민, 외국인, 사망자, 온열질환자 and 투표자. A label is only the harness's
-- ground truth, though; it is word_overrides that decides what reaches a screen.
--
-- They name a role rather than anyone in it. 피해자 heads a headline about
-- whatever crime it belongs to and says nothing about which; the word that
-- carries that story is the crime, the place or the person, and those are drawn
-- beside it. The same case as 환자 and 신입, and the same case the dictionary
-- already made for 지도부 — a standing category, not an event.
--
-- Measured before applying, README's rule that the dictionary is measured too:
--
--   Only 2026-08-03 moves, because neither word reaches the top 70 on the other
--   three days. There: precision 62.9 -> 65.7, F1 56.1 -> 58.6, and the two
--   words promoted into the freed slots are 탄도미사일 (rank 69) and 합수본
--   (rank 70) — **both labelled good**. Two bad words out, two good words in.
--
--   `unlabeled` stays 0 on every row, so rule 4 is satisfied without new
--   labelling. That is luck rather than design: migration 0005 excluded 26 words
--   and promoted 7, all of them bad. An exclusion does not empty a slot, it
--   promotes whatever was next, and what comes next has to be labelled before
--   the next harness run means anything.
--
-- These two are not part of the 35 labelled-bad words the README keeps out of
-- the dictionary on purpose. Those — 공습, 압박, 배터리, 클라우드 — can each head
-- a story of their own, and excluding them would use the dictionary to settle
-- where the good-word line sits. A role noun cannot head anything.

insert into word_overrides (word, mode, note) values
  ('이용자', 'exclude', 'role, not an event; drawn 2026-08-03 at rank 67'),
  ('피해자', 'exclude', 'role, not an event; drawn 2026-08-03 at rank 41')
on conflict (word) do update
  set mode = excluded.mode, note = excluded.note;
