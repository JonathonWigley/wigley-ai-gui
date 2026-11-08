# 01 — Core area focus

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` · modify `src/renderer/pane-targets.ts` · modify `src/renderer/shell/modes.ts` ·
           modify `src/renderer/shell/shell.ts` · modify `src/renderer/plugins/page-api.ts` · modify `src/renderer/renderer.ts` ·
           modify `src/plugins/sessions/page/start.ts` · modify `src/plugins/docs/page/start.ts` ·
           modify `src/plugins/backlog/page/start.ts` · modify `src/plugins/backlog/page/backlog-view.ts` ·
           modify `src/plugins/settings/page/start.ts` · modify `src/plugins/settings/page/settings-view.ts` ·
           modify `src/plugins/gallery/page/start.ts` ·
           test `src/renderer/pane-targets.test.ts` · test `src/renderer/shell/modes.test.ts` · test `src/renderer/shell/shell.test.ts` ·
           test (compile only: each `Mode` literal gains `focusMain`) `src/renderer/shell/shell-chrome.test.ts`,
           `src/renderer/plugins/page-api.test.ts`, `src/shared/plugin-part-harness.test.ts`
Consumes:  `ScopeStack.onBaseChange`, `blurFocusedElement()` (`src/shared/page/dom.ts`), `createListeners`
           (`src/shared/listeners.ts`) — all in the tree
Produces:  in `src/contracts/plugin.ts`:
           `Mode.focusSideBar?(): void`
           `Mode.focusMain(): void`
           `export interface RightBarOptions extends ContributeOptions { focus?(): void }`
           `export interface RightBarArea { contribute(element: HTMLElement, options?: RightBarOptions): Disposable }`
           `PluginAreas` = `Record<'titleBar' | 'panel' | 'statusBar' | 'overlay', Area> & { rightBar: RightBarArea }`
           in `src/renderer/pane-targets.ts`:
           `export interface RightBarStop { focus(): void }`
           `export interface PaneAreas { focusSideBar(): boolean; focusMain(): void; rightBarStops(): readonly RightBarStop[] }`
           `createPaneTargets(sideBar: ResizeTarget, isScopePushed: () => boolean, log: (message: string) => void, areas: PaneAreas): PaneTargets`
           `PaneTargets.baseChanged(): void` (replaces `dropViewTargets`)
           `PaneTargets.stopRemoved(stop: RightBarStop): void`
           `PaneTargets.sideBarOpened(): void` (the narrow overlay; see below)
           `ModesDeps.sideBarOpened(): void` · `RightBarOptions.left?(): void` · `RightBarStop.left?(): void` (rulings)
           in `src/renderer/shell/modes.ts`: `CoreModes.focusSideBar(): boolean` · `CoreModes.focusMain(): void`
           in `src/renderer/shell/shell.ts`:
           `export type ShellAreas = Record<Exclude<AreaName, 'rightBar'>, Area> & { rightBar: RightBarArea }`
           `Shell.areas: ShellAreas` · `Shell.rightBarStops(): readonly RightBarStop[]` ·
           `Shell.onRightBarStopRemoved(listener: (stop: RightBarStop) => void): Disposable`
           in `src/renderer/plugins/page-api.ts`: `PageApiDeps.areas: ShellAreas`
           in `src/plugins/settings/page/settings-view.ts`: `SettingsView.focusMain(): void`
           in `src/plugins/backlog/page/backlog-view.ts`: `BacklogView.focusMain(): void`
           log lines (source `page`, so `[page] <text>`): `focus in the side bar` · `focus in the right bar` ·
           `focus back in main` · unchanged `no pane <direction>` and `no pane <direction> while a scope is pushed`
Decisions: the chain is plan.md's diagram, verbatim (Design Overview) · `focusMain` required, `focusSideBar` optional
           (plan Decisions) · `focus` on a right-bar-only options type (plan Decisions) · Alt+h with the side bar
           hidden stays put (interview) · no Docs/Settings/Backlog side bar moves onto `focusSideBar` here (Tasks 04/05),
           Sessions' `focusSideBar` is Task 03 · the core logs one line per area move, so self-tests wait on the core,
           not on each mode (agent) · `baseChanged` replaces `dropViewTargets`, one call doing both resets
           on every base change (agent) · the areas reach the core through `PaneAreas`, a port the consumer owns, so
           `pane-targets.ts` stays DOM-free and testable with fakes (agent) · a right-bar contribution learns its
           turn ended from the DOM focus leaving its element, since every move takes the DOM focus (agent) ·
           Task 01 adds no key bind

## Cold-read rulings

Lead rulings; each overrides any line below that says otherwise.

- **Overlay wiring:** `ModesDeps.sideBarOpened(): void` (Produces). `modes.ts` calls it right after
  `mode.sideBarOpenedOver?.()`, only when the mode has `focusSideBar`. The renderer passes
  `() => paneTargets.sideBarOpened()` through a late-bound closure, since `createModes` runs before
  `createPaneTargets`. Tests: a `pane-targets.test.ts` row (`sideBarOpened()`, then Alt+l → asked `['main']`, logged
  `focus in the side bar` then `focus back in main`); a `modes.test.ts` row (a narrow mode with `focusSideBar`
  opened over runs the dep after the hook; one without `focusSideBar` doesn't).
- **The right area's turn ends when the DOM focus leaves the right bar.** `RightBarOptions` gains `left?(): void`, and
  `RightBarStop` gains `left?(): void`. The core owns one `focusin` listener on the document: while
  `area === 'right'`, a `focusin` whose target is outside the right bar element sets `area = 'main'`, calls
  `heldStop.left?.()`, clears `heldStop`, and calls `areas.focusMain()` unless a base scope change already ran since the
  stop took the keys. Window blur (no `focusin`) changes nothing, so returning to the window resumes the panel's turn.
  Every other way the turn ends (Alt+h, `baseChanged`, `stopRemoved`) also calls `heldStop.left?.()`. Test rows:
  `focusin` outside while right → `left` and `main` asked; `focusin` inside → nothing; base change then `focusin` → `left`
  only.


`src/contracts/plugin.ts`, each member with its doc comment, beside the existing ones on `Mode`:

- `focusSideBar?()` — the core calls it when Alt+h leaves main's left edge while this mode shows with its side bar
  beside or over the content. It sets the side bar's key scope, focuses the side bar's list and draws its cursor;
  the core then holds the side bar as the area with the keys. A mode without it is no stop on the left.
- `focusMain()` — the core calls it when Alt+l leaves the side bar, Alt+h leaves the right bar, or the right-bar
  stop holding the keys is disposed. It gives main's last focused pane back its key scope, its resize and focus
  targets and the DOM focus, as `shown` does for that pane, so no box in the area left behind keeps the caret.
- `RightBarOptions.focus` — makes the contribution a stop for the core's focus keys, in the right bar's drawn order
  (`ContributeOptions` order). The core calls it when Alt+l leaves main's right edge and this is the first stop, or
  Alt+j/Alt+k reach it from the stop before or after. It sets the contribution's own key scope, draws its cursor
  and moves the DOM focus into the contribution's element. The turn ends when the DOM focus leaves that element (a
  click into main, Alt+h, a mode change) or the contribution is disposed; on a disposal holding the keys the core
  calls the shown mode's `focusMain`.
- `PluginAreas` doc comment names the right bar's `RightBarArea`.

## The core

`pane-targets.ts` keeps `area: 'main' | 'side' | 'right'` and `heldStop: RightBarStop | null` (the stop holding the
right area). `focus(direction)`:

1. A scope pushed: log `no pane <direction> while a scope is pushed`, ask nothing (unchanged, every area).
2. `area === 'side'`: `right` → `areas.focusMain()`, `area = 'main'`, log `focus back in main`; any other
   direction logs `no pane <direction>`. Neither the view target nor the outer panes are asked.
3. `area === 'right'`: `left` → `areas.focusMain()`, `area = 'main'`, log `focus back in main`. `down`/`up` → the
   stop after/before `heldStop` in `areas.rightBarStops()`: its `focus()`, then `heldStop` = it, `area = 'right'`,
   log `focus in the right bar`; none that way logs `no pane <direction>`. `right` logs `no pane right`.
4. `area === 'main'`: the view target, then the outer panes (unchanged). Both false: `left` → `areas.focusSideBar()`,
   true → `area = 'side'`, log `focus in the side bar`; `right` with `rightBarStops()` not empty → `stops[0].focus()`,
   `heldStop = stops[0]`, `area = 'right'`, log `focus in the right bar`; else log `no pane <direction>`.

The core writes `area` (and `heldStop`) after the hook returns: the hook's own `setScope` runs `baseChanged`, which
resets `area` to main, and the write after it wins.

`baseChanged()` — forgets the view's resize and focus targets (what `dropViewTargets` did) and sets
`area = 'main'`, `heldStop = null`. Renderer wires `scopeStack.onBaseChange(() => paneTargets.baseChanged())`.

`stopRemoved(stop)` — when `area === 'right'` and `heldStop === stop`: `area = 'main'`, `heldStop = null`, then
`areas.focusMain()`, log `focus back in main`. Otherwise nothing.

`sideBarOpened()` — the narrow overlay: `modes.ts` runs `mode.sideBarOpenedOver?.()` (line 133 at plan time), and
when the mode passes `focusSideBar` the core then calls `sideBarOpened()`, which sets `area = 'side'`, `heldStop = null`
and logs `focus in the side bar`. It runs after the hook, for the same reason as above, so Alt+l from the overlay's
list reaches `focusMain` (Task 03's `list overlay` self-test rests on it). The wiring from `CoreModes` to
`PaneTargets` is the implementer's, through the port the renderer already builds.

The interface comment over `PaneTargets` is rewritten for the areas, `baseChanged`, `stopRemoved` and `sideBarOpened`.

## Shell, modes, page API and renderer

- `modes.ts`: `CoreModes.focusSideBar()` calls the shown mode's `focusSideBar` and returns true when the mode has
  one and `layoutOf(entry) !== 'hidden'`; else calls nothing and returns false (no mode shown included).
  `CoreModes.focusMain()` calls the shown mode's `focusMain`; nothing with no mode shown. Doc comments on both.
- `shell.ts`: the right bar's `contribute` takes `RightBarOptions`. A contribution passing `focus` holds a
  `RightBarStop` made for it (`{ focus: options.focus }`, one object per contribution). `rightBarStops()` returns the
  right bar's stops in its contributions' sorted order (the drawn order, top to bottom). A stop's contribution
  `dispose` takes it out of the list first, removes the element, updates hidden, then tells each
  `onRightBarStopRemoved` listener once; a second `dispose` tells nothing. Other areas keep `Area`. `ShellAreas` and
  the `Shell` interface comment cover both members.
- `page-api.ts`: `PageApiDeps.areas` and `pluginAreas`' parameter take `ShellAreas`; the tracked right bar passes the
  options through unchanged (the type is the change). `modes.add` already spreads the mode, so `focusMain` and
  `focusSideBar` reach the registry with no other edit.
- `renderer.ts`: `createPaneTargets(shell.sideBarDivider, () => scopeStack.anyPushed(), log, { focusSideBar: () =>
  modes.focusSideBar(), focusMain: () => modes.focusMain(), rightBarStops: () => shell.rightBarStops() })`;
  `scopeStack.onBaseChange(() => paneTargets.baseChanged())`;
  `shell.onRightBarStopRemoved((stop) => paneTargets.stopRemoved(stop))`, made after `paneTargets`.

## `focusMain` per mode

Each calls the mode's existing path that gives main its pane back; none logs a line of its own.

| Mode (`mode.add` site) | `focusMain` |
|---|---|
| Sessions (`sessions/page/start.ts`, `id: 'sessions'`) | `lastVisible === 'none'` → `api.keys.setScope('idle')`, then `blurFocusedElement()` (the idle pane holds no box); else `checkVisible(true)`, which tells the visible tab `shown` again and so gives it its scope and DOM focus |
| Docs (`docs/page/start.ts`, `id: 'docs'`) | `machineView.treeHidden()` — the doc pane takes focus and the doc scope through the view's `setScope`, which also sets the resize and focus targets |
| Backlog (`backlog/page/start.ts`) | `view.focusMain()`: new `BacklogView.focusMain()` — focus `'homes'` dispatches `{ type: 'focus', focus: 'items' }` (as `sideBarHidden` does); any other focus runs `render(true)`, which sets the scope, both targets and the DOM focus (the editor's included) |
| Settings (`settings/page/start.ts`) | `view.focusMain`: new `SettingsView.focusMain()` = `focusRows` (closes an open filter, sets `rows`, the focus target, the DOM focus and the cursor) |
| Gallery (`gallery/page/start.ts`) | the two lines `shown` runs today (`setScope('gallery')`, `setResizeTarget(view.resizeTarget())`), moved into one local function both call, then `blurFocusedElement()` |

GIVEN main's view and outer panes turn down Alt+h and the shown mode gives `focusSideBar` with its side bar shown
WHEN Alt+h is pressed THEN the core calls `focusSideBar`, logs `[page] focus in the side bar`, and the next Alt+l
calls `focusMain` and logs `[page] focus back in main`.
GIVEN the side bar is hidden or the mode gives no `focusSideBar` WHEN Alt+h reaches main's left edge THEN nothing is
called and `[page] no pane left` logs.
GIVEN two right-bar stops and main's edge on the right WHEN Alt+l, then Alt+j, then Alt+j THEN the first stop's
`focus`, then the second's, then `[page] no pane down`; Alt+h then calls `focusMain`.
GIVEN the side or right area holds the keys WHEN a base scope change the core did not make runs (a click into main)
THEN the next Alt+hjkl walks main's chain again.
GIVEN a narrow window and a mode with `focusSideBar` WHEN its side bar opens over main THEN `[page] focus in the
side bar` logs and Alt+l calls `focusMain`.
GIVEN a right-bar stop holds the keys WHEN its contribution is disposed THEN the core calls `focusMain` and logs
`[page] focus back in main`.

Tests:
- `pane-targets.test.ts`, one new table `reaches the areas past main's edge: $row`, over the existing
  `recordingTargets` plus a fake `PaneAreas` that records `side bar`, `main` and `stop <n>` asks into the same
  `asked` list, `focusSideBar` answering the row's `sideBar: boolean`. Each row sets view and outer to false (or
  unset), runs its `before` presses, clears `asked`/`logged`, presses `direction`, and asserts `asked` and `logged`
  whole. Rows (the break each catches in brackets):
  - main, left, side bar true → `['view left', 'outer left', 'side bar']`, `['focus in the side bar']` [side bar
    step missing]
  - main, left, side bar false → `[…, 'side bar']`, `['no pane left']` [stop entered when hidden]
  - main, right, 2 stops → `[…, 'stop 1']`, `['focus in the right bar']` [wrong first stop]
  - main, right, 0 stops → `['no pane right']`
  - main, up, 2 stops → `['view up', 'outer up']`, `['no pane up']` [up/down leaking into the areas]
  - side (before: left), right → `['main']`, `['focus back in main']`
  - side, left / down → `[]`, `['no pane left']` / `['no pane down']` [view target asked while side holds keys]
  - right on stop 1 of 2 (before: right), down → `['stop 2']`; on stop 2 (before: right, down), down →
    `['no pane down']`; on stop 2, up → `['stop 1']` [index off by one]
  - right, left → `['main']`, `['focus back in main']`; right, right → `[]`, `['no pane right']`
  - side, scope pushed → `[]`, `['no pane right while a scope is pushed']` [pushed check skipped outside main]
  - side, then `baseChanged()`, left → `['view left', 'outer left', 'side bar']` [area never reset]
  - main, left, the fake `focusSideBar` calling `targets.baseChanged()` inside (its own `setScope`), then right →
    `['main']` [area written before the hook]
- `pane-targets.test.ts`, table `stopRemoved ends only the holding stop's turn: $case`: holding stop removed →
  `asked` `['main']`, `logged` `['focus back in main']`, and a following Alt+h asks the view; another stop removed →
  nothing asked, the next Alt+j still moves from the held stop; removed while the side area holds → nothing asked.
- The existing `drops the view targets and keeps the outer panes` test calls `baseChanged()` in place of
  `dropViewTargets()`; existing rows pass a `PaneAreas` whose `focusSideBar` returns false and holds no stops, so
  their `no pane <direction>` lines stand.
- `modes.test.ts`, table `focusSideBar reaches the shown mode's side bar only while it shows: $case` — beside →
  called, true; over (narrow, toggled open) → called, true; hidden by toggle → not called, false; mode without
  `focusSideBar` → false; mode without a side bar → false; and `focusMain` calls the shown mode's hook, not a hidden
  mode's.
- `shell.test.ts`: `mountShell_RightBarStops_FollowDrawnOrder` — three right-bar contributions (`order` 10 with
  `focus`, `order` 0 without, `order` 5 with) → `rightBarStops()` holds the order-5 stop then the order-10 one, and
  calling each `focus` reaches its own contribution's function; `mountShell_RightBarStopDisposed_TellsOnce` —
  disposing a stop's contribution twice tells the listener once with that stop and drops it from
  `rightBarStops()`; disposing a contribution without `focus` tells nothing.

Approach:  Each mode's `focusMain` is proved live (final verification), not in unit tests: it calls an existing path.
Done when: `npm run typecheck`, `npm run lint` and the tests above pass; no key bind added; `grep -rn
dropViewTargets src` finds nothing.
Commit:    one commit for the group

## Proof

