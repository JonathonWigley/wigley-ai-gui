# 04 — Views set the resize target

Status: done
Type: Batch
Wave: 3 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/page/round-view.ts` · modify `src/plugins/forms/page/forms-view.ts` ·
           modify `src/plugins/forms/page/start.ts` · modify `src/plugins/backlog/page/backlog-view.ts` ·
           modify `src/plugins/backlog/page/start.ts` · modify `src/plugins/docs/page/start.ts` ·
           modify `src/plugins/gallery/page/gallery-view.ts` · modify `src/plugins/gallery/page/start.ts` ·
           test `src/plugins/forms/page/round-view.test.ts` · test `src/plugins/forms/page/forms-view.test.ts` ·
           test `src/plugins/backlog/page/backlog-view.test.ts`
Consumes:  `export interface ResizeTarget { nudge(direction: ResizeDirection): void; }` (`src/contracts/panes.ts`) ← 01
           `export const PANE_RESIZE_COMMANDS = { left: 'panes.resizePaneLeft', right: 'panes.resizePaneRight', up: 'panes.resizePaneUp', down: 'panes.resizePaneDown' } as const;` (`src/contracts/panes.ts`) ← 01
           `export interface Split extends ResizeTarget { element: HTMLElement; start: HTMLElement; end: HTMLElement; width(): number; reloadWidth(): void; setStartHidden(hidden: boolean): void; dispose(): void; }` (`src/shared/page/ui/split.ts`) ← 01
           the `split.dispose()` calls 01 adds in `RoundView.dispose`, the docs `addView` handle's `dispose` and the
           gallery's `sectionSpecs` / `splitSample` (which keeps the last sample split) ← 01
           `panes: { setResizeTarget(target: ResizeTarget | null): void };` in `PageApi` (`src/contracts/plugin.ts`) ← 02
Produces:  `resizeTarget: ResizeTarget` in `RoundView`, in `src/plugins/forms/page/round-view.ts`
           `setResizeTarget(target: ResizeTarget | null): void` in `FormsViewDeps`, in
           `src/plugins/forms/page/forms-view.ts`
           `setResizeTarget(target: ResizeTarget | null): void` in `BacklogViewDeps`, in
           `src/plugins/backlog/page/backlog-view.ts`
           `resizeTarget(): ResizeTarget` in `GalleryView`, in `src/plugins/gallery/page/gallery-view.ts`

## Before you start

- Task 01 already passes `anchor` and `timers` to each `createSplit` call in these files, changes their limits,
  filters the split's prompt anchors out of `rebuild_DisposesTheFirstBuildsAnchors`, and adds every `split.dispose()`
  call these views need (forms `RoundView.dispose`, the docs `addView` handle's `dispose`, the gallery's
  `splitSample`; none in backlog). Do not change the limits, the `anchor` or `timers` argument, or add a dispose
  call.
- Task 02 adds `api.panes.setResizeTarget`. Plugins reach it only through this call. Pass it into each view as a
  dep beside `setScope`. No plugin imports `src/renderer` (plan.md § Boundary rules).
- The tmux rule (plan.md § Decisions): the focused pane's right divider when it has one, else its left divider.
  Each view below has one split, so the rule gives that split for every pane in the split. A pane outside every
  split (a mode's side bar, Docs mode's doc) gets `null`, and the core then moves the side bar.
- Call `setResizeTarget` immediately after each `setScope` call, never before it. The core drops the target on each
  base scope change (02), so a target set before `setScope` is lost.

## Decisions

- **Forms** — the target is the split of the round that shows, in every forms base scope but `idle`. In `idle`
  no round shows, so the target is `null`. Under the cancel prompt the round still shows, so the target stays its
  split. (tmux rule; plan.md § Decisions, Target lifetime)
- **Backlog** — the target is the list | detail split while focus is `items` or `detail`, the editor included.
  While focus is `homes`, the target is `null`: the homes pane is the mode's side bar, and its right divider is
  the side bar's. `docs/keymap.md` (commit `72cee4c`) names "the Backlog homes" as a side bar case. (tmux rule)
- **Docs** — Docs mode's machine view has no split: its tree is the side bar and its doc fills the sheet. Its
  target is always `null`. A session's Docs tab view has the tree | doc split, and its target is that split. While
  its tree is hidden (`setStartHidden(true)`), the split stays the target. Its handle then has no layout box, so a
  nudge does nothing (01). (tmux rule; `docs/keymap.md` names "Docs mode's tree" as a side bar case)
- **Gallery** — the target is the `Split` sample whenever Gallery mode shows (scope `gallery`). Each `setLayouts`
  draws a new sample, so while the mode shows, set the target again after `setLayouts`. (brief; the sample is
  the gallery's one split)
- **Dispose** — task 01 owns every `Split.dispose()` call (plan.md § File Structure, Task 01). This task adds
  none, and keeps 01's calls where it reshapes the code around them (the gallery's `splitSample`).

## Changes

### Forms

- `round-view.ts` — `RoundView` gets `resizeTarget: ResizeTarget`, set to the view's `split`. Update the
  `RoundView` comment for it.
- `forms-view.ts` — `FormsViewDeps` gets `setResizeTarget(target: ResizeTarget | null): void`. Add one local
  function that sets the base scope: it calls `deps.setScope(view)`, then `deps.setResizeTarget(target)`, where
  `target` is `null` when `view` is `idle`, else the `resizeTarget` of the round view of `activeForm(state)`, or
  `null` when that round has no view. Both places that call `deps.setScope` today use it: the tabs' `shown`
  callback and the `confirm.setBaseScope` callback in `render`. Update the `FormsViewDeps` comment for the new dep.
- `start.ts` — pass `setResizeTarget: (target) => api.panes.setResizeTarget(target)` to `mountFormsView`.

### Backlog

- `backlog-view.ts` — `BacklogViewDeps` gets `setResizeTarget(target: ResizeTarget | null): void`. In `render`,
  immediately after `deps.setScope(scopeOf(state))`, call `deps.setResizeTarget(state.focus === 'homes' ? null :
  split)`. Update the deps comment.
- `start.ts` — pass `setResizeTarget: (target) => api.panes.setResizeTarget(target)` to `createBacklogView`.

### Docs

- `start.ts` — `createView` gets one more parameter, `resizeTarget: ResizeTarget | null`. The `setScope` dep it
  hands `createDocsView` calls `api.keys.setScope(scope)`, then `api.panes.setResizeTarget(resizeTarget)`. The
  machine view passes `null`. `addView` passes its `split`.
- `start.ts` — Docs mode's `shown` calls `api.panes.setResizeTarget(null)` after its `api.keys.setScope`.
- `start.ts` — the `shown` that `addView` returns calls `api.panes.setResizeTarget(split)` after its
  `api.keys.setScope`. Its `dispose` keeps 01's `split.dispose()`.
- Keep one helper for "set scope, then set target" if the three call sites read better with it. Do not change
  `docs-view.ts`: its `applyScope` calls the `setScope` dep, which now sets the target.

### Gallery

- `gallery-view.ts` — `GalleryView` gets `resizeTarget(): ResizeTarget`, which returns the sample split that 01's
  `sectionSpecs` keeps (the one `splitSample` made last, and disposes before it makes the next). Expose that kept
  split to the view; do not keep a second copy or add a dispose. Keep the section order and the
  `framed('Split', …)` place. Update the `GalleryView` comment for `resizeTarget`.
- `start.ts` — keep a local `isShown` flag, set in the mode's `shown` and cleared in `hidden`. `shown` calls
  `api.keys.setScope('gallery')`, then `api.panes.setResizeTarget(view.resizeTarget())`. The `setLayouts` that
  `api.layouts.show` gets calls `view.setLayouts(shown)`, then `api.panes.setResizeTarget(view.resizeTarget())`
  when `isShown` is true.

## Behaviour

GIVEN a round shows in its Form tab WHEN the forms view sets its base scope THEN `setResizeTarget` gets that
round's split, immediately after `setScope`.
GIVEN the forms view is `idle` WHEN it sets its base scope THEN `setResizeTarget` gets `null`.
GIVEN Backlog mode shows WHEN focus moves to the list or the detail THEN `setResizeTarget` gets the list | detail
split; WHEN focus moves to the homes THEN it gets `null`.
GIVEN a round view WHEN it rebuilds THEN its split stays live and its resize prompt anchors stay; WHEN it is
disposed THEN its split's prompt anchors are disposed (01's call; these rows pin it beside the target).
GIVEN Gallery mode shows WHEN a new layout set draws the sections again THEN the target is the new sample.

## Tests

Rows added to existing tests only. Docs' and gallery's `start.ts` have no test, and the plan adds none: their
wiring is a live check in task 06.

- `round-view.test.ts`, describe `round view rebuild`:
  - `rebuild_DisposesTheFirstBuildsAnchors` — 01 already filters the split's prompt anchors out; leave it.
  - add `rebuild_KeepsTheSplitPrompt` — after `view.rebuild(round)`, at least one anchor for a
    `PANE_RESIZE_COMMANDS.left` or `.right` command exists, and none of them is disposed.
  - `dispose_DisposesEveryAnchor` — add `expect` that at least one recorded anchor is for a `PANE_RESIZE_COMMANDS`
    command, so the test proves the split's prompt is disposed too.
- `forms-view.test.ts` — the setup's `setScope` and a new `setResizeTarget` fake push into one call log, in call
  order. Add one `it.each` in a new describe `form tab resize target`, rows:
  | Action after the setup | Last two calls |
  | --- | --- |
  | none (the round shows) | `setScope('forms')`, then `setResizeTarget` with a non-null target |
  | `askCancel` | `setScope`, then `setResizeTarget` with a non-null target |
  | `formClosed` for the round | `setScope('idle')`, then `setResizeTarget(null)` |
- `backlog-view.test.ts` — the setup's `setScope` and a new `setResizeTarget` fake push into one call log, in call
  order. Add one `it.each` in a new describe `backlog resize target`, rows:
  | Command | Last two calls |
  | --- | --- |
  | `view.commands.focusList()` | `setScope('list')`, then `setResizeTarget` with a non-null target |
  | `view.commands.focusDetail()` | `setScope('detail')`, then `setResizeTarget` with a non-null target |
  | `view.sideBarOpenedOver()` | `setScope('list')`, then `setResizeTarget(null)` |

  The setup already opens a home, so each row starts with focus off the homes. Read the scope values from
  `scopeOf` as the code holds them when the test runs.

## Done when

`npm run typecheck`, `npm run lint` and the tests above pass. The test gate picks the run (`wigley:make`). The
behaviour in the running app is checked in task 06 (Final verification).

## Commit

One commit for the group.

## Proof

Commit 2694625 · proof: diff read: RoundView.resizeTarget, setResizeTarget deps in forms/backlog, docs and gallery wiring present; worker typecheck and lint pass, 22 tests in 3 files; lead typecheck deferred to after 03 lands (03 mid-edit in tree) · concerns: forms Form tab shown can set null for a moment before the round view exists, then confirm.setBaseScope sets the split; task doc's askCancel row did not hold (askCancel only from review), test dispatches openReview first; forms-view deps comment has an over-long line
