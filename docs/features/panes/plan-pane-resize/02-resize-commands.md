# 02 — Resize commands, plugin API and side bar

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/plugin.ts`
- create `src/renderer/pane-resize.ts`, test `src/renderer/pane-resize.test.ts`
- modify `src/renderer/key-scope.ts`, test `src/renderer/key-scope.test.ts`
- modify `src/renderer/plugins/page-api.ts`, test `src/renderer/plugins/page-api.test.ts`
- modify `src/renderer/renderer.ts`
- modify `src/renderer/shell/shell.ts`, `src/renderer/shell/shell.css`, test `src/renderer/shell/shell.test.ts`
- modify `src/config/keymap.ts`
- modify `src/plugins/keymap.ts`
- modify `src/plugins/gallery/page/gallery.css`
- modify `src/plugins/forms/main/selftest-script.ts`

Consumes:
- `export type ResizeDirection = 'left' | 'right';` ← 01
- `export interface ResizeTarget { nudge(direction: ResizeDirection): void; }` ← 01
- `export const PANE_RESIZE_COMMANDS = { left: 'panes.resizePaneLeft', right: 'panes.resizePaneRight', up: 'panes.resizePaneUp', down: 'panes.resizePaneDown' } as const;` ← 01
- `export function createSplitDivider(options: SplitDividerOptions): SplitDivider;` ← 01
- `export interface SplitDividerOptions extends SplitLimits { uiState: UiState; stateKey: string; handle: HTMLElement; measure(): { left: number; span: number }; show(width: number): void; anchor: AnchorNamer<never>; timers: Timers; }` ← 01
- `export function clampSplitWidth(width: number, limits: SplitLimits, span: number): number;` ← 01
- `export interface SplitDivider extends ResizeTarget { width(): number; reloadWidth(): void; dispose(): void }` ← 01
- the tree's `BaseKitDeps['keys']` (`src/shared/page/layout-host/base-kit.ts`), `ShellChrome.setKeys`
  (`src/renderer/shell/shell-chrome.ts`), and the `timers: Timers` const in `src/renderer/renderer.ts`

Produces:
- in `src/contracts/plugin.ts`, in `PageApi`: `panes: { setResizeTarget(target: ResizeTarget | null): void };`
- in `src/renderer/key-scope.ts`, in `ScopeStack`: `onBaseChange(listener: (base: ViewScope) => void): void;`
- in `src/renderer/pane-resize.ts`:
  - `export interface PaneResize { setTarget(target: ResizeTarget | null): void; dropTarget(): void; resize(direction: ResizeDirection): void; }`
  - `export function createPaneResize(sideBar: ResizeTarget): PaneResize;`
- in `src/renderer/plugins/page-api.ts`, in `PageApiDeps`: `paneResize: Pick<PaneResize, 'setTarget'>;`
- in `src/renderer/shell/shell.ts`:
  - `export function mountShell(root: HTMLElement, layout: ShellLayout, uiState: UiState, timers: Timers): Shell;`
  - in `Shell`: `sideBarDivider: ResizeTarget;`
  - in `Shell`: `setKeys(keys: BaseKitDeps['keys']): void;`
  - in `Shell`: `dispose(): void;`
- in `src/config/keymap.ts`, in `coreCommands`: the four commands of the table below.
- in `src/plugins/keymap.ts`: the binds' `command` type accepts the four core page commands; a `── Panes ──`
  banner with two binds.

Decisions:
- One command pair, app-wide, the tmux rule. `<A-S-h>` runs `panes.resizePaneLeft`, `<A-S-l>` runs
  `panes.resizePaneRight`, both in scope `any`. `panes.resizePaneUp` / `panes.resizePaneDown` are declared and
  unbound. (plan.md › Decisions, round 1)
- Core page commands. They are declared in `coreCommands`, keyed by `PANE_RESIZE_COMMANDS`, and registered in
  `renderer.ts`. `src/renderer` reads the ids from `src/contracts/panes.ts`, never from `src/config`.
  (architecture)

  | Id | Label | Group | runsIn | Default bind (scope `any`) | Handler in `renderer.ts` |
  | --- | --- | --- | --- | --- | --- |
  | `panes.resizePaneLeft` | `move the pane divider left` | `panes` | `page` | `<A-S-h>` | `paneResize.resize('left')` |
  | `panes.resizePaneRight` | `move the pane divider right` | `panes` | `page` | `<A-S-l>` | `paneResize.resize('right')` |
  | `panes.resizePaneUp` | `move the pane divider up` | `panes` | `page` | none | `log('page', 'no pane divider runs up or down')` |
  | `panes.resizePaneDown` | `move the pane divider down` | `panes` | `page` | none | `log('page', 'no pane divider runs up or down')` |

- `PaneResize.resize` nudges the target, or `sideBar` when no target is set. `dropTarget` sets the target to null.
  (design review)
- Target lifetime. `api.panes.setResizeTarget(target | null)` calls `paneResize.setTarget`. `renderer.ts` wires
  `scopeStack.onBaseChange(() => paneResize.dropTarget())`. A pushed scope is not a base change and keeps the
  target. (design review)
- `onBaseChange` listeners run only when `setBase` moves the base to another scope, after the `onChange` listeners
  and after the pushed scopes' `onBaseChanged` listeners. `push` and `pop` do not run them. (agent-settled: a view
  calls `setResizeTarget` after `setScope`, so the drop must run inside `setBase`)
- The side bar resizes through the split core. `mountShell` builds a handle `div.shell-side-bar-handle` and a
  `createSplitDivider` with `stateKey: 'side-bar-width'`, `min: 160`, `endMin: 320`. `renderer.ts` passes
  `uiState.scoped('shell')`, so the stored key is `shell.side-bar-width`, and its module `timers` const for the
  divider's prompt linger timer (01). One width for every side bar layout. (round 2)
- The side bar opens at the `sidebar-width` theme token. `initial` is
  `parseFloat(getComputedStyle(root).getPropertyValue('--wg-sidebar-width'))`, read once at mount, before the first
  `show`; `256` when it is not a finite number. (architecture)
- `show(width)` sets the unitless `--shell-side-bar-width` on `root` (`style.setProperty`, as `--ui-split-start`
  is set). `shell.css` gives `.shell-side-bar` `width: calc(var(--shell-side-bar-width) * 1px)` in place of
  `var(--wg-sidebar-width)`. `gallery.css`'s `.gallery-test-side-bar` — the side bar of the gallery's test shell
  layout, which hosts the live side bar — takes the same `calc(var(--shell-side-bar-width) * 1px)`, so a resize
  shows under that layout too. The token stays in the theme contract as the open width. (agent-settled: one
  property on the root survives every layout remount)
- A narrowing window narrows the side bar at once, so the main area never sits below its 320px least width. The
  shell keeps the last width the divider passed to `show` and draws from it: while the side bar layout is
  `beside`, `clampSplitWidth(width, limits, measure().span)`; in `over` and `hidden`, the width itself, since an
  overlay squeezes no main area and its span would be main's own width. The shell redraws in `show`, in
  `layOutSideBar` (a switch to `beside` needs a fresh clamp, and the root does not resize), and on each resize of
  `root`, seen by a `ResizeObserver` on `root` that `Shell.dispose` disconnects. Only the drawn width is clamped: the divider's width
  and uiState keep the user's width, so a widening window gives the side bar its width back, and only a drag or a
  nudge writes uiState. The existing window-resize path (`sideBarAfterResize` in `src/renderer/shell/modes.ts`)
  does not fit: it runs only when the window crosses the `SIDE_BAR_OVER_QUERY` breakpoint, not on every width.
  (user ruling)
- `measure()` reads the current layout's side bar and main elements:
  `{ left: sideBar.getBoundingClientRect().left, span: main.getBoundingClientRect().right - sideBar.getBoundingClientRect().left }`.
  The handle takes no layout space, so the span is the side bar and main together. (agent-settled)
- The handle is a child of `root`, appended again after each layout mount (`fillElements`), since
  `mountLayout` empties `root`. `shell.css` places it in the grid's `side` area at its end edge, over the side bar's
  right border, with `cursor: col-resize` and the same 1px line and hover colour as `.ui-split-handle`. It takes no
  track space. The shell sets `handle.hidden` unless the side bar layout is `beside`. A hidden handle has no layout
  box, so the divider's own check stops a nudge and a drag while the side bar lies over or is hidden.
  (round 1; agent-settled: the side bar element scrolls, so a handle inside it would scroll away)
- The resize prompt on the side bar handle draws through the chrome keys. `mountShell` gives the divider a
  forwarding anchor. Before the first `Shell.setKeys`, it anchors nothing. Each `setKeys(keys)` disposes every live
  forwarded anchor and anchors it again with `keys.anchor(element, command)`. The `Disposable` the forwarding anchor
  returns disposes the live one and forgets it. `renderer.ts` calls `shell.setKeys(keysExports as
  BaseKitDeps['keys'])` beside `chrome.setKeys`, with the same object. (user, round 4: "the shell anchors the side
  bar handle's prompt through the chrome keys")
- `Shell.dispose()` disposes the side bar divider (its listeners, its prompt anchors), disconnects the root's
  `ResizeObserver` and removes the handle. The
  page never unmounts its shell, so `renderer.ts` does not call it; the shell test does. (user, round 4)
- `src/plugins/keymap.ts`: a type `CorePageCommand = (typeof PANE_RESIZE_COMMANDS)[keyof typeof PANE_RESIZE_COMMANDS]`;
  the `binds` entry's `command` becomes `QualifiedCommandId<BuiltInManifest, 'page'> | CorePageCommand`. The new
  banner `// ── Panes ──…`, padded to the width of the other banners, follows the `── Tabs and sessions ──` block
  and holds:
  `{ keys: '<A-S-h>', scope: 'any', command: 'panes.resizePaneLeft' }` and
  `{ keys: '<A-S-l>', scope: 'any', command: 'panes.resizePaneRight' }`.

GIVEN no view set a target WHEN the user presses `<A-S-l>` with the side bar beside THEN the side bar grows 24px and
uiState holds the width under `shell.side-bar-width`.
GIVEN a view set its split as the target WHEN the user presses `<A-S-h>` THEN the split's divider moves 24px left
and the side bar stays.
GIVEN a view set a target WHEN another view sets a different base scope THEN the next press moves the side bar.
GIVEN a view set a target WHEN help pushes its scope THEN the next press still moves the view's split.
GIVEN the side bar beside at a stored 400px WHEN the window narrows until the main area would be under 320px THEN
the side bar narrows at once to keep the main area at 320px, uiState still holds 400, and a widening window gives
the side bar its 400px back.
GIVEN a narrow window with the side bar laid over WHEN the user presses either key with no target THEN nothing moves.
GIVEN the keys plugin started WHEN the pointer is over the side bar handle THEN the handle shows `⌥⇧H ◂ ▸ ⌥⇧L`, and
the self-test logs no `[keys] unplaced <A-S-h>` or `<A-S-l>` line.

Tests:
- `pane-resize.test.ts`, `resize_NudgesTheTargetElseTheSideBar` — `it.each`; rows
  `{ steps, nudged }` with recording fake targets:

  | steps before `resize('right')` | nudged |
  | --- | --- |
  | none | side bar, `'right'` |
  | `setTarget(split)` | split, `'right'` |
  | `setTarget(split)`, `setTarget(null)` | side bar |
  | `setTarget(split)`, `dropTarget()` | side bar |
  | `setTarget(first)`, `setTarget(second)` | second only |

  It catches a stale target that moves after a drop, and a press that moves two dividers.
- `key-scope.test.ts`, `onBaseChange_RunsOnlyWhenTheBaseMoves` — `it.each`; rows `{ action, heard }`:
  `setBase('other')` → `['other']`; `setBase` to the same base → `[]`; `push('help')` → `[]`; a pop → `[]`;
  `setBase('other')` while `help` is pushed → `['other']`. It catches a drop on a pushed scope, which would lose the
  target under help.
- `key-scope.test.ts`, `onBaseChange_RunsAfterTheOtherListeners` — the order recorded is `onChange`, the pushed
  scope's `onBaseChanged`, then `onBaseChange`. It catches a drop that runs before a pushed modal closes.
- `page-api.test.ts`, `createPageApi_PanesSetResizeTarget_HandsTheTargetToPaneResize` — the fake `paneResize`
  records `[target, null]` after `setResizeTarget(target)` then `setResizeTarget(null)`. The `deps()` fake gains
  `paneResize: { setTarget: () => {} }`.
- `shell.test.ts` — the two existing `mountShell` calls pass a fake uiState and a fake `Timers`, and stub
  `getComputedStyle` and `ResizeObserver` (as `split.test.ts` stubs `ResizeObserver` on `globalThis`). One helper
  in `shell.test.ts` also gives every test's side bar the rect `{ left: 0 }` and main `{ right: 1200 }` unless a
  row says other: the base `FakeElement` (`src/shared/page/test-dom.ts`) has no `getBoundingClientRect`, and the
  token rows hold only with a span of at least 576.
- `shell.test.ts`, `mountShell_SideBarOpenWidth_ReadsTheToken` — `it.each`; rows (token value → `--shell-side-bar-width`):
  `'256px'` → `'256'`; `'300px'` → `'300'`; `''` → `'256'`; `'auto'` → `'256'`; and a stored
  `side-bar-width` `320` with token `'256px'` → `'320'`. It catches a lost token read or a stored width ignored.
- `shell.test.ts`, `mountShell_SideBarHandle_ShownOnlyBeside` — `it.each`; `layOutSideBar` `beside` → `hidden`
  false; `over` → true; `hidden` → true. It catches a resize while the side bar lies over the content.
- `shell.test.ts`, `mountShell_SetLayout_KeepsTheSideBarHandleInRoot` — after `setLayout` and after its dispose,
  `root` holds `.shell-side-bar-handle`. It catches a handle lost on a layout swap.
- `shell.test.ts`, `mountShell_SideBarNudge_StoresTheWidth` — side bar beside, the handle with one client rect,
  side bar rect `{ left: 48, right: 304 }`, main rect `{ right: 1200 }`: `sideBarDivider.nudge('right')` stores
  `280` under `side-bar-width` and sets `--shell-side-bar-width` to `'280'`. It catches a divider wired to the wrong
  key or the wrong element.
- `shell.test.ts`, `mountShell_WindowNarrows_ClampsOnlyTheDrawnWidth` — `it.each`; stored `side-bar-width` 400, side
  bar `left` 0; rows (main `right` the observer reports → `--shell-side-bar-width`, stored): `1200` → `'400'`, 400;
  `600` → `'280'`, 400; `600` then `1200` → `'400'`, 400; layout `over`, main `right` 600 → `'400'`, 400; layout
  `hidden` then `beside` at main `right` 600, with no observer callback → `'280'`, 400. It catches a side bar that
  squeezes the main area under its least width, an overlay narrowed for a main area it does not squeeze, a stale
  width after a layout switch, and a resize that overwrites the user's stored width.
- `selftest-script.ts` (forms' script, which holds the keys steps) gains a step on the Form tab: `<A-S-l>` expects
  `[page] <A-S-l> ran panes.resizePaneRight`, then `<A-S-h>` expects `… ran panes.resizePaneLeft`. It pins the
  default binds and the core page commands through the real key engine (`AGENTS.md` § Running and testing: a key
  behaviour gets a self-test step).
- `shell.test.ts`, `Shell_SetKeys_AnchorsThePromptAgain` — with recording keys (`recordingAnchors()` from
  `src/shared/page/layout-host/test-layouts.ts`): before `setKeys`, no anchor is recorded; after `setKeys(first)`,
  first records `panes.resizePaneLeft` and `panes.resizePaneRight`; after `setKeys(second)`, first's two are
  disposed and second records the two. It catches a prompt that stays empty because the keys came after mount.
- `shell.test.ts`, `Shell_Dispose_DisposesTheDividerAndRemovesTheHandle` — after `setKeys(first)` and `dispose()`,
  first's two anchors are disposed and `root` holds no `.shell-side-bar-handle`.
- The existing `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks` (`src/plugins/keymap.test.ts`) and the
  `src/main/config` tests cover the new binds and core commands: run them unchanged.

Approach:
- Register the four handlers in `renderer.ts` before `commands.requireRegistered`, which checks every page bind's
  command. Create `paneResize` right after `mountShell` and `createScopeStack`, and pass it into every
  `createPageApi` call as `paneResize`.
- In `shell.css`, keep the handle's prompt rules in `split.css` (task 01). The shell handle needs only its own
  placement and line.

Done when: `npm run typecheck` and `npm run lint` (layer check, style check, oxlint, oxfmt) pass; the test gate
runs the tests above. The live check of the keys and the prompt is in task 06.

Commit: one commit for the group.

## Proof

Commit fe29dbe · proof: diff read: PageApi.panes, ScopeStack.onBaseChange, createPaneResize, Shell.sideBarDivider/setKeys/dispose, mountShell(root, layout, uiState, timers), four coreCommands and two binds present; typecheck passes; worker: lint, 167 tests in 9 files, selftest pass · concerns: the side bar laid over draws its stored width unclamped, so a stored width wider than a narrow window runs past its edge; the forms self-test resize steps nudge the side bar until 04 sets the forms split as target
