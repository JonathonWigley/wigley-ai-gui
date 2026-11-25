# 02 — Grouped bar, counts, peek and pin

Status: in progress
Type: Task
Rung: deep · crosses the mode registry, the shell chrome, the shell's room math and lifecycle (hot-reloaded setting, plugin restart, page reload of the pin)
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/plugin.ts`
- modify `src/contracts/commands.ts`
- modify `src/config/keymap.ts`
- modify `src/plugins/keymap.ts`
- modify `src/config/theme-tokens.ts`
- modify `src/config/themes/catppuccin-mocha.json`
- modify `src/renderer/shell/modes.ts` · test `src/renderer/shell/modes.test.ts`
- modify `src/renderer/shell/shell-chrome.ts` · test `src/renderer/shell/shell-chrome.test.ts`
- modify `src/renderer/shell/shell.ts` · test `src/renderer/shell/shell.test.ts`
- modify `src/renderer/shell/shell.css`
- modify `src/renderer/shell/layouts/layout.d.ts`
- modify `src/renderer/shell/read-shell-layout.ts` · test `src/renderer/shell/read-shell-layout.test.ts`
- modify `src/shared/plugin-part-harness.test-support.ts`
- modify `src/renderer/shell/layouts/default/layout.js`
- modify `src/renderer/shell/layouts/default/layout.css`
- modify `src/renderer/renderer.ts`
- modify `src/renderer/plugins/page-api.ts` · test `src/renderer/plugins/page-api.test.ts`
- modify `CHANGELOG.md`

Consumes:  `ModePlace`, `Mode.place`, `Mode.showCommand` ← 01 · `ActivityBarSetting`, `Settings.shell.activityBar` ← 01 · `arrangeActivityItems`, `ActivityModeEntry`, `ActivityGroups` ← 01
Produces:  `ModeHandle.setCount(count: number | null): void` in `src/contracts/plugin.ts`
           `export const ACTIVITY_BAR_TOGGLE_PIN: CommandKey<void, 'activityBar.togglePin'>` in `src/contracts/commands.ts`
           `activityDivider(parent: HTMLElement, kit: ShellKit): HTMLElement` and `activityPin(parent: HTMLElement, input: ActivityPinInput, kit: ShellKit): HTMLElement` on `Layout` in `src/renderer/shell/layouts/layout.d.ts`
           `export interface ActivityItemInput { id: string; title: string; icon: string; count: number | null; showCommand: string | null }` in `src/renderer/shell/layouts/layout.d.ts`
           `export interface ActivityPinInput { pinned: boolean }` in `src/renderer/shell/layouts/layout.d.ts`
           page log lines `activity bar pinned`, `activity bar unpinned`, `activity bar peeked` under `page`

Decisions:
- **Registry.** `ModeHandle.setCount` keeps the count like `setContext` keeps the context and hands it to a new
  `ModesDeps` member, `counted(modeId: string, count: number | null): void`, that the renderer routes to the chrome; a
  disposed handle's `setCount` does nothing. A mode added again after dispose starts with count null. `place` and
  `showCommand` reach the chrome with the `Mode`. `page-api.ts` qualifies `showCommand` with the manifest id as it
  qualifies `id`.
- **Chrome.** `mountShellChrome` takes the setting (a `setActivityBar(setting: ActivityBarSetting)` member the
  renderer calls at start and on each config change, from `live.current().settings.shell.activityBar`) and draws the
  bar from `arrangeActivityItems`: top groups into the `start` track, bottom groups into the `end` track, an
  `activityDivider` slot between neighbouring groups on one edge, and one `activityPin` slot last in the `end` track.
  The chrome re-contributes every bar slot in one pass on an add, a dispose, a setting change and a layout change,
  each slot's `order` its index in its track (items, dividers and the pin counted); a count change redraws that one
  item. No divider sits before the pin. A second member, `setActivityPinned(pinned: boolean)`, redraws the pin slot
  with `ActivityPinInput.pinned`; the renderer calls it from the shell's `onPinnedChanged`. `firstAdd` is the order of each mode id's first add, kept across its disposal, as `itemOrders` keeps
  it today. Each `ActivityModeEntry.id` is the qualified mode id. A hidden mode's item is not drawn; `showMode` still shows it.
- **Item input.** `count` is the mode's count when above 0, else null (0, a negative and null all read null), shown
  whole with no cap; `showCommand` the qualified id or null.
- **Default layout.** `activityItem` draws the icon, a `span.activity-item-dot` while `count` is not null, a
  `span.activity-item-title`, a `span.activity-item-count` while `count` is not null, and the show command's key
  through the kit's key hint for `showCommand` when not null; title and tooltip stay. `activityDivider` draws a
  `border-default` hairline across the bar's width. `activityPin` draws a button whose click runs
  `activityBar.togglePin` through `kit.command`, labelled `Pin open` or `Unpin` by `pinned`, with the key hint for
  `activityBar.togglePin`, never taking focus (as `activityItem` does). The icon column keeps `activitybar-width` in
  both states, so no icon moves when the bar expands. `read-shell-layout.ts`'s `LAYOUT_PARTS` gains `activityDivider`
  and `activityPin`. The CSS
  shows the title, count, key and pin only under `.shell-activity-bar.is-expanded`, and the dot only outside it.
  The count is an accent pill (`accent` fill, `fg-on-accent` text); every value is a token
  (`npm run lint` runs `check-styles`).
- **Peek and pin in `shell.ts`.** The shell owns the bar's state. `Shell` gains `togglePin(): void`,
  `onPinnedChanged(listener: (pinned: boolean) => void): Disposable` and `activityBarNarrowChanged(isNarrow: boolean): void`.
  `mountShell` gains a sixth parameter `log: (message: string) => void` (the renderer passes
  `(message) => log('page', message)`, as `createPaneTargets` gets it; the five `shell.test.ts` call sites update).
  One function derives the classes from the state: `is-pinned` = pinned and not narrow; `is-peeking` = peeking;
  `is-expanded` = `is-pinned` or `is-peeking`. Every pin toggle, narrow change and the mount-time restore ends in
  `drawBarWidths()`, since the root's `ResizeObserver` does not see a track change.
  - `pointerenter` on a bar that is not expanded arms the timer; after `--wg-activitybar-peek-delay` (read from the
    computed style when the timer arms, through the injected `timers`; `ms` and `s` parse, anything else falls back
    to 300, and 0 peeks at once) the bar peeks and logs `activity bar peeked`. `pointerleave` clears the timer and
    ends the peek. A click on an item or the Pin button ends the peek, which re-arms only on a fresh `pointerenter`.
    Hover on an applied pin does nothing.
  - The grid's first column is a width the shell sets (a root variable `shell.css` reads), `activitybar-width` while
    not pinned, so the bar's in-flow box never changes on a peek. The peeking bar is `position: absolute` in its
    cell, filling its rows, `--wg-activitybar-expanded-width` wide, overflow visible on x, above the over side bar,
    the left bar and the resize handles by `z-index`, with `material-floating-shadow` and the chrome material class
    the side bar uses, so content text never shows through.
  - Pinned: the first column takes `--wg-activitybar-expanded-width`; the side bar's room math counts it.
  - A layout swap (`replaceLayout`, the gallery's `test-shell-layout.ts`) remounts the bar element: `fillElements`
    re-applies the classes and pointer listeners to the new element, as `applyChromeLayout` does for its state, and
    the peek timer clears on a swap and on dispose. `layout.d.ts`'s header comment and `mountShell`'s doc comment
    add `is-expanded`, `is-pinned` and `is-peeking` to what the app keeps on the area element. The default layout's
    CSS keys on `.shell-activity-bar.is-expanded`; the gallery's test bar shows no names, which a test layout may. Toggling logs `activity bar pinned` or `activity bar unpinned` and writes
    `activity-bar-pinned` (boolean) to the shell's scoped `uiState`; the shell reads it at mount.
  - The renderer tells the shell the 680px query's state (`SIDE_BAR_OVER_QUERY`, the `narrow` media query it already
    holds) at start and on change, never the crowding: while it matches, the pin is not applied (no `is-pinned`, the
    track collapsed) and the bar peeks on hover; the pin stays set and applies again when it stops matching.
- **Command and key.** `activityBar.togglePin` is a core page command registered in `renderer.ts` beside
  `MODES_SHOW`, its handler `shell.togglePin()`, with its label `pin the activity bar open` and group in `src/config/keymap.ts` beside the core
  commands there, bound `{ keys: '<Leader>vp', scope: 'any', command: 'activityBar.togglePin' }` in
  `src/plugins/keymap.ts` beside the other `<Leader>v` binds.
- **Tokens.** `activitybar-expanded-width` (`length`, `200px`) and `activitybar-peek-delay` (`duration`, `300ms`)
  in `theme-tokens.ts` beside `activitybar-width`, and in `catppuccin-mocha.json`.
- Fakes keep compiling: add `setCount` to the handle in `src/shared/plugin-part-harness.test-support.ts`, and
  `counted` to every `createModes({...})` in `modes.test.ts` (`sessions/page/preview.ts` picks three members and needs
  nothing).
- CHANGELOG `### Changed`: `The activity bar groups its modes with dividers, puts Practice, Gallery and Settings at its bottom, and peeks each mode's name on hover.`; `### Added`: `Space v p pins the activity bar open with each mode's name and key.` and `A mode can show a count on its activity bar item.`

GIVEN a setting change that moves a mode to another group WHEN the config reloads THEN the bar redraws in the new order with no reload
GIVEN a pinned bar WHEN the page reloads THEN the bar opens pinned
GIVEN a pinned bar WHEN the window narrows below 680px THEN the bar lies collapsed and peeks on hover, and widening pins it again
GIVEN a plugin restart WHEN its mode is added again THEN it keeps its place

Tests:     `modes.test.ts`: a row or case for `setCount` reaching `counted` and a disposed handle's `setCount` doing nothing, in the test that owns `setContext`.
           `shell-chrome.test.ts`: one table test over the drawn bar (slot order and track per item, divider count and place, no divider before the pin, pin last in the end track) for suggestions, a setting override and a hidden mode; one table over the count input (2, 0, a negative, null, a count set then cleared); one case for a mode re-added after dispose keeping its place with count null; one for the key hint (`recordingAnchors`): an item with `showCommand` anchors the qualified id, one without anchors none; one for `setActivityPinned` redrawing the pin's input.
           Default layout parts (in the test that owns `activityItem`'s parts): the pin's click runs `activityBar.togglePin` through `kit.command`, and the divider draws.
           `read-shell-layout.test.ts`: a row for a layout defining `activityDivider` and `activityPin`.
           `shell.test.ts`: the pin toggles `is-pinned`/`is-expanded`, logs, writes `uiState`, notifies `onPinnedChanged` and is read back at mount; the narrow input drops and restores the pin; the peek arms on enter, fires after the delay through fake timers, clears on a leave before the delay, ends on an item click, never arms on a pinned bar; one `it.each` over the delay parse (`300ms`, `0.3s`, `0ms`, an invalid string); a layout swap keeps the pin's classes on the new element.
           `page-api.test.ts`: a row qualifying `showCommand` beside the one qualifying `id`.
Done when: compiles; `npm run lint` passes; the test gate runs the tests above; the look itself is checked in 06
Commit:    one commit for the group

## Proof

