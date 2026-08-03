-- scripts/analysis/09_labels_four_days.sql
--
-- The 138 words that 20_unlabeled.sql and 21_unlabeled_category.sql returned
-- once the harness was widened from two collected days to four (12_eval_days.sql)
-- and round four was added to 02_sieve_configs.sql.
--
-- Rule 4, twice over: the sweep widened *and* the data moved. 2026-08-02 and
-- 2026-08-03 are new to the harness and are the only two days collected after
-- both the noun-merge fix and the canonical-link dedup, so they draw a partly
-- different vocabulary from the two days the label set was built on.
--
-- Every label below follows a line the existing set has already drawn. The
-- groups are the reasons, and each names the words it is following.
--
-- Two rulings that decide the round this file exists for:
--
--   골리앗 is bad, and that closes half the standalone question. It looked like
--   a whole word wrongly cut by sieve 2 (골리앗의 scores 0.00 because Korean
--   attaches 의 with no space). It is: the cut is wrong about it. But four of
--   its five headlines across three days are the same book — 『골리앗의 저주』
--   in [북리뷰], [북스&] and [Book] — and both 북리뷰 and 저주 are already
--   labelled bad. Rescuing it would put a book-column title on the canvas.
--
--   자국민 is bad for the reason 국민 is, which closes the other half.
--
-- So sieve 2's whole measured cost on this archive — 골리앗 and 자국민 — is two
-- bad words, and its measured gain is three more (춘천시, 한화에어, 폭등장).
-- 10_sieve_eval.sql decides what follows from that; this file only labels.

-- ---------------------------------------------------------------- good

-- People. The set labels every named person good: 한동훈, 김민석, 정청래,
-- 최민희, 박지원, 송영길.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '권영진', '정의선', '김용민', '이수지', '문진석',
  '이언주', '유승민', '윤석열', '이인제', '홍준표'
]) w on conflict (word) do update set label = excluded.label;

-- Named companies, organisations, bodies and products, following 삼성전자,
-- 현대차, 홈플러스, 순천대, 선관위, 종합특검, 갤럭시, 아이폰, 제미나이, 엑사원.
--
-- The set is consistent about abbreviations going the other way — 삼전, 하닉,
-- 형소, 스페이스 and 전대 are all bad while 삼성전자, SK하이닉스, 형소법 and
-- 스페이스X are good — so the full form is what earns the label.
--
-- 혁수대 is the exception and it is deliberate: 혁명수비대 never appears in the
-- archive, so this is the only form the organisation has here, which makes it a
-- name rather than a shortening of one. 미군 and 하마스 are the precedent.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '오픈AI', '스페이스X', 'LG전자', 'KT다이렉트샵', '아스트라', '아이오닉3',
  '폴드8', '누리호', '서울대', '국민연금', '합수본', '네이비실', '혁수대',
  '신천지', '프로야구'
]) w on conflict (word) do update set label = excluded.label;

-- Places, following 강남, 해운대, 경남, 충청, 강릉, 제주, 세우타 — each one a
-- place something happened in.
--
-- 여의도 was proposed here on that precedent and overruled on review. It is not
-- used as a location in these headlines but as metonymy for the market, which
-- makes it a standing way of saying "the securities industry" rather than a
-- place the day's news is at — it reads the way 증권사 and 은행 do.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['부울경', '충청권', '키이우']) w
on conflict (word) do update set label = excluded.label;

-- Weather, which the set treats as a subject in its own right: 폭염, 초열대야,
-- 더위, 기온, 기상, 날씨, 태풍, 가뭄 are all good.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '열대야', '최고기온', '무더위', '폭염경보', '폭염중대경보', '열사병'
]) w on conflict (word) do update set label = excluded.label;

-- Named political events, following 대선, 총선, 임단협, 필리버스터 — each names
-- a specific thing that happened rather than the category it belongs to
-- (경선, 선거, 전대 are all bad).
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['순회경선', '전당대회', '명청대전']) w
on conflict (word) do update set label = excluded.label;

-- Legal instruments and the specific things a case turns on, following 특검,
-- 검수완박, 공소기각, 형소법, 구속, 기소. Each names one identifiable thing that
-- a headline can be about on its own.
--
-- 형사사법체계 was proposed here beside 형소법 and overruled on review. 형소법 is
-- the bill that passed; 형사사법체계 is the standing thing the bill changes, and
-- names it no more precisely than 사법 does — which is already bad.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '긴급조치권', '소환장', '유류분'
]) w on conflict (word) do update set label = excluded.label;

-- Concrete hardware the day's story is about, following 미사일, 패트리엇,
-- 에너지시설. 군집위성 and 추력기 are what the 누리호 delay is about, and a
-- reader learns the story from them; 설비 and 시스템 are bad because they name
-- no particular thing.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['탄도미사일', '군집위성', '추력기']) w
on conflict (word) do update set label = excluded.label;

-- A named disease and a named offence, following 난임, 마약, 방화.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['에볼라', '음주운전']) w
on conflict (word) do update set label = excluded.label;

-- A nickname that refers to one identifiable thing, following 돌핀 and 워시.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['노스트라다무스']) w
on conflict (word) do update set label = excluded.label;

-- 윤리위 follows 선관위, and 반도체 follows 메모리. Both were first proposed bad
-- here — 윤리위 beside 관저 and 청와대, 반도체 beside 배터리 and 클라우드 — and
-- both were overruled on review, correctly: the set already held the good half of
-- each pair, so the bad label was the inconsistency rather than the fix for one.
--
-- The line the pair draws: 청와대, 관저, 대법 and 국회 are the backdrop a story
-- happens in front of, while 선관위 and 윤리위 are bodies that were themselves
-- the story on the day they appear.
--
-- 반도체 moving leaves 배터리, 클라우드, 바이오, 휴머노이드 and 부동산 on the bad
-- side as the outliers now. That is the open question README.md records as
-- "where the good-word line sits", not something this file settles.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array['윤리위', '반도체']) w
on conflict (word) do update set label = excluded.label;

-- 李대통령 is a person, following 이재명 and every other named politician. It
-- reads as a contraction, which is why it was first proposed bad beside 삼전 and
-- 하닉, but those shorten a company's name while this one names the man. 대통령
-- on its own stays bad: that is the office.
--
-- Selected rather than written as a literal because the archive holds it as two
-- different strings — 李 U+674E and the CJK compatibility ideograph U+F7A1 —
-- which Naver's headlines use interchangeably. They look identical and are two
-- separate words to every count in this project (15 rows between them, and
-- 李정부 splits the same way over 3). That is a collection defect of the same
-- shape as the canonical-link one, recorded in README.md; here it only means
-- both forms need the label.
insert into analysis.word_labels (word, label)
select distinct word, 'good' from headline_nouns
where normalize(word, nfc) = normalize('李대통령', nfc)
on conflict (word) do update set label = excluded.label;

-- ----------------------------------------------------------------- bad

-- Standing domain categories rather than events, following 배터리, 클라우드,
-- 바이오, 휴머노이드, 부동산, 아파트, 수출, 금융. Each can head a real story,
-- which is exactly why README.md keeps them out of word_overrides — the label
-- is a judgement about the word, not a decision to blacklist it.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '가상자산', '데이터센터', '스마트폰', '전기차', '태양광',
  '재개발', '핵심광물', '온라인', '에이전트'
]) w on conflict (word) do update set label = excluded.label;

-- Generic nouns, following 전망, 참여, 취소, 발견, 돌파, 회복, 처리, 확대.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '마무리', '가능성', '막바지', '무방비', '거짓말', '사실상', '재정비',
  '공동방어', '긴급회의', '목소리', '사과문', '위성사진', '장기계약',
  '인신공격', '전면전', '전우애', '지옥문', '자기정치', '취재원', '한복판',
  '속수무책', '후안무치', '쓰레기', '주의보'
]) w on conflict (word) do update set label = excluded.label;

-- Intensifiers and superlatives, following 역대, 최고, 최대, 극한, 완승.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '역대급', '대규모', '차세대', '최우선', '신기록', '초박빙', '초접전',
  '승부수', '승부처', '시험대', '저평가'
]) w on conflict (word) do update set label = excluded.label;

-- Time words, following 오늘, 내일, 주말, 하루, 사흘, 나흘, 작년, 하반기, 분기.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '월요일', '일요일', '다음날', '다음주', '닷새째', '연이틀', '상반기', '여름철'
]) w on conflict (word) do update set label = excluded.label;

-- Categories of people, following 국민, 남성, 여성, 환자, 신입, 후보, 의원.
-- 자국민 is here, and it is one of the two words this whole round turns on.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '자국민', '이주민', '입주민', '피해자', '사망자', '외국인', '이용자',
  '투표자', '테러범', '신생아', '온열질환자', '직장인', '전문가', '서학개미'
]) w on conflict (word) do update set label = excluded.label;

-- Posts rather than the people holding them, following 대표, 위원, 의원, 총재,
-- 측근, 후보.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '최고위원', '당대표', '당권주자', '지도부', '美대사', '증권사'
]) w on conflict (word) do update set label = excluded.label;

-- The two overruled the other way on review: a standing institution named by
-- metonymy, and a standing system named where the bill that changed it was
-- meant. See the good groups above for why each was first proposed there.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['여의도', '형사사법체계']) w
on conflict (word) do update set label = excluded.label;

-- Market and industry terms, following 주가, 급등, 폭등, 폭락, 반등, 실적,
-- 출하, 변수, 상한.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '상한가', '변동성', '출하량', '롤러코스피'
]) w on conflict (word) do update set label = excluded.label;

-- A shortened form of something the set already labels in full, following 삼전,
-- 하닉, 형소, 스페이스, 전대.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['SK하닉']) w
on conflict (word) do update set label = excluded.label;

-- Words whose sense here is a piece of a longer one, or a generic where a
-- specific was meant, following 도체, 무인, 유조, 알뜰, 춘천시, 한화에어.
-- 무인기 is bad following 드론, not as a fragment: the object is generic.
-- 수사권 follows 보완수사 and 수사. 재선거 follows 선거.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '무인기', '수사권', '재선거', '가짜뉴스', '수도권'
]) w on conflict (word) do update set label = excluded.label;

-- Column and section furniture, following 북리뷰, 자막뉴스, 클로즈업,
-- 헬시타임, 밀리터리, 피지컬. 골리앗 is here and it is the other word this
-- round turns on — see the header.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['핫이슈', '골리앗']) w
on conflict (word) do update set label = excluded.label;

-- A real fragment, following 도체, 무인, 유조, 형소, 춘천시, 한화에어: 특별감찰
-- only ever occurs inside 특별감찰관, and 특별 is already bad on its own.
--
-- It appears only when 11_category_eval.sql's standalone-off variant is added —
-- it ranks 81st day-wide and never reaches the all-categories top 70, but it is
-- third in politics. That is 21_unlabeled_category.sql earning its existence,
-- and it is the third and last of the words sieve 2 is deciding about here.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['특별감찰']) w
on conflict (word) do update set label = excluded.label;

-- A building that names a type rather than one of them, following 병원,
-- 아파트, 오피스텔, 공장.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['요양병원']) w
on conflict (word) do update set label = excluded.label;

-- 대공습 follows 공습, which is bad and is one of the 35 the README keeps out of
-- the dictionary on purpose — an attack is a thing that happened, but the word
-- names the category and recurs whatever the war.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array['대공습']) w
on conflict (word) do update set label = excluded.label;

select label, count(*) from analysis.word_labels group by label order by label;
