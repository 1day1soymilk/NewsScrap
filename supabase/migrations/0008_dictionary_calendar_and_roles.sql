-- supabase/migrations/0008_dictionary_calendar_and_roles.sql
--
-- Four more words for word_overrides.exclude: 일요일, 지도부, 다음주, 대규모.
--
-- **These came off the screen rather than out of the label set**, which is a
-- looser standard than 0005's and is stated here rather than glossed over.
-- 2026-08-02 is not one of the two labelled days, so there is no label to appeal
-- to; 일요일 and 지도부 were caught by eye. What is checked is everything else:
-- each is generic in Korean generally rather than on the day it was measured
-- (0005's actual test), and the promotion chain below was measured before any
-- of them was written down.
--
-- All four pass sieve 4 on 'length' alone. That clause admits any word of three
-- characters or more, so it is the one carrying every generic word that reaches
-- the screen — neither of the other two rescues catches these: min_spec is
-- disabled, and their neighbours-per-headline run 7.25 (지도부) and 4.00
-- (일요일) against a ceiling of 1.8. This is not an argument for retuning
-- min_word_len. At 2 the sieve collapses to 24% F1 and at 4 recall falls to 16%,
-- both measured in 0003; the dictionary is the right instrument for a handful of
-- words the length clause cannot tell from proper nouns.
--
-- **The chain is why this is four words and not two.** render_cap is 70, so
-- every exclusion promotes exactly one deeper word onto the canvas. Excluding
-- only 일요일 (rank 65) and 지도부 (66) would have pulled up 다음주 (72) — a
-- calendar word replacing a calendar word — and then 대규모 (73) behind it.
-- Taking all four, 2026-08-02's drawn tail ends 쿠웨이트 · 가짜뉴스 · 갤럭시 ·
-- 까마귀 · 머스크, none of them generic, so the chain terminates here.
--
-- Measured scope: all four appear in the top 80 on 2026-08-02 only. The two
-- labelled days' tails do not move by a single rank — 2026-07-31 still ends
-- 일본은행 · 제미나이 · 젤렌스키 and 2026-08-01 still ends 오피스텔 · 우크라 ·
-- 윤용근. A sweep of the same three days for other calendar and role words
-- (관계자, 위원장, 회의, 입장, 상황, 이번주, 지난주, 올해, 내년, 이날 and the
-- rest) returned nothing else inside the top 80, so this is a bounded fix rather
-- than the first instalment of a class.
--
-- **This moves the label set.** The four words are excluded on a day that is not
-- labelled, but the drawn set on 2026-08-02 changes, and any future run of
-- 10_sieve_eval.sql must be preceded by 20_unlabeled.sql as usual. Reversible
-- with one delete; no redeploy is involved.

-- Calendar words, the same case as 오늘 and 다음 in 0003 and 작년 in 0005.
insert into word_overrides (word, mode, note) values
  ('일요일', 'exclude', 'calendar word; drawn 2026-08-02 at rank 65'),
  ('다음주', 'exclude', 'calendar word; rank 72, promoted onto the canvas by the two above')
on conflict (word) do update set mode = excluded.mode, note = excluded.note;

-- A standing body rather than an event, which is why 대통령 and 청와대 are
-- already out in 0005. 지도부 names whoever is in charge and carries no news of
-- its own: the headlines it appeared in were about 권영진 and 탈당, both of
-- which are drawn in their own right.
insert into word_overrides (word, mode, note) values
  ('지도부', 'exclude', 'standing body, not an event; drawn 2026-08-02 at rank 66')
on conflict (word) do update set mode = excluded.mode, note = excluded.note;

-- Generic modifier, the same case as 마지막 in 0005 and 최고 in 0003. Excluded
-- pre-emptively: at rank 73 it is not drawn today, and it is drawn the moment
-- the three above are removed.
insert into word_overrides (word, mode, note) values
  ('대규모', 'exclude', 'generic modifier; rank 73, promoted by the three above')
on conflict (word) do update set mode = excluded.mode, note = excluded.note;

select mode, count(*) from word_overrides group by mode order by mode;
