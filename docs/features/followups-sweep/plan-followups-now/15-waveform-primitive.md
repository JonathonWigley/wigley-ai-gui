# 15 — Shared waveform primitive

Status: done
Type: Task
Rung: standard · promotes a plugin-local SVG builder to a shared primitive the way Sparkline is built (`src/shared/page/ui/sparkline.ts`: a pure shape function plus a builder, its CSS beside it, a gallery section and a `DESIGN.md` § Primitives row)
Wave: 2 · Depends on: 14 (both list `src/plugins/gallery/page/gallery-view.ts` and `DESIGN.md`)
Plan: [plan.md](plan.md)

Follow-up: `followups.md` L580, "Promote the audio picker's waveform to a shared ui primitive".

Files:     create `src/shared/page/ui/waveform.ts` · create `src/shared/page/ui/waveform.css` ·
           test `src/shared/page/ui/waveform.test.ts` · modify `src/plugins/audio-picker/page/layout/picker-kit.ts` ·
           test `src/plugins/audio-picker/page/layout/picker-kit.test.ts` ·
           modify `src/plugins/audio-picker/layouts/default/layout.css` ·
           modify `src/plugins/audio-picker/layouts/layout.d.ts` · modify `src/plugins/gallery/page/gallery-view.ts` ·
           modify `DESIGN.md`

Preconditions (checked 2026-11-17 on `main` 9b671bd16, from the `wigley-ai-gui/` folder):

| Claim | Command | Expected |
|---|---|---|
| The waveform is a local helper in the picker kit | `grep -n "function waveform\|waveform: (parent)" src/plugins/audio-picker/page/layout/picker-kit.ts` | `97:    waveform: (parent) => appended(parent, waveform(peaks)),` and `130:function waveform(peaks: readonly number[] \| null): HTMLElement {` |
| Its CSS is in the default layout's stylesheet | `grep -n "audio-picker-waveform" src/plugins/audio-picker/layouts/default/layout.css` | lines 76, 84, 88, 94 |
| No shared waveform yet | `ls src/shared/page/ui/waveform.ts` | no such file |
| The kit test owns the bar drawing today | `grep -n "createCandidateKit_Waveform" src/plugins/audio-picker/page/layout/picker-kit.test.ts` | one line, near 163 |
| `audio/waveform.ts` is the unrelated peaks module | `grep -n "export function" src/plugins/audio-picker/page/audio/waveform.ts` | `waveformPeaks` only |
| The gallery's Sparkline section | `grep -n "section('Sparkline'" src/plugins/gallery/page/gallery-view.ts` | one line, near 224 |

Consumes:  nothing from another task (14 only shares two files)
Produces:
- `src/shared/page/ui/waveform.ts`, importing `./waveform.css`:
  - `export interface WaveformBar { x: number; y: number; width: number; height: number }`
  - `export function waveformShape(peaks: readonly number[] | null): { viewBox: string; bars: WaveformBar[] }` — the
    pure geometry, moved from the picker kit's `waveform`: viewBox `0 0 ${max(count, 1)} 2`; bar `i` at `x = i`,
    `width = 0.7`, `height = max(2 * peak, 0.04)`, `y = 1 - height / 2`; null gives no bars. The two constants
    (`MIN_BAR_HEIGHT = 0.04`, `BAR_WIDTH = 0.7`) and their comments move here with it.
  - `export function waveform(peaks: readonly number[] | null): HTMLElement` — `span.ui-waveform`, `aria-hidden`,
    `is-loading` while `peaks` is null, holding `svg.ui-waveform-svg` (`preserveAspectRatio="none"`) with one
    `rect.ui-waveform-bar` per bar. SVG classes go on as attributes through a local `svgElement`, as
    `sparkline.ts` does.
- `src/shared/page/ui/waveform.css`: the rules moved from the picker's `layout.css`, renamed —
  `.ui-waveform` (`color: var(--wg-fg-tertiary)`, `display: inline-block`, `flex: none`,
  `height: var(--wg-space-4)`, `width: calc(var(--wg-space-8) * 2)`), `.ui-waveform-svg` (`display: block`,
  `height: 100%`, `width: 100%`), `.ui-waveform-bar` (`fill: currentColor`).
- `createCandidateKit`'s `waveform` member draws `waveform(peaks)` from the shared module, adds class
  `audio-picker-waveform` to it (as `playButton` adds `audio-picker-play` to its IconButton), and appends it. The
  local `waveform`, `SVG_NAMESPACE`, `MIN_BAR_HEIGHT` and `BAR_WIDTH` leave `picker-kit.ts`.
- `layout.css` keeps only `.audio-picker-row.is-cursor .audio-picker-waveform { color: var(--wg-accent); }` of the
  waveform rules; the other three waveform rules are deleted.
- `layout.d.ts`, `CandidateKit.waveform`'s comment: `span.ui-waveform.audio-picker-waveform`: the row's waveform, the
  shared Waveform primitive of one bar per peak; empty, with `is-loading`, until the sound decodes.
- Gallery: `section('Waveform', waveformCells)` right after `section('Sparkline', sparklineCells)`, and
  `waveformCells()` with three cells in one row, not wide (the primitive has a fixed size): `Peaks` (a 32-value
  sample rising and falling between 0.1 and 1), `Silence` (32 zeros), `Loading` (`null`).
- `DESIGN.md` § Primitives, a row after Sparkline: "**Waveform** (`waveform`): an SVG bar per peak (each 0 to 1),
  centred on its box's middle, in `fg-tertiary`; a fixed size, `space-4` high and twice `space-8` wide, and a line
  for silence. It is empty, with `is-loading`, until its peaks arrive. The audio picker's candidate row draws one
  through its kit's `waveform`, which turns it `accent` on the cursor row."

Decisions:
- The kit keeps `audio-picker-waveform` on the node beside `ui-waveform`, so a user audio-picker layout's CSS that
  targets that class keeps working and the cursor-row rule stays in the layout's stylesheet. The layout contract's
  comment names both classes.
- The cursor-row accent stays in the audio picker's `layout.css`: it is the picker's row state, not the primitive's.
  `.audio-picker-row.is-cursor .audio-picker-waveform` (three classes) outranks `.ui-waveform` whichever loads first.
- A pure `waveformShape` beside the builder, as `sparklineShape` sits beside `sparkline`, so the geometry is tested
  without a DOM; the builder only writes its attributes.
- Not added to the shared `BaseKit`: one owner's kit draws it today (`DESIGN.md` § Primitives: a primitive exists
  because a surface uses it). `AGENTS.md`'s source-tree line for the shared kit (≈151) stays true.
- `DESIGN.md`'s Audio picker surface entry (≈456, "a small waveform in `fg-tertiary` that turns `accent` on the
  cursor row") stays true and is left as it is.
- `audio-picker/page/audio/waveform.ts` (`waveformPeaks`) is the decoder's peaks module and stays.

GIVEN peaks `[0.5, 0.25, 1]` WHEN `waveformShape` runs THEN the viewBox is `0 0 3 2` and the bars are
`{x: 0, y: 0.5, width: 0.7, height: 1}`, `{x: 1, y: 0.75, width: 0.7, height: 0.5}`,
`{x: 2, y: 0, width: 0.7, height: 2}`.

GIVEN silence `[0, 0]` WHEN `waveformShape` runs THEN the viewBox is `0 0 2 2` and both bars are `height: 0.04`,
`y: 0.98`, so silence draws a line.

GIVEN `null` (the sound still decoding) WHEN `waveformShape` runs THEN the viewBox is `0 0 1 2` and there are no
bars; `waveform(null)` carries `is-loading`.

GIVEN a candidate row WHEN the default layout calls `kit.waveform(line)` THEN the line gains a `span` with classes
`ui-waveform` and `audio-picker-waveform`, one bar per peak, in `fg-tertiary`, `accent` on the cursor row.

GIVEN the gallery (`Space z g`) WHEN it draws THEN a Waveform section follows Sparkline with Peaks, Silence and
Loading samples.

Tests:
- `src/shared/page/ui/waveform.test.ts`, `describe('waveformShape')`, one table
  `it.each(...)('places a bar per peak, centred on the middle ($case)')` with the three cases above, asserting
  `toEqual({ viewBox, bars })` with the exact values given in the GIVEN lines (`0.98` is exact in IEEE doubles:
  `1 - 0.04 / 2 === 0.98`). Titles are sentences (`followups.md` L804).
- `picker-kit.test.ts`: the table `createCandidateKit_Waveform_DrawsABarPerPeakInPeakOrder ($case)` is deleted (the
  primitive's test owns the geometry now) and replaced by one test,
  `it("draws the row's waveform from its peaks, classed for the layout")`: a kit over peaks `[0.5, 1]`; the node
  `kit.waveform(parent)` returns is the parent's last child, has classes `ui-waveform` and `audio-picker-waveform`,
  and its `svg` holds 2 `RECT` children; it does not have `is-loading`. A second row of the same test (an `it.each`
  titled `"draws the row's waveform from its peaks, classed for the layout: $case"`) is a kit over `null` peaks: the
  node has `is-loading` and its `svg` holds 0 `RECT` children.
Done when: compiles (`npm run typecheck`); `npm run lint` passes (`scripts/check-styles.mts`: the moved CSS uses only
           tokens); `npm test` runs `src/shared/page/ui/waveform.test.ts`,
           `src/plugins/audio-picker/page/layout/picker-kit.test.ts` and
           `src/plugins/audio-picker/layouts/default/layout.test.ts` green. The look is checked in the final
           verification task.
Commit:    one commit: "Waveform: promote the audio picker's waveform to a shared ui primitive with a gallery entry
           and a DESIGN.md row (follow-up: promote the audio picker's waveform to a shared ui primitive)".

## Proof

Commit 0a96f9660, a5770279b · proof: diff read against Produces; wave 2 typecheck and lint clean after one compile fix on the same rung · concerns: none
