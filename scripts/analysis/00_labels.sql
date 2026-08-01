-- scripts/analysis/00_labels.sql
--
-- The label set the sieve harness scores against: is this word a keyword a
-- reader would want to see, or is it noise?
--
-- Kept in its own schema so it never touches the app's tables or its RLS model.
-- PostgREST only exposes public, so nothing here is reachable from the browser.
--
-- WARNING: this set is INCOMPLETE. The planning stage measured against 343
-- labelled words; those labels lived only in a chat transcript and are gone. What
-- follows is the subset recoverable from the plan document — every word it named
-- along with a verdict. The harness prints an `unlabeled` column for exactly this
-- reason: any row where it is non-zero is measuring a fraction of the screen and
-- must be thrown away (rule 4 in README.md).

create schema if not exists analysis;

create table if not exists analysis.word_labels (
  word  text primary key,
  label text not null check (label in ('good', 'bad')),
  note  text
);

-- 'good' — a real subject: a person, place, organisation, or the name of an event.
insert into analysis.word_labels (word, label, note) values
  ('폭염',     'good', 'biggest story of 2026-07-31, 45 headlines'),
  ('양산',     'good', 'place, same story'),
  ('경남',     'good', 'place, same story'),
  ('날씨',     'good', null),
  ('트럼프',   'good', null),
  ('국힘',     'good', 'not a fragment — headlines write it this way'),
  ('코스피',   'good', null),
  ('김민석',   'good', null)
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- 'bad', recurring institutions and procedures. The plan treated 경찰 and 수사 as
-- good words, but that does not survive contact with the signals: 경찰 sits at
-- 6.56 distinct neighbours per headline and 수사 at 5.17, the loosest
-- neighbourhoods of the day. That is YAKE's signature for a word that attaches to
-- a different set of words every time — here, every unrelated crime story of the
-- day — rather than naming any one of them. They recur daily whatever the news
-- is, which puts them with 정부 rather than with 트럼프.
--
-- The plan's evidence for 수사 was one passing remark that paired it with 뉴스 as
-- a "normal word scoring low on standalone", and 뉴스 is in its own exclude seed.
insert into analysis.word_labels (word, label, note) values
  ('경찰', 'bad', '6.56 neighbours per headline'),
  ('수사', 'bad', '5.17 neighbours per headline'),
  ('검찰', 'bad', 'same case as 경찰')
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- 'bad', fragments — a piece of a compound that ETRI split. Phase 1's eojeol
-- merge fixes these at collection time, so they should disappear from data
-- collected after it deploys, but the 7/31 and 8/1 archives still carry them.
insert into analysis.word_labels (word, label, note) values
  ('도체',     'bad', '반도체'),
  ('무인',     'bad', '무인기'),
  ('알뜰',     'bad', '알뜰폰'),
  ('상한',     'bad', '상한가'),
  ('하이닉스', 'bad', 'SK하이닉스'),
  ('하닉',     'bad', 'SK하이닉스, abbreviated'),
  ('경리',     'bad', 'fragment'),
  ('한화에어', 'bad', '한화에어로스페이스'),
  ('스페이스', 'bad', '한화에어로스페이스')
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- 'bad', generic — words that are generic in Korean generally, not merely on the
-- day they were measured. That is what makes labelling them safe rather than
-- overfitting to one day's news.
insert into analysis.word_labels (word, label, note) values
  ('최고',       'bad', null),
  ('역대',       'bad', null),
  ('사상',       'bad', null),
  ('최대',       'bad', null),
  ('한국',       'bad', 'specificity 0.039'),
  ('확대',       'bad', 'neighbours 4.50 in planning-stage units'),
  ('전국',       'bad', null),
  ('정부',       'bad', null),
  ('시장',       'bad', null),
  ('공개',       'bad', null),
  ('관측',       'bad', null),
  ('추천',       'bad', null),
  ('파괴',       'bad', null),
  ('해제',       'bad', null),
  ('폐지',       'bad', null),
  ('생산',       'bad', null),
  ('예약',       'bad', null),
  ('주장',       'bad', null),
  ('처리',       'bad', null),
  ('발언',       'bad', null),
  ('문자',       'bad', null),
  ('글로벌',     'bad', null),
  ('스마트',     'bad', null),
  ('시스템',     'bad', null),
  ('서비스',     'bad', null),
  ('플랫폼',     'bad', null),
  ('포인트',     'bad', null)
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- 'bad', site furniture — Naver column and section names, never about the news.
insert into analysis.word_labels (word, label, note) values
  ('뉴스',       'bad', null),
  ('자막',       'bad', null),
  ('기사',       'bad', 'half of its 11 headlines are 버스기사/배달기사'),
  ('오늘',       'bad', null),
  ('다음',       'bad', null),
  ('이유',       'bad', null),
  ('하루',       'bad', null),
  ('시간',       'bad', null),
  ('북리뷰',     'bad', 'column name'),
  ('밀리터리',   'bad', 'column name'),
  ('헬시타임',   'bad', 'column name')
on conflict (word) do update set label = excluded.label, note = excluded.note;

select label, count(*) from analysis.word_labels group by label order by label;
