# 03 — Shared pane tree

Status: in progress
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     create `src/shared/page/pane-tree/pane-tree.ts` · test `src/shared/page/pane-tree/pane-tree.test.ts` · create `src/shared/page/pane-tree/pane-tree-view.ts` · create `src/shared/page/pane-tree/pane-tree.css` · modify `src/shared/page/ui/split.ts` only to extract its resize prompt build into an exported helper (see Decisions) · test `src/shared/page/ui/split.test.ts` (unchanged rows still pass) · modify `AGENTS.md` § Architecture's `src/shared/` layout block (one line for `pane-tree/`)

Consumes:  `PaneDirection`, `FocusTarget`, `ResizeTarget`, `OuterPanes` ← 01

Produces:  in `pane-tree.ts`:
           `export type SplitAxis = 'row' | 'column';` (`row`: side by side; `column`: stacked)
           `export type PaneNode = { kind: 'leaf'; id: string } | PaneSplit;`
           `export interface PaneSplit { kind: 'split'; axis: SplitAxis; ratio: number; first: PaneNode; second: PaneNode }`
           `export interface PaneTree { root: PaneNode; focusedId: string }`
           `export function singlePane(id: string): PaneTree`
           `export function leafIds(tree: PaneTree): string[]` (depth first, `first` before `second`)
           `export function splitFocused(tree: PaneTree, axis: SplitAxis, newId: string): PaneTree`
           `export function closePane(tree: PaneTree, id: string): PaneTree | null`
           `export function paneToward(tree: PaneTree, id: string, direction: PaneDirection): string | null`
           `export function focusToward(tree: PaneTree, direction: PaneDirection): PaneTree | null`
           `export function swapToward(tree: PaneTree, direction: PaneDirection): PaneTree | null`
           `export function nudgeFocused(tree: PaneTree, direction: PaneDirection, limits: (split: PaneSplit) => { step: number; least: number }): { tree: PaneTree; owned: boolean }`
           `export function parsePaneTree(value: unknown): PaneTree | null`
           in `pane-tree-view.ts`:
           `export interface PaneTreeView { element: HTMLElement; tree(): PaneTree; slot(id: string): HTMLElement; restore(tree: PaneTree): void; split(axis: SplitAxis, newId: string): boolean; close(id: string): boolean; focus(id: string): void; swap(direction: PaneDirection): boolean; outer: OuterPanes; dispose(): void }`
           `export interface PaneTreeViewOptions { initialId: string; anchor: AnchorNamer<never>; timers: Timers; changed(tree: PaneTree): void; focused(id: string): void }`
           `export function createPaneTreeView(options: PaneTreeViewOptions): PaneTreeView`

Decisions (pure core):
- `splitFocused` replaces the focused leaf with a split of `axis` and ratio `0.5`: the old leaf is
  `first`, the new leaf `second` (below for `column`, right for `row`), and the new leaf is focused.
  It throws when `newId` is already a leaf.
- `closePane` returns null when `id` is the only leaf. Otherwise the sibling subtree takes the
  parent split's place. When the closed leaf was focused, focus moves into the sibling subtree:
  to its last leaf when the closed leaf was `second`, to its first leaf when it was `first`. For a
  sibling that is one leaf, that is the pane the split came from.
- Geometry: each leaf has a rect in the unit square, from the ratios. `paneToward(tree, id, dir)`
  takes the leaves whose opposite edge touches the leaf's `dir` edge (compare with a tolerance of
  `1e-9`) and whose span on the other axis overlaps the leaf's span by more than the tolerance.
  It returns the one with the largest overlap. On a tie it returns the topmost for `left`/`right`,
  and the leftmost for `up`/`down`. It returns null when none touches. No wrap.
- `focusToward` and `swapToward` return null when `paneToward` is null. `swapToward` exchanges the
  two leaf ids in place, and focus stays on the moved id, as tmux's `swap-pane` keeps the active
  pane active.
- `nudgeFocused`: `left`/`right` use axis `row`, `up`/`down` use `column`. Walk up from the focused
  leaf. The divider is the nearest ancestor split of that axis where the leaf is in `first` (its
  right or lower divider). When none exists, it is the nearest one where the leaf is in `second`
  (its left or upper divider). `left`/`up` subtract `step` from that split's ratio, and
  `right`/`down` add it. Clamp the ratio so that each side keeps at least `least` of the split's
  span. `owned` is false, and the tree is unchanged, only when no ancestor split has that axis.
- `parsePaneTree` returns null for any value that is not a well-formed tree: a ratio outside
  `(0, 1)`, a duplicate leaf id, an empty id, or a `focusedId` that is not a leaf.

Decisions (view):
- The view owns the tree. Each change (split, close, swap, focus, a drag's end, a nudge) calls
  `changed(tree)` once. A focus change also calls `focused(id)`. `restore` replaces the tree and
  calls neither.
- Each leaf is a slot element that keeps its identity across draws. A slot's children are the
  owner's: the view moves slots between split containers and never empties them. A focused slot
  carries `is-focused` only while the tree holds two leaves or more.
- A pointer down on a slot focuses it.
- `split` returns false, and changes nothing, when either new half would fall under the least size:
  `280` px wide for `row`, `160` px tall for `column`. These two numbers are design values in one
  constant each.
- `outer.focus.move(dir)` runs `focusToward` and returns whether it moved. `outer.resize.nudge(dir)`
  runs `nudgeFocused` with `step` = `24` px and `least` = the least size above, each divided by the
  split's measured span in pixels on its axis. It returns `owned`.
- Each divider has a handle. A drag on it sets that split's ratio, clamped as `nudgeFocused`
  clamps, and calls `changed` once at the drag's end. A handle shows the resize prompt as `Split`'s
  handle does: `⌥⇧H ◂ ▸ ⌥⇧L` on a `row` divider, and `⌥⇧K ▴ ▾ ⌥⇧J` on a `column` divider (the
  `panes.resizePaneUp`/`Down` commands). It shows on hover, during a drag, and for 1000 ms after a
  nudge. `createSplitDivider` builds its prompt inline from `keyEdge` and `keyChevron`, with the
  left and right resize commands fixed. Extract that build into one exported helper in `split.ts`
  that takes the two commands and their chevrons. `createSplitDivider` calls it with the left and
  right commands, and its output stays the same. The pane tree view calls it for both axes.
- `pane-tree.css` styles a focused slot with a 1px inset border in `var(--wg-focus-border)`, and
  reuses the handle look from `split.css` through its classes.
- `dispose` removes the drag listeners and disposes the prompt anchors.

GIVEN one pane WHEN `splitFocused(tree, 'row', 'b')` runs THEN the root is a `row` split at 0.5, `a` first, `b` second, and `b` is focused
GIVEN a 2×2 grid (a row split of two column splits) WHEN `paneToward` runs from the top-left leaf toward `right` THEN it returns the top-right leaf
GIVEN a left pane beside two stacked right panes WHEN `paneToward` runs from the left leaf toward `right` THEN it returns the upper right leaf (tie: topmost)
GIVEN the focused pane on the left edge WHEN `focusToward(tree, 'left')` runs THEN it returns null
GIVEN a `row` split focused on `first` WHEN `nudgeFocused(tree, 'right', …)` runs THEN the ratio grows by `step`
GIVEN a `row` split focused on `second` WHEN `nudgeFocused(tree, 'left', …)` runs THEN the ratio shrinks by `step` (its left divider)
GIVEN only `row` splits WHEN `nudgeFocused(tree, 'up', …)` runs THEN `owned` is false and the tree is unchanged
GIVEN a ratio one step from the limit WHEN two nudges run THEN the ratio stops at the limit and both return `owned` true
GIVEN the focused `second` leaf of a split whose sibling is a split WHEN `closePane` runs THEN the sibling subtree takes its place and its last leaf is focused

Tests: `pane-tree.test.ts` — one table test per function: `splitFocused` (both axes, and the throw),
`closePane` (only leaf → null; first and second, leaf and subtree siblings, focused and unfocused),
`paneToward` (2×2 grid all four directions; the tie row; the edge rows), `swapToward` (ids swapped,
focus follows), `nudgeFocused` (each row above, with `step: 0.1, least: 0.2` stated in the test),
`parsePaneTree` (a valid tree round-trips through `JSON.parse(JSON.stringify(tree))`, and one row
per invalid shape above). Rows use trees built in the test with leaf ids `a`…`f`. The view earns a
live check, not a test (07).

Done when: `npm run typecheck` and `npm run lint` pass (the layer check accepts the new folder);
the test gate runs `pane-tree.test.ts`.
Commit:    one commit for the group

## Proof
