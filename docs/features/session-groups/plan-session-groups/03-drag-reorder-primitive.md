# 03 — DragReorder primitive

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/shared/page/ui/drag-reorder.ts` · create `src/shared/page/ui/drag-reorder.css` ·
           test `src/shared/page/ui/drag-reorder.test.ts` · modify `src/plugins/gallery/page/gallery-view.ts`
Consumes:  none
Produces:  in `src/shared/page/ui/drag-reorder.ts`:
           `export interface ReorderDrop { key: string; zone: string; index: number }`
           `export interface DragReorderEvents { dropped(drop: ReorderDrop): void; started(): void; ended(): void }`
           `export interface DragReorder { zone(element: HTMLElement, zoneId: string, options: { ordered: boolean }): void; item(element: HTMLElement, source: HTMLElement, key: string, zoneId: string): void; isDragging(): boolean; clear(): void; dispose(): void }`
           `export function createDragReorder(events: DragReorderEvents): DragReorder`
           `export function dropIndex(midpoints: readonly number[], pointerY: number, draggedIndex: number | null): number`
Decisions: drag mechanics are a shared primitive, so a view keeps only what a drop means (design review) ·
           the app's first drag, so it follows `DESIGN.md` § Primitives: builder in `ui/`, CSS beside it, a gallery entry ·
           only a drag this primitive started is acted on, so file drop keeps its drops (plan read)

- **Registration.** `item(element, source, key, zoneId)` registers `element` as one item of `zoneId`, measured
  for the drop position, and makes `source` (the element itself, or a part of it such as a header) the HTML5
  drag source (`draggable = true`). `zone(element, zoneId, { ordered })` registers a drop target. Listeners sit
  on each registered element; `clear` removes every registration and its listeners before a view redraws, and
  `dispose` does the same and ends any drag. A view that lives for the page load never calls `dispose`; the
  gallery does when its entry drops.
- **Own drags only.** `dragstart` on a source sets the drag's data to the private type
  `application/x-wigley-reorder` (the key) and nothing else — no `text/plain`, so a drop on a text box inserts
  nothing — sets `effectAllowed = 'move'`, marks the item `is-dragging`, and calls `started`. Every `dragenter`,
  `dragover`, `dragleave` and `drop` handler returns at once unless this primitive's own drag runs, so a file
  drag (`types` holding `Files`, which `src/renderer/drop-targets.ts` handles in the capture phase) gets no
  mark, no `preventDefault` and no `dropEffect` from it.
- **Marks.** In an `ordered` zone, `index` comes from `dropIndex` over the zone's items' vertical midpoints:
  the item at that index among the items other than the dragged one carries `is-drop-before`, or, past the last,
  the last such item carries `is-drop-after`; the dragged item itself never carries a drop mark. A zone with
  `ordered: false` carries `is-drop-target` on its element instead, and reports index 0. Marks live in one zone
  at a time: they move to the zone under the pointer and clear when the pointer leaves every zone, on drop, on
  `dragend`, and on `clear`.
- **Drop.** A drop on a zone calls `dropped` with the key, the zone id and the index, then ends the drag; a drop
  whose drag was cleared mid-way is ignored. `ended` runs once per drag, on drop, `dragend` or `clear`.
- **dropIndex.** `index` counts the zone's items without the dragged one: `midpoints` are every item's
  midpoint in order, `draggedIndex` the dragged item's position among them, null when it comes from another
  zone. The pointer lands before an item when `pointerY < midpoint`; at or past a midpoint it lands after it.
- **Classes.** Every item carries `ui-drag-reorder-item` and every zone `ui-drag-reorder-zone`; the states are
  `is-dragging`, `is-drop-before`, `is-drop-after`, `is-drop-target`, each styled only under those classes
  (`.ui-drag-reorder-item.is-drop-before`): an `accent` line, 2 px, at the item's top or bottom edge, taking no
  space; `is-dragging` at reduced opacity; `is-drop-target` an `accent-tint` fill.
- **Gallery.** An entry with two zones — an ordered one of three items and an unordered one — that reorders on
  drop, disposed with the entry as the split sample's is.

GIVEN midpoints [10, 30, 50] and a dragged item from another zone WHEN the pointer is at 5, 20, 30, 40, 60 THEN the index is 0, 1, 2, 2, 3
GIVEN midpoints [10, 30, 50] and dragged index 0 WHEN the pointer is at 5, 20, 40, 60 THEN the index is 0, 0, 1, 2
GIVEN a drag this primitive did not start (a file) WHEN it passes over a zone THEN no mark is set and `preventDefault` is not called
GIVEN an own drag of item `a` over an ordered zone [a, b, c] at index 1 WHEN it is dropped THEN `dropped` gets {key a, zone, index 1}, every mark is gone, and `ended` ran once
GIVEN an own drag in progress WHEN `clear` runs THEN `ended` runs, every mark is gone, and a later drop reports nothing
Tests:     `dropIndex_countsWithoutTheDraggedItem` — one table over the two `dropIndex` GIVENs ·
           `dragReorder_actsOnOwnDragsOnly` — one table over the last three GIVENs, through `installFakeDom`
           (`src/shared/page/test-dom.ts`): call the registered listeners with a stub event holding `dataTransfer`
           (`types`, `setData`, `getData`), `clientY` and `preventDefault`; give items rects through the fake's
           `getBoundingClientRect`
Done when: compiles; the test gate runs the tests above; the gallery entry is checked in the final verification
Commit:    one commit for the group

## Proof
