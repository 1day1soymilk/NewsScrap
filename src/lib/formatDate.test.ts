import { describe, expect, it } from 'vitest'
import { formatDate } from './formatDate'

describe('formatDate', () => {
  it('수집일을 마스트헤드의 세 조각으로 나눈다', () => {
    // KST로 고정한다. 이 함수는 UTC 자정을 넘길 때 하루가 밀리지 않도록
    // +09:00을 붙여 파싱하고, 그것이 여기서 확인하는 것이다.
    expect(formatDate('2026-08-01')).toEqual({
      day: '8월 1일',
      weekday: '토',
      year: '2026년',
    })
  })

  it('잘못된 날짜를 36px짜리 "Invalid Date"로 만들지 않는다', () => {
    // 손으로 고친 쿼리스트링에서 들어온다. Intl은 던지지 않고 "Invalid Date"를
    // 그리므로, 마스트헤드가 그 문자열을 제목 크기로 내걸게 된다.
    expect(formatDate('아무거나')).toEqual({ day: '아무거나', weekday: '', year: '' })
    expect(formatDate('2026-13-45')).toEqual({ day: '2026-13-45', weekday: '', year: '' })
  })
})
