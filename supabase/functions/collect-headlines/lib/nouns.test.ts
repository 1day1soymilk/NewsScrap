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
  // 네이버는 같은 한자를 보통 한자와 CJK 호환 한자 두 가지로 쓴다. 화면에서
  // 구별되지 않으므로 아래 테스트는 **반드시 이스케이프로** 입력을 만든다. 양쪽을
  // 그냥 타이핑하면 입력과 기대값이 한 문자열이 되어, 통과하면서 아무것도
  // 검증하지 않는다 — 처음 작성했을 때 실제로 그렇게 됐다. 글자를 "고치지" 말 것.
  const COMPAT_LI = '李' // CJK COMPATIBILITY IDEOGRAPH-F9E1
  const COMPAT_NO = '盧' // CJK COMPATIBILITY IDEOGRAPH-F933
  const PLAIN_LI = '李' // CJK UNIFIED IDEOGRAPH-674E
  const PLAIN_NO = '盧' // CJK UNIFIED IDEOGRAPH-76E7

  it('drops words shorter than 2 characters and known stopwords', () => {
    expect(filterNouns(['여야', '예산안', '것', '기자', '사진'])).toEqual(['여야', '예산안'])
  })

  // 단어는 headline_nouns의 키이므로, 같은 글자의 두 표현이 두 단어가 되면 모든
  // 집계가 조용히 갈린다. 제목 쪽에서도 정규화하지만 여기서 다시 하는 것은
  // 중복이 아니다 — ETRI가 입력의 문자를 그대로 돌려준다는 가정을 하지 않기
  // 위해서다. 아카이브에 실제로 있던 형태가 李대통령이다.
  it('normalises compatibility ideographs to NFC', () => {
    expect(filterNouns([`${COMPAT_LI}대통령`, `${COMPAT_NO}배신`])).toEqual([
      `${PLAIN_LI}대통령`,
      `${PLAIN_NO}배신`,
    ])
  })

  // 위 테스트가 깨지면 출력이 "李대통령"과 "李대통령"으로 찍혀 읽을 수가 없다.
  // 이 테스트는 같은 것을 코드포인트로 물어서, 실패했을 때 26446과 63969라는
  // 구별 가능한 숫자가 나오게 한다.
  it('leaves behind the ordinary code point, not the compatibility one', () => {
    const [word] = filterNouns([`${COMPAT_LI}대통령`])
    expect(word.codePointAt(0)).toBe(0x674e)
  })

  it('applies the stopword list after normalising', () => {
    expect(filterNouns([`${COMPAT_LI}대통령`, '기자'])).toEqual([`${PLAIN_LI}대통령`])
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
