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
// Types that may be glued into a noun run without forming one on their own:
// foreign words (SL), hanja (SH) and numbers (SN). SL is what makes
// SK/SL + 하이닉스/NNP come back as SK하이닉스 — ETRI never tags SK as a noun,
// which is why the current archive holds 하이닉스 but no SK at all.
const MERGEABLE_TYPES = new Set([...NOUN_TYPES, 'SL', 'SH', 'SN'])
const STOPWORDS = new Set(['기자', '사진', '종합', '단독', '속보', '영상'])
// aiopen.etri.re.kr shut down on 2025-06-30. e-PreTX is ETRI's successor
// platform and serves the same WiseNLU API with an unchanged request/response
// schema — only the host and the /api path prefix differ. Limit: 5,000 req/day.
const ETRI_ENDPOINT = 'http://epretx.etri.re.kr:8000/api/WiseNLU'

// ETRI splits compound nouns into their parts, so 반도체 arrives as 반 + 도체 and
// 알뜰폰 as 알뜰 + 폰. Taken singly those pieces are fragments that read as
// unrelated words in a word cloud. Merging the adjacent noun morphemes of one
// eojeol restores the compound; the pieces are then dropped, since keeping both
// would double-count the headline.
//
// The merge never crosses an eojeol boundary — "정부 대책" is two words, not
// 정부대책 — which is why this reads sentence.word rather than scanning morp
// straight through.
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
        if (morph && MERGEABLE_TYPES.has(morph.type)) run.push(morph)
        else flush()
      }
      flush()
    }
  }

  return nouns
}

export function filterNouns(words: string[]): string[] {
  return words.filter((word) => word.length >= 2 && !STOPWORDS.has(word))
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
