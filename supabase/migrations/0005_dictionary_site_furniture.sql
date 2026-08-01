-- supabase/migrations/0005_dictionary_site_furniture.sql
--
-- 26 more words for word_overrides.exclude.
--
-- Same standard as the seed in 0003: every entry is a word the sieve draws and
-- the label set calls bad, and every one is generic in Korean generally rather
-- than on the day it was measured. A word that is empty today but could head a
-- real story next week does not belong here — that is what the sieve is for.
--
-- The candidates were taken from the 61 labelled-bad words that clear the
-- shipped sieve on 2026-07-31 or 2026-08-01, not from whatever caught the eye on
-- screen. Thirty-five of those 61 are deliberately left in: 공습, 압박, 배터리,
-- 클라우드, 바이오, 휴머노이드, 부동산, 아파트 and the rest can each head a real
-- story, and excluding them would be using the dictionary to paper over where
-- the good-word line sits.
--
-- 피지컬 was dropped from the list on reading its headline — "피지컬 AI·금융
-- AX·GPU 인프라로 하반기 승부" — where it is part of a real technical term
-- rather than boilerplate.

-- Column and section tags. Naver brackets these and they run every day
-- regardless of the news, which is the same case as 뉴스 and 자막 in 0003.
-- Confirmed from the headlines: "[밀리터리+]", "[북리뷰]", "[헬시타임]",
-- "[클로즈업 북한]", "[은퇴 레시피]", "[오늘날씨]".
insert into word_overrides (word, mode, note) values
  ('자막뉴스',  'exclude', 'column tag'),
  ('오늘날씨',  'exclude', 'column tag'),
  ('클로즈업',  'exclude', 'column tag'),
  ('레시피',    'exclude', 'column tag'),
  ('북리뷰',    'exclude', 'column tag'),
  ('밀리터리',  'exclude', 'column tag'),
  ('헬시타임',  'exclude', 'column tag'),
  ('인터뷰',    'exclude', 'media furniture')
on conflict (word) do update set mode = excluded.mode, note = excluded.note;

-- Calendar and reporting periods. 마지막 is the odd one out only in looking
-- specific: "마지막 실적발표" is a modifier, not a subject.
insert into word_overrides (word, mode, note) values
  ('작년',   'exclude', 'calendar word'),
  ('하반기', 'exclude', 'reporting period'),
  ('2분기',  'exclude', 'reporting period'),
  ('마지막', 'exclude', 'generic modifier')
on conflict (word) do update set mode = excluded.mode, note = excluded.note;

-- Standing institutions and roles: they name the office rather than the news,
-- and they recur every single day. 정부 and 시장 are already labelled bad for
-- the same reason.
insert into word_overrides (word, mode, note) values
  ('대통령', 'exclude', 'standing office, drawn on both measured days'),
  ('청와대', 'exclude', 'standing institution')
on conflict (word) do update set mode = excluded.mode, note = excluded.note;

-- Technology and business boilerplate. Each of these was drawn on both measured
-- days, which is the evidence that they recur independently of the news.
insert into word_overrides (word, mode, note) values
  ('글로벌',   'exclude', 'boilerplate, both days'),
  ('데이터',   'exclude', 'boilerplate, both days'),
  ('인프라',   'exclude', 'boilerplate, both days'),
  ('플랫폼',   'exclude', 'boilerplate, both days'),
  ('시스템',   'exclude', 'boilerplate, both days'),
  ('서비스',   'exclude', 'boilerplate, both days'),
  ('빅테크',   'exclude', 'boilerplate, both days'),
  ('포인트',   'exclude', 'index boilerplate: "코스피 장중 1000포인트"'),
  ('모바일',   'exclude', 'boilerplate'),
  ('인터넷',   'exclude', 'boilerplate')
on conflict (word) do update set mode = excluded.mode, note = excluded.note;

-- Compound fragments the eojeol merge did not rejoin. Both are named in 0003's
-- own commentary: a fragment sits in one context and so scores a perfect
-- specificity, which is why the sieve cannot catch them.
insert into word_overrides (word, mode, note) values
  ('스마트', 'exclude', 'fragment of 스마트폰'),
  ('감찰',   'exclude', 'fragment of 특별감찰관; named in 0003')
on conflict (word) do update set mode = excluded.mode, note = excluded.note;

select mode, count(*) from word_overrides group by mode order by mode;
