# 04 — Shell registry, title bar, activity bar, mode side bars

Status: done
Type: Task
Wave: 4 · Depends on: 03, 06
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` · modify `src/renderer/shell/shell.ts` · create
           `src/renderer/shell/shell-layout.ts` · create `src/renderer/shell/activity-bar.ts` · create
           `src/renderer/shell/title-bar.ts` · modify `src/renderer/shell/modes.ts` · modify
           `src/renderer/shell/shell.css` · modify `src/renderer/renderer.ts` · modify
           `src/renderer/plugins/page-api.ts` · create `src/shared/page/ui/icon.ts` · create
           `src/shared/page/ui/icon.css` · create `src/main/title-bar-overlay.ts` · modify
           `src/main/window.ts` · modify `src/main/main.ts` · modify `src/plugins/sessions/page/start.ts` ·
           modify `src/plugins/sessions/page/sessions-view.ts` · modify `src/plugins/sessions/page/tabs.ts` ·
           modify `src/plugins/sessions/page/sessions.css` · modify `src/plugins/docs/page/start.ts` · modify
           `src/plugins/docs/page/docs-view.ts` · modify `src/plugins/docs/page/doc-view.ts` · modify
           `src/plugins/forms/main/selftest-script.ts` · modify `src/plugins/docs/main/selftest-script.ts` ·
           modify `scripts/check-layers.mts` · modify `package.json`, `package-lock.json` (install) ·
           test `src/renderer/shell/modes.test.ts` · test `src/renderer/shell/shell.test.ts` (create) ·
           test `src/main/title-bar-overlay.test.ts` (create) · test `src/plugins/sessions/page/tabs.test.ts` ·
           test `src/renderer/plugins/page-api.test.ts`
Consumes:  `export interface Disposable { dispose(): void }` in `src/contracts/disposable.ts` ← 02 ·
           `AppConfig.platform: Platform` ← 02 · `ConfigStore.onChanged(listener: (config: AppConfig) => void): Disposable` ← 02 ·
           `Theme.tokens: Record<string, string>` ← 01 · tokens `toolbar-height`, `activitybar-width`,
           `statusbar-height`, `icon-size`, `indicator-width`, `accent`, `fg`, `fg-secondary`,
           `window-background`, `material-chrome-bg`, `border-subtle`, `sidebar-width`, `traffic-light-inset`
           ← 01's registry and Mocha ·
           `shell.css` and `sessions.css` already on the new token names ← 06 ·
           `PageApi` with `settings()` / `keys.keymap()` as 03 leaves it ← 03
Produces:  in `src/contracts/plugin.ts`:
           `type AreaName = 'titleBar' | 'activityBar' | 'sideBar' | 'main' | 'panel' | 'statusBar' | 'overlay'` ·
           `interface ContributeOptions { order?: number; align?: 'start' | 'center' | 'end' }` ·
           `interface Area { contribute(element: HTMLElement, options?: ContributeOptions): Disposable }` ·
           `type PluginAreas = Record<'titleBar' | 'panel' | 'statusBar' | 'overlay', Area>` ·
           `interface ModeContext { title: string; detail: string | null }` ·
           `Mode` gains `icon: string` and `sideBar?: HTMLElement` ·
           `ModeHandle` gains `setContext(context: ModeContext | null): void`, `toggleSideBar(): void`, `sideBarShown(): boolean` ·
           `interface ShellLayout { mount(root: HTMLElement): Record<AreaName, HTMLElement> }` ·
           `PageApi.shell: { setLayout(layout: ShellLayout): Disposable }`
           · in `src/shared/page/ui/icon.ts`: `export function icon(name: string): HTMLElement`
           · in `src/renderer/shell/shell.ts`: `export interface Shell { areas: Record<AreaName, Area>; setLayout(layout: ShellLayout): Disposable; layOutSideBar(layout: SideBarLayout): void }`,
             `export function mountShell(root: HTMLElement, layout: ShellLayout): Shell`,
             `export interface Placement { align: 'start' | 'center' | 'end'; order: number; sequence: number }`,
             `export function placementOf(options: ContributeOptions | undefined, sequence: number): Placement`,
             `export function comparePlacements(a: Placement, b: Placement): number`
           · in `src/renderer/shell/shell-layout.ts`: `export const defaultShellLayout: ShellLayout`,
             `export const SIDE_BAR_OVER_QUERY = '(max-width: 679px)'`
           · in `src/renderer/shell/modes.ts`: `export type SideBarLayout = 'beside' | 'over' | 'hidden'`,
             `export interface ModesDeps { place(mode: Mode, handle: ModeHandle): void; marked(modeId: string): void; layOutSideBar(layout: SideBarLayout): void; showContext(context: ModeContext | null): void; isNarrow: boolean; log: Log }`,
             `export interface CoreModes extends Modes { narrowChanged(isNarrow: boolean): void }`,
             `export function createModes(deps: ModesDeps): CoreModes`,
             `export interface SideBarState { isHiddenWide: boolean; isOverlayOpen: boolean }`,
             `export const SIDE_BAR_START: SideBarState`, `export function sideBarLayout(state: SideBarState, isNarrow: boolean): SideBarLayout`,
             `export function toggledSideBar(state: SideBarState, isNarrow: boolean): SideBarState`,
             `export function sideBarAfterResize(state: SideBarState, isNarrow: boolean): SideBarState`
           · in `src/renderer/shell/activity-bar.ts`: `export function createActivityBar(area: Area, log: Log): { add(mode: Mode, handle: ModeHandle): void; mark(modeId: string): void }`
           · in `src/renderer/shell/title-bar.ts`: `export function mountTitleBarContext(area: Area): { show(context: ModeContext | null): void }`
           · in `src/main/title-bar-overlay.ts`: `export function titleBarOverlayOf(theme: Theme): { color: string; symbolColor: string; height: number }`
Decisions: the shell is a registry of fixed areas placed by one replaceable `ShellLayout` (plan.md, design.md § Shell) ·
           `activityBar` and `sideBar` are core-owned and leave `PluginAreas`; no plugin contributes to either
           today (tree: `grep -rn 'contribute(' src` finds only `statusBar` and `overlay` contributions from
           plugins) (plan.md) · contributions sort by alignment group (`start`, `center`, `end`), then `order`
           ascending (default `0`), then registration order (drafter) · the registry writes each contribution's
           alignment as `data-align` and places it directly in the area's element, in sorted order; the layout's
           CSS turns `data-align` into position, so a replaced layout decides placement without the registry
           wrapping anything (drafter) · an area's element is `hidden` while it holds no contribution, except the
           side bar, whose visibility the mode registry sets through `layOutSideBar` (drafter) · `setLayout` moves
           every live contribution into the new layout's elements; its `Disposable` restores the layout
           `mountShell` was given, and does nothing once another `setLayout` replaced it (drafter) · each mode
           keeps its own side bar choice; the 680px rule and the wide/narrow toggle move unchanged from sessions'
           `tabs.ts` into the core (tree, DESIGN.md § Breakpoints) · Docs mode registers no side bar in this
           plan: its tree stays inside its view and `Space k d` keeps toggling it; plan C moves the tree to the
           side bar (plan-c-surfaces/plan.md) · mode icons: Sessions `comment-discussion`, Docs `book` (drafter) ·
           mode context: Sessions `{ title: <row label>, detail: <row projectDir> }` for the selected row, null
           with none; Docs `{ title: <open doc's path, `~`-shortened>, detail: null }`, null with none (drafter) ·
           the activity mark is an inset `indicator-width` bar in `accent` along the item's left edge, the window
           side, as VS Code draws it (drafter; DESIGN.md says "inner edge") · title bar: macOS `hiddenInset`;
           Windows and Linux `hidden` with `titleBarOverlay` (design.md § Shell) · `data-platform` on `<html>`
           from the served platform, set by `renderer.ts` (plan.md: no `process.platform` outside composition
           roots) · codicons' CSS is imported by `icon.ts`, not by `icon.css`, so `check-layers.mts` sees the one
           importer (it reads `.ts` imports only) (drafter) · no CSP change: `index.html`'s `default-src 'self'`
           covers the bundled font, and Vite emits the 80 KB `.ttf` as a file, not a `data:` URL (tree)
GIVEN two placements in different groups WHEN compared THEN `start` < `center` < `end` whatever their order
GIVEN two placements in one group WHEN compared THEN the lower `order` first, equal orders by `sequence`
GIVEN no options WHEN `placementOf` THEN `align` `start`, `order` `0`
GIVEN modes added WHEN the first is added THEN it is placed, marked, its side bar laid out, its context shown, then its `shown` runs
GIVEN a shown mode with a side bar WHEN another mode shows THEN the old side bar is hidden and the new one laid out by its own choice
GIVEN a wide window WHEN `toggleSideBar` THEN the side bar hides, then shows, each logged
GIVEN a narrow window WHEN `toggleSideBar` THEN the side bar opens over the content, logged
GIVEN the side bar open over the content WHEN the window widens THEN it lays out beside; the hidden choice survives resizes
GIVEN a mode with no side bar WHEN `toggleSideBar` THEN it throws
GIVEN a hidden mode WHEN its context is set THEN nothing shows until it shows
GIVEN a theme WHEN `titleBarOverlayOf` THEN the overlay takes `window-background`, `fg-secondary` and `toolbar-height`, following `var(--wg-…)` aliases
Tests:     see **Tests** below
Done when: `npm install` added `@vscode/codicons`; `npm run typecheck`, `npm run lint` and `npm test` pass with
           the tests below; `npm run selftest` passes with the changed steps below; task 06's registry check prints nothing;
           no `.remove()` is called on an area contribution anywhere (`grep -rn 'contribute(' src` shows each result unused or `.dispose()`d);
           the title bar, activity bar, side bar and icon checks are listed in
           [08 — Final verification](08-final-verification.md)
Commit:    one commit

## Install

`npm install --save-exact @vscode/codicons@<the version plan.md's precondition measured, or newer>` into
`dependencies` (approved in plan.md § Preconditions). No other package.

## Tokens this task reads

Task 01 declares two lengths for this task, and Mocha sets them:

| Token | Kind | Mocha | Use here |
|---|---|---|---|
| `sidebar-width` | length | `256px` | replaces only the side bar widths: `.shell-side-bar`'s `width` (`shell.css`) and the removed `.sessions` grid column (`sessions.css`); `.session-tab`'s `flex: 0 1 16rem` (a tab width) stays raw |
| `traffic-light-inset` | length | `78px` | the room `hiddenInset`'s window buttons take at the title bar's left |

Task 06 (wave 2) has already renamed every variable in `shell.css` and `sessions.css`; this task edits those
files on the new names, and every rule it writes reads 01's registry names, never an old `--wg-bg-*` name.
Task 06's registry check (its **Done when**) still prints nothing after this task; a new `--wg-` property this
task sets at runtime with `setProperty` is added to that check's runtime list, as `status-bar-height` is,
and named in the proof.

## Contract changes (`src/contracts/plugin.ts`)

Rewrite the doc comment of every member below to state its new behaviour:

| Member | Now | After |
|---|---|---|
| `AreaName` | six areas | adds `'titleBar'` first |
| `Area` | `contribute(element)` returns `{ remove(): void }`; shows while anything is contributed | `contribute(element, options?)` returns `Disposable`; a second `dispose` does nothing; contributions sort as **Ordering** says |
| `ContributeOptions` | — | new |
| `PluginAreas` | every area but `main` | `titleBar`, `panel`, `statusBar`, `overlay`: `activityBar` and `sideBar` are drawn by the core from the modes |
| `Mode` | id, title, element, shown, hidden | adds `icon` (a Codicon name, drawn in the activity bar; `title` is its label and tooltip) and optional `sideBar` (shown in the side bar while the mode shows) |
| `ModeContext` | — | new: the title bar's centre text, `detail` after it in `fg-secondary` |
| `ModeHandle` | show, isShown | adds `setContext` (stored per mode; shown while the mode shows), `toggleSideBar` (throws `Mode "<id>" has no side bar` on a mode without one), `sideBarShown` (true while the mode shows and its side bar lays out `beside` or `over`) |
| `ShellLayout` | — | new; comment states what the shell does to the returned elements: `hidden` while an area holds nothing (the side bar: while the shown mode shows none), `data-align` on each contribution, `data-side-bar` (`beside` / `over` / `hidden`) on the side bar element |
| `PageApi` | no `shell` | `shell.setLayout` replaces the layout and returns the `Disposable` that restores the default |

`Modes` keeps its members; its comment adds the side bar and context order from **Show order**.

## Ordering

`placementOf(options, sequence)` fills defaults (`align: 'start'`, `order: 0`). `comparePlacements` ranks
`start` 0, `center` 1, `end` 2, then `order` ascending, then `sequence` ascending. Each area counts its own
`sequence` from 0 in contribution order. `contribute` inserts the element before the first live contribution
that sorts after it, and sets `data-align` on it.

## The registry (`shell.ts`)

- `mountShell(root, layout)` replaces today's `mountShell(root)`. It empties `root`, removes its `class`
  attribute, calls `layout.mount(root)`, and throws `Shell layout returned no element for <name>` when the
  returned record lacks an area.
- `setLayout(next)`: empties `root` and its `class`, mounts `next`, moves every live contribution, in sorted
  order, into the new element for its area, and re-applies each area's `hidden` and the side bar's last
  `layOutSideBar` value. If `next.mount` throws or misses an area, it mounts the previous layout again the
  same way and rethrows.
- `layOutSideBar(layout)` sets the side bar element's `hidden` to `layout === 'hidden'` and
  `data-side-bar` to `layout`.
- `publishStatusBarHeight` stays (keys' which-key sits on `--wg-status-bar-height`) and re-observes the new
  status bar element after each `setLayout`.

## Default layout (`shell-layout.ts`, `shell.css`)

`defaultShellLayout.mount` adds class `shell` to `root` (`showStartFailure` in `renderer.ts` removes it) and
appends, in this order, one `div` per area: `shell-title-bar`, `shell-activity-bar`, `shell-side-bar`,
`shell-main`, `shell-panel`, `shell-status-bar`, `shell-overlay`.

`shell.css`:

- grid areas `'title title title' 'activity side main' 'activity side panel' 'status status status'`;
  columns `auto auto minmax(0, 1fr)`; rows `var(--wg-toolbar-height) minmax(0, 1fr) auto auto`
- title bar: `height: var(--wg-toolbar-height)`, flex row, `-webkit-app-region: drag`, `user-select: none`;
  `button`, `input` and `[role='button']` inside it take `-webkit-app-region: no-drag`. Padding:
  `:root[data-platform='macos'] .shell-title-bar` sets `padding-inline: var(--wg-traffic-light-inset)` (both
  sides, so the centre stays centred on the window); `windows` and `linux` set `padding-inline` to
  `calc(100vw - env(titlebar-area-x, 0) - env(titlebar-area-width, 100vw))`, the width the overlay's buttons
  take
- alignment in the title bar and status bar (rows) and the activity bar (a column): `start` items pack at the
  start; the first `center` item and the first `end` item take `margin-inline-start: auto`
  (`margin-block-start: auto` in the activity bar). Selector for "first of its group":
  `:not([data-align='center']) + [data-align='center'], [data-align='center']:first-child`, and the same for
  `end`. In `main`, `side bar`, `panel` and `overlay` alignment changes nothing
- activity bar: `width: var(--wg-activitybar-width)`; side bar: `width: var(--wg-sidebar-width)`,
  `overflow-y: auto`, `min-height: 0`
- side bar over the content: `.shell-side-bar[data-side-bar='over']` takes `grid-column: 3; grid-row: 2 / 4;
  justify-self: start; z-index: 1`, so it lies on the main and panel cell while its own column collapses
- activity item and title bar context rules (below) live here too

## Activity bar (`activity-bar.ts`)

`add(mode, handle)` contributes one item to the area: `button('activity-item', '', () => handle.show())` from
`src/shared/page/dom.ts` (never focusable), holding `icon(mode.icon)`, with `title` and `aria-label` set to
`mode.title`. `mark(modeId)` sets class `is-shown` and `aria-current="true"` on that mode's item, clears them on
the rest, and, only when the marked id changed, logs `log('page', 'marked <title> in the activity bar')`.

CSS: item `width` and `height` `var(--wg-activitybar-width)`, transparent, no border, `color:
var(--wg-fg-secondary)`; `:hover` and `.is-shown` `color: var(--wg-fg)`; `.is-shown` `box-shadow: inset
var(--wg-indicator-width) 0 0 var(--wg-accent)`.

## Title bar context (`title-bar.ts`)

`mountTitleBarContext(area)` contributes one `span.title-bar-context` with `{ align: 'center' }`, holding
`span.title-bar-context-title` and `span.title-bar-context-detail`. `show(null)` hides it; `show(context)`
unhides it, writes `title`, writes `detail` (the detail span `hidden` when `detail` is null), and sets the
element's `title` attribute to `detail ?? title`. CSS: the context stays draggable (no `no-drag`); one line,
ellipsis, `max-width: 60%`; detail in `var(--wg-fg-secondary)`, `var(--wg-space-2)` after the title.

## Modes (`modes.ts`)

`createModes(deps)` replaces `createModes(attach, log)`. Move `SidebarState`, `SidebarLayout`,
`SIDEBAR_START`, `sidebarLayout`, `toggledSidebar` and `sidebarAfterResize` out of
`src/plugins/sessions/page/tabs.ts` into `modes.ts`, renamed to the `SideBar…` / `sideBar…` spellings in
Produces, bodies unchanged; their three tests move from `tabs.test.ts` into `modes.test.ts` with the new names.

Each added mode holds its own `SideBarState`, starting at `SIDE_BAR_START`, and its context, starting null.
The shown mode's layout is `sideBarLayout(state, isNarrow)` when it has a side bar, else `'hidden'`.

**Show order.** `add(mode)`: throw on a repeated id, `deps.place(mode, handle)`, then the first mode reveals
and every later one sets `element.hidden` and `sideBar.hidden` true. A `show()` that changes mode: old
`element.hidden = true`, old `sideBar.hidden = true`, old `hidden()`; then reveal. Reveal: `element.hidden =
false`, `sideBar.hidden = false`, `deps.marked(id)`, `deps.layOutSideBar(layout)`, `deps.showContext(context)`,
log `showed <title> mode`, `mode.shown()`; after a `show()`, the `onChanged` listeners.

**Handle.** `setContext(c)` stores it and, while the mode shows, calls `deps.showContext(c)`.
`toggleSideBar()` throws on a mode without a side bar; flips the mode's state with `toggledSideBar`; while the
mode shows, calls `deps.layOutSideBar(layout)` and logs `log('page', <line>)`: `side bar shown` for `beside`,
`side bar shown over the content` for `over`, `side bar hidden` for `hidden`. On a hidden mode it only flips
the state.

`narrowChanged(isNarrow)` stores it, applies `sideBarAfterResize` to every mode's state, and lays out the shown
mode's side bar again (no log).

## Wiring (`renderer.ts`, `page-api.ts`)

`renderer.ts`, after the config arrives: `document.documentElement.dataset.platform = config.platform`;
`const shell = mountShell(app, defaultShellLayout)`; `createActivityBar(areas.activityBar, log)`;
`mountTitleBarContext(areas.titleBar)`; `const narrow = window.matchMedia(SIDE_BAR_OVER_QUERY)`;
`createModes` with `place` contributing `mode.element` to `main`, `mode.sideBar` (when set) to `sideBar`, and
`activityBar.add(mode, handle)`; `marked` → `activityBar.mark`; `layOutSideBar` → `shell.layOutSideBar`;
`showContext` → the title context's `show`; `isNarrow: narrow.matches`; and `narrow`'s `change` event calls
`modes.narrowChanged(event.matches)`. `PageApiDeps` gains `setLayout(layout: ShellLayout): Disposable`
(`shell.setLayout`), which `createPageApi` hands as `shell.setLayout`; `pluginAreas` returns the four
`PluginAreas`. `modes.add` keeps qualifying the id and passes `icon` and `sideBar` through.

## Call sites moving to `Disposable`

Measured at plan time, re-verify with `grep -rn 'contribute(' src`. No call site uses the handle today, so
each keeps discarding it; only these change:

| File | Change |
|---|---|
| `src/renderer/shell/shell.ts` | the handle is a `Disposable` |
| `src/renderer/renderer.ts:80` | `createModes((element) => areas.main.contribute(element), log)` becomes the `place` above |
| `src/renderer/plugins/page-api.test.ts:202` | the fake area returns `{ dispose: () => {} }` |
| `renderer.ts:53`, `:83`, `forms-view.ts:80-81`, `chat-dialogs.ts:80`, `:158`, `picker.ts:67`, `key-bar-view.ts:26`, `help-view.ts:40`, `which-key-view.ts:14` | unchanged: handle unused |

`PageChannel.on`'s `{ remove(): void }` is not an area contribution and stays.

## Sessions

- `sessions-view.ts`: the sidebar view's element leaves the `.sessions` root; `SessionsView` drops
  `layOut` and gains `sideBar: HTMLElement`.
- `start.ts`: drop `NARROW_QUERY`, `SIDEBAR_LOGS`, the media listener and the sidebar state. `modes.add` gets
  `icon: 'comment-discussion'` and `sideBar: view.sideBar`. `showMode`: `mode.show()` when hidden, else
  `mode.toggleSideBar()`. In `apply`, after `state = next`, call `mode.setContext` with the selected row's
  `{ title: row.label, detail: row.projectDir }`, or null when no row is selected.
- `sessions.css`: `.sessions` loses its two-column grid and the `is-sidebar-hidden` / `is-sidebar-over`
  rules; `.session-sidebar` loses its background, border and over rules (the side bar area draws them) and
  keeps `min-height: 0`.
- `tabs.ts` / `tabs.test.ts`: the moved members and their three tests leave.

## Docs

- `doc-view.ts`: `DocViewDeps` gains `openChanged(path: string | null): void`, called with the open doc's
  path after `open` sets `shown`, after `retarget` changes the path, and with null after `clear`.
- `docs-view.ts`: `DocsViewDeps` gains the same `openChanged`, handed to `createDocView`.
- `start.ts`: `modes.add` gets `icon: 'book'`. The machine view's `openChanged(path)` runs
  `homeDir.then((home) => mode.setContext(path === null ? null : { title: tildePath(path, home), detail: null }))`
  (one chain, so contexts apply in call order; `tildePath` from `src/plugins/docs/doc-paths.ts`); session
  views pass `openChanged: () => undefined`. `showMode` keeps toggling the tree.

## Icon (`src/shared/page/ui/`)

`icon.ts` imports `@vscode/codicons/dist/codicon.css` and then `./icon.css`. `icon(name)` returns
`<span class="codicon codicon-<name>" aria-hidden="true"></span>`. `icon.css`:
`.codicon[class*='codicon-'] { font-size: var(--wg-icon-size); }` (the same selector codicons uses, loaded
after it). `scripts/check-layers.mts` gains `'src/shared/page/ui': { layers: ['src/contracts', 'src/shared',
'src/shared/page'], packages: ['@vscode/codicons'] }`, and `src/renderer`'s layer gains `'src/shared/page/ui'`;
no other layer lists the package.

## Window (`window.ts`, `main.ts`, `title-bar-overlay.ts`)

- `createMainWindow` gains a fourth parameter `titleBar: Pick<BrowserWindowConstructorOptions,
  'titleBarStyle' | 'titleBarOverlay'>`, spread into the window options.
- `main.ts` builds it from the platform it serves: `macos` → `{ titleBarStyle: 'hiddenInset' }`; `windows`
  and `linux` → `{ titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlayOf(theme) }`. On `windows` and
  `linux` it subscribes to the ConfigStore's `onChanged` and calls
  `window.setTitleBarOverlay(titleBarOverlayOf(config.theme))`.
- `titleBarOverlayOf(theme)`: `color` is `window-background`, `symbolColor` is `fg-secondary`, each followed
  through `var(--wg-<name>)` aliases in `theme.tokens` to a value that is not one; `height` is
  `toolbar-height` parsed as `<n>px`, throwing `Token toolbar-height is "<value>", not a px length` otherwise.

## Tests

`src/renderer/shell/shell.test.ts` (the environment is `node`: `vitest.config.mts`; DOM placement is a live
check):

- `placementOf fills align start and order 0` — `placementOf(undefined, 3)` equals `{ align: 'start', order: 0, sequence: 3 }`; `placementOf({ align: 'end' }, 1)` equals `{ align: 'end', order: 0, sequence: 1 }`
- `comparePlacements puts start before center before end, whatever their order` — sorting `[{end,-5,0}, {center,0,1}, {start,9,2}]` gives sequences `[2, 1, 0]`
- `comparePlacements orders one group by order, then by sequence` — `[{start,2,0}, {start,-1,1}, {start,0,2}, {start,0,3}]` gives `[1, 2, 3, 0]`

`src/renderer/shell/modes.test.ts`: `setup(isNarrow = false)` builds deps that push into `calls`:
`place <id>`, `marked <id>`, `side bar <layout>`, `context <title or null>`; `add(id, title, hasSideBar =
false)` gives the element and side bar as `{ hidden: false }` objects and `icon: 'x'`.

- the existing five tests keep their claims, their `calls` now holding the deps' entries, e.g. adding
  `a.one`, `b.two` then `two.show()` gives `['place a.one', 'marked a.one', 'side bar hidden', 'context null',
  'shown a.one', 'place b.two', 'hidden a.one', 'marked b.two', 'side bar hidden', 'context null', 'shown
  b.two', 'changed b.two']`
- `hides other modes' side bars and lays out the shown one's` — both with side bars: one's `sideBar.hidden`
  false, two's true, `side bar beside`; after `two.handle.show()` one's true, two's false, `side bar beside`
- `toggleSideBar hides and shows the side bar while wide, logging each` — `side bar hidden` with log
  `[page] side bar hidden` and `sideBarShown()` false, then `side bar beside`, `[page] side bar shown`, true
- `toggleSideBar opens the side bar over the content while narrow` — `setup(true)`: add gives `side bar
  hidden`; toggle gives `side bar over`, `[page] side bar shown over the content`, `sideBarShown()` true
- `narrowChanged closes the overlay on widening and keeps the hidden choice` — narrow, toggle (`over`),
  `narrowChanged(false)` → `side bar beside`; toggle → `hidden`; `narrowChanged(true)` → `side bar hidden`;
  `narrowChanged(false)` → `side bar hidden`
- `keeps each mode's side bar choice across shows` — one toggled hidden; `two.show()` → `side bar beside`;
  `one.show()` → `side bar hidden`
- `toggleSideBar on a hidden mode changes its choice only` — `two.toggleSideBar()` adds no `side bar` entry and
  no log; `two.show()` → `side bar hidden`
- `toggleSideBar throws on a mode with no side bar` — `Mode "a.one" has no side bar`
- `shows the shown mode's context and keeps a hidden mode's for its show` — `one.setContext({ title: 's1',
  detail: '/p' })` → `context s1`; `two.setContext({ title: 'd', detail: null })` → nothing; `two.show()` →
  `context d`; `one.show()` → `context s1`; `one.setContext(null)` → `context null`
- the three moved side bar function tests, as they stand in `tabs.test.ts` today

`src/main/title-bar-overlay.test.ts`:

- `takes the window background, secondary text colour and toolbar height` — tokens `{ 'window-background':
  '#11111b', 'fg-secondary': '#a6adc8', 'toolbar-height': '40px' }` → `{ color: '#11111b', symbolColor:
  '#a6adc8', height: 40 }`
- `follows a token alias to its value` — `'window-background': 'var(--wg-base-colour)'`, `'base-colour':
  '#1e1e2e'` → `color: '#1e1e2e'`
- `rejects a toolbar height that is not px` — `'toolbar-height': '2.5rem'` throws `Token toolbar-height is
  "2.5rem", not a px length`

`src/renderer/plugins/page-api.test.ts`: `hands the plugin the title bar, panel, status bar and overlay areas`
replaces the "every area but main" test (no `main`, `activityBar` or `sideBar` property); the mode test's
fixture adds `icon: 'x'` and expects it passed through; `shell.setLayout` calls the deps' `setLayout` with the
layout and returns its `Disposable`.

## Self-test

| Script | Step | Keys | Expect |
|---|---|---|---|
| `src/plugins/forms/main/selftest-script.ts` | the four sidebar steps (`Space k s` today expecting `[sessions] sidebar hidden` / `shown`) | unchanged | `[page] side bar hidden`, `[page] side bar shown`, `[page] side bar hidden`, `[page] side bar shown`; the script's header comment says "side bar" |
| `src/plugins/docs/main/selftest-script.ts` | the step pressing `Space k d` that expects `[page] showed Docs mode` | unchanged | `[page] marked Docs in the activity bar` (logged during the show, so it proves both) |

## Proof

Proof: every Produces signature found in its file; `@vscode/codicons` imported only by `icon.ts` and listed only under `src/shared/page/ui`; install run by the user (agent installs are denied). The worker ran `npm test` (1681 pass), `npm run selftest` (pass), task 06's registry check (clean, no runtime variable added) and the contribute grep (clean). Rulings and concerns in the Run log, group 04; commit sha there.
