# 10 — Retire the key bar

Status: not started
Type: Batch
Wave: 3 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09
Plan: [plan.md](plan.md)

**Contents**

- **Files** — what this task deletes, changes and tests.
- **Consumes / Produces** — the signatures this task reads and adds.
- **Decisions** — the choices settled for the implementer.
- **Preflight greps** — the commands that prove no caller is left.
- **Behaviour** — GIVEN/WHEN/THEN.
- **Tests** — names and the values they assert.
- **Done when / Commit**

Every key now shows in place (tasks 03–09). This task deletes the key bar and the old hint helpers,
puts the Keys button in the title bar, and makes the self-test fail on each unplaced bind.

## Files

- delete `src/plugins/keys/page/key-bar.ts` · `src/plugins/keys/page/key-bar-view.ts` · `src/plugins/keys/page/key-bar.test.ts`
- delete `src/shared/page/key-hint.ts` (task 06 deleted `src/plugins/chat/page/key-hint.ts`)
- modify `src/plugins/keys/page/start.ts` · `src/plugins/keys/page/keys.css` · `src/plugins/keys/page/help-view.ts` · `src/plugins/keys/manifest.ts`
- modify `src/plugins/keys/page/unplaced-log.ts` · test `src/plugins/keys/page/unplaced-log.test.ts`
- modify `src/plugins/keys/page/keys-for.ts` (comment) · `src/plugins/keys/page/which-key-view.ts` (comment)
- modify `src/shared/key-hints.ts` · test `src/shared/key-hints.test.ts`
- modify `src/shared/page/confirm-prompt.ts` · test `src/shared/page/confirm-prompt.test.ts`
- modify `src/plugins/forms/page/forms-view.ts` · `src/plugins/primer/page/primer-view.ts` · `src/plugins/backlog/page/backlog-view.ts` (one line each)
- modify `src/plugins/chat/page/entry-list.ts` (comment)
- modify `src/main/selftest-runner.ts` · `src/main/selftest.ts`
- test `src/main/selftest-steps.test.ts` · `src/main/selftest.test.ts`
- modify `src/plugins/forms/main/selftest-script.ts` (one fixture question, Decisions)
- modify each other plugin's `main/selftest-script.ts` only when its first gate run logs a bind that no fixture
  state reaches (Decisions)
- modify `docs/features/followups.md`

## Consumes / Produces

Consumes:

- `anchor(element: HTMLElement, command: CommandId, options?: AnchorOptions): Disposable` on
  `KeysPageExports`, and `createAnchors(deps: AnchorDeps): Anchors` in
  `src/plugins/keys/page/anchors.ts` ← 01
- `export interface UnplacedLog { checkSeen(): void }` and
  `export function startUnplacedLog(deps: UnplacedLogDeps): UnplacedLog` in
  `src/plugins/keys/page/unplaced-log.ts` ← 01
- the log line `[keys] unplaced <keys> <command> in <scope>` ← 01
- `readLog(window: DrivenWindow): Promise<string[]>` in `src/main/drive/page-driver.ts` (now)
- `contributeConfigProblems(titleBar: Area)`, which contributes the badge to the title bar's end
  before the plugins start ← 02
- every view's anchors, so no import of either `key-hint` module is left ← 03–09

Produces:

- `export const PLACEMENT_CHECK_EVENT = 'keys-check-placement'` in `src/plugins/keys/page/unplaced-log.ts`
- `export const PLACEMENT_CHECK_EVENT = 'keys-check-placement'` in `src/main/selftest-runner.ts`
- `export const UNPLACED_PREFIX = '[keys] unplaced '` in `src/main/selftest-runner.ts`
- `export function unplacedLines(lines: readonly string[]): string[]` in `src/main/selftest-runner.ts`
- `export async function checkPlacement(window: DrivenWindow): Promise<number>` in `src/main/selftest-runner.ts`
- `mountHelpView(overlay: Area, sections: HelpSection[], close: () => void, platform: Platform, closeHint: HTMLElement): HelpView` in `src/plugins/keys/page/help-view.ts` (the last parameter changes type)

## Decisions

- **Key bar.** Delete the three files. In `start.ts`, delete the `mountKeyBarView` call, its imports,
  the `keyBar.render()` call in the keymap listener, and the `services.editor.contains` use. In
  `keys.css`, delete the `.keys-bar`, `.keys-bar-hint` and `.keys-bar-label` rules and their comment.
- **Keys button.** `start.ts` builds `element('span', 'keys-title-bar-item')`. It holds
  `iconButton('record-keys', 'Keys', openHelp, 'sm')`, then an anchor element
  `element('span', 'keys-title-bar-hint')`. `openHelp` runs `qualify(keysManifest.id, 'toggleHelp')`,
  as the bar's button does now. The hint is `anchors.anchor(hint, qualify(keysManifest.id, 'toggleHelp'))`
  with no scope, so it shows in every scope. The item goes to `api.areas.titleBar` with
  `{ align: 'end' }`. The config badge comes first, because the renderer contributes it before the
  plugins start (task 02). The prompt prints what `keysFor` gives for the first page bind of
  `keys.toggleHelp`: `Space ?` on macOS with the default keymap (`<Leader>?` in `any`,
  `src/plugins/keymap.ts`), as `DESIGN.md` § Surfaces writes it. CSS in `keys.css`: `.keys-title-bar-item` is `display: inline-flex`,
  `align-items: center`, `gap: var(--wg-space-1)`.
- **Help's Close hint.** Delete `closeHelpHint`. `start.ts` makes
  `element('span', 'keys-close-hint')` and anchors it to `keys.closeHelp` with
  `{ scope: qualify(keysManifest.id, 'help') }`. The hint shows only while help is open, since only
  then is `keys.help` in force. `<Esc>` is a vim key, and a view may still anchor one (AGENTS.md
  § Architecture, Key hints). `mountHelpView` takes this element as `closeHint`. It builds the Close
  button once, with `textButton('Close', close, { variant: 'secondary', hint: closeHint })`, and
  appends it to `dialog.actions`. `setSections` replaces the grid only. Rewrite its doc comment.
- **Shared and chat `key-hint` modules.** Delete both files once the preflight grep prints nothing.
  When the grep prints a file, a wave-2 task left a caller. Route that call through `keys.anchor`
  here (the view's plugin already lists `keys` in `dependsOn` after its task), and name the file
  under Proof as a concern.
- **`pageHints`.** After the key bar goes, only `src/shared/key-hints.test.ts` uses `pageHints`
  (measured at plan time, re-verify with the grep below). Delete `pageHints` from
  `src/shared/key-hints.ts` and its `describe('pageHints')` block. Keep `editorHints`,
  `mergeHints`, `KeyHint` and `vimTokens`: help and which-key use them.
- **Confirm prompt's `platform`.** Since task 01 it is unused. Delete `platform` from
  `ConfirmPromptDeps` and its `Platform` import. Delete the `platform: deps.platform` line from the
  confirm deps in `forms-view.ts` (inside `createConfirmPrompt({…})`), `primer-view.ts` (the same)
  and `backlog-view.ts` (inside `promptDeps`). Each view's own `platform` dep stays. Delete
  `platform: 'macos'` from `confirm-prompt.test.ts`.
- **Unplaced lines fail the self-test.** The keys plugin logs unplaced lines only from
  `checkSeen()` (01). At the end of the run the runner asks the page to check every scope that was
  in force during the page load, then fails the run on every unplaced line.
  - **The page side.** `unplaced-log.ts` exports `PLACEMENT_CHECK_EVENT`. `start.ts` adds
    `document.addEventListener(PLACEMENT_CHECK_EVENT, () => unplacedLog.checkSeen())`. The check
    logs each `(scope, bind)` once per page load (01, De-duplication).
  - **The runner side.** `src/main` cannot import the keys plugin's page code
    (`scripts/check-layers.mts`), so `PLACEMENT_CHECK_EVENT` and `UNPLACED_PREFIX` are written in
    both places. The tests pin both ends.
  - `unplacedLines(lines)` returns the lines that start with `UNPLACED_PREFIX`, in the order given.
  - `checkPlacement(window)` runs
    `document.dispatchEvent(new Event('keys-check-placement'))` in the page with `window.run`, so
    the keys plugin logs the unplaced lines of every scope seen. It then reads `readLog(window)`, reverses
    it to oldest first, and takes `unplacedLines` of it. The page log (`src/renderer/log-view.ts`)
    writes each line at once and keeps every line of the page load, so the read holds every
    unplaced line of the load. It reports each line with `report(false, line)`. When there is
    none, it reports `report(true, 'every key placed')`. It returns the count of unplaced lines.
    A `PageNavigatedError` rejects out of it, as other page reads do.
  - `runAllScripts` in `selftest.ts` calls `checkPlacement(window)` once, after the last script and
    before the `all passed` line. It returns when `isCurrent()` is false after the call. It adds
    the count to `failures`. `runScript` does not change. Reason: the check runs once, after every
    state the scripts reach has drawn, so one read counts each gap once. Each line names its scope,
    and so its plugin.
- **Fixture states, not stand-ins.** A bind counts as placed once the page load names its
  anchor in its scope (01), on the element that draws its target. That element may be hidden by its
  scope, by a background view (the `secondRound` view) or by a closed dialog (the confirm prompt's
  buttons). When the gate logs a built-in bind as unplaced only because no self-test fixture builds
  its target, the fix is a fixture state that builds it at some point in the run. The fix is never
  a stand-in element made only to satisfy the gate, and never a list of exempt commands. Each fixture state below is
  read from the self-test scripts at plan time:
  - **Forms, `forms.choose5`…`forms.choose9`.** No fixture card has more than four picks: finding
    1 numbers two choices and two bare action headers (`src/plugins/forms/main/selftest-script.ts`,
    the `fixtureRound` finding and the step whose why names choice numbers 3 and 4). Add a third
    question to `secondRound`, titled `Nine choices`, with
    `choices: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']` and the
    other fields of `waiting`. The fixture asks `secondRound` with the other rounds when it opens,
    before the first step, and `syncRoundViews` builds a round view for every round, so its picks
    anchor in `forms.forms`. The run never answers that round, so no result
    check changes.
  - **Chat, `chat.allowPermission` and `chat.denyPermission`.** No new state: the first session
    holds the fixture's pending permission from the start (`askFixturePermission`).
  - **Primer, `x`, `c`, `C` and `a` in `primer.card`.** No new state: the rail selects a task row
    (`j`), so a task card draws.
  - **Any other line.** Read the scope and command it names, find the state that draws the target,
    and add that state to the owning plugin's self-test script. When no fixture can reach the
    state, report the line under Proof as a concern and leave the gate red.
- **Self-test steps.** No step reads the key bar or the status line's vim mode. Every step waits for
  a logged line, and no `scrollsItself` list names `.keys-bar` or `.ui-status-line-mode` (grep below).
  So no step changes. Only the fixture states in Decisions change.
- **Comments that name the key bar.** Rewrite each to the state after this task:
  - `src/plugins/keys/manifest.ts:4`: key hints over the merged keymap: which-key while a sequence is
    pending, the help overlay listing every key, the title bar's Keys button, and the prompts drawn
    into the anchors views name.
  - the `keysPagePart` comment in `start.ts`: drop the key bar sentence; name the Keys button.
  - `src/plugins/keys/page/keys-for.ts:9`: "as help and the anchors show it".
  - `src/shared/key-hints.ts:2`: the formatting which-key, help and the key prompts share.
  - `keys.css:1` and `src/plugins/keys/page/which-key-view.ts:14`: which-key docks above the status
    bar while it shows, and at the window's bottom edge otherwise.
  - `src/plugins/chat/page/entry-list.ts:225`: the list resizes with the window, or its tab shows
    again (no key bar).
- **Follow-ups.** In `docs/features/followups.md`:
  - remove "**Key hint on/off setting**"
  - remove "Docs prints keys as plain text inside three sentences"
  - remove "One `keyHint` helper in place of four copies"
  - remove "**One vim-mode status item**". It describes a status bar item for the focused box's vim
    mode. Each box already shows its vim mode in CodeMirror's vim status panel
    (`vim({ status: true })` in `src/renderer/codemirror-vim/codemirror-vim-host.ts`), and after
    task 02 no status line shows a mode, so the item it describes no longer exists. Remove the whole
    entry and its Contents line, if `followups.md` has one; do not rewrite it.

## Preflight greps

Run each before the first edit. Each must print nothing, except the two that list what this task
deletes.

- `grep -rln "key-hint'" src --include='*.ts'` prints nothing. It matches each import of
  `shared/page/key-hint` and `chat/page/key-hint`, and no import of `key-hints`. At plan time it
  printed 11 files (measured at plan time, re-verify): `primer-review.ts`, `primer-view.ts`,
  `card-parts.ts`, `card-kit.ts`, `layout-panes.ts`, `sign-in-dialog.ts`, `chat-dialogs.ts`,
  `chat-kit.ts`, `backlog-view.ts`, `chat-view.ts` and `confirm-prompt.ts`; task 01 and tasks
  04–09 remove each import. A file printed now is a caller a wave-2 task left (Decisions).
- `grep -rn "noSelectionHint\|appendKeyHint" src --include='*.ts'` prints nothing (task 03 removed
  `noSelectionHint`; `appendKeyHint` lives only in the deleted module).
- `grep -rln "\bpageHints\b" src --include='*.ts'` prints `src/plugins/keys/page/key-bar.ts`,
  `src/shared/key-hints.ts` and `src/shared/key-hints.test.ts` only.
- `grep -rn "keys-bar\|ui-status-line-mode" src/plugins --include='selftest-script.ts'` prints nothing.

After the edits:

- `grep -rn "key-bar\|keyBar\|barHints\|mountKeyBarView\|keys-bar\|closeHelpHint\|key bar\|key list" src`
  prints nothing.
- `test ! -e src/shared/page/key-hint.ts` exits 0.

## Behaviour

- GIVEN the app starts WHEN no plugin contributes to the status bar THEN the status bar takes no
  height (a visual check, task 12).
- GIVEN any scope WHEN the title bar draws THEN its end holds the Keys button with the `Space ?` prompt.
- GIVEN help is open THEN its Close button shows `⎋`; GIVEN help is closed THEN that hint is hidden.
- GIVEN a self-test run WHEN the page logs `[keys] unplaced x a.trash in a.s` at any time in the
  page load THEN the run prints `[selftest] FAIL [keys] unplaced x a.trash in a.s` once after the
  last script, and counts one failure.
- GIVEN the last script ends with `a.s` in force WHEN the runner dispatches the placement check
  THEN the keys plugin logs the unplaced binds of `a.s`, and the run fails on them.

## Tests

`selftest-steps.test.ts`, over the existing `page` helper. The test adds one answer to the fake
window, `['keys-check-placement', …]`, which pushes the test's lines to the front of the log, as
the page would log them:

- `checkPlacement fails once for each unplaced line, printing the line` — the log holds `[t] done` and `[keys] unplaced x a.trash in a.s`: `checkPlacement` resolves to `1`; console lines include `[selftest] FAIL [keys] unplaced x a.trash in a.s`.
- `checkPlacement counts the lines the check event logs` — the log holds no unplaced line, and the event answer logs `[keys] unplaced y a.copy in a.t`: resolves to `1`.
- `checkPlacement passes when no unplaced line is logged` — resolves to `0`; console lines include `[selftest] PASS every key placed`.

`selftest.test.ts`:

- `unplacedLines keeps only the keys plugin's unplaced lines, in order` — `unplacedLines(['[keys] unplaced x a.trash in a.s', '[t] done', '[keys] unplaced y a.copy in a.t'])` equals the first and third lines, in that order.
- `startSelfTest fails the run on an unplaced line logged before the first script` — over the fake window the `startSelfTest` tests use, the log holds one unplaced line at ready: the run exits with code `1` and prints `[selftest] FAIL [keys] unplaced x a.trash in a.s`.
- `PLACEMENT_CHECK_EVENT is the keys plugin's event name` — `PLACEMENT_CHECK_EVENT` from `selftest-runner.ts` equals `'keys-check-placement'`.

`unplaced-log.test.ts`:

- `PLACEMENT_CHECK_EVENT is the runner's event name` — equals `'keys-check-placement'`.
- `UNPLACED line starts with the runner's prefix` — `'[keys] ' + unplacedLine({ keys: 'x', command: 'a.trash' }, 'a.s')` starts with `'[keys] unplaced '`.

`key-hints.test.ts`: delete the `describe('pageHints')` block. `confirm-prompt.test.ts`: delete the
`platform` line; every test runs unchanged. `key-bar.test.ts` goes with its module.

## Done when

Every preflight and after-edit grep gives its expected output; `npm run lint` and
`npm run typecheck` pass; the test gate runs the tests above. The self-test run with zero unplaced
lines, the collapsed status bar and the title bar's Keys button are checked in task 12 (Final
verification).

## Commit

One commit for the group.

## Proof
