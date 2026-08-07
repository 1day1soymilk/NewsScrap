import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CACHE_MAX_ENTRIES,
  CACHE_TTL_MS,
  cached,
  cachedQuery,
  clearQueryCache,
  isReady,
} from './queryCache'

beforeEach(() => {
  clearQueryCache()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('cached', () => {
  it('같은 키는 한 번만 돌고 **같은 객체**를 돌려준다', async () => {
    // 같은 객체라는 것이 요점의 절반이다. App.tsx의 메모는 전부 신원 비교라,
    // 값만 같고 객체가 다르면 라벨 측정 70회와 루뱅 분할과 300틱이 다시 돈다.
    const run = vi.fn(async () => ({ nodes: [] }))

    const first = await cached('a', run)
    const second = await cached('a', run)

    expect(run).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('진행 중인 요청에 두 번째 호출이 올라탄다', async () => {
    let release: (value: number) => void = () => {}
    const run = vi.fn(() => new Promise<number>((resolve) => (release = resolve)))

    const first = cached('a', run)
    const second = cached('a', run)
    release(7)

    expect(run).toHaveBeenCalledTimes(1)
    expect(await first).toBe(7)
    expect(await second).toBe(7)
  })

  it('키가 다르면 따로 돈다', async () => {
    const run = vi.fn(async () => 1)

    await cached('a', run)
    await cached('b', run)

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('실패는 남기지 않는다 — 다시 시도가 실제로 다시 시도해야 한다', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(3)

    await expect(cached('a', run)).rejects.toThrow('boom')
    await expect(cached('a', run)).resolves.toBe(3)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('TTL이 지나면 다시 돈다', async () => {
    // 지난 날짜의 데이터는 불변이지만 오늘 것은 07:00 KST cron으로 바뀌고,
    // 탭을 열어 둔 채 그 경계를 넘을 수 있다.
    vi.useFakeTimers()
    const run = vi.fn(async () => 1)

    await cached('a', run)
    vi.advanceTimersByTime(CACHE_TTL_MS - 1)
    await cached('a', run)
    expect(run).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2)
    await cached('a', run)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('상한을 넘으면 가장 오래된 것부터 버린다', async () => {
    const run = vi.fn(async () => 1)

    for (let i = 0; i <= CACHE_MAX_ENTRIES; i++) await cached(`k${i}`, run)
    expect(run).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 1)

    // 가장 오래된 k0은 밀려났고, 방금 넣은 것은 남아 있다.
    await cached('k0', run)
    expect(run).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 2)
    await cached(`k${CACHE_MAX_ENTRIES}`, run)
    expect(run).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 2)
  })

  it('다시 읽힌 키는 나이가 갱신되지 않는다 — TTL은 응답이 온 시각부터다', async () => {
    // 계속 읽히는 키가 영원히 신선한 척하면 오늘 자 그래프가 cron을 넘겨도
    // 갱신되지 않는다.
    vi.useFakeTimers()
    const run = vi.fn(async () => 1)

    await cached('a', run)
    vi.advanceTimersByTime(CACHE_TTL_MS - 10)
    await cached('a', run)
    vi.advanceTimersByTime(20)
    await cached('a', run)

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('상한을 넘어도 최근에 읽힌 항목은 버려지지 않는다 — LRU는 삽입 순서가 아니라 읽은 순서다', async () => {
    // 검색과 궤적이 늘린 항목 수만큼, keyword_graph처럼 계속 다시 읽히는 값이
    // 삽입 순서만으로 밀려나면 안 된다. 'keep'을 매번 다시 읽어 항상 최근에
    // 읽힌 상태로 유지하면서 새 키를 CACHE_MAX_ENTRIES개 채운 뒤, 하나를 더
    // 넣어 상한을 넘긴다.
    const run = vi.fn(async () => 1)

    await cached('keep', run)
    for (let i = 0; i < CACHE_MAX_ENTRIES - 1; i++) {
      await cached(`k${i}`, run)
      await cached('keep', run) // 'keep'을 매번 다시 읽어 맨 뒤로 옮긴다
    }
    // 지금까지 삽입/재읽기 순서: k0, k1, ..., k(CACHE_MAX_ENTRIES-2), keep
    // (크기는 CACHE_MAX_ENTRIES, 아직 상한을 넘지 않았다)
    expect(run).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES)

    // 한 번 더 넣어 상한을 넘긴다 — 가장 오래 읽히지 않은 k0이 밀려나야 한다.
    await cached(`k${CACHE_MAX_ENTRIES - 1}`, run)
    expect(run).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 1)

    await cached('keep', run)
    expect(run).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 1) // 'keep'은 살아있다

    await cached('k0', run)
    expect(run).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 2) // k0은 밀려났다
  })

  it('최근에 읽어도 TTL은 삽입 시각 기준으로 그대로 만료된다 — LRU가 TTL을 슬라이딩 윈도로 바꾸지 않는다', async () => {
    vi.useFakeTimers()
    try {
      const run = vi.fn(async () => 1)

      await cached('a', run)
      // TTL 만료 직전까지 반복해서 읽어 맨 뒤로 옮긴다 — 읽기가 'at'을
      // 갱신한다면 이 다음 advance로는 만료되지 않아야 한다.
      vi.advanceTimersByTime(CACHE_TTL_MS - 10)
      await cached('a', run)
      vi.advanceTimersByTime(20) // 삽입 시각 기준으로 TTL을 넘긴다
      await cached('a', run)

      expect(run).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clearQueryCache는 전부 비운다', async () => {
    const run = vi.fn(async () => 1)

    await cached('a', run)
    clearQueryCache()
    await cached('a', run)

    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('isReady', () => {
  it('기다릴 필요가 없을 때만 참이다 — 진행 중인 요청은 거짓', async () => {
    // 스켈레톤을 걸지 말지가 이 답에 달려 있다. 아직 날아가고 있는 요청은
    // 캐시에 자리가 있어도 기다려야 하므로 참이면 안 된다.
    let release: (value: number) => void = () => {}
    const run = () => new Promise<number>((resolve) => (release = resolve))

    const pending = cached('a', run)
    expect(isReady('a')).toBe(false)

    release(1)
    await pending
    expect(isReady('a')).toBe(true)
  })

  it('담긴 적 없거나 TTL이 지났으면 거짓이다', async () => {
    vi.useFakeTimers()
    expect(isReady('없음')).toBe(false)

    await cached('a', async () => 1)
    expect(isReady('a')).toBe(true)

    vi.advanceTimersByTime(CACHE_TTL_MS + 1)
    expect(isReady('a')).toBe(false)
  })

  it('실패한 요청은 자리를 남기지 않으므로 거짓이다', async () => {
    await expect(cached('a', () => Promise.reject(new Error('boom')))).rejects.toThrow()
    expect(isReady('a')).toBe(false)
  })
})

describe('cachedQuery', () => {
  it('인자에서 키를 만들어 캐시하고, 같은 인자면 한 번만 돈다', async () => {
    const run = vi.fn(async (date: string, category: string | null) => `${date}/${category}`)
    const query = cachedQuery((date: string, category: string | null) => `k|${date}|${category}`, run)

    const first = await query('2026-08-01', null)
    const second = await query('2026-08-01', null)
    await query('2026-08-02', null)

    expect(run).toHaveBeenCalledTimes(2)
    expect(second).toBe(first)
  })

  it('그 인자로 물어보면 기다릴 일이 있는지 답한다', async () => {
    const query = cachedQuery((date: string) => `k|${date}`, async (date: string) => date)

    expect(query.isReady('2026-08-01')).toBe(false)
    await query('2026-08-01')
    expect(query.isReady('2026-08-01')).toBe(true)
    expect(query.isReady('2026-08-02')).toBe(false)
  })
})
