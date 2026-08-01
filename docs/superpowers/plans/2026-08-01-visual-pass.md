# Phase 4 비주얼 패스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 화면 전체에 단일 토큰 체계를 입히고, 카테고리 6색이 실제로 서로 구분되도록 팔레트를 다시 고른다.

**Architecture:** 값의 단일 출처는 `src/index.css`의 `@theme` 블록 하나다. 컴포넌트는 hex를 들고 있지 않고 `var(--color-*)` 문자열만 참조한다. 팔레트가 만족해야 하는 두 규칙(hue 간격 ≥40°, 바탕 대비 ≥4.5:1)은 주석이 아니라 `src/lib/theme.test.ts`가 CSS를 되읽어 강제한다. 레이아웃은 세로 중앙 쌓기에서 상단 스티키 툴바로 바꾸되, 마크업 계약은 건드리지 않는다.

**Tech Stack:** Tailwind v4.3.3 (Vite 플러그인, config 파일 없음), React 19, Vitest 4, Playwright 1.62.

## Global Constraints

이 절은 모든 태스크의 요구사항에 암묵적으로 포함된다.

- **스펙:** `docs/superpowers/specs/2026-08-01-visual-pass-design.md`
- **`<nav>`는 `CategoryTabs` 하나뿐이어야 한다.** `e2e/smoke.spec.ts:19`가 `getByRole('navigation').getByRole('button')`을 **7개**로 센다. 다른 곳을 `<nav>`로 감싸면 strict mode 위반으로 깨진다.
- **`<text>`와 `<line>`의 `opacity` / `strokeOpacity`는 속성(attribute)으로 남긴다.** `e2e/keywordGraph.spec.ts`가 `toHaveAttribute('opacity', '1')`과 `'0.1'`을 직접 검사한다. `style`로 옮기면 속성이 사라져 깨진다. 이번 작업에서 `style`로 옮기는 것은 **`fill`과 `stroke`뿐**이다.
- **`KeywordGraph.tsx`의 `FONT_FAMILY = 'sans-serif'`는 변경 금지.** canvas `measureText`와 `<text fontFamily>`가 같은 문자열이어야 측정 폭과 렌더 폭이 맞는다. 어긋나면 라벨이 겹친다.
- **헤드라인 패널은 `fixed` 오버레이로 유지한다.** 문서 흐름에 넣어 그래프 폭을 줄이면 `ResizeObserver`가 새 폭을 물고 `computeGraphLayout`이 다시 돈다 — 단어를 누를 때마다 그래프가 재배치된다.
- **깨면 안 되는 셀렉터:** `<aside>`(complementary), `svg text` / `svg line` / `svg polygon`, `input[type="date"]`, `data-testid="graph-skeleton"` / `"headline-skeleton"`, 단어 버튼 `aria-label` 형식 `단어, N건[, 급상승 문구]`, 버튼 이름 `이전 수집일` / `다음 수집일` / `다시 시도` / `닫기`, 텍스트 `오늘의 주요 뉴스 스크랩`(heading) / `오늘의 톱 스토리` / `직전 수집일 대비 급상승` / `아직 수집된 데이터가 없습니다.` / `관련 헤드라인이 없습니다.`
- **tsconfig를 손대지 않는다.** `tsconfig.app.json`의 `types`에 `node`가 없으므로 `src/` 안에서 `node:fs`를 쓸 수 없다. CSS를 읽어야 하는 곳은 Vite의 `?raw` 임포트를 쓴다 — `vite/client`가 `*?raw`를 `string`으로 이미 선언하고 있다.
- **게이트는 `npm run build`다.** `npm test`만으로는 컴파일 안 되는 코드가 통과한다.

### 확정된 팔레트

계산으로 검증된 값이다(측정 스크립트 결과, Task 2의 테스트가 같은 규칙을 재확인한다).

| 토큰 | 값 | hue | 대비 (vs `#f8fafc`) |
|---|---|---|---|
| `--color-section-politics` | `#be123c` | 345° | 6.01:1 |
| `--color-section-economy` | `#15803d` | 142° | 4.79:1 |
| `--color-section-society` | `#3f6212` | 86° | 6.76:1 |
| `--color-section-culture` | `#a21caf` | 295° | 6.04:1 |
| `--color-section-world` | `#155e75` | 194° | 6.95:1 |
| `--color-section-it` | `#4338ca` | 245° | 7.55:1 |
| `--color-surge` | `#854d0e` | 32° | 6.55:1 |

6색 중 가장 가까운 쌍의 hue 간격은 **50.1°**, 급상승 색은 어느 카테고리와도 **46.4°** 떨어져 있다. 잉크 3단계는 `#0f172a` 17.06:1, `#475569` 7.24:1, `#64748b` 4.55:1로 전부 통과한다.

---

### Task 1: 색 계산 헬퍼

순수 함수만 든 모듈. Task 2의 제약 테스트가 이걸 쓴다.

**Files:**
- Create: `src/lib/colorMath.ts`
- Test: `src/lib/colorMath.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `hexToRgb(hex: string): Rgb`, `relativeLuminance(hex: string): number`, `contrastRatio(a: string, b: string): number`, `hue(hex: string): number | null`, `hueDistance(a: number, b: number): number`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/colorMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { contrastRatio, hexToRgb, hue, hueDistance, relativeLuminance } from './colorMath'

describe('hexToRgb', () => {
  it('parses a six-digit hex', () => {
    expect(hexToRgb('#4338ca')).toEqual({ r: 0x43, g: 0x38, b: 0xca })
  })

  // A silently-wrong colour is worse than a crash here: every rule in
  // theme.test.ts is computed from these numbers.
  it('rejects anything that is not a six-digit hex', () => {
    expect(() => hexToRgb('#abc')).toThrow()
    expect(() => hexToRgb('rebeccapurple')).toThrow()
  })
})

describe('relativeLuminance', () => {
  it('runs from 0 at black to 1 at white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })
})

describe('contrastRatio', () => {
  it('gives WCAG 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2)
  })

  it('gives 1:1 for a colour against itself', () => {
    expect(contrastRatio('#15803d', '#15803d')).toBeCloseTo(1, 5)
  })

  it('does not care which argument is lighter', () => {
    expect(contrastRatio('#0f172a', '#f8fafc')).toBeCloseTo(
      contrastRatio('#f8fafc', '#0f172a'),
      10,
    )
  })
})

describe('hue', () => {
  it('places the primaries at 0, 120 and 240 degrees', () => {
    expect(hue('#ff0000')).toBeCloseTo(0, 4)
    expect(hue('#00ff00')).toBeCloseTo(120, 4)
    expect(hue('#0000ff')).toBeCloseTo(240, 4)
  })

  // Grey has no hue, and the spacing rule cannot be applied to it. Returning 0
  // would put it next to red and quietly pass a rule it was never subject to.
  it('returns null for a colour with no chroma', () => {
    expect(hue('#64748b')).not.toBeNull()
    expect(hue('#808080')).toBeNull()
  })
})

describe('hueDistance', () => {
  it('measures the short way around the wheel', () => {
    expect(hueDistance(350, 10)).toBeCloseTo(20, 5)
    expect(hueDistance(10, 350)).toBeCloseTo(20, 5)
  })

  it('caps at half a turn', () => {
    expect(hueDistance(0, 180)).toBeCloseTo(180, 5)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/colorMath.test.ts`
Expected: FAIL — `Failed to resolve import "./colorMath"`

- [ ] **Step 3: 구현한다**

`src/lib/colorMath.ts`:

```ts
// WCAG 2.1 contrast and plain HSL hue, used by theme.test.ts to hold the
// palette to the two rules it was chosen to satisfy. Kept here rather than in
// the test so the arithmetic itself is covered.

export interface Rgb {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.startsWith('#') ? hex.slice(1) : hex
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`not a six-digit hex colour: ${hex}`)
  }
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

function linearise(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)
}

export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

// Degrees around the colour wheel. Null for an achromatic colour: it has no
// hue, so the separation rule does not apply to it and must not be faked.
export function hue(hex: string): number | null {
  const { r, g, b } = hexToRgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return null

  let degrees: number
  if (max === r) degrees = 60 * (((g - b) / delta) % 6)
  else if (max === g) degrees = 60 * ((b - r) / delta + 2)
  else degrees = 60 * ((r - g) / delta + 4)

  return (degrees + 360) % 360
}

// The short way round, so 350 and 10 are 20 degrees apart rather than 340.
export function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360
  return raw > 180 ? 360 - raw : raw
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/colorMath.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/colorMath.ts src/lib/colorMath.test.ts
git commit -m "Add the contrast and hue arithmetic the palette rules need"
```

---

### Task 2: 디자인 토큰과 제약 테스트

값의 단일 출처를 만들고, 팔레트 규칙을 테스트로 고정한다.

**Files:**
- Modify: `src/index.css` (현재 1줄)
- Test: `src/lib/theme.test.ts`

**Interfaces:**
- Consumes: Task 1의 `contrastRatio`, `hue`, `hueDistance`
- Produces: CSS 커스텀 프로퍼티 — `--color-ground`, `--color-surface`, `--color-line`, `--color-ink`, `--color-ink-muted`, `--color-ink-faint`, `--color-section-{politics,economy,society,culture,world,it}`, `--color-surge`, `--color-edge`, `--color-cluster`, `--color-top-story`, `--color-danger`, `--font-sans`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
// Vite hands back the file's source text. tsconfig.app.json has no "node" in
// its types, so node:fs is not available here, and adding it would let any
// browser module import a node builtin.
import cssSource from '../index.css?raw'
import { contrastRatio, hue, hueDistance } from './colorMath'

// src/index.css is the only place these values live. Reading them back is what
// stops a later edit from quietly breaking the rules the palette was picked to
// satisfy — the alternative is a comment, and comments do not fail a build.
function token(name: string): string {
  const match = cssSource.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`--${name} is not defined in src/index.css`)
  return match[1]
}

const SECTIONS = ['politics', 'economy', 'society', 'culture', 'world', 'it'] as const
const MIN_HUE_SEPARATION = 40
const MIN_CONTRAST = 4.5

function sectionHue(slug: string): number {
  const degrees = hue(token(`color-section-${slug}`))
  if (degrees === null) throw new Error(`--color-section-${slug} has no hue`)
  return degrees
}

describe('section palette', () => {
  it('clears 4.5:1 against the ground', () => {
    // 4.5 rather than the 3:1 allowed for large text: MIN_FONT_SIZE is 14, so
    // the smallest label on the graph is small text.
    const ground = token('color-ground')
    for (const slug of SECTIONS) {
      expect(contrastRatio(token(`color-section-${slug}`), ground)).toBeGreaterThanOrEqual(
        MIN_CONTRAST,
      )
    }
  })

  // The rule this whole task exists for. The palette it replaces had economy,
  // world, society and IT inside one 80-degree band, two of them 22 degrees
  // apart, so four of the six sections were not tellable apart by colour.
  it('keeps every pair of sections at least 40 degrees apart', () => {
    for (let i = 0; i < SECTIONS.length; i += 1) {
      for (let j = i + 1; j < SECTIONS.length; j += 1) {
        const separation = hueDistance(sectionHue(SECTIONS[i]), sectionHue(SECTIONS[j]))
        expect(
          separation,
          `${SECTIONS[i]} and ${SECTIONS[j]} are ${separation.toFixed(1)} degrees apart`,
        ).toBeGreaterThanOrEqual(MIN_HUE_SEPARATION)
      }
    }
  })
})

describe('surge colour', () => {
  // The marker is drawn touching its word. Sharing a hue band with any section
  // would make it read as part of the label rather than as a claim about it.
  it('is reserved from every section hue', () => {
    const surge = hue(token('color-surge'))
    expect(surge).not.toBeNull()
    for (const slug of SECTIONS) {
      expect(hueDistance(surge!, sectionHue(slug))).toBeGreaterThanOrEqual(MIN_HUE_SEPARATION)
    }
  })

  it('clears 4.5:1 against the ground', () => {
    expect(contrastRatio(token('color-surge'), token('color-ground'))).toBeGreaterThanOrEqual(
      MIN_CONTRAST,
    )
  })
})

describe('ink scale', () => {
  it('is readable at all three levels', () => {
    const ground = token('color-ground')
    for (const name of ['color-ink', 'color-ink-muted', 'color-ink-faint']) {
      expect(contrastRatio(token(name), ground), name).toBeGreaterThanOrEqual(MIN_CONTRAST)
    }
  })
})

describe('cluster shading', () => {
  // Two overlapping washes double their opacity, which is how the old palette
  // let a pair of ordinary clusters land on the top story's strength. Neutral
  // grey cannot stack into blue, so the failure mode goes away structurally
  // rather than by tuning a number.
  it('separates the top story from ordinary clusters by hue, not by opacity', () => {
    expect(hue(token('color-cluster'))).toBeNull()
    expect(hue(token('color-top-story'))).not.toBeNull()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: FAIL — `--color-ground is not defined in src/index.css`

- [ ] **Step 3: 토큰을 정의한다**

`src/index.css` 전체를 아래로 바꾼다:

```css
@import "tailwindcss";

/* Tailwind v4 through the Vite plugin — there is no config file. Everything in
   @theme is emitted as a custom property on :root, which is what lets
   KeywordGraph.tsx reference these as var() strings instead of holding a
   second copy of every hex.

   src/lib/theme.test.ts reads this block back and enforces the two rules the
   palette was chosen to satisfy. Change a value here and that test is the
   thing that tells you whether the change is allowed. */
@theme {
  --font-sans: ui-sans-serif, system-ui, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;

  --color-ground: #f8fafc;
  --color-surface: #ffffff;
  --color-line: #e2e8f0;

  --color-ink: #0f172a;
  --color-ink-muted: #475569;
  --color-ink-faint: #64748b;

  /* The six sections. Closest pair is 50.1 degrees apart; every one clears
     4.5:1 on --color-ground. The palette this replaces had four of the six
     inside one 80-degree band. */
  --color-section-politics: #be123c; /* 345deg */
  --color-section-economy: #15803d; /* 142deg */
  --color-section-society: #3f6212; /* 86deg */
  --color-section-culture: #a21caf; /* 295deg */
  --color-section-world: #155e75; /* 194deg */
  --color-section-it: #4338ca; /* 245deg */

  /* Reserved: 46.4 degrees from the nearest section colour, because the marker
     is drawn touching a word and would otherwise read as part of it. */
  --color-surge: #854d0e; /* 32deg */

  /* Graph structure. The edge colour is slate — it is a line, so it only has
     to stay quieter than the labels. */
  --color-edge: #64748b;
  /* The cluster wash is a true achromatic grey, not slate. Slate's hue is
     215deg and the top story's is 221deg, so a slate wash would be within six
     degrees of the thing it has to be told apart from — the opacity problem
     again, one layer down. src/lib/theme.test.ts asserts this one has no hue
     at all. */
  --color-cluster: #737373;
  --color-top-story: #2563eb;

  /* Only ever rendered in place of the graph, never beside it, so it is free
     to sit near the politics hue. */
  --color-danger: #b91c1c;
}

/* Set explicitly rather than relying on Tailwind's default-font-family
   plumbing, so the page ground and ink do not depend on a preflight internal. */
@layer base {
  html {
    background-color: var(--color-ground);
    color: var(--color-ink);
    font-family: var(--font-sans);
  }

  /* The sticky toolbar's height, which the headline panel has to start below.
     It is here rather than as a Tailwind class on both because the two would
     otherwise agree only by coincidence: the toolbar wraps to two rows below
     lg, and a panel pinned to a single hard-coded offset covers the tab row in
     exactly the sm-to-lg range. The breakpoint below must stay equal to the
     toolbar's lg:flex-row in src/App.tsx. */
  :root {
    --header-height: 6.5rem;
  }

  @media (width >= 64rem) {
    :root {
      --header-height: 3.75rem;
    }
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: 타입 체크**

Run: `npm run build`
Expected: 성공. `?raw` 임포트가 `vite/client` 타입으로 해결되는지 확인하는 단계다.

- [ ] **Step 6: 커밋**

```bash
git add src/index.css src/lib/theme.test.ts
git commit -m "Define the design tokens and hold the palette to its rules in a test"
```

---

### Task 3: 그래프 캔버스가 토큰을 쓰게 한다

`KeywordGraph.tsx`에서 하드코딩된 색 상수를 전부 `var()` 참조로 바꾼다.

**Files:**
- Modify: `src/components/KeywordGraph.tsx:25-60` (색 상수), `:179-198` (캡션), `:216-224` (폴리곤), `:240` (간선), `:280`·`:296` (텍스트 fill)
- Test: `e2e/keywordGraph.spec.ts` (새 테스트 1개 추가)

**Interfaces:**
- Consumes: Task 2의 CSS 커스텀 프로퍼티
- Produces: 없음 (내부 변경)

- [ ] **Step 1: 실패하는 e2e 테스트를 쓴다**

`e2e/keywordGraph.spec.ts` 맨 끝에 추가한다. **이 테스트가 이 태스크의 진짜 위험을 잡는다** — `var()`를 SVG에 넘겼을 때 실제로 해석되는지. 해석이 안 되면 `fill`이 기본값 검정으로 떨어지는데, 눈으로는 "그냥 검은 글자"라 멀쩡해 보인다.

```ts
test('resolves the design tokens to real colours in the SVG', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  // 예산안 is a politics word in the fixture and the all-categories view is the
  // default, so it must render in the politics ink rather than falling back to
  // the neutral one.
  const word = page.locator('svg text').filter({ hasText: /^예산안$/ })
  await expect(word).toBeVisible()
  const fill = await word.evaluate((el) => getComputedStyle(el).fill)
  // #be123c. An unresolved var() computes to rgb(0, 0, 0) here, which is the
  // failure this test exists for.
  expect(fill).toBe('rgb(190, 18, 60)')

  // The one blob is the top story, so it takes the blue rather than the grey.
  const blobFill = await page
    .locator('svg polygon')
    .evaluate((el) => getComputedStyle(el).fill)
  expect(blobFill).toBe('rgb(37, 99, 235)')
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx playwright test e2e/keywordGraph.spec.ts -g "resolves the design tokens"`
Expected: FAIL — `expected 'rgb(180, 83, 9)' to be 'rgb(190, 18, 60)'` (아직 옛 팔레트라 `#b45309`가 나온다)

- [ ] **Step 3: 색 상수를 토큰 참조로 바꾼다**

`src/components/KeywordGraph.tsx:25-60`의 상수 블록을 아래로 교체한다:

```ts
// Every colour here is a reference into the @theme block in src/index.css,
// which is the single source of truth. Holding hex values in this file was
// what let the old six-section palette drift into an 80-degree band without
// anything noticing; src/lib/theme.test.ts now enforces the spacing.
const CATEGORY_COLORS: Record<string, string> = {
  politics: 'var(--color-section-politics)',
  economy: 'var(--color-section-economy)',
  society: 'var(--color-section-society)',
  culture: 'var(--color-section-culture)',
  world: 'var(--color-section-world)',
  it: 'var(--color-section-it)',
}
const NEUTRAL_COLOR = 'var(--color-ink)'
// Edges read as structure rather than as text, so they get their own colour.
// They can afford to be this solid because routing stops them short of every
// label — nothing is drawn underneath a word for them to fight with.
const EDGE_COLOR = 'var(--color-edge)'

// Ordinary clusters are achromatic and the top story is not. Two overlapping
// washes double to 0.14, which is why distinguishing them by opacity failed:
// that landed on exactly the strength that was meant to single the top story
// out. Grey cannot stack into blue, so the ambiguity is gone by construction
// and the top story's own opacity can come down.
const CLUSTER_TINT = 'var(--color-cluster)'
const CLUSTER_OPACITY = 0.07
const TOP_STORY_TINT = 'var(--color-top-story)'
const TOP_STORY_OPACITY = 0.1

// Day-over-day movement. One glyph for both "new" and "surging": a word that
// was not there yesterday is the limiting case of one that grew, and two
// symbols would need a legend to tell apart what the tooltip already says.
const SURGE_MARK = '▲'
const SURGE_COLOR = 'var(--color-surge)'
```

`FADED_OPACITY`, `UNFOCUSED_OPACITY`, `SURGE_GAP`, `SURGE_MIN_SIZE`, `SURGE_MAX_SIZE`, `SURGE_ALLOWANCE`는 그대로 둔다.

- [ ] **Step 4: `fill`과 `stroke`를 `style`로 옮긴다**

`var()`는 프레젠테이션 속성에서 브라우저별로 신뢰할 수 없으므로 인라인 `style`로 넘긴다. **`opacity`와 `strokeOpacity`는 속성으로 남긴다** — e2e가 직접 검사한다.

폴리곤 (`:216-224`):

```tsx
<polygon
  key={cluster.words[0]}
  points={cluster.hull.map((p) => `${p.x},${p.y}`).join(' ')}
  style={{
    fill: index === 0 ? TOP_STORY_TINT : CLUSTER_TINT,
    stroke: index === 0 ? TOP_STORY_TINT : CLUSTER_TINT,
  }}
  strokeWidth={CLUSTER_ROUNDING}
  strokeLinejoin="round"
  opacity={index === 0 ? TOP_STORY_OPACITY : CLUSTER_OPACITY}
/>
```

간선 (`:240` 부근) — `stroke={EDGE_COLOR}`를 지우고 `style`을 넣는다:

```tsx
<line
  key={`${edge.a}--${edge.b}--${index}`}
  x1={segment.x1}
  y1={segment.y1}
  x2={segment.x2}
  y2={segment.y2}
  style={{ stroke: EDGE_COLOR }}
  strokeLinecap="round"
  strokeWidth={1.4 + 2.6 * edge.npmi}
  strokeOpacity={touchesSelection ? 0.45 + 0.4 * edge.npmi : 0.12}
/>
```

급상승 마커 (`:280`) — `fill={SURGE_COLOR}` → `style={{ fill: SURGE_COLOR }}`.

단어 라벨 (`:296`) — `fill={color}` → `style={{ fill: color }}`.

- [ ] **Step 5: 캡션과 빈 상태를 토큰 유틸리티로 바꾼다**

`:180` 톱 스토리 캡션:

```tsx
<p className="mb-3 text-center text-sm text-ink-muted">
  <span className="mr-2 rounded-full bg-top-story/10 px-2 py-0.5 text-top-story">
    오늘의 톱 스토리
  </span>
  {topStory.words.join(' · ')}
  <span className="ml-2 text-ink-faint">{topStory.headlines}건</span>
</p>
```

`:192` 급상승 범례: `text-gray-500` → `text-ink-muted`.

`:148` 빈 상태: `text-gray-500` → `text-ink-muted`.

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

```bash
npm run build
npx playwright test e2e/keywordGraph.spec.ts
```

Expected: build 성공, 그래프 e2e 전부 PASS. 특히 기존 `toHaveAttribute('opacity', '1')` / `'0.1'` 테스트가 살아 있어야 한다 — 깨졌다면 `opacity`를 `style`로 옮긴 것이다.

- [ ] **Step 7: 커밋**

```bash
git add src/components/KeywordGraph.tsx e2e/keywordGraph.spec.ts
git commit -m "Draw the graph in the design tokens and prove they resolve"
```

---

### Task 4: 상단 툴바와 컨트롤

세로 중앙 쌓기를 스티키 상단 툴바로 바꾸고 컨트롤에 토큰을 입힌다.

**Files:**
- Modify: `src/App.tsx:210-245` (셸과 컨트롤), `:283-296` (스켈레톤)
- Modify: `src/components/CategoryTabs.tsx`
- Test: `src/components/CategoryTabs.test.tsx` (기존, 변경 없이 통과해야 함), `e2e/appControls.spec.ts` (기존)

**Interfaces:**
- Consumes: Task 2의 토큰
- Produces: 없음 (`CategoryTabs`의 props는 그대로)

- [ ] **Step 1: 기준선을 잡는다**

Run: `npx vitest run src/components/CategoryTabs.test.tsx && npx playwright test e2e/appControls.spec.ts`
Expected: 둘 다 PASS. 이 태스크는 **이 결과를 바꾸지 않는 것**이 성공 조건이다.

- [ ] **Step 2: `CategoryTabs`에 토큰을 입힌다**

`<nav>`는 유지한다 — smoke가 이 안의 버튼을 7개로 센다.

```tsx
export function CategoryTabs({ categories, selected, onSelect }: CategoryTabsProps) {
  // aria-pressed as well as the fill: which tab is on is now part of the
  // state a link restores, and colour alone does not say so to a screen
  // reader or to a test.
  const className = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm transition-colors ${
      active
        ? 'bg-ink text-surface'
        : 'bg-surface text-ink-muted ring-1 ring-line hover:text-ink'
    }`

  return (
    <nav className="flex flex-wrap justify-center gap-2 sm:justify-end">
      <button onClick={() => onSelect(null)} aria-pressed={selected === null} className={className(selected === null)}>
        전체
      </button>
      {categories.map((category) => (
        <button
          key={category.slug}
          onClick={() => onSelect(category.slug)}
          aria-pressed={selected === category.slug}
          className={className(selected === category.slug)}
        >
          {category.label}
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 3: 셸을 상단 툴바로 바꾼다**

`src/App.tsx`의 `return (` 안, `<div className="min-h-svh p-6">`부터 `</div>` 닫힘까지를 아래 구조로 바꾼다. 헤딩 텍스트·버튼 `aria-label`·`input[type="date"]`는 글자 하나 바꾸지 않는다.

```tsx
return (
  <div className="min-h-svh bg-ground text-ink">
    {/* Sticky so the date and the tabs stay reachable while the graph is
        scrolled. The panel is offset below this in HeadlinePanel, or it
        would cover the controls it is a response to. */}
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">오늘의 주요 뉴스 스크랩</h1>

          {/* Not a <nav>: smoke.spec.ts counts the buttons inside the one
              navigation landmark on the page, and that is CategoryTabs. */}
          <div className="flex items-center gap-1">
            {/* Stepping to the neighbouring collected date rather than by a
                calendar day: the archive has gaps, and today itself is empty
                until the 13:00 KST cron has run. */}
            <button
              onClick={() => previousDate && setSelectedDate(previousDate)}
              disabled={!previousDate}
              aria-label="이전 수집일"
              className="rounded-md px-2 py-1 text-sm text-ink-muted hover:bg-ground hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              ‹
            </button>
            <input
              type="date"
              value={selectedDate}
              min={availableDates[availableDates.length - 1]}
              max={availableDates[0]}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
            />
            <button
              onClick={() => nextDate && setSelectedDate(nextDate)}
              disabled={!nextDate}
              aria-label="다음 수집일"
              className="rounded-md px-2 py-1 text-sm text-ink-muted hover:bg-ground hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              ›
            </button>
          </div>
        </div>

        <CategoryTabs categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />
      </div>
    </header>

    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {error && (
        <div className="text-center">
          <p className="mb-2 text-danger">{error}</p>
          <button
            onClick={() => loadGraph()}
            className="rounded-md border border-line bg-surface px-3 py-1 text-sm text-ink-muted hover:text-ink"
          >
            다시 시도
          </button>
        </div>
      )}
      {!error && loading && <GraphSkeleton />}
      {!error && !loading && (
        <KeywordGraph
          graph={graph}
          selectedWord={selectedWord}
          // Clicking a lit word again clears the focus and closes the panel.
          onWordClick={(word) => setSelectedWord((current) => (current === word ? null : word))}
          colorByCategory={selectedCategory === null}
          surges={surges}
        />
      )}
    </main>

    <HeadlinePanel
      word={selectedWord}
      headlines={headlinesForWord}
      categories={categories}
      loading={headlinesLoading}
      error={headlinesError}
      onClose={() => setSelectedWord(null)}
    />
  </div>
)
```

- [ ] **Step 4: 스켈레톤에 토큰을 입힌다**

`src/App.tsx`의 `GraphSkeleton`에서 `bg-gray-200` → `bg-line`, `bg-gray-100` → `bg-ground`. 나머지(`data-testid`, `role`, `aria-*`)는 그대로.

- [ ] **Step 5: 아무것도 깨지지 않았는지 확인한다**

```bash
npm run build
npx vitest run src/components/CategoryTabs.test.tsx
npx playwright test e2e/appControls.spec.ts e2e/keywordGraph.spec.ts
```

Expected: 전부 PASS. `appControls.spec.ts`가 깨지면 `aria-label`이나 `input[type="date"]`을 건드린 것이다.

- [ ] **Step 6: 커밋**

```bash
git add src/App.tsx src/components/CategoryTabs.tsx
git commit -m "Move the controls into a sticky toolbar and dress them in the tokens"
```

---

### Task 5: 헤드라인 패널

패널에 토큰을 입히고, 데스크톱에서 툴바를 덮지 않게 내린다.

**Files:**
- Modify: `src/components/HeadlinePanel.tsx:48-113`
- Test: `src/components/HeadlinePanel.test.tsx` (기존), `e2e/headlinePanel.spec.ts` (기존)

**Interfaces:**
- Consumes: Task 2의 토큰
- Produces: 없음 (props 변경 없음)

- [ ] **Step 1: 기준선을 잡는다**

Run: `npx vitest run src/components/HeadlinePanel.test.tsx && npx playwright test e2e/headlinePanel.spec.ts`
Expected: PASS

- [ ] **Step 2: `<aside>`를 다시 칠하고 위치를 내린다**

`<aside>` 태그와 `aria-label`은 유지한다 — e2e가 `getByRole('complementary')`로 잡는다. `fixed`도 유지한다: 문서 흐름에 넣으면 그래프 폭이 바뀌어 시뮬레이션이 다시 돈다.

```tsx
// Bottom sheet on a phone, side drawer from `sm` up. The fixed 320px drawer
// it replaces covered most of the graph on a narrow screen, so clicking a
// word hid the thing that had just been clicked.
//
// Starting below the toolbar rather than at sm:top-0: the toolbar is sticky,
// and a panel starting at the top of the viewport covered the date and the
// tabs, so choosing a word took away the controls for choosing a different
// one. The offset is --header-height from src/index.css rather than a literal,
// because the toolbar wraps to two rows below lg and any single hard-coded
// value is wrong on one side of that breakpoint.
<aside
  className="fixed inset-x-0 bottom-0 z-20 max-h-[70svh] overflow-y-auto rounded-t-xl border-t border-line bg-surface p-4 shadow-lg sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-(--header-height) sm:max-h-none sm:w-80 sm:rounded-none sm:border-l sm:border-t-0"
  aria-label={`"${word}" 관련 헤드라인`}
>
```

- [ ] **Step 3: 내용물에 토큰을 입힌다**

같은 파일에서 색 유틸리티만 바꾼다. 텍스트와 구조는 그대로다.

- 제목 옆 건수: `text-gray-500` → `text-ink-faint`
- 닫기 버튼: `text-gray-500 hover:text-gray-900` → `text-ink-faint hover:text-ink`
- 오류: `text-red-600` → `text-danger`
- 빈 상태: `text-gray-500` → `text-ink-muted`
- 카테고리 뱃지: `bg-gray-100 text-gray-600` → `bg-ground text-ink-muted ring-1 ring-line`
- 링크: `text-blue-700` → `text-top-story`
- `HeadlineSkeleton`의 `bg-gray-200` → `bg-line`

- [ ] **Step 4: 확인한다**

```bash
npm run build
npx vitest run src/components/HeadlinePanel.test.tsx
npx playwright test e2e/headlinePanel.spec.ts
```

Expected: 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/HeadlinePanel.tsx
git commit -m "Dress the headline panel and stop it covering the toolbar"
```

---

### Task 6: 잔재 정리와 전체 게이트

**Files:**
- Delete: `public/icons.svg`
- Modify: `index.html`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 2–5 전부
- Produces: 없음

- [ ] **Step 1: 참조가 없음을 다시 확인하고 지운다**

```bash
grep -rn "icons.svg" --include=*.ts --include=*.tsx --include=*.html --include=*.css . | grep -v node_modules
```

Expected: 출력 없음. 그러면:

```bash
git rm public/icons.svg
```

- [ ] **Step 2: `index.html`을 고친다**

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>오늘의 주요 뉴스 스크랩</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: `CLAUDE.md`에 토큰 규칙을 적는다**

"Drawing the graph" 절 바로 앞에 새 절을 넣는다:

```markdown
### Design tokens

Every colour on screen is defined once, in the `@theme` block in
`src/index.css`. Components hold `var(--color-*)` strings, never hex — a second
copy of a hex value is how the six section colours drifted into an 80-degree
band, four of them indistinguishable in the all-categories view.

`src/lib/theme.test.ts` reads that block back and fails the build if the
palette breaks either rule it was chosen to satisfy: **no two sections within
40° of hue**, and **4.5:1 against the ground** (4.5 rather than the 3:1 for
large text, because `MIN_FONT_SIZE` is 14). The surge colour is held 40° clear
of all six as well, because the marker is drawn touching its word.

**Ordinary clusters are achromatic and the top story is not.** Distinguishing
them by opacity failed: two overlapping washes at 0.07 double to 0.14, landing
on exactly the strength meant to single the top story out. Grey cannot stack
into blue, so do not reintroduce a coloured tint for ordinary clusters.

The cluster wash is a true grey (`#737373`), **not slate**. Slate-500 is the
obvious thing to reach for and it is wrong here: its hue is 215° against the
top story's 221°, six degrees apart, which puts the wash back in the same hue
as the thing it exists to be told apart from.

SVG `fill` and `stroke` go through inline `style`, not presentation attributes —
`var()` is unreliable in the latter. `opacity` and `stroke-opacity` stay
attributes: `e2e/keywordGraph.spec.ts` asserts on them directly.
```

- [ ] **Step 4: 전체 게이트를 돌린다**

`playwright.config.ts`가 `reuseExistingServer: true`이므로 먼저 dev 서버를 내린다.

```bash
npm run build
npm test
npm run lint
npm run test:e2e
```

Expected: build 성공, Vitest 전부 통과, oxlint 0 경고, Playwright 28개 통과(기존 27 + Task 3에서 추가한 1개). `.env`가 없으면 smoke 1개가 별개 사유로 실패하며, 그건 이 작업과 무관하다.

- [ ] **Step 5: 눈으로 확인한다**

`npm run dev` 후 두 가지만 본다. 스펙의 검증 절이 요구하는 항목이다.

1. '전체' 보기에서 여섯 섹션이 서로 구분되는가 — 특히 경제·세계·IT·사회가 이전처럼 뭉쳐 보이지 않는가.
2. 클러스터가 여럿인 날에 회색 블롭 두 개가 겹친 자리가 톱 스토리(파랑)로 오인되지 않는가.
3. **창 너비를 좁혔다 넓히며** 단어를 하나 고른 채로 패널 상단이 툴바와 맞물리는가. `--header-height`는 실측이 아니라 추정값이므로, 툴바가 한 줄↔두 줄로 바뀌는 `lg` 경계 양쪽에서 패널이 툴바를 덮거나 사이가 뜨면 `src/index.css`의 두 값을 조정한다.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "Drop the template leftovers and write down the token rules"
```

---

## Self-Review

**스펙 커버리지**

| 스펙 요구사항 | 태스크 |
|---|---|
| `@theme` 토큰 체계 | 2 |
| 시스템 산세리프 스택, 웹폰트 없음 | 2 |
| hue 간격 ≥40° | 2 (테스트), 확정값은 Global Constraints |
| 바탕 대비 ≥4.5:1 | 2 (테스트) |
| 급상승 색 hue 예약 | 2 (테스트) |
| 클러스터 회색 / 톱 스토리 파랑 | 2 (토큰), 3 (적용) |
| 그래프 라벨 폰트 불변 | Global Constraints |
| 상단 스티키 툴바 | 4 |
| 패널 오버레이 유지 | Global Constraints, 5 |
| 패널을 툴바 아래로 | 5 |
| 마크업 계약 | Global Constraints, 각 태스크 검증 단계 |
| `public/icons.svg` 삭제 | 6 |
| `index.html` lang / title | 6 |
| 검증 3종 + 대비 계산 + 눈으로 볼 것 2개 | 6 |

스펙이 "미결"로 남긴 hex 값은 계획 작성 중 계산으로 확정해 Global Constraints 표에 넣었다. 남은 placeholder는 없다.

**타입 일관성**

`colorMath.ts`가 내보내는 이름(`hexToRgb`, `relativeLuminance`, `contrastRatio`, `hue`, `hueDistance`)은 Task 1의 테스트와 Task 2의 `theme.test.ts`에서 같은 철자로 쓰인다. `hue`는 `number | null`을 돌려주므로 `theme.test.ts`의 `sectionHue`가 null을 걸러 `number`로 좁힌 뒤 `hueDistance`에 넘긴다.
