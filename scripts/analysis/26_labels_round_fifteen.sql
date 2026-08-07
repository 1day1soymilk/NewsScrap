-- scripts/analysis/26_labels_round_fifteen.sql
--
-- Rule 4 for round fifteen. Two things moved the data under the harness at once:
-- **2026-08-04 joined `analysis.eval_days`**, and **the shipped config row was
-- corrected to carry the place gate** (migration 0028 turned it on; config 200
-- still said off, so the harness had been scoring a screen the app does not
-- draw). Either alone would have fired rule 4; together they put 33 new words on
-- the day-wide screen and 215 on the category tabs.
--
--   scripts/analysis/run.sh scripts/analysis/26_labels_round_fifteen.sql
--
-- The day-wide list is a subset of the category one, so this file labels the
-- 215 and clears both.
--
-- **The operational form of the line, used throughout:** would this word appear
-- in a randomly chosen other week's news? If yes it is bad however important the
-- story that produced it — 압수수색 and 본회의 and 유상증자 are all bad and all
-- matter. If no, it names this dated thing and is good.
--
-- Three anchors already in the label set settled most of the hard cases without
-- a new judgement: **개정안 is bad**, so the whole 세제개편안 / 세제개편 /
-- 세법개정안 family is bad even though it is 2026-08-04's biggest economic story
-- at df 61; **a foreign country or a Korean city is good** (미국, 중국, 일본,
-- 이란, 독일, 인도, 북한, 서울, 부산, 대구 all are) while 한국, 유럽, 중동 and
-- 호남 are bad as backdrop; and **a named company is good** (삼성, 애플, 구글,
-- 네이버, 테슬라, 코스피) while the generic economics around it is not (금리,
-- 증시).

-- People, and the two institutions named like people. Not arguable.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '김성수', '김성환', '김은혜', '정몽준', '조현', '이성윤', '김택수',
  '다카이치', '네타냐후', '인판티노', '푸틴', '멘데스', '보우소나루',
  '크리스토퍼 놀런', '美국방부', '후티'
]) w on conflict (word) do update set label = excluded.label;

-- Countries, cities, districts and named places. 성동구 is the instructive one:
-- its `standalone` is 0.00 because every headline writes 성동구서, which is the
-- **조사 blind spot** the fragment cut has always had — Korean attaches the
-- particle with no space, exactly as 해남에 and 골리앗의 do. A place that scores
-- 0.00 for that reason is still a place.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '러시아', '루마니아', '인도네시아', '인니', '그린란드', '다뉴브강', '日구마모토',
  '동탄', '반포', '강남권', '성동구', '무안', '거제', '영천', '파주', '인천시',
  '서울청', '인천공항', '묵호시장', '전라선', '제주해경청', '전북경찰청장',
  '청주시의원', '한강벨트'
]) w on conflict (word) do update set label = excluded.label;

-- Companies, brands and named products. 스벅 is Starbucks in three characters
-- and 탱크데이 is the incident that hit it, so both are the story rather than a
-- category. 여권폰 is the Galaxy Z's nickname for this launch.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '에코프로', '고려아연', '영풍', 'LG유플러스', '대우건설', '샌디스크', 'HD현대',
  '스벅', '스타벅스', '탱크데이', '넷플릭스', '블룸버그', '닛케이', '롯데',
  '롯데백화점', '우리운용', '브룩필드', '한화시스템', '제주항공', '삼성증권',
  '카카오페이', '원스토어', '엘리스그룹', '에이투지', '한국GM', '텔레그램',
  '챗GPT', '포켓몬', '나루토', 'Z폴드8', '아이오닉', 'AI팩토리', '여권폰',
  '한길그레이트북스'
]) w on conflict (word) do update set label = excluded.label;

-- Dated things: a document, a meeting, a proposal, a faction, one animal in one
-- case, and one weather level. 선호투표제 is the 보완수사권 case again — it names
-- the instrument one dated fight is about, where 수사권 names the power in
-- general.
insert into analysis.word_labels (word, label)
select w, 'good' from unnest(array[
  '방위백서', '日방위백서', '5중전회', '무장해제안', '선호투표제', '친청계',
  '악어거북', '중대경보', '극한더위'
]) w on conflict (word) do update set label = excluded.label;

-- **Fragments.** Every one of these is a longer name cut short, and the sample
-- headline says which: 최영 ← 최영중, 언스 ← 지니언스, 클래시 ← 클래시스,
-- 헌드레드 ← 원헌드레드, 네트웍스 ← 파고네트웍스. 복싱장서 is the 조사 blind spot
-- going the other way from 성동구 — there the particle hides a real place, here
-- it makes 복싱장 look like a word of its own.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '최영', '언스', '클래시', '헌드레드', '네트웍스', '복싱장서'
]) w on conflict (word) do update set label = excluded.label;

-- **A section tag is not a subject**, and this pass found eight more of them.
-- Every headline carrying one ends in it, in brackets: [팩플], [비하인드 뉴스],
-- [밀리터리노트], [박영환의 시사1번지], [김윤수의 리포트], [데일리안 오늘뉴스
-- 종합], [연합뉴스 이 시각 헤드라인]. 동상이몽 arrives inside the 밀리터리노트
-- headline as a quoted idiom rather than as a subject.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '팩플', '비하인드', '밀리터리노트', '시사1번지', '김윤수', '데일리안',
  '연합뉴스', '동상이몽'
]) w on conflict (word) do update set label = excluded.label;

-- The tax bill and everything around it. **개정안 is already labelled bad**, and
-- these are the same word with a prefix; that 세제개편안 leads the day's economy
-- section at df 61 is exactly the kind of importance the line does not measure.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '세제개편안', '세제개편', '세법개정안', '세금폭탄', '양도소득', '세액공제',
  '국내생산세액공제', '최고세율', '종부세율', '중간예납', '장특공제',
  '근로장려금', '부동산세', '다주택자', '1주택자', '대미투자'
]) w on conflict (word) do update set label = excluded.label;

-- Generic finance and markets. 금리 and 증시 are the anchors.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '영업이익', '당기순이익', '근원물가', '소비자물가', '기준금리', '예금금리',
  '채권시장', '신용등급', '거래대금', '주식선물', '공개매수', '소액주주',
  '주주환원', '임시주총', '잔금대출', '엔화매수', '18종목', '3거래일',
  '1.2조원', '200만원', '3600여명'
]) w on conflict (word) do update set label = excluded.label;

-- Generic policy, benefits and property.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '실업급여', '기초연금', '관리급여', '취약계층', '전기요금', '서비스료',
  '주택공급', '공급대책', '그린벨트', '국가산단', '국가유산',
  '국가민속문화유산', '윤리감찰', '국가폭력', '강제노동', '불법이민', '불법체류'
]) w on conflict (word) do update set label = excluded.label;

-- Generic roles, bodies and proceedings. 경찰청장 is generic where 전북경찰청장
-- above names one office; that is the whole distinction.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '국무회의', '업무보고', '영수회담', '중앙선관위', '권리당원', '대선후보',
  '부정평가', '투표자수', '수사부서', '경찰청장', '국방차관', '외교장관',
  '경영고문', '기획감독', '국가대표', '독립운동가', '대통령님', '남녀관계'
]) w on conflict (word) do update set label = excluded.label;

-- Generic crime, accident and courtroom vocabulary — the 압수수색 family.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '증거인멸', '시세조종', '사기혐의', '강도살인', '무단침입', '사망사고',
  '인명피해', '아동학대', '정면충돌', '최후통첩', '활공폭탄', '미군기지'
]) w on conflict (word) do update set label = excluded.label;

-- Generic technology and product categories. 반도체 is good by an explicit
-- reversal recorded in README's Labels section; these are not that case.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '자율주행', '피지컬AI', '폴더블폰', '의료기기', '표준규격', '전문기업',
  '이통3사', '사전개통', '사전판매', '지방세포', '인공눈물', '도수치료',
  'K팝 아이돌'
]) w on conflict (word) do update set label = excluded.label;

-- Everyday nouns and figures of speech. None of these would be missing from any
-- other week.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  '돼지고기', '오토바이', '어린이집', '초등학교', '대형마트', '유통업체',
  '시어머니', '프라이팬', '해외여행', '프리랜서', '밀리언셀러', '트라우마',
  '아이디어', '포트폴리오', '프로젝트', '메가프로젝트', '컨소시엄', '클러스터',
  '드라이브', '롤러코스터', '바늘구멍', '풍선효과'
]) w on conflict (word) do update set label = excluded.label;

select label, count(*) from analysis.word_labels group by 1 order by 1;

-- **A second pass, and it fired for the reason rule 4 exists.** Adding the
-- head_pos variants to 11_category_eval.sql moved which words reach a tab's
-- screen — a cut removes a word and the cap then promotes a deeper one — so nine
-- words that had never been on any screen arrived. The harness's own `unlab`
-- column is what caught them, in eight of its 270 cells.
--
-- Four are section tags, and this is the third pass in a row to find some:
-- [fn마켓워치] (파이낸셜뉴스), [부동산360] and [투자360] (헤럴드경제), and
-- 미국CPU반도체TOP10, which is not a column but the tail of an ETF's name —
-- 'KODEX 미국CPU반도체TOP10' — so it is furniture of the same kind, a product
-- label rather than a subject. The rest are the 압수수색 family: a market
-- mechanism and three pieces of legal and financial vocabulary that turn up in
-- any week.
insert into analysis.word_labels (word, label)
select w, 'bad' from unnest(array[
  'fn마켓워치', '부동산360', '투자360', '미국CPU반도체TOP10',
  '매수사이드카', '반사이익', '중요정보', '취소소송', '형사고발'
]) w on conflict (word) do update set label = excluded.label;

select label, count(*) from analysis.word_labels group by 1 order by 1;
