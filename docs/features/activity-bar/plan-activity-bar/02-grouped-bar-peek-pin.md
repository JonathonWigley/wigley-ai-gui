# 02 — Grouped bar, counts, peek and pin

Status: not started
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
  `ModesDeps` member that the renderer routes to the chrome; a disposed handle's `setCount` does nothing. `place` and
  `showCommand` reach the chrome with the `Mode`. `page-api.ts` qualifies `showCommand` with the manifest id as it
  qualifies `id`.
- **Chrome.** `mountShellChrome` takes the setting (a `setActivityBar(setting: ActivityBarSetting)` member the
  renderer calls at start and on each config change, from `live.current().settings.shell.activityBar`) and draws the
  bar from `arrangeActivityItems`: top groups into the `start` track, bottom groups into the `end` track, an
  `activityDivider` slot between neighbouring groups on one edge, and one `activityPin` slot last in the `end` track.
  The chrome redraws the bar's slots on an add, a dispose, a setting change and a layout change; a count change redraws
  that one item. `firstAdd` is the order of each mode id's first add, kept across its disposal, as `itemOrders` keeps
  it today. A hidden mode's item is not drawn; `showMode` still shows it.
- **Item input.** `count` is the mode's count when above 0, else null; `showCommand` the qualified id or null.
- **Default layout.** `activityItem` draws the icon, a `span.activity-item-dot` while `count` is not null, a
  `span.activity-item-title`, a `span.activity-item-count` while `count` is not null, and the show command's key
  through the kit's key hint for `showCommand` when not null; title and tooltip stay. `activityDivider` draws a
  `border-default` hairline. `activityPin` draws a button whose click runs `activityBar.togglePin` through
  `kit.command`, labelled `Pin open` or `Unpin` by `pinned`, never taking focus (as `activityItem` does). The CSS
  shows the title, count, key and pin only under `.shell-activity-bar.is-expanded`, and the dot only outside it.
  The count is an accent pill (`accent` fill, `fg-on-accent` text); every value is a token
  (`npm run lint` runs `check-styles`).
- **Peek and pin in `shell.ts`.** The shell owns the bar's state and exposes the pin's toggle and an
  `activityBarNarrowChanged(isNarrow)` input (names at the implementer's choice, stated in the shell's doc comment):
  - Pointer enters the bar: after `--wg-activitybar-peek-delay` (read from the computed style when the timer starts,
    through the injected `timers`) the bar takes `is-peeking` and `is-expanded` and logs `activity bar peeked`.
    Pointer leaves: the timer clears and both classes go at once. A click on an activity item ends the peek.
  - Peeking widens the bar to `--wg-activitybar-expanded-width` over the content with the floating panel's shadow
    token; the grid track keeps `activitybar-width`.
  - Pinned: `is-pinned` and `is-expanded`, and the grid track takes `--wg-activitybar-expanded-width`; the side bar's
    room math counts the pinned width. Toggling logs `activity bar pinned` or `activity bar unpinned` and writes
    `activity-bar-pinned` (boolean) to the shell's scoped `uiState`; the shell reads it at mount.
  - The renderer tells the shell the 680px query's state (`SIDE_BAR_OVER_QUERY`, the `narrow` media query it already
    holds) at start and on change, never the crowding: while it matches, the pin is not applied (no `is-pinned`, the
    track collapsed) and the bar peeks on hover; the pin stays set and applies again when it stops matching.
- **Command and key.** `activityBar.togglePin` is a core page command registered in `renderer.ts` beside
  `MODES_SHOW`, with its label `pin the activity bar open` and group in `src/config/keymap.ts` beside the core
  commands there, bound `{ keys: '<Leader>vp', scope: 'any', command: 'activityBar.togglePin' }` in
  `src/plugins/keymap.ts` beside the other `<Leader>v` binds.
- **Tokens.** `activitybar-expanded-width` (`length`, `200px`) and `activitybar-peek-delay` (`duration`, `300ms`)
  in `theme-tokens.ts` beside `activitybar-width`, and in `catppuccin-mocha.json`.
- Every `ModeHandle` fake and the gallery's `test-shell-layout.ts` keep compiling: add `setCount` where a fake
  implements the handle (`grep -rln "ModeHandle" src`).
- CHANGELOG `### Changed`: `The activity bar groups its modes with dividers, puts Practice, Gallery and Settings at its bottom, and peeks each mode's name on hover.`; `### Added`: `Space v p pins the activity bar open with each mode's name and key.` and `A mode can show a count on its activity bar item.`

GIVEN a setting change that moves a mode to another group WHEN the config reloads THEN the bar redraws in the new order with no reload
GIVEN a pinned bar WHEN the page reloads THEN the bar opens pinned
GIVEN a pinned bar WHEN the window narrows below 680px THEN the bar lies collapsed and peeks on hover, and widening pins it again
GIVEN a plugin restart WHEN its mode is added again THEN it keeps its place

Tests:     `modes.test.ts`: a row or case for `setCount` reaching the deps and a disposed handle's `setCount` doing nothing, in the test that owns `setContext`.
           `shell-chrome.test.ts`: one table test over the drawn bar (slot order and track per item, divider count and place, pin last in the end track) for suggestions, a setting override and a hidden mode; one case for a count redrawing its item's `count` input; one for a mode re-added after dispose keeping its place.
           `shell.test.ts`: the pin toggles `is-pinned`/`is-expanded`, logs, writes `uiState` and is read back at mount; the narrow input drops and restores the pin; the peek arms on enter, fires after the delay through fake timers, clears on leave.
           `page-api.test.ts`: a row qualifying `showCommand` beside the one qualifying `id`.
Done when: compiles; `npm run lint` passes; the test gate runs the tests above; the look itself is checked in 06
Commit:    one commit for the group

## Proof

