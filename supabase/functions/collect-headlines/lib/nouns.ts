/**
 * One morpheme as the analyser returns it.
 *
 * `start` is a character offset into the title. garu reports the span of the
 * containing **eojeol** rather than of the morpheme, so every token inside one
 * eojeol carries the same `start`; extractNouns only ever asks which eojeol a
 * start falls in, so either reading works and neither is assumed.
 */
export interface AnalyzedToken {
  text: string
  pos: string
  start: number
}

/**
 * A word the extraction kept, with the part of speech it was built from.
 *
 * The pos is carried because **length is only a proxy for what the sieve wants
 * to know.** `min_word_len` is 3 and it admits 68 of the 70 drawn words, which
 * makes it effectively the whole sieve; what it is standing in for is "this is a
 * word in its own right rather than a piece of one". A two-character word fails
 * that test often enough to be worth cutting wholesale, and 이란 and 중국 and
 * 삼성 are the price. The analyser answers the real question directly: it tags
 * 이란 NNP and 감찰 NNG, and 감찰·윤리·청문·초등·순회 are exactly the words
 * CLAUDE.md names as the reason the specificity clause had to be turned off.
 */
export interface ExtractedNoun {
  word: string
  pos: string
}

// A run of morphemes only becomes a noun if it contains one of these.
const NOUN_TYPES = new Set(['NNG', 'NNP'])
// The eojeol is the word. Korean writes a compound without spaces, so whatever
// the writer left unspaced belongs together and the only job here is to strip
// what got stuck on the end — particles, endings and the like. So this is a
// denylist of what ends a run rather than an allowlist of what may join one:
// particles (J*), endings (E*), verbs and adjectives (V*, XSV, XSA), adverbs and
// determiners (M*), interjections (I*), bound nouns (NNB) and punctuation.
//
// Symbols are deliberately absent from it: SL, SH and SN are part of the word,
// which is what makes SK/SL + 하이닉스/NNP come back as SK하이닉스 — no analyser
// here has ever tagged SK as a noun, so an early archive holds 하이닉스 and no
// SK at all.
//
// An allowlist was tried first and it is the reason the archive filled with 도체
// and 무인 and held no 반도체 at all: it named the noun tags, and ETRI returned
// 반도체 as 반/XPN + 도체/NNG and 무인기 as 무인/NNG + 기/XSN, so the run broke at
// exactly the place the compound needed joining. Adding those two tags back
// fixes the same 66 of 150 sampled headlines this rule does, but it has to
// enumerate the tagset to say something the spacing already said.
// scripts/analysis/31_fragments.sql is what found the fragments.
//
// **The rule outlived the analyser that motivated it, which is the argument for
// it.** garu returns 반도체 and 무인기 whole, so the allowlist would not fail
// here in the same way — and that is exactly why the denylist stays: it does not
// depend on which splits any particular analyser happens to make.
//
// NNB breaks because it is a bound noun rather than part of the word: without it
// 김민석 측 arrives as 김민석측.
const BREAK_TAG_FAMILIES = new Set(['J', 'E', 'V', 'M', 'I'])
const BREAK_TYPES = new Set(['NNB', 'XSV', 'XSA', 'SF', 'SP', 'SS', 'SE', 'SO', 'SW'])
// The two suffixes that survive the rule above and should not. Both are
// inflection rather than compounding: 들 makes 개미 and 개미들 two separate
// words, and 적 gives the adnominal 기록적 where 기록 is the keyword. Picked from
// the XSN lemmas a 150-headline sample actually produced, not from the tagset.
// 님 is deliberately not here — 선배님 would read better as 선배, but denying it
// turns 손님 into 손, and a wrong word costs more than a redundant one.
const NON_MERGEABLE_SUFFIXES = new Set(['들', '적'])

const STOPWORDS = new Set(['기자', '사진', '종합', '단독', '속보', '영상'])

// An analyser splits compound nouns into their parts — 알뜰폰 arrives as 알뜰 +
// 폰 — and taken singly those pieces are fragments that read as unrelated words
// on the graph. Rejoining the morphemes of one eojeol restores the compound; the
// pieces are then dropped, since keeping both would double-count the headline.
//
// The rejoin never crosses an eojeol boundary — "정부 대책" is two words, not
// 정부대책. That boundary is the whole idea: the headline's own spacing says what
// belongs together, so a run continues until a morpheme turns up that is not part
// of the word (see BREAK_TYPES) rather than while the tags stay on an approved
// list.
function isMergeable(token: AnalyzedToken): boolean {
  if (BREAK_TAG_FAMILIES.has(token.pos[0])) return false
  if (BREAK_TYPES.has(token.pos)) return false
  return !(token.pos === 'XSN' && NON_MERGEABLE_SUFFIXES.has(token.text))
}

/**
 * Which eojeol each character belongs to. Whitespace is -1.
 *
 * The rule has always been that the headline's own spacing says what belongs
 * together — ETRI's `word` spans were a proxy for it. Tokens carry character
 * offsets, so the spacing can be read directly, which is both simpler and
 * closer to what the rule claims.
 */
function eojeolOf(title: string): Int32Array {
  const index = new Int32Array(title.length)
  let current = 0
  let inSpace = true
  for (let i = 0; i < title.length; i++) {
    if (/\s/.test(title[i])) {
      index[i] = -1
      inSpace = true
    } else {
      if (inSpace) current += 1
      inSpace = false
      index[i] = current
    }
  }
  return index
}

export function extractNouns(
  title: string,
  tokens: readonly AnalyzedToken[],
): ExtractedNoun[] {
  const eojeol = eojeolOf(title)
  const nouns: ExtractedNoun[] = []
  let run: AnalyzedToken[] = []
  let at = -2

  // The merged word takes the pos of its **head** — the last NOUN_TYPES token in
  // the run — because Korean compounds are head-final. That is what makes
  // SK/SL + 하이닉스/NNP arrive as NNP rather than SL, and 반/XPN + 도체/NNG as
  // NNG. A run always holds at least one noun token or it is not flushed, so
  // there is always a head to take.
  const flush = () => {
    const nounTokens = run.filter((token) => NOUN_TYPES.has(token.pos))
    if (nounTokens.length > 0) {
      nouns.push({
        word: run.map((token) => token.text).join(''),
        pos: nounTokens[nounTokens.length - 1].pos,
      })
    }
    run = []
  }

  for (const token of tokens) {
    const here = eojeol[token.start] ?? -1
    if (here !== at) {
      flush()
      at = here
    }
    if (isMergeable(token)) run.push(token)
    else {
      flush()
      at = -2
    }
  }
  flush()

  return nouns
}

// The word is the key every count in this project is grouped by, so two
// spellings of one word are two words and nothing on screen says so. Naver's
// headlines use the CJK compatibility ideographs interchangeably with the
// ordinary ones — 李 U+F9E1 against 李 U+674E, and likewise 金 U+F90A,
// 勞 U+F92F, 盧 U+F933, 女 U+F981 — and they render identically. Before
// migration 0012 the archive held 李대통령 as two words splitting 15 rows, and
// 李정부 as two more. NFC folds the compatibility form onto the ordinary one.
//
// extractHeadlines normalises the title too, so in the shipped pipeline the
// analyser is already handed NFC text. This is not that guarantee restated: it
// is the one that does not depend on the analyser echoing its input's code
// points back.
export function filterNouns(nouns: ExtractedNoun[]): ExtractedNoun[] {
  return nouns
    .map((noun) => ({ word: noun.word.normalize('NFC'), pos: noun.pos }))
    .filter((noun) => noun.word.length >= 2 && !STOPWORDS.has(noun.word))
}
