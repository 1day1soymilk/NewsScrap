// scripts/layout/fixture.ts
//
// 어느 픽스처를 잴 것인지 정하는 한 곳. `measure.ts`, `bridges.ts`,
// `planarity.ts`가 다 이걸 부른다.
//
//   node … measure.ts                              → graphDays.json (기본, 네 날)
//   node … measure.ts scripts/layout/graphDays.fat.json
//
// **파일이 둘인 이유는 표가 둘이어야 하기 때문이다.** 본 표(2026-07-31 ~ 08-03)는
// 게이트를 켜기 전후를 비교하는 자리라 날 구성이 바뀌면 게이트 효과와 날 효과가
// 섞여 원인을 못 짚는다 — 이 저장소가 이미 세 번 물린 함정이다. 두꺼운 날
// (08-04)은 이 하네스가 한 번도 안 재 본 그림이라 값이 있지만, 그 값은 따로
// 읽어야 하는 값이다. 한 파일에 다섯 날을 넣으면 본 표가 조용히 다섯 날짜리가
// 되고 그 구분이 사라진다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import type { GraphEdge } from '../../src/lib/types.ts'

export interface FixtureNode {
  word: string
  count: number
  faded: boolean
  category_slug: string | null
}

export type Fixture = Record<string, { nodes: FixtureNode[]; edges: GraphEdge[] }>

const here = dirname(fileURLToPath(import.meta.url))

/**
 * `argv[2]`의 픽스처를 읽는다. 없으면 `graphDays.json`.
 *
 * 경로를 인자로 받는 것 자체가 이 자의 규칙 하나다: **숫자가 어느 픽스처에서
 * 나왔는지는 숫자만 봐서 알 수 없다.** 그래서 읽은 경로를 같이 돌려주고, 각
 * 스크립트는 표 위에 그것을 찍는다.
 */
export function loadFixture(): { fixture: Fixture; path: string } {
  const path = process.argv[2] ? resolve(process.argv[2]) : join(here, 'graphDays.json')
  return { fixture: JSON.parse(readFileSync(path, 'utf8')) as Fixture, path }
}
