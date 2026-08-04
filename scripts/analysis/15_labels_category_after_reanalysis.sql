-- scripts/analysis/15_labels_category_after_reanalysis.sql
--
-- The other half of rule 4 after the analyser swap. `14_labels_after_reanalysis.sql`
-- cleared `20_unlabeled.sql`, the day-wide worklist, and that left
-- `21_unlabeled_category.sql` returning **232** words — because a category tab
-- ranks inside one section, so words that never come near the day's top 70
-- reach a tab's screen easily. `11_category_eval.sql` was printing `unlab`
-- between 20 and 41 against `shown` 70, which by the README's rule 1 makes
-- every one of its 120 rows meaningless.
--
-- Both worklists were empty before the re-analysis (README, round six). Nothing
-- about the sieve moved; the words underneath did.
--
-- **The operational form of the line, and it is the one that settled the hard
-- cases:** would this word appear in a randomly chosen other week's news? 압수수색
-- and 유상증자 and 본회의 would, every week, so they are bad however specific the
-- story that produced them. 문자통보 and 미장착 and 보릿돌교 would not.
--
--   scripts/analysis/run.sh scripts/analysis/15_labels_category_after_reanalysis.sql

-- People. Not arguable.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '김동관', '김병기', '이준석', '강득구', '조경태', '주진우', '김동선', '추경호',
  '황명선', '민형배', '조수미', '소로스', '연산군', '차가원'
]) w on conflict (word) do update set label = excluded.label;

-- 마리아 and 칼라스 are the two halves of one name — 마리아 칼라스 — split at the
-- space, which is what the eojeol rule does to a two-word name and always will.
-- Both are good because both are the person; that they arrive separately is a
-- fact about spacing, not about the words.
insert into analysis.word_labels (word, label, note)
select w, 'good', 'half of 마리아 칼라스; the eojeol rule splits two-word names'
from unnest(array['마리아', '칼라스']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- Companies and brands.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '아스트라제네카', '에쓰오일', '한화솔루션', '현대제철', '알리바바', '마이크론',
  'NH투자증권', 'LB세미콘', '대신증권', '롯데카드', '르노코리아', '우리은행',
  '체리차', '마이바흐'
]) w on conflict (word) do update set label = excluded.label;

-- Organisations and units — 민주당 and 윤리위 are already good, and these are
-- the same kind of thing: a body that can be named, not a role someone holds.
-- The distinction from the role nouns further down is exactly that: 경찰청 is an
-- organisation, 경찰관 and 공무원 are jobs.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '혁신당', '노사모', '경찰청', '국과수', '방첩사', '국방부', '기후부', '우주청',
  '해병대', '국방방첩본부', '공무원노조', '경찰직협', '주일미군', '1군단'
]) w on conflict (word) do update set label = excluded.label;

-- Named works, products and programmes.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '오디세이', '파친코', '스파이더맨', '로보틱스2', '성장사다리',
  '국가AI컴퓨팅센터', 'AI컴퓨팅센터'
]) w on conflict (word) do update set label = excluded.label;

-- Places where something particular happened. 보릿돌교 is the bridge that
-- collapsed in Pohang and 왕십리역 the station; 대프리카 is Daegu under the
-- record heat, a nickname the heatwave story made. 솔라시도 is where the AI
-- centre broke ground. Contrast 아시아, 동남아, 중남미, 지구촌, 전남광주 below,
-- which are regions any week's news can be about — 수도권's family.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '대프리카', '솔라시도', '왕십리역', '보릿돌교', '필리핀', '캐나다'
]) w on conflict (word) do update set label = excluded.label;

-- The particular point of one dated dispute — 거부권 and 보완수사권's family.
-- 문자통보 is how the US notified Seoul of the drone flight, 미장착 and
-- 실탄장착 and 중기관총 and 경계작전 are the 1군단 controversy, 사이드카 the
-- circuit breaker that fired on one day. None of them would appear in another
-- week's news, which is the test.
insert into analysis.word_labels (word, label, note)
select w, 'good', 'arguable: an act, not a name — but not one another week would print'
from unnest(array[
  '문자통보', '미장착', '실탄장착', '경계작전', '중기관총', '美무인기', '美국채',
  '대이란', '사이드카', '순환인사제', '번호이동', '선호투표', '루사급'
]) w on conflict (word) do update set label = excluded.label, note = excluded.note;

-- The heatwave's own vocabulary. 폭염 is already good as the story's name, and
-- these name the same event rather than describe hot weather in general —
-- which is why 찜통더위 is **bad** below and these are not.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['극한폭염', '온열질환', '수족구병']) w
on conflict (word) do update set label = excluded.label;

-- Sectors a dated story is about — 반도체's argument. 李정부 names one
-- government the way 李대통령 names one president.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['K조선', '李정부']) w
on conflict (word) do update set label = excluded.label;

-- ---------------------------------------------------------------------------
-- Everything else: 157 words that would read the same in any other week.
-- ---------------------------------------------------------------------------

-- Roles and titles. The 대통령 / 의원 / 경찰관 / 이용자 / 피해자 family, which
-- says who someone is and never what happened. 수석부회장, 부위원장, 위원장,
-- 정책실장, 형사과장, 형사팀장, 검찰총장 are the same with a rank attached —
-- 1군단장 and 수사팀장 were labelled bad on exactly this ground in round five.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '관계자', '검찰총장', '공무원', '관광업계', '버스기사', '부사관', '사무관',
  '사장님', '수석부회장', '실무자', '여직원', '용의자', '위원장', '부위원장',
  '정책실장', '형사과장', '형사팀장', '입주민대표', '제약사', '대기업', '증권가',
  '이민자', '탈북민', '초등생', '청소년', '한국인', '희생자', '배신자'
]) w on conflict (word) do update set label = excluded.label;

-- Legal and corporate procedure. Every one of these happens somewhere every
-- week: an arrest, a raid, a rights issue, a plenary session. That the archive
-- can point at the particular one is not the test — 압수수색 is what the story
-- did, never what it was about.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '강제추행', '명예훼손', '압수수색', '불송치', '본회의', '이사회', '공천권',
  '유상증자', '중간배당', '자사주', '예탁금', '단일종목', '매각설', '재건축',
  '금리인상', '금융위기', '국제유가', '보험금', '양도세', '의료비', '지원금',
  '기부물품', '계약구조', '사전예약', '기간제', '중간선거', '투표율', '절대평가'
]) w on conflict (word) do update set label = excluded.label;

-- Numbers and the words for them — 상한가, 출하량, 영업익, 지지율's family. A
-- story reports these; it is not about them.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '2.3만주', '2단계', '2만장', '2순위', '3파전', '49만원', 'D램값', '상승률',
  '점유율', '수익성', '고수익', '경쟁력', '기업가치', '최고치', '저수율',
  '판매량', '수수료', '자금난', '일주일'
]) w on conflict (word) do update set label = excluded.label;

-- Generic abstractions and qualifiers — 가능성, 시험대, 승부수, 막바지, 무방비.
-- 시간문제 and 초읽기 and 재점화 say a thing is近 or resumed and nothing about
-- which thing; 서프라이즈, 대혼란, 딜레마, 리스크, 기대감, 눈높이, 정체성,
-- 인과관계 are the same move in the abstract.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '시간문제', '초읽기', '재점화', '서프라이즈', '대혼란', '딜레마', '리스크',
  '기대감', '눈높이', '정체성', '인과관계', '순식간', '날벼락', '한마디',
  '빨간불', '대리전', '추격전', '최전방', '반노동', '고속도로'
]) w on conflict (word) do update set label = excluded.label;

-- Weather and season words that are not this event's name. 찜통더위 and 소나기
-- and 자외선 and 선풍기 and 내일날씨 would print in any July; 극한폭염 and
-- 온열질환, above, would not print in a July without this heatwave.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '찜통더위', '소나기', '자외선', '선풍기', '내일날씨', '출근길', '저수지'
]) w on conflict (word) do update set label = excluded.label;

-- Regions and countries as backdrop — 수도권 and 경남권's family. A place is
-- good when the story happened *there* and bad when it is merely where the
-- subject lives.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '아시아', '동남아', '중남미', '지구촌', '대한민국', '전남광주', '지구대',
  '백화점', '길바닥', '관리사무소', '브랜드센터', '사업부', '단톡방'
]) w on conflict (word) do update set label = excluded.label;

-- Product and technology categories with no dated story of their own. These are
-- where 반도체's argument runs out: 신제품 and 세탁가전 and 하이브리드 and
-- 생태계 name a shelf, not a subject. 반도체주 and 소부장 are the sector
-- rewritten as a trading category, which is 상한가 again.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '신제품', '세탁가전', '하이브리드', '생태계', '수익화', '저전력', '첨단소재',
  '우주부품', '비만약', '공급망', '반도체주', '소부장', '카지노', '라이프',
  '곰팡이', '심정지', '합병증', '전투기', '방화사건', '합동감식', '기부물품',
  '손가락', '집문서', '택시비', '특별상', '최고위', '공무원노조'
]) w on conflict (word) do update set label = excluded.label;

-- **Section tags and edition markers.** Every headline carrying one of these
-- ends in it, in brackets or parentheses: [뉴시스Pic], [배틀라인], [이슈톺],
-- [손바닥 부동산], (종합2보). They are the newspaper's furniture, attached to a
-- story rather than part of one — 북리뷰, 주末머니 and Y녹취록 already sit here.
-- The tell is worth keeping: `spec` 1.00 plus every headline sharing a
-- bracketed suffix means a section, not a subject.
insert into analysis.word_labels (word, label, note)
select w, 'bad', 'section tag in brackets, like 북리뷰 — not part of any story'
from unnest(array['뉴시스Pic', '배틀라인', '이슈톺', '손바닥', '종합2', '현장영상', '리포트']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- **Fragments the analyser left behind**, and they are the honest cost of the
-- eojeol rule. 주52 is 주52시간 cut at the digit, 청대전 is 명청대전 without its
-- first syllable, 한화M is 한화M&S truncated at the ampersand, 양극째 does not
-- occur in its own headline at all (양극재 does). All four score `standalone`
-- 0.00 or near it, which is the signal doing its job — they reach a category
-- tab only because a tab ranks inside one section.
insert into analysis.word_labels (word, label, note)
select w, 'bad', 'fragment: standalone ~0.00, no whole word behind it'
from unnest(array['주52', '청대전', '한화M', '양극째', '아메리칸', '팩토리', '전년比', '中사업', '2단계']) w
on conflict (word) do update set label = excluded.label, note = excluded.note;

-- Two the grouping above missed on the first pass, caught by re-running
-- 21_unlabeled_category.sql — which is the whole reason the worklist is a query
-- rather than a list someone keeps. 쌍둥이 is a figure of speech in a politics
-- headline and 패키징 a step in chip manufacture; both are any-week words.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['쌍둥이', '패키징']) w
on conflict (word) do update set label = excluded.label;

select
  (select count(*) from analysis.word_labels) as labels_total,
  (select count(*) from analysis.word_labels where label = 'good') as good,
  (select count(*) from analysis.word_labels where label = 'bad') as bad;
