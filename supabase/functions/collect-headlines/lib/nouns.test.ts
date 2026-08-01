import { afterEach, describe, expect, it, vi } from 'vitest'
import { callEtriMorphAnalysis, extractNouns, filterNouns } from './nouns'

// ETRI numbers morphemes sequentially within a sentence, and each eojeol spans
// an inclusive range of those ids. These helpers keep the fixtures readable.
function morp(lemma: string, type: string, id: number) {
  return { id, lemma, type, position: id, weight: 1 }
}

function word(id: number, text: string, begin: number, end: number) {
  return { id, text, type: '', begin, end }
}

describe('extractNouns', () => {
  it('collects NNG/NNP lemmas across all sentences', () => {
    const response = {
      return_object: {
        sentence: [
          {
            morp: [
              morp('여야', 'NNG', 0),
              morp('예산안', 'NNG', 1),
              morp('처리', 'NNG', 2),
              morp('하', 'VV', 3),
            ],
            word: [word(0, '여야', 0, 0), word(1, '예산안', 1, 1), word(2, '처리하다', 2, 3)],
          },
        ],
      },
    }

    expect(extractNouns(response)).toEqual(['여야', '예산안', '처리'])
  })

  // The tags here are the ones ETRI actually returns, checked against the live
  // API. An earlier version of this fixture tagged 반 as NNG and 기 as NNG, which
  // are the tags that would make the merge work — so the test passed while the
  // archive filled with 도체 and 무인 and held no 반도체 at all. A fixture that
  // invents its input measures nothing.
  it('merges adjacent noun morphemes inside one eojeol but not across eojeol', () => {
    const response = {
      return_object: {
        sentence: [
          {
            morp: [
              morp('SK', 'SL', 0),
              morp('하이닉스', 'NNP', 1),
              morp('반', 'XPN', 2),
              morp('도체', 'NNG', 3),
              morp('무인', 'NNG', 4),
              morp('기', 'XSN', 5),
              morp('수출', 'NNG', 6),
            ],
            word: [
              word(0, 'SK하이닉스', 0, 1),
              word(1, '반도체', 2, 3),
              word(2, '무인기', 4, 5),
              word(3, '수출', 6, 6),
            ],
          },
        ],
      },
    }

    expect(extractNouns(response)).toEqual(['SK하이닉스', '반도체', '무인기', '수출'])
  })

  it('leaves the inflectional suffixes out of the merge', () => {
    const response = {
      return_object: {
        sentence: [
          {
            morp: [
              morp('개미', 'NNG', 0),
              morp('들', 'XSN', 1),
              morp('기록', 'NNG', 2),
              morp('적', 'XSN', 3),
              morp('손', 'NNG', 4),
              morp('님', 'XSN', 5),
            ],
            word: [word(0, '개미들', 0, 1), word(1, '기록적', 2, 3), word(2, '손님', 4, 5)],
          },
        ],
      },
    }

    // 들 would split 개미 from 개미들 and 적 gives an adnominal, but 님 stays
    // mergeable because dropping it turns 손님 into 손.
    expect(extractNouns(response)).toEqual(['개미', '기록', '손님'])
  })

  it('ends the run at a bound noun', () => {
    const response = {
      return_object: {
        sentence: [
          {
            morp: [morp('김민석', 'NNP', 0), morp('측', 'NNB', 1)],
            word: [word(0, '김민석측', 0, 1)],
          },
        ],
      },
    }

    expect(extractNouns(response)).toEqual(['김민석'])
  })

  it('splits a run wherever a non-mergeable morpheme interrupts it', () => {
    const response = {
      return_object: {
        sentence: [
          {
            morp: [
              morp('정부', 'NNG', 0),
              morp('의', 'JKG', 1),
              morp('대책', 'NNG', 2),
            ],
            word: [word(0, '정부의대책', 0, 2)],
          },
        ],
      },
    }

    expect(extractNouns(response)).toEqual(['정부', '대책'])
  })

  it('drops runs that carry no NNG/NNP of their own', () => {
    const response = {
      return_object: {
        sentence: [
          {
            morp: [morp('2026', 'SN', 0), morp('년', 'NNB', 1), morp('폭염', 'NNG', 2)],
            word: [word(0, '2026년', 0, 1), word(1, '폭염', 2, 2)],
          },
        ],
      },
    }

    expect(extractNouns(response)).toEqual(['폭염'])
  })

  it('falls back to individual morphemes when a sentence carries no eojeol spans', () => {
    const response = {
      return_object: {
        sentence: [{ morp: [morp('반', 'NNG', 0), morp('도체', 'NNG', 1)] }],
      },
    }

    expect(extractNouns(response)).toEqual(['반', '도체'])
  })

  it('returns an empty array when return_object is missing', () => {
    expect(extractNouns({})).toEqual([])
  })
})

describe('filterNouns', () => {
  it('drops words shorter than 2 characters and known stopwords', () => {
    expect(filterNouns(['여야', '예산안', '것', '기자', '사진'])).toEqual(['여야', '예산안'])
  })
})

describe('callEtriMorphAnalysis', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the expected request and returns the parsed JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ return_object: { sentence: [] } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callEtriMorphAnalysis('여야 예산안 처리', 'test-key')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://epretx.etri.re.kr:8000/api/WiseNLU',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'test-key' }),
      }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({
      request_id: 'collect-headlines',
      argument: { analysis_code: 'morp', text: '여야 예산안 처리' },
    })
    expect(result).toEqual({ return_object: { sentence: [] } })
  })

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(callEtriMorphAnalysis('text', 'key')).rejects.toThrow('500')
  })
})
