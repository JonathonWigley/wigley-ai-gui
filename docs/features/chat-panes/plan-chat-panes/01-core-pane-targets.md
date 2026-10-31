# 01 — Core focus and resize targets

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/panes.ts` · modify `src/contracts/plugin.ts` · create `src/renderer/pane-targets.ts` (replaces `src/renderer/pane-resize.ts`, deleted) · test `src/renderer/pane-targets.test.ts` (replaces `pane-resize.test.ts`) · modify `src/renderer/renderer.ts` · modify `src/renderer/plugins/page-api.ts` · test `src/renderer/plugins/page-api.test.ts` · modify `src/config/keymap.ts` · modify `src/shared/page/ui/split.ts` · modify `src/shared/page/ui/split-width.ts` · test `src/shared/page/ui/split.test.ts`, `split-width.test.ts` · modify `src/plugins/keymap.ts`

Consumes:  nothing

Produces:  in `src/contracts/panes.ts`:
           `export type PaneDirection = 'left' | 'right' | 'up' | 'down';` (replaces `ResizeDirection`; every use moves to it)
           `export interface ResizeTarget { nudge(direction: PaneDirection): boolean; }`
           `export interface FocusTarget { move(direction: PaneDirection): boolean; }`
           `export interface OuterPanes { focus: FocusTarget; resize: ResizeTarget; }`
           `export const PANE_FOCUS_COMMANDS = { left: 'panes.focusLeft', right: 'panes.focusRight', up: 'panes.focusUp', down: 'panes.focusDown' } as const;`
           in `src/contracts/plugin.ts`, `PageApi.panes`:
           `{ setResizeTarget(target: ResizeTarget | null): void; setFocusTarget(target: FocusTarget | null): void; setOuterPanes(panes: OuterPanes | null): void }`
           in `src/renderer/pane-targets.ts`:
           `export interface PaneTargets { setResizeTarget(target: ResizeTarget | null): void; setFocusTarget(target: FocusTarget | null): void; setOuterPanes(panes: OuterPanes | null): void; dropViewTargets(): void; resize(direction: PaneDirection): void; focus(direction: PaneDirection): void }`
           `export function createPaneTargets(sideBar: ResizeTarget, log: (message: string) => void): PaneTargets`

Decisions:
- `nudge` returns false only when the direction's axis is not the target's own. A side-by-side
  `Split` and the side bar's `SplitDivider` return false for `up` and `down`, and true for `left`
  and `right`, also when the divider sits at a limit or has no layout box. A press at a limit must
  not leak to the next target (smart-splits design, `docs/features/chat-panes/design.md` § Keys).
- `resize(direction)` asks the view's resize target, then the outer panes' `resize`, then
  `sideBar`, and stops at the first that returns true. When all return false it logs
  `no pane divider runs <direction>` under `page`. This replaces the up/down log loop in
  `renderer.ts`, which now registers all four resize commands through `resize`.
- `focus(direction)` asks the view's focus target, then the outer panes' `focus`, and stops at the
  first that returns true. When both return false or are unset, it logs `no pane <direction>`
  under `page`.
- `dropViewTargets` clears the view's resize and focus targets, never the outer panes.
  `renderer.ts` calls it in `scopeStack.onBaseChange`, where `dropTarget` sits today.
- The outer panes stay set until their owner calls `setOuterPanes(null)`.
- Register the four `PANE_FOCUS_COMMANDS` in `renderer.ts` beside the resize commands. Declare
  their labels in `src/config/keymap.ts` in the shape of the resize entries: `focus the pane on
  the left`, `focus the pane on the right`, `focus the pane above`, `focus the pane below`, in the
  group the resize commands use.
- In `src/plugins/keymap.ts`, widen `CorePageCommand` (today only the `PANE_RESIZE_COMMANDS`
  values) to include the `PANE_FOCUS_COMMANDS` values, so task 02's binds compile. Bind `<A-S-j>`
  to `panes.resizePaneDown` and `<A-S-k>` to `panes.resizePaneUp`, scope `any`, beside the
  existing resize binds. Do not add the `Alt+hjkl`
  focus binds here: they clash with the ten scoped binds that task 02 removes, so task 02 adds them.
- Update the doc comments in `plugin.ts` (the `panes.setResizeTarget` paragraph) and `panes.ts` to
  state the three-step chain and the outer panes' lifetime.

GIVEN a view resize target that returns false for `up` WHEN `resize('up')` runs with outer panes set THEN the outer panes' `resize.nudge('up')` runs
GIVEN no view targets and no outer panes WHEN `resize('left')` runs THEN the side bar nudges
GIVEN every target returns false WHEN `resize('down')` runs THEN `no pane divider runs down` is logged
GIVEN a view focus target that returns false WHEN `focus('right')` runs THEN the outer panes' `focus.move('right')` runs
GIVEN view targets and outer panes set WHEN `dropViewTargets` runs and `focus('left')` runs THEN only the outer panes' focus is asked
GIVEN a side-by-side `Split` WHEN `nudge('up')` runs THEN it returns false and its width is unchanged

Tests:
- `pane-targets.test.ts`: one table test for the resize chain. Rows: view true (outer and side bar
  not asked); view false then outer true; view unset, outer false, side bar true; view and outer both
  unset, side bar true; all false (the
  log line). One table test for the focus chain, with the same row shape and the `no pane <dir>`
  log. One test that `dropViewTargets` keeps the outer panes. Each row records which fakes were
  asked.
- `split.test.ts`: add rows for `nudge('up')` and `nudge('down')` returning false and leaving the
  width. Add a row that a nudge at the limit returns true.
- `page-api.test.ts`: extend the existing `panes` case so that `setFocusTarget` and
  `setOuterPanes` reach the core.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above.
Commit:    one commit for the group

## Proof
