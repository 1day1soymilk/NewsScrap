import { afterEach, describe, expect, it, vi } from 'vitest'
import { callEtriMorphAnalysis, extractNouns, filterNouns } from './nouns'

describe('extractNouns', () => {
  it('collects NNG/NNP lemmas across all sentences', () => {
    const response = {
      return_object: {
        sentence: [
          {
            morp: [
              { id: 0, lemma: '여야', type: 'NNG', position: 0, weight: 1 },
              { id: 1, lemma: '예산안', type: 'NNG', position: 1, weight: 1 },
              { id: 2, lemma: '처리', type: 'NNG', position: 2, weight: 1 },
              { id: 3, lemma: '하', type: 'VV', position: 3, weight: 1 },
            ],
          },
        ],
      },
    }

    expect(extractNouns(response)).toEqual(['여야', '예산안', '처리'])
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
      'http://aiopen.etri.re.kr:8000/WiseNLU',
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
