import { describe, expect, it } from 'vitest'
import { extractNouns, filterNouns } from './nouns'
import type { AnalyzedToken } from './nouns'

// garu returns character offsets rather than morpheme ids, so a fixture is just
// the title plus the tokens in order. `at` keeps the offsets honest by finding
// each token in the title itself.
//
// **What garu actually returns is the eojeol's span, repeated on every token
// inside it** — 보완/수사/권 all carry start 0 for 보완수사권, not 0/2/4. The two
// disagree, and `extractNouns` reads the same eojeol out of either, because the
// eojeol a character belongs to is the eojeol its first character belongs to.
// Fixtures in this shape are therefore the stricter of the two, and
// `eojeolSpans` below pins the real one so neither reading goes untested.
function tokens(title: string, spec: [string, string][]): AnalyzedToken[] {
  let cursor = 0
  return spec.map(([text, pos]) => {
    const start = title.indexOf(text, cursor)
    cursor = start + text.length
    return { text, pos, start }
  })
}

// The same spec with garu's own offsets: every token in an eojeol carries that
// eojeol's start. Verified against garu-ko 0.9.12 on these very titles.
function eojeolSpans(title: string, spec: [string, string][]): AnalyzedToken[] {
  const starts = tokens(title, spec).map((token) => token.start)
  return spec.map(([text, pos], index) => {
    let start = starts[index]
    while (start > 0 && !/\s/.test(title[start - 1])) start -= 1
    return { text, pos, start }
  })
}

// Every case is run twice, once through each builder, because the two offset
// readings must not be allowed to diverge silently. The tags are the ones
// garu-ko 0.9.12 actually returns for these titles, checked against it — a
// fixture that invents its input measures nothing, which is the mistake the
// ETRI version of this file recorded having made.
// `expected` is `word/pos`. The merged word's pos is its **head**: the last
// NOUN_TYPES token in the run, because Korean compounds are head-final. That is
// what makes SK/SL + 하이닉스/NNP come back NNP rather than SL, and it is the
// whole point of carrying pos at all — a two-character NNP is a name and a
// two-character NNG is not.
const CASES: { name: string; title: string; spec: [string, string][]; expected: string[] }[] = [
  {
    name: 'collects NNG and NNP',
    title: '여야 예산안 처리',
    spec: [['여야', 'NNG'], ['예산안', 'NNG'], ['처리', 'NNG']],
    expected: ['여야/NNG', '예산안/NNG', '처리/NNG'],
  },
  {
    // 보완수사권 is one eojeol and must come back whole; 완전 박탈 is two.
    name: 'merges inside one eojeol but never across a space',
    title: '보완수사권 완전 박탈',
    spec: [['보완', 'NNG'], ['수사', 'NNG'], ['권', 'XSN'], ['완전', 'MAG'], ['박탈', 'NNG']],
    expected: ['보완수사권/NNG', '박탈/NNG'],
  },
  {
    // 적 makes 기록적 an adnominal where 기록 is the keyword; 들 makes 개미들
    // a second word for 개미.
    name: 'leaves the inflectional suffixes out of the merge',
    title: '기록적 개미들',
    spec: [['기록', 'NNG'], ['적', 'XSN'], ['개미', 'NNG'], ['들', 'XSN']],
    expected: ['기록/NNG', '개미/NNG'],
  },
  {
    // Without this 김민석 측 arrives as 김민석측.
    name: 'ends the run at a bound noun',
    title: '김민석측 발언',
    spec: [['김민석', 'NNP'], ['측', 'NNB'], ['발언', 'NNG']],
    expected: ['김민석/NNP', '발언/NNG'],
  },
  {
    // SL, SH and SN are part of the word: this is what makes SK하이닉스 and
    // 1군단장 and 李대통령 survive as single words.
    name: 'keeps symbols inside the word',
    title: 'SK하이닉스 1군단장 李대통령',
    spec: [
      ['SK', 'SL'], ['하이닉스', 'NNP'],
      ['1', 'SN'], ['군단장', 'NNG'],
      ['李', 'SH'], ['대통령', 'NNG'],
    ],
    expected: ['SK하이닉스/NNP', '1군단장/NNG', '李대통령/NNG'],
  },
  {
    name: 'splits a run wherever a particle or ending interrupts it',
    title: '상한가에 반도체가',
    spec: [['상한', 'NNG'], ['가', 'JKB'], ['에', 'JKB'], ['반도체', 'NNG'], ['가', 'JKS']],
    expected: ['상한/NNG', '반도체/NNG'],
  },
  {
    name: 'drops runs carrying no NNG or NNP of their own',
    title: '하였다 예산안',
    spec: [['하', 'VV'], ['였', 'EP'], ['다', 'EF'], ['예산안', 'NNG']],
    expected: ['예산안/NNG'],
  },
]

describe('extractNouns', () => {
  for (const { name, title, spec, expected } of CASES) {
    it(name, () => {
      const show = (ns: { word: string; pos: string }[]) => ns.map((n) => `${n.word}/${n.pos}`)
      expect(show(extractNouns(title, tokens(title, spec)))).toEqual(expected)
      expect(show(extractNouns(title, eojeolSpans(title, spec)))).toEqual(expected)
    })
  }

  // The case this signal was added for. garu tags 이란 NNP and 감찰 NNG, and
  // 감찰/윤리/청문/초등/순회 are precisely the words CLAUDE.md names as the reason
  // the specificity clause had to be disabled — so pos separates what spec could
  // not. Verified against garu-ko 0.9.12.
  it('tells a two-character name from a two-character common noun', () => {
    const title = '이란 감찰 논란'
    const result = extractNouns(title, tokens(title, [
      ['이란', 'NNP'], ['감찰', 'NNG'], ['논란', 'NNG'],
    ]))
    expect(result).toEqual([
      { word: '이란', pos: 'NNP' },
      { word: '감찰', pos: 'NNG' },
      { word: '논란', pos: 'NNG' },
    ])
  })

  it('returns an empty array for no tokens', () => {
    expect(extractNouns('', [])).toEqual([])
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

  // filterNouns now carries the pos through untouched — it filters and
  // normalises, it does not re-judge. `n` keeps these fixtures readable.
  const n = (word: string, pos = 'NNG') => ({ word, pos })

  it('drops words shorter than 2 characters and known stopwords', () => {
    expect(filterNouns([n('여야'), n('예산안'), n('것'), n('기자'), n('사진')]))
      .toEqual([n('여야'), n('예산안')])
  })

  it('carries the pos through unchanged', () => {
    expect(filterNouns([n('이란', 'NNP'), n('감찰')])).toEqual([n('이란', 'NNP'), n('감찰')])
  })

  // 단어는 headline_nouns의 키이므로, 같은 글자의 두 표현이 두 단어가 되면 모든
  // 집계가 조용히 갈린다. 제목 쪽에서도 정규화하지만 여기서 다시 하는 것은
  // 중복이 아니다 — ETRI가 입력의 문자를 그대로 돌려준다는 가정을 하지 않기
  // 위해서다. 아카이브에 실제로 있던 형태가 李대통령이다.
  it('normalises compatibility ideographs to NFC', () => {
    expect(filterNouns([n(`${COMPAT_LI}대통령`), n(`${COMPAT_NO}배신`)])).toEqual([
      n(`${PLAIN_LI}대통령`),
      n(`${PLAIN_NO}배신`),
    ])
  })

  // 위 테스트가 깨지면 출력이 "李대통령"과 "李대통령"으로 찍혀 읽을 수가 없다.
  // 이 테스트는 같은 것을 코드포인트로 물어서, 실패했을 때 26446과 63969라는
  // 구별 가능한 숫자가 나오게 한다.
  it('leaves behind the ordinary code point, not the compatibility one', () => {
    const [first] = filterNouns([n(`${COMPAT_LI}대통령`)])
    expect(first.word.codePointAt(0)).toBe(0x674e)
  })

  it('applies the stopword list after normalising', () => {
    expect(filterNouns([n(`${COMPAT_LI}대통령`), n('기자')])).toEqual([n(`${PLAIN_LI}대통령`)])
  })
})
