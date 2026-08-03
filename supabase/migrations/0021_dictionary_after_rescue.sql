-- 0021: 36 dictionary exclusions, chosen from what the rescue left on screen.
--
-- The largest gain of the four changes that followed migration `0018`, and the
-- cheapest — no threshold moves and no signal is added.
--
--   day-wide, four days, unlabeled 0, story_rank 1:
--     before   mean F1 54.10   mean precision 77.85
--     after    mean F1 62.43   mean precision **90.35**
--   category tabs, 24 cells:
--     before   67.02
--     after    71.80
--
-- **Chosen the way `0005` chose its 26, not by looking at the canvas**: every
-- word here is labelled bad in `analysis.word_labels`, is drawn by the shipped
-- sieve on at least one of the four days, and is not already in the dictionary.
-- That query returned 44; these are 36 of them.
--
-- **The eight left in are the point of the exercise.** 부동산, 아파트, 에너지,
-- 스마트폰, 무인기, 요양병원, 재선거 and 개정안 can each head a real story, and
-- excluding them would be using the dictionary to paper over where the good-word
-- line sits — which is a labelling question, not a dictionary one. That is the
-- same judgement `0005` made about 공습, 압박, 배터리, 클라우드, 바이오 and
-- 휴머노이드, and it is why the dictionary is not simply "every bad word".
--
-- Six of the entries are new in kind rather than new in name, and they exist
-- because of the rescue: 유럽, 남미, 중동, 한국, 어스, 모스 and 민주 all reach
-- the canvas through `passed_by = 'proper'`. A region is backdrop rather than
-- subject (수도권's family), 한국 is the country the paper is published in, and
-- 어스, 모스 and 민주 are the halves of 구글 어스, 모스크바 and 민주당 that the
-- tagger calls proper nouns.
--
-- Rule 4 was re-run and returned nothing: an exclusion promotes whatever sat at
-- rank 71, and on these four days everything promoted was already labelled. That
-- is luck rather than design — `0005` excluded 26 and promoted 7, all bad, all
-- unlabelled — so re-run `20_unlabeled.sql` after any dictionary edit regardless.

insert into public.word_overrides (word, mode, note)
select w, 'exclude', 'role or title — names who someone is, never what happened'
from unnest(array[
  '당대표', '반대표', '최고위원', '수사팀장', '경제라인', '투표자', '외국인',
  '사망자', '美대사'
]) w on conflict (word) do update set mode = excluded.mode, note = excluded.note;

insert into public.word_overrides (word, mode, note)
select w, 'exclude', 'place as backdrop, not where the story happened — 수도권''s family'
from unnest(array['유럽', '남미', '중동', '경남권', '한국']) w
on conflict (word) do update set mode = excluded.mode, note = excluded.note;

insert into public.word_overrides (word, mode, note)
select w, 'exclude', 'a number a story reports rather than the story — 상한가''s family'
from unnest(array['10조', '3분기', '상반기', '출하량', '영업익', '성과급', '레버리지']) w
on conflict (word) do update set mode = excluded.mode, note = excluded.note;

insert into public.word_overrides (word, mode, note)
select w, 'exclude', 'generic abstraction or qualifier — 가능성, 시험대, 막바지'
from unnest(array['역대급', '뉴노멀', '승부수', '차세대', '거짓말', '놀이터', '회삿돈']) w
on conflict (word) do update set mode = excluded.mode, note = excluded.note;

-- Fragments the eojeol rule leaves behind, plus three the tagger calls proper
-- nouns: 어스 is 구글 어스, 모스 is 모스크바, 민주 is 민주당. 하이닉스 and
-- SK하닉 are both SK하이닉스, which is drawn whole beside them.
insert into public.word_overrides (word, mode, note)
select w, 'exclude', 'fragment of a longer word that is itself on the canvas'
from unnest(array[
  'SK하닉', '하이닉스', '어스', '모스', '민주', '보완수사', '수사권', '컴퓨팅센터'
]) w on conflict (word) do update set mode = excluded.mode, note = excluded.note;

select mode, count(*) from public.word_overrides group by mode order by mode;
