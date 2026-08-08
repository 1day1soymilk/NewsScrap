-- scripts/analysis/28_labels_round_sixteen.sql
--
-- Round sixteen's labels: everything 20_unlabeled.sql and
-- 21_unlabeled_category.sql returned once 2026-08-05 and 08-06 joined
-- analysis.eval_days and the gated-α configurations went active.
--
--   scripts/analysis/run.sh scripts/analysis/28_labels_round_sixteen.sql
--
-- 299 words: 32 from the day-wide worklist, 299 from the category one, and the
-- day-wide set is a subset of the category set — which is the usual shape, since
-- a tab reaches words the day-wide top 70 never sees.
--
-- **The line, as this directory has settled it.** Two sittings of sampling the
-- existing 1,223 labels put it plainly, and it is not the frequency test on its
-- own:
--
--   * a word with a **referent you could point at** — a person, a company, a
--     place, a named thing — is good however often it recurs. 트럼프, 애플, 일본
--     and 연준 are all labelled good and all appear every week.
--   * a **common noun, a role, a quantity, a fragment or a section tag** is bad.
--     This is where "would it appear in a randomly chosen other week?" does its
--     work, because that is the test that catches 압수수색 and 본회의.
--
-- The role/entity split is the edge that needed care and the existing labels
-- already draw it: 검찰총장 is bad and 검찰개혁 is good. So 국방장관, 대법원장,
-- 재무장관, 총무원장 and 윤리위원장 are bad here, while 대검찰청, 서울시,
-- 경기남부청 and 서초경찰서 — institutions rather than the seats inside them —
-- are good.
--
-- **Two families were checked against real headlines rather than guessed at**,
-- because the word alone does not say which they are:
--
--   * **Section tags.** `[올댓차이나]` and `[시그널]` are the newspaper's own
--     furniture, exactly the signature this directory already records — high
--     `spec` plus a shared bracketed affix. Both bad. 뉴스특보 and 프레스룸 join
--     them.
--   * **Fragments of a name.** 리사 is 리사 쿡, 제프 is 제프 딘, 진종 is 진종오,
--     앤트 is 앤트로픽, 베이 and 캐리비안 are 캐리비안 베이, 골드만 is
--     골드만삭스, 카자흐 is 카자흐스탄. All bad; the whole forms that also
--     reached the screen (골드만삭스, 카자흐스탄, 캐리비안베이) are good. 차이나
--     is the sharpest of them — it comes from **차이날까**, so it is not a
--     fragment of a name at all but a mis-analysis.
--
-- Three coinages are good and are worth naming, because they are what the sieve
-- exists to find: **탈팡** (leaving Coupang), **피노키오** (as in "피노키오 세제")
-- and **빅쇼트** (Michael Burry's byname). None would appear in another week.
--
-- 조선 is good and it is the one case where a very common string is the actual
-- subject: the story is the 통일부's proposal to write '조선'.

insert into analysis.word_labels (word, label) values
  -- 사람
  ('구광모','good'),('김선호','good'),('김어준','good'),('김영진','good'),
  ('김주원','good'),('나경원','good'),('문대림','good'),('박근혜','good'),
  ('박나래','good'),('박범계','good'),('박수영','good'),('백승주','good'),
  ('버핏','good'),('서정진','good'),('안규백','good'),('안중근','good'),
  ('안철수','good'),('엘사예드','good'),('오세훈','good'),('원희룡','good'),
  ('유병호','good'),('유연석','good'),('유영하','good'),('윤호중','good'),
  ('이상민','good'),('이성훈','good'),('이승기','good'),('정기선','good'),
  ('정념스님','good'),('정동영','good'),('한덕수','good'),('한정애','good'),
  ('허사비스','good'),('허지웅','good'),('홍명보','good'),('황정민','good'),
  ('北김여정','good'),
  -- 회사 · 조직 · 기관
  ('DB하이텍','good'),('JP모건','good'),('LG헬로비전','good'),('SK디앤디','good'),
  ('SK바이오팜','good'),('SK텔레콤','good'),('가온전선','good'),('개혁신당','good'),
  ('건강한겨레','good'),('경기남부청','good'),('고려대','good'),('골드만삭스','good'),
  ('국립발레단','good'),('넷리스트','good'),('넷마블','good'),('노바메이트','good'),
  ('농심','good'),('대검찰청','good'),('대통령실','good'),('대한축구협회','good'),
  ('대한항공','good'),('두산퓨얼셀','good'),('롯데에너지','good'),('메타','good'),
  ('미래에셋','good'),('서울시','good'),('서초경찰서','good'),('솔리다임','good'),
  ('신남성연대','good'),('에이피알','good'),('엘앤에프','good'),('웹젠','good'),
  ('육사','good'),('조계종','good'),('충북도','good'),('축구대표팀','good'),
  ('축구협회','good'),('카카오','good'),('카카오게임즈','good'),
  ('코닉테라퓨틱스','good'),('코히어','good'),('쿠팡Inc','good'),('쿠팡이츠','good'),
  ('테오젠','good'),('토스증권','good'),('트리니티항공','good'),('티빙','good'),
  ('포스코퓨처엠','good'),('퓨리오사AI','good'),('한미사이언스','good'),
  ('한은','good'),('한화큐셀','good'),('현대차그룹','good'),('美민주당','good'),
  ('美연준','good'),('美해병대','good'),('강남서','good'),('무안군수','good'),
  -- 장소
  ('가평','good'),('강남3구','good'),('개포우성','good'),('경기도','good'),
  ('경복궁','good'),('과테말라','good'),('구로주공','good'),('구미','good'),
  ('김포','good'),('대만','good'),('대치동','good'),('덴마크','good'),
  ('도쿄','good'),('독도','good'),('동해안','good'),('레바논','good'),
  ('무안군','good'),('미시간','good'),('방콕','good'),('백악관','good'),
  ('번동','good'),('베트남','good'),('벨기에','good'),('북미','good'),
  ('북항','good'),('분당','good'),('서산','good'),('순천','good'),
  ('스웨덴','good'),('슬로바키아','good'),('아덴만','good'),('아태','good'),
  ('영국','good'),('영등포','good'),('영종도','good'),('오스트리아','good'),
  ('용산','good'),('용산공원','good'),('용산어린이정원','good'),
  ('우크라이나','good'),('워싱턴','good'),('청계천','good'),('카자흐스탄','good'),
  ('카타르','good'),('캄보디아','good'),('캐리비안베이','good'),('쿠바','good'),
  ('평택기지','good'),('호르무즈해협','good'),('호주','good'),('홍콩','good'),
  ('히로시마','good'),('양평고속도로','good'),
  -- 이름 붙은 것 · 제품 · 기술 · 사건
  ('3D메모리','good'),('가격하한제','good'),('궤도선','good'),
  ('네안데르탈인','good'),('다우','good'),('다우지수','good'),
  ('단거리전술핵','good'),('독도함','good'),('메모리장벽','good'),
  ('바나나킥','good'),('병적기록부','good'),('빅쇼트','good'),('사법개혁','good'),
  ('아반떼','good'),('알파고','good'),('앱스토어','good'),('에어팟','good'),
  ('자폭드론','good'),('정치특검','good'),('조선','good'),('카카오톡','good'),
  ('카톡','good'),('코로나','good'),('탈팡','good'),('파운드리','good'),
  ('폭염특보','good'),('폴리실리콘','good'),('피노키오','good'),('벤츠','good'),
  -- 일반명사 · 직위 · 수량
  ('2027학년도','bad'),('21세기','bad'),('2차','bad'),('3289가구','bad'),
  ('330만원','bad'),('3D','bad'),('TV토론','bad'),('女탈의실','bad'),
  ('가사도우미','bad'),('개인정보','bad'),('경상수지','bad'),('경상흑자','bad'),
  ('고발사건','bad'),('골든타임','bad'),('공립교사','bad'),('공산주의','bad'),
  ('공산주의자','bad'),('국방장관','bad'),('기둥뿌리','bad'),('기술수출','bad'),
  ('기후위기','bad'),('나치','bad'),('대리운전','bad'),('대법원장','bad'),
  ('대북정책','bad'),('대토론회','bad'),('데이터센터용','bad'),('머리카락','bad'),
  ('멱살잡이','bad'),('멸종위기종','bad'),('모니터링','bad'),('무기징역','bad'),
  ('무상교육','bad'),('미국발','bad'),('미국산','bad'),('미성년자','bad'),
  ('민주사회주의','bad'),('바이러스','bad'),('반면교사','bad'),('발레리나','bad'),
  ('방공미사일','bad'),('백조','bad'),('변호인단','bad'),('불법촬영','bad'),
  ('블록체인','bad'),('비상대출','bad'),('비상상황','bad'),('사관학교','bad'),
  ('사전예고','bad'),('사회주의','bad'),('상당부분','bad'),('상원의원','bad'),
  ('상장폐지','bad'),('생산시간','bad'),('서울의원','bad'),('소상공인','bad'),
  ('수사인력','bad'),('수석과학자','bad'),('수입금지','bad'),('스택','bad'),
  ('스트레스','bad'),('신호위반','bad'),('아파트값','bad'),('악성코드','bad'),
  ('엄중조치','bad'),('여론조사','bad'),('여론조사비','bad'),('여자탈의실','bad'),
  ('연구부정','bad'),('영업손실','bad'),('예비선거','bad'),('예술감독','bad'),
  ('외환보유액','bad'),('요양보호사','bad'),('윤리위원장','bad'),('이상주의','bad'),
  ('임금협상','bad'),('임용시험','bad'),('자체감사','bad'),('재무장관','bad'),
  ('재생에너지','bad'),('재정위기','bad'),('재정학계','bad'),('전·월세','bad'),
  ('정무부시장','bad'),('정신세계','bad'),('정치무상','bad'),('제2','bad'),
  ('제약바이오','bad'),('주주단체','bad'),('중국산','bad'),('중앙은행','bad'),
  ('지방국립대','bad'),('지배구조','bad'),('총무원장','bad'),('최고지도자','bad'),
  ('최저임금','bad'),('추가투표','bad'),('코브라','bad'),('택배기사','bad'),
  ('품목허가','bad'),('프리마켓','bad'),('한국계','bad'),('할아버지','bad'),
  ('혼조','bad'),
  -- 지면 가구 — 대괄호 접미사가 서명이다
  ('올댓차이나','bad'),('시그널','bad'),('뉴스특보','bad'),('프레스룸','bad'),
  ('비즈360','bad'),
  -- 23_unlabeled_gate_on.sql이 처음 돌면서 나온 다섯. 게이트가 place를 지우고
  -- 그 자리에 올린 단어들이라 게이트 없는 두 워크리스트로는 볼 수 없던 것들이다.
  ('구로','good'),('변희재','good'),('현대百','good'),
  ('위기상황','bad'),('정년연장','bad'),
  -- 21_unlabeled_category.sql이 head_pos 축을 되찾은 뒤 나온 다섯. 넷은
  -- 일반명사와 관용구고 하나(비즈360)는 위의 지면 가구다. 구속영장은 이
  -- 저장소가 이미 나쁜 말의 정의로 드는 압수수색과 같은 종류다 — 어느 주에나
  -- 나온다.
  ('등기임원','bad'),('일주일째','bad'),('갑론을박','bad'),('구속영장','bad'),
  -- 조각. 온전한 형태가 같이 올라온 것은 위에 good으로 있다
  ('SK하이퍼','bad'),('골드만','bad'),('공공나노팹에','bad'),('리사','bad'),
  ('베이','bad'),('앤트','bad'),('장동혁의','bad'),('제프','bad'),
  ('진종','bad'),('진종오에','bad'),('차이나','bad'),('카자흐','bad'),
  ('캐리비안','bad')
on conflict (word) do update set label = excluded.label;

-- 라벨이 붙었는지 확인. 두 워크리스트가 0행이어야 아래 하네스를 읽을 수 있다.
select label, count(*) from analysis.word_labels group by label order by label;
