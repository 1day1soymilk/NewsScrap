-- scripts/analysis/01_labels_expansion.sql
--
-- Labels for every word that 20_unlabeled.sql found on screen under any
-- configuration in the harness, across 2026-07-31 and 2026-08-01. Without these
-- the harness violates rule 4 — 55 to 63 of every 70 words drawn were unlabelled,
-- so its precision figures were describing a tenth of the screen.
--
-- The line, taken from the worked examples in the plan (경찰 and 수사 are good;
-- 처리, 발언, 해제, 관측 are bad; 폭염 and 날씨 are good):
--
--   good — names what the news was about: a person, place, country, organisation,
--          company, brand, named phenomenon, or a concrete event that identifies
--          what happened.
--   bad  — vocabulary that could attach to any story on any day, calendar and
--          filler words, market and business boilerplate, and fragments of
--          compounds that ETRI split.
--
-- These are a first pass and are meant to be argued with. The borderline calls
-- are recorded below rather than hidden, because a label set nobody disagrees
-- with is usually one nobody checked.

create schema if not exists analysis;

-- People named in the day's headlines.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '한동훈','정청래','최길수','김의겸','최태원','곽상언','노무현','정몽규','머스크',
  '노태문','김용범','박지원','윤용근','장윤기','고동진'
]) w on conflict (word) do update set label = excluded.label;

-- Places and countries.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '이란','미국','중국','서울','호르무즈','이스라엘','스페인','우크라','한반도',
  '사우디','충청','아르헨','한미','구마모토','모로코','세우타','홍해','강릉'
]) w on conflict (word) do update set label = excluded.label;

-- Organisations, companies, brands and market indices.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '애플','미군','삼성','아마존','민주당','하마스','삼성전자','구글','노조',
  '카카오뱅크','테슬라','코스닥','한화오션','갤럭시','나스닥','셀트리온',
  '홈플러스','아이폰','연준','폴드','공화당','패트리엇'
]) w on conflict (word) do update set label = excluded.label;

-- Named phenomena and concrete events — the category 폭염 and 날씨 belong to.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '더위','기온','기상','태풍','가뭄','강진','파업','구속','기소','마약',
  '미사일','유조선','개헌','검수완박','돌핀','메모리'
]) w on conflict (word) do update set label = excluded.label;

-- Business and market boilerplate: present in the economy section every single
-- day regardless of what happened.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '분기','개미','사업','반기','실적','영업','폭등','기업','증시','투자','주식',
  '반등','매각','경쟁','공장','급등','데이터','레버리지','적자','주가','경제',
  '매출','성장','수익','매수','상승','금리','달러','연봉','옵션','거래','인프라',
  '클라우드','휴머노이드','게임','계약','은행','아파트','광물','국산','인터넷',
  '삼전닉스'
]) w on conflict (word) do update set label = excluded.label;

-- Generic abstract nouns: they describe an action or a state, not a subject.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '통과','전쟁','반대','공격','국민','성과','임금','기록','논란','확인','후보',
  '사건','사망','승인','합의','검사','검토','바닥','사과','호위','개혁','기각',
  '비상','위험','조정','타격','국경','문제','비행','이상','흉기','배상','부부',
  '승리','아들','격화','남편','동맹','병원','압박','인상','감시','임명','정정',
  '징계','천재','감량','거짓','검거','격추','고통','공습','나이','다툼','당원',
  '면허','배경','오인','전방','주변','징역','출신','통보','혈압','건강','경질',
  '공석','공중','군단','난입','누락','당심','대통령','피지컬'
]) w on conflict (word) do update set label = excluded.label;

-- Calendar words and filler.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '주말','가능','본격','속도','내일','연속','결국','마지막','아침','사흘','극한'
]) w on conflict (word) do update set label = excluded.label;

-- Fragments of compounds. Every one of these scores low on standalone, which is
-- the sieve-2 signal: 형소 0.00 (형사소송법), 감찰 0.00, 특별 0.00, 영업 0.00,
-- 변호 0.00, 보완 0.00, 은행 0.00, 선거 0.11, 의원 0.13, 경선 0.17, 안심 0.17,
-- 위원 0.20 (위원장/위원회).
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '형소','감찰','특별','변호','보완','선거','의원','위원','경선','안심','개정',
  '무장','민주','전대','인방','체감'
]) w on conflict (word) do update set label = excluded.label;

-- Borderline calls, recorded so they can be overturned rather than rediscovered:
--   메모리   good — a product category, but it is what the SK하이닉스 story was about
--   구속·기소 good — concrete legal events; see the open question below
--   대통령   bad  — a job title that recurs daily, closer to 정부 than to 트럼프
--   검찰     bad  — moved out of good along with 경찰 and 수사, see 00_labels.sql
--   흉기·호위 bad  — attached to a real story, but generic nouns in themselves
--   삼전닉스 bad  — market slang blending 삼성전자 and 하이닉스
--   돌핀     good — reads as a name or codename; low confidence, 3 headlines
--   피지컬   bad  — ambiguous between the TV series and 피지컬 AI

select label, count(*) from analysis.word_labels group by label order by label;
