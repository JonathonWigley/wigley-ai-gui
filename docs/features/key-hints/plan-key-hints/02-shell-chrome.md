# 02 — Status bar collapse, config badge, save-state line

Status: in progress
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

**Contents**

- **Files** — what this task changes and tests.
- **Consumes / Produces** — the signatures other tasks use.
- **Decisions** — the choices settled for the implementer.
- **Behaviour** — GIVEN/WHEN/THEN.
- **Tests** — names and the values they assert.
- **Done when / Commit**

Three changes to the window's chrome: the status bar takes no height while it shows nothing, the
config problem moves to the title bar as a badge, and the status line draws the save state only.

## Files

- modify `src/renderer/shell/shell.css`
- modify `src/renderer/config-push.ts` · test `src/renderer/config-push.test.ts`
- modify `src/renderer/renderer.ts`
- modify `src/shared/page/status-line.ts` · modify `src/shared/page/status-line.css` · test `src/shared/page/status-line.test.ts` (create)
- modify `src/plugins/forms/page/forms-view.ts` (`statusContent` and its two calls only)
- modify `src/plugins/primer/page/primer-view.ts` (`statusContent` and its two calls only)

This task edits the forms and primer files in wave 1, and tasks 04 and 05 edit them again in wave
2. The edit here is the minimum that keeps the tree compiling after wave 1: `StatusLineContent`
loses `mode`, and the `statusContent` function in each file returns that type, so each file stops
compiling without the edit. Task 01, in the same wave, does not open these two files
(`01-anchors.md`, Files).

## Consumes / Produces

Consumes: the tree only. `tag(text, tone)` in `src/shared/page/ui/tag.ts`; `Area.contribute(element, options)`
in `src/contracts/plugin.ts`; `installFakeDom`, `asFake` and `findAll` in `src/shared/page/test-dom.ts`.

Produces (tasks 04 and 05 consume these):

- `export interface StatusLineContent { save: string; saveState: string }` in `src/shared/page/status-line.ts`
- `export interface StatusLine { element: HTMLElement; update(isShown: boolean, content: StatusLineContent): void }` in `src/shared/page/status-line.ts` (unchanged). `update` sets `hidden` to `!isShown`. In a rail header (tasks 04 and 05) the caller passes `true`.
- `export function createStatusLine(): StatusLine` in `src/shared/page/status-line.ts` (unchanged signature)
- `export function contributeConfigProblems(titleBar: Area): { show(problems: readonly ConfigProblem[]): void }` in `src/renderer/config-push.ts`

## Decisions

- **Status bar collapse.** Add one rule to `shell.css`:
  `.shell-status-bar:not(:has(> .shell-track > :not([hidden]))) { display: none; }`.
  The shell already hides the area's element while it holds no contribution
  (`applyHidden` in `src/renderer/shell/shell.ts`). This rule covers the other case: every
  contribution is there but `hidden`. CSS reads the `hidden` attribute that each contributor already
  sets, so no contributor and no shell code changes. The `:not(:has(…))` selector outranks
  `.shell-status-bar`, so its `display: flex` loses. `--wg-status-bar-height` then reads `0px`:
  the `ResizeObserver` in `createStatusBarHeight` hears the size go to zero, and which-key and the
  toasts dock to the window's bottom edge. The existing `.shell-track:empty` rules stay. Rewrite
  the comment above `.shell-status-bar`: the bar takes no height while no track holds a shown item.
- **Coherence until task 10.** The key bar contributes a shown element to the status bar until task
  10 deletes it, so the bar keeps its height until then. Forms and primer still contribute their
  status line to the status bar until tasks 04 and 05 place it in their rail headers. Between this
  task and those, the save state shows in the status bar, on its own, only over a Form or Primer
  tab. Each state is a working app.
- **Config badge.** `contributeConfigProblems(titleBar)` makes `tag('', 'error')` with the extra
  class `config-problem-badge`, sets `hidden`, and contributes it with `{ align: 'end' }`. The
  `error` tone is `status-error` on `status-error-tint` (`src/shared/page/ui/tag.css`), which is
  the `status-error` badge `DESIGN.md` § Surfaces names. No new theme token. `show` keeps today's
  text and tooltip: one problem reads as `<file>: <message>`; more read as
  `<n> config problems`; the tooltip lists each problem on its own line. The doc comment becomes:
  a title bar badge over the config problems, at the end, hidden while there is none.
- **Badge order.** `renderer.ts` calls `contributeConfigProblems(areas.titleBar)` in place of
  `areas.statusBar`, before the plugins start. Contributions with equal `align` and `order` keep the
  order they were contributed in (`ContributeOptions` in `src/contracts/plugin.ts`). So the badge
  sorts before the keys plugin's Keys button (task 10) with no `order`.
- **Badge CSS.** In `shell.css`, replace the `.status-error` rule (the status bar's material, which
  no longer applies) with `.config-problem-badge`: `max-width: calc(var(--wg-space-8) * 12)`,
  `overflow: hidden`, `text-overflow: ellipsis`, `-webkit-app-region: no-drag`. The title bar is a
  drag region, and a drag region takes the mouse, so the badge opts out to show its tooltip. Add
  `gap: var(--wg-space-2)` to `.shell-title-bar > .shell-track-end`, so the badge and the Keys
  button sit apart.
- **The toast stays.** `announceNewProblems` and `createConfigPush` do not change.
- **Status line.** `createStatusLine` draws the save part only. Delete the `ui-status-line-mode`
  span and the `mode` field. The root becomes `element('span', 'ui-status-line')`, since it no
  longer sits in a bar footer. The doc comment becomes: a session form's save state, for the form
  to place in its rail header (`DESIGN.md` § Surfaces); `update` hides it while `isShown` is false.
  Until tasks 04 and 05 move it, forms and primer pass `tabs.isShown()` as `isShown`.
- **Status line CSS.** `status-line.css` keeps `.ui-status-line-save` and its `unsaved` rule. Delete
  `.ui-status-line-mode`. `.ui-status-line` becomes `display: inline-flex`, `align-items: center`,
  `font-size: var(--wg-text-12)`, `min-width: 0`. It drops `flex`, `flex-wrap`, `gap` and `padding`:
  the view that places the line owns its spacing, and tasks 04 and 05 cannot both edit this shared
  file in wave 2. Rewrite the file's comment to match.
- **Forms and primer.** In each file, `statusContent` drops its `boxes` parameter and the `mode`
  field, and returns `{ save, saveState }` as now. Its two calls pass `store.get()` or `state`
  alone. Remove the `modeLabel` import from each file. `boxes.onChange(updateStatus)`,
  `areas.statusBar.contribute(status.element)` and `onBaseChanged: updateStatus` stay. Rewrite
  each `statusContent` comment: it no longer names the vim mode. Leave every other line of these
  files to tasks 04 and 05.
- **The vim mode in forms and primer boxes.** Each box already shows its own vim mode in
  CodeMirror's vim status panel (`vim({ status: true })` in
  `src/renderer/codemirror-vim/codemirror-vim-host.ts`), so the status line's mode was a second
  copy. Removing it loses nothing. `shared/vim-mode-label.ts` stays: chat uses it.

## Behaviour

- GIVEN no status bar contribution is shown WHEN the window draws THEN the status bar takes no height
  and `--wg-status-bar-height` is `0px` (a visual check, task 12).
- GIVEN one broken config file WHEN the config is pushed THEN the title bar's end shows an error-tone
  badge `<file>: <message>`, its tooltip the same line, and a toast shows the same line.
- GIVEN two problems THEN the badge reads `2 config problems` and its tooltip lists both lines.
- GIVEN the problems are fixed THEN the badge hides.
- GIVEN a Form tab is shown THEN its status line holds the save state alone.

## Tests

`config-push.test.ts`: a new `describe('contributeConfigProblems')` installs the fake DOM
(`installFakeDom`, with `vi.stubGlobal` and `vi.unstubAllGlobals` as `confirm-prompt.test.ts`
does). Its fake `Area` records each `[element, options]`.

- `contributeConfigProblems_Contributes_AtTheTitleBarEnd` — one call; options equal `{ align: 'end' }`; the element's class holds `ui-tag--error` and `config-problem-badge`; `hidden` is true.
- `contributeConfigProblems_OneProblem_ShowsIt` — `show([{ file: 'settings.json', message: 'bad value' }])`: `hidden` false; `textContent` and `title` are `settings.json: bad value`.
- `contributeConfigProblems_TwoProblems_ShowsTheCount` — `textContent` `2 config problems`; `title` `a.json: x\nb.json: y`.
- `contributeConfigProblems_NoProblem_Hides` — after one problem, `show([])`: `hidden` true.

`status-line.test.ts` (create), with the same fake DOM:

- `createStatusLine_Update_DrawsTheSaveStateAlone` — `update(true, { save: 'Saved', saveState: 'saved' })`: `textContent` `Saved`; no `ui-status-line-mode` part; the save part's `dataset.state` is `saved`; `hidden` false.
- `createStatusLine_NotShown_Hides` — `update(false, { save: '', saveState: '' })`: `hidden` true.

Task 01 narrows `ConfirmKeys` to `anchor`, so this task also widens `FormsViewDeps.keys`
(`src/plugins/forms/page/forms-view.ts`) and `PrimerViewDeps.keys` (`src/plugins/primer/page/primer-view.ts`)
from `Pick<KeysPageExports, 'keysFor' | 'onChanged'>` to `Pick<KeysPageExports, 'keysFor' | 'onChanged' | 'anchor'>`.
In `forms-view.test.ts` and `primer-view.test.ts`, the `keys` fake gains
`anchor: () => ({ dispose: () => undefined })`, because the confirm prompt names its anchors when the view
is built. No other change is made to those two tests: their fake `statusBar` area takes the line and reads
no mode.

## Done when

`npm run lint` and `npm run typecheck` pass; the test gate runs the tests above. The collapse and
the badge in the running app are checked in task 12 (Final verification).

## Commit

One commit for the group.

## Proof
