# 02 — The HScroller primitive

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/shared/page/ui/h-scroller.ts` · create `src/shared/page/ui/h-scroller.css` ·
           create `src/shared/page/ui/h-scroller-steps.ts` · test `src/shared/page/ui/h-scroller-steps.test.ts` ·
           modify `src/plugins/gallery/page/gallery-view.ts` · modify `src/plugins/gallery/page/gallery.css` ·
           modify `src/plugins/forms/main/selftest-script.ts`
Consumes:  `iconButton(iconName, label, onClick, size)` in `src/shared/page/ui/icon-button.ts` (tree today) ·
           `element(tag, className, text?)` in `src/shared/page/dom.ts` (tree today) ·
           `tag(text, tone)` in `src/shared/page/ui/tag.ts` (tree today)
Produces:  in `src/shared/page/ui/h-scroller.ts`, exactly as plan.md § File Structure:
           `export interface HScroller { element: HTMLElement; track: HTMLElement; reveal(item: HTMLElement): void; refresh(): void; dispose(): void; }`
           `export function createHScroller(): HScroller;`
           in `src/shared/page/ui/h-scroller-steps.ts` (pure, no DOM):
           `export interface ScrollView { scrollLeft: number; clientWidth: number; scrollWidth: number }`
           `export interface ItemSpan { start: number; end: number }`
           `export type ScrollDirection = 'back' | 'forward';`
           `export function chevronStates(view: ScrollView): { overflows: boolean; back: boolean; forward: boolean }`
           `export function stepTarget(items: readonly ItemSpan[], view: ScrollView, direction: ScrollDirection): number`
           `export function revealTarget(item: ItemSpan, view: ScrollView): number`

## Decisions

- **Read first:** `DESIGN.md` § Primitives (HScroller, IconButton, the conventions), § Tokens and themes, § Space,
  size and shape, § Motion, § Checks.
- **The DOM.** `element` is `div.ui-h-scroller`, holding in order: the back chevron, `track`
  (`div.ui-h-scroller-track`), the forward chevron. Each chevron is
  `iconButton('chevron-left', 'Scroll back', …, 'sm')` and `iconButton('chevron-right', 'Scroll forward', …, 'sm')`,
  with the part class `ui-h-scroller-chevron` added. `iconButton` builds through `button` in `src/shared/page/dom.ts`,
  which sets `tabIndex = -1` and stops focus on mousedown, so a chevron never takes focus.
- **Item spans.** The track is `position: relative`, so each child's `offsetLeft` is measured from the track's
  content start. An item's span is `{ start: offsetLeft, end: offsetLeft + offsetWidth }`. The items are the track's
  element children, in order.
- **The tolerance.** One CSS pixel, a constant `EDGE_SLACK = 1` in `h-scroller-steps.ts`. It absorbs fractional
  `scrollLeft` at a zoom other than 100%.
- **`chevronStates(view)`:**
  - `overflows` is `scrollWidth > clientWidth + EDGE_SLACK`.
  - `back` is `overflows && scrollLeft > EDGE_SLACK`.
  - `forward` is `overflows && scrollLeft + clientWidth < scrollWidth - EDGE_SLACK`.
- **How the chevrons show.** The root carries `data-overflow="true"` or `"false"`. `createHScroller` sets
  `data-overflow="false"` at creation, so both chevrons take no space until the first measure says otherwise.
  - While nothing overflows, both chevrons take no space (`display: none`), so a short row keeps its full width.
  - While the track overflows, each chevron keeps its space, and a chevron with nothing further that way takes
    `is-no-target` and hides (`visibility: hidden`). Keeping the space stops the track width from changing as the
    user scrolls, so the chevrons never flicker.
  - Hiding both while nothing overflows only widens the track, and showing both narrows a track that already
    overflows, so neither change can flip `overflows` back.
- **`stepTarget(items, view, direction)`** returns the new `scrollLeft`. It scrolls by one item:
  - `forward`: take the first item whose `end > scrollLeft + clientWidth + EDGE_SLACK`. Return
    `min(item.end - clientWidth, scrollWidth - clientWidth)`. With no such item, return `scrollLeft`.
  - `back`: take the last item whose `start < scrollLeft - EDGE_SLACK`. Return `max(item.start, 0)`. With no such item,
    return `scrollLeft`.
  - `forward` with an item wider than `clientWidth`: when its `start > scrollLeft + EDGE_SLACK`, return
    `min(item.start, scrollWidth - clientWidth)`, so its start shows first; otherwise return
    `min(item.end - clientWidth, scrollWidth - clientWidth)`, so the next click still moves.
- **`revealTarget(item, view)`** returns the new `scrollLeft` that shows `item` whole:
  - `item.start < scrollLeft` → `item.start`.
  - `item.end > scrollLeft + clientWidth` → `item.end - clientWidth`, or `item.start` when the item is wider than
    `clientWidth`.
  - Otherwise → `scrollLeft` (no move).
  - The result is held in `[0, max(0, scrollWidth - clientWidth)]`.
- **The handle.**
  - A chevron click calls `stepTarget` on the current spans and view, and scrolls the track to it with
    `track.scrollTo({ left, behavior: 'smooth' })` (`'instant'` under reduced motion, see Motion).
  - `refresh()` first runs a pending reveal when `clientWidth > 0` (below), then reads the view, applies
    `chevronStates`, and sets `data-overflow` and `is-no-target`. So the chevron state a refresh leaves is the one after
    its reveal.
  - The track's `scroll` event calls `refresh`, so trackpad scrolling updates the chevrons.
  - One `ResizeObserver` on the track calls `refresh` when the track's size changes.
  - The owner calls `refresh` after it adds, removes or resizes items (plan.md contract). The HScroller does not
    watch the track's children.
  - `reveal(item)` scrolls the track to `revealTarget(item span, view)` with `behavior: 'smooth'` (`'instant'` under
    reduced motion). A pending reveal, run by a later `refresh`, always uses `behavior: 'instant'`: no user action
    asked for that move (DESIGN.md § Motion, what moves), and the sample or strip lands on a settled position at its
    first layout. While the track is not laid out
    (`clientWidth === 0`, as in a hidden tab or a sample not yet in the document), it keeps `item` as the pending
    reveal, the latest call replacing it, and the next `refresh` that finds `clientWidth > 0` reveals it and clears
    it. A pending item no longer in `track` is dropped.
  - `dispose()` disconnects the observer, removes the scroll listener and drops the pending reveal. The owner
    removes `element`.
- **Motion.** The track sets no CSS `scroll-behavior`: each scroll the HScroller makes names its `behavior` in
  `scrollTo` (above), so a pending reveal can jump while a chevron step animates. Under
  `prefers-reduced-motion: reduce` (read through `matchMedia` at each scroll) every scroll uses `'instant'`. A chevron
  click while a smooth scroll still runs computes its step from the in-flight `scrollLeft`; that is accepted. The
  track hides its scrollbar (`scrollbar-width: none`); the chevrons and the trackpad scroll it. Vertical wheel
  input is not turned into sideways scrolling.
- **CSS, tokens only** (`DESIGN.md` § Tokens and themes; `scripts/check-styles.mts` judges it). Root: a flex row,
  `align-items: center`, `gap: var(--wg-space-1)`, `min-width: 0`. Track: `display: flex`,
  `gap: var(--wg-space-2)`, `flex: 1`, `min-width: 0`, `overflow-x: auto`, `overflow-y: hidden`. Chevron sizes come
  from IconButton's `sm` size (the class `ui-icon-button--sm`, which `iconButton(…, 'sm')` sets). No new token. Class names follow the conventions:
  `ui-h-scroller`, `ui-h-scroller-track`, `ui-h-scroller-chevron`.
- **Not in `BaseKit`.** A layout draws items; the app keeps scrolling (AGENTS.md § Architecture, A layout). Task 09
  builds its strip's HScroller in the app and hands the layout the track to draw boxes into.
- **The gallery entry.** Add `section('HScroller', …)` to `sectionSpecs` in `gallery-view.ts`, after `framed('Split', …)`
  and before `section('Card', …)`, the order of DESIGN.md § Primitives. One row of four wide cells (`cell(…, …, true)`),
  each an HScroller holding Tag samples (`tag('Item <n>')`, neutral tone):
  | Caption | Items | Set up |
  |---|---|---|
  | `No overflow` | 2 | nothing |
  | `At start` | 12 | nothing |
  | `In the middle` | 12 | `reveal(item 6)` |
  | `At end` | 12 | `reveal(item 12)` |
  The cells are built before they join the document, so the reveals stay pending and run on the first `refresh` with
  a layout. Keep the scrollers each draw makes in a holder, as `KeptSplit` keeps the split sample, and dispose the
  previous draw's scrollers at the start of each draw. Add a gallery CSS rule only if a sample needs one; it uses
  tokens too.
- **The gallery logs each sample's state.** Each HScroller sample has one `ResizeObserver` of the gallery's own on its
  `element`. Its first callback with a width above 0 calls the sample's `refresh()` (which runs the pending reveal
  first), reads the root's `data-overflow` and each chevron's `is-no-target`, logs
  `[gallery] hscroller <caption>: overflow <true|false> back <true|false> forward <true|false>` (`back` and `forward`
  true when that chevron shows), and disconnects. The observers join the draw's holder, so a new draw disposes them.
  Expected lines: `No overflow: overflow false back false forward false`, `At start: overflow true back false forward
  true`, `In the middle: overflow true back true forward true`, `At end: overflow true back true forward false`.
- **Forms' gallery steps expect them.** In `src/plugins/forms/main/selftest-script.ts`, the gallery group's first step
  (the one before the `gallery-full-0` screenshot) gains `alsoExpect` with the four lines above as anchored patterns.
  So a wrong chevron state or a pending reveal that never runs fails the self-test, not only the user's eye.
- **DESIGN.md** already lists HScroller (commit `cd16018`); task 10 re-reads it against this code.

## GIVEN / WHEN / THEN

- GIVEN a track whose items fit WHEN `refresh` runs THEN `data-overflow` is `false` and neither chevron takes space.
- GIVEN an overflowing track at `scrollLeft` 0 WHEN `refresh` runs THEN the back chevron is hidden with its space
  kept and the forward chevron shows.
- GIVEN an overflowing track WHEN the user clicks the forward chevron THEN the first item cut off at the right edge
  scrolls fully into view at the right edge, and focus stays where it was.
- GIVEN a track scrolled to its end WHEN `refresh` runs THEN the forward chevron hides and the back chevron shows.
- GIVEN an HScroller not in the document WHEN `reveal(item)` runs, and later the track is laid out THEN the item is
  scrolled into view.

## Tests

`h-scroller-steps.test.ts`, the pure rules, each an `it.each` table (`split-width.test.ts` is the pattern):

- `describe('chevronStates')` — rows (`clientWidth` 100):
  | scrollLeft | scrollWidth | expected |
  |---|---|---|
  | 0 | 100 | `{ overflows: false, back: false, forward: false }` |
  | 0 | 100.5 | `{ overflows: false, back: false, forward: false }` |
  | 0 | 300 | `{ overflows: true, back: false, forward: true }` |
  | 100 | 300 | `{ overflows: true, back: true, forward: true }` |
  | 200 | 300 | `{ overflows: true, back: true, forward: false }` |
  | 199.5 | 300 | `{ overflows: true, back: true, forward: false }` |
  Catches a chevron that shows with nothing further, or flickers on a fractional scroll position.
- `describe('stepTarget')` — items of width 50 with gap 10 (`{0,50}`, `{60,110}`, `{120,170}`, `{180,230}`,
  `{240,290}`), `clientWidth` 100, `scrollWidth` 290:
  | scrollLeft | direction | expected |
  |---|---|---|
  | 0 | forward | 10 (item `{60,110}`, the first cut off, ends at the right edge) |
  | 10 | forward | 70 |
  | 70 | forward | 130 |
  | 190 | forward | 190 (nothing further) |
  | 190 | back | 180 (item `{180,230}`: the last one starting left of the edge) |
  | 130 | back | 120 |
  | 0 | back | 0 (nothing further) |
  Two more rows with their own items: `{0,50}`, `{60,460}`, `scrollWidth` 460, `scrollLeft` 0, forward → 60 (a wide
  item's start shows first); one item `{0,400}`, `scrollWidth` 400, `scrollLeft` 0, forward → 300 (a wide item
  already at the left edge moves to its end).
  Catches a step that skips an item, overshoots the end, sticks on a wide item, or moves with nothing further.
- `describe('revealTarget')` — `clientWidth` 100, `scrollWidth` 290:
  | item | scrollLeft | expected |
  |---|---|---|
  | `{60,110}` | 0 | 10 |
  | `{0,50}` | 130 | 0 |
  | `{60,110}` | 60 | 60 (already whole: no move) |
  | `{240,290}` | 0 | 190 |
  | `{60,250}` | 0 | 60 (wider than the view: its start) |
  Catches a reveal that cuts the item or moves a visible one.

The DOM wiring (observer, pending reveal, chevron classes) needs a laid-out page: the forms self-test's gallery step
pins it through the four `[gallery] hscroller …` lines above. The look, the scroll listener and focus staying put on a
chevron click go to task 11 through the gallery's HScroller section, which the forms self-test's gallery screenshots
(`forms-gallery-full-*`, `forms-gallery-reduced-*`) capture.

## Done when

`npm test` passes with the tables above; `npm run lint` passes (layers and styles);
`npm run selftest -- --plugin forms --group gallery` passes.

## Commit

One commit for the group.

## Proof

