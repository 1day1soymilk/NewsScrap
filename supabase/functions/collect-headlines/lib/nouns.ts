export interface EtriMorpheme {
  id: number
  lemma: string
  type: string
  position: number
  weight: number
}

export interface EtriResponse {
  return_object?: {
    sentence?: { morp?: EtriMorpheme[] }[]
  }
}

const NOUN_TYPES = new Set(['NNG', 'NNP'])
const STOPWORDS = new Set(['기자', '사진', '종합', '단독', '속보', '영상'])
// aiopen.etri.re.kr shut down on 2025-06-30. e-PreTX is ETRI's successor
// platform and serves the same WiseNLU API with an unchanged request/response
// schema — only the host and the /api path prefix differ. Limit: 5,000 req/day.
const ETRI_ENDPOINT = 'http://epretx.etri.re.kr:8000/api/WiseNLU'

export function extractNouns(response: EtriResponse): string[] {
  const sentences = response.return_object?.sentence ?? []
  const nouns: string[] = []
  for (const sentence of sentences) {
    for (const morph of sentence.morp ?? []) {
      if (NOUN_TYPES.has(morph.type)) {
        nouns.push(morph.lemma)
      }
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
