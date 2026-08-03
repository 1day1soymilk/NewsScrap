export interface EtriMorpheme {
  id: number
  lemma: string
  type: string
  position: number
  weight: number
}

// An eojeol (space-delimited token). `begin`/`end` are inclusive morpheme ids
// within the same sentence, not character offsets.
export interface EtriWord {
  id: number
  text: string
  type: string
  begin: number
  end: number
}

export interface EtriResponse {
  return_object?: {
    sentence?: { morp?: EtriMorpheme[]; word?: EtriWord[] }[]
  }
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
// which is what makes SK/SL + 하이닉스/NNP come back as SK하이닉스 — ETRI never
// tags SK as a noun, so an earlier archive holds 하이닉스 and no SK at all.
//
// An allowlist was tried first and it is the reason the archive filled with 도체
// and 무인 and holds no 반도체 at all: it named the noun tags, and ETRI returns
// 반도체 as 반/XPN + 도체/NNG and 무인기 as 무인/NNG + 기/XSN, so the run broke at
// exactly the place the compound needed joining. Adding those two tags back
// fixes the same 66 of 150 sampled headlines this rule does, but it has to
// enumerate the tagset to say something the spacing already said.
// scripts/analysis/31_fragments.sql is what found the fragments.
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
// aiopen.etri.re.kr shut down on 2025-06-30. e-PreTX is ETRI's successor
// platform and serves the same WiseNLU API with an unchanged request/response
// schema — only the host and the /api path prefix differ. Limit: 5,000 req/day.
const ETRI_ENDPOINT = 'http://epretx.etri.re.kr:8000/api/WiseNLU'

// ETRI splits compound nouns into their parts, so 반도체 arrives as 반 + 도체 and
// 알뜰폰 as 알뜰 + 폰. Taken singly those pieces are fragments that read as
// unrelated words on the graph. Rejoining the morphemes of one eojeol restores
// the compound; the pieces are then dropped, since keeping both would
// double-count the headline.
//
// The rejoin never crosses an eojeol boundary — "정부 대책" is two words, not
// 정부대책 — which is why this reads sentence.word rather than scanning morp
// straight through. That boundary is the whole idea: the headline's own spacing
// says what belongs together, so a run continues until a morpheme turns up that
// is not part of the word (see BREAK_TYPES) rather than while the tags stay on
// an approved list.
function isMergeable(morph: EtriMorpheme): boolean {
  if (BREAK_TAG_FAMILIES.has(morph.type[0])) return false
  if (BREAK_TYPES.has(morph.type)) return false
  return !(morph.type === 'XSN' && NON_MERGEABLE_SUFFIXES.has(morph.lemma))
}

export function extractNouns(response: EtriResponse): string[] {
  const sentences = response.return_object?.sentence ?? []
  const nouns: string[] = []

  for (const sentence of sentences) {
    const morphemes = sentence.morp ?? []
    const words = sentence.word ?? []

    if (words.length === 0) {
      // No eojeol spans to merge within. Fall back to individual morphemes
      // rather than treating the sentence as one span, which would glue
      // unrelated words together.
      for (const morph of morphemes) {
        if (NOUN_TYPES.has(morph.type)) nouns.push(morph.lemma)
      }
      continue
    }

    const byId = new Map(morphemes.map((morph) => [morph.id, morph]))
    for (const word of words) {
      let run: EtriMorpheme[] = []
      const flush = () => {
        if (run.some((morph) => NOUN_TYPES.has(morph.type))) {
          nouns.push(run.map((morph) => morph.lemma).join(''))
        }
        run = []
      }

      for (let id = word.begin; id <= word.end; id++) {
        const morph = byId.get(id)
        if (morph && isMergeable(morph)) run.push(morph)
        else flush()
      }
      flush()
    }
  }

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
// extractHeadlines normalises the title too, so in the shipped pipeline ETRI is
// already handed NFC text. This is not that guarantee restated: it is the one
// that does not depend on ETRI echoing its input's code points back.
export function filterNouns(words: string[]): string[] {
  return words
    .map((word) => word.normalize('NFC'))
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word))
}

export async function callEtriMorphAnalysis(text: string, apiKey: string): Promise<EtriResponse> {
  const response = await fetch(ETRI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({
      request_id: 'collect-headlines',
      argument: { analysis_code: 'morp', text },
    }),
  })

  if (!response.ok) {
    throw new Error(`ETRI API request failed with status ${response.status}`)
  }

  return (await response.json()) as EtriResponse
}
