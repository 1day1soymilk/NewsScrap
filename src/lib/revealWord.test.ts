import { describe, expect, it } from 'vitest'
import { REVEAL_GAP, revealScrollDelta } from './revealWord'

const VIEWPORT = { width: 390, height: 844 }
const HEADER = 60

/** 폭을 다 쓰는 하단 시트. 실측한 배치(844px 화면에 297px 시트)를 그대로 쓴다. */
const SHEET = { top: 547, left: 0, right: 390 }
/** `sm` 이상의 옆서랍. 오른쪽 320px, 헤더 아래부터 바닥까지. */
const DRAWER = { top: HEADER, left: 960, right: 1280 }
const WIDE = { width: 1280, height: 900 }

describe('revealScrollDelta', () => {
  it('시트에 가린 단어를 시트 위로 올린다', () => {
    // 실측한 그 자리: 단어가 y 744~819, 시트가 547부터.
    const delta = revealScrollDelta({ top: 744, bottom: 819 }, SHEET, VIEWPORT, HEADER)
    expect(delta).toBe(819 + REVEAL_GAP - 547)
    // 올린 뒤 단어 아래끝이 시트 위에 여백을 두고 선다.
    expect(819 - delta).toBe(547 - REVEAL_GAP)
  })

  it('시트 위에 이미 있는 단어는 건드리지 않는다', () => {
    expect(revealScrollDelta({ top: 200, bottom: 275 }, SHEET, VIEWPORT, HEADER)).toBe(0)
  })

  it('여백만큼 모자란 단어도 올린다 — 붙어 있으면 잘린 것처럼 읽힌다', () => {
    const delta = revealScrollDelta({ top: 470, bottom: 545 }, SHEET, VIEWPORT, HEADER)
    expect(delta).toBe(545 + REVEAL_GAP - 547)
    expect(delta).toBeGreaterThan(0)
  })

  it('옆서랍에서는 아무것도 안 한다 — 세로로 겹치지 않는다', () => {
    // 서랍의 top은 헤더 높이라 단어 대부분이 그 아래에 있지만, 폭을 다 쓰지 않는다.
    expect(revealScrollDelta({ top: 700, bottom: 775 }, DRAWER, WIDE, HEADER)).toBe(0)
  })

  it('헤더 위로는 밀지 않는다 — 가린 것을 다른 것으로 바꾸는 셈이다', () => {
    // 70svh를 다 쓴 시트(844의 70%는 591이므로 top이 253까지 올라온다)에 헤더 아래
    // 좁은 띠만 남은 경우. 필요한 값은 107px인데 올릴 자리가 60px뿐이라 60에서 멈춘다.
    const tall = { top: 100, left: 0, right: 390 }
    const needed = 195 + REVEAL_GAP - 100
    const delta = revealScrollDelta({ top: 120, bottom: 195 }, tall, VIEWPORT, HEADER)
    expect(delta).toBe(120 - HEADER)
    expect(delta).toBeLessThan(needed)
  })

  it('헤더 밑에 이미 들어가 있으면 더 밀지 않는다', () => {
    const tall = { top: 100, left: 0, right: 390 }
    expect(revealScrollDelta({ top: 40, bottom: 115 }, tall, VIEWPORT, HEADER)).toBe(0)
  })

  it('시트가 화면 밖이면 가릴 것이 없다', () => {
    const offscreen = { top: 844, left: 0, right: 390 }
    expect(revealScrollDelta({ top: 744, bottom: 819 }, offscreen, VIEWPORT, HEADER)).toBe(0)
  })
})
