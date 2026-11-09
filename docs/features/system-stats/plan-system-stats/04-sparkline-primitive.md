# 04 — Sparkline primitive

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Read first: `DESIGN.md` § Primitives (the Meter and Sparkline entries and the conventions list) and § Checks;
`AGENTS.md` § Architecture, the `check-styles.mts` bullet (no raw colour, length or duration in CSS).

Files:
- create `src/shared/page/ui/sparkline.ts` · `src/shared/page/ui/sparkline.css` · test `src/shared/page/ui/sparkline.test.ts`
- modify `src/shared/page/layout-host/kit.d.ts` · `src/shared/page/layout-host/base-kit.ts` ·
  `src/plugins/gallery/page/gallery-view.ts` · `src/shared/page/test-dom.ts`
- test `src/shared/page/layout-host/base-kit.test.ts` (one test added)

Consumes:
- `MeterTone` in `src/shared/page/ui/meter.ts` (in the tree); `element`, `appended` in `src/shared/page/dom.ts` (in the tree)

Produces:
- `src/shared/page/ui/sparkline.ts`:
  - `export function sparklineShape(values: readonly number[]): { viewBox: string; points: string }`
  - `export function sparkline(values: readonly number[], tone: MeterTone): HTMLElement`
- `src/shared/page/layout-host/kit.d.ts`, in `BaseKit` after `meter`:
  ```ts
  // `span.ui-sparkline`: a line of `values` (0–100, oldest first) in `tone`, the tone of the meter beside it; the line
  // spans the part's width whatever the count. To redraw, call it again in a fresh parent part.
  sparkline(parent: HTMLElement, values: readonly number[], tone: MeterTone): HTMLElement;
  ```
- `src/shared/page/layout-host/base-kit.ts`: `sparkline: (parent, values, tone) => appended(parent, sparkline(values, tone))`
- `src/shared/page/test-dom.ts`: `installFakeDom`'s `document` gains
  `createElementNS: (_namespace: string, tag: string) => new FakeElement(tag)`.

Decisions:
- Element tree, built with `document.createElementNS('http://www.w3.org/2000/svg', …)` for the SVG parts:
  `span.ui-sparkline` (`data-tone` = `tone`, `aria-hidden="true"`: the meter and value beside it carry the reading)
  → `svg` (`class="ui-sparkline-svg"`, `viewBox` from `sparklineShape`, `preserveAspectRatio="none"`)
  → `polyline` (`class="ui-sparkline-line"`, `points` from `sparklineShape`). The root is a `span`, so the builder
  returns an `HTMLElement` as `BaseKit` declares and `appended` accepts. SVG parts take their class through
  `setAttribute('class', …)`, since an SVG element's `className` is read-only.
- `sparklineShape`: each value is clamped to 0–100, and a non-finite value (`NaN`) counts as 0, so one bad number
  never blanks the line (an invalid `points` attribute drops the whole polyline). Point `i` is `x = i`, `y = 100 − value`, written `x,y` and joined
  by one space, numbers as JavaScript prints them (no rounding). `viewBox` is `0 0 <max(n − 1, 1)> 100`. One value
  draws a flat line: `0,y 1,y`. No values give `points` `''` (the polyline draws nothing, the space stays).
- The line spans the full width for any count, so a history still filling up stretches; the caller decides how
  many values to pass.
- `sparkline.css`, tokens only:
  - `.ui-sparkline`: `display: block`, `width: 100%`, `height: var(--wg-space-6)`.
  - `.ui-sparkline-svg`: `display: block`, `width: 100%`, `height: 100%`, `overflow: visible`.
  - `.ui-sparkline-line`: `fill: none`, `stroke-width: 1px`, `vector-effect: non-scaling-stroke` (the line stays one
    pixel when the SVG stretches), `stroke-linejoin: round`.
  - `.ui-sparkline[data-tone='normal'] .ui-sparkline-line` `stroke: var(--wg-status-success)`; `'warning'` →
    `var(--wg-status-warning)`; `'critical'` → `var(--wg-status-error)` — the Meter's fill colours.
- Gallery: a `section('Sparkline', sparklineCells)` right after `section('Meter', meterCells)` in `sectionSpecs`.
  `sparklineCells()` returns one row of four wide cells (`cell(sparkline(values, tone), caption, true)`: the line
  fills its parent, and only a wide cell gives it a real width), the Meter's three tones plus the empty state:
  | caption | values | tone |
  |---|---|---|
  | `Normal` | `[12, 18, 15, 30, 26, 22, 35, 28, 31, 24]` | `normal` |
  | `Warning` | `[55, 62, 70, 68, 74, 80, 77, 72, 75, 78]` | `warning` |
  | `Critical` | `[70, 82, 88, 91, 95, 93, 97, 92, 96, 94]` | `critical` |
  | `Empty` | `[]` | `normal` |

GIVEN values `[10, 55, 100]` and tone `critical` WHEN a layout calls `kit.sparkline(parent, values, tone)` THEN
`parent` holds one `span.ui-sparkline` with `data-tone="critical"` whose polyline runs `0,90 1,45 2,0`.
GIVEN the gallery WHEN it opens THEN a Sparkline block shows after the Meter block, in the three tones and empty.

Tests:
- `src/shared/page/ui/sparkline.test.ts`, `sparklineShape_PlacesEachValueAcrossTheWidth` — rows:
  | values | viewBox | points |
  |---|---|---|
  | `[]` | `0 0 1 100` | `''` |
  | `[40]` | `0 0 1 100` | `0,60 1,60` |
  | `[10, 55, 100]` | `0 0 2 100` | `0,90 1,45 2,0` |
  | `[-5, 120, 37.5, 64]` | `0 0 3 100` | `0,100 1,0 2,62.5 3,36` |
  | `[NaN, 50]` | `0 0 1 100` | `0,100 1,50` |
- `src/shared/page/layout-host/base-kit.test.ts`, `sparkline_AppendsALineInItsTone` — beside
  `meter_AppendsAMeterFilledToItsPercentInItsTone`: `kit.sparkline(parent, [10, 55, 100], 'critical')`; `parent`'s
  children are `[node]`, `node.className` is `ui-sparkline`, `node.dataset.tone` is `critical`, its `aria-hidden` is
  `true`, its one child has `class` `ui-sparkline-svg` and `viewBox` `0 0 2 100`, and that child's one child has
  `class` `ui-sparkline-line` and `points` `0,90 1,45 2,0`.
- The gallery's existing `src/plugins/gallery/page/start.test.ts` draws every section through the default layout, so
  it runs the new cells; no new gallery test.

Done when: `npm run typecheck` passes; `npm run lint` passes (`check-styles` included); the two tests above and
`src/plugins/gallery/page/start.test.ts` pass. How the line looks in each tone, in both themes and with reduced
transparency, is a check in "08 — Final verification" (the gallery screenshot).

Commit: one commit for the group.

## Proof

Commit 615c8b4d · proof: diff read: kit.sparkline in kit.d.ts and base-kit.ts present; worker's sparkline, base-kit, layout-contracts, gallery tests pass (64); typecheck clean for 04's files (other errors are 03 in flight) · concerns: docs/keymap.md fails oxfmt --check (pre-existing on the branch, from the docs-ahead commit)
