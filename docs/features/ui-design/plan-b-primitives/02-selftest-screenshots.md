# 02 — Self-test screenshot steps

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` · modify `src/main/selftest-config.ts` · test `src/main/selftest-config.test.ts` · modify `src/main/selftest.ts` · modify `src/main/main.ts` · modify `src/plugins/forms/main/selftest-script.ts` · modify `.gitignore`
Consumes:  `SelfTestStep`, `HandedScript`, `startSelfTest`, `SelfTestDriver.closeHandover` ← tree (plan A changes `selftest.ts` and `main.ts` for the temp config folder; this task adds to whatever parameters it leaves)
Produces:  `SelfTestStep.screenshot?: string` in `src/contracts/plugin.ts` · `export function screenshotFiles(handed: readonly HandedScript[]): Map<SelfTestStep, string>` in `src/main/selftest-config.ts` · `startSelfTest(…, screenshotFolder: string): SelfTestDriver` (a new last parameter) in `src/main/selftest.ts` · `export const PRIMITIVE_ELLIPSIS_SELECTORS: readonly string[]` (`.ui-row-label`, `.ui-row-detail`, `.ui-tab-label`, `.ui-collapsible-summary`) and `export function withPrimitiveEllipsis(scrollsItself: readonly string[]): string[]` in `src/main/selftest-config.ts`
Decisions: PNGs go to `<repo>/.selftest/screenshots/<pluginId>-<screenshot>.png`, the folder from `path.join(app.getAppPath(), '.selftest', 'screenshots')` in `main.ts` (drafter: `app.getAppPath()` is the repo root under `electron-forge start`; a repo folder outlives the temp home the self-test deletes, so the agent reads the PNGs after the run) · `.gitignore` gains `.selftest/` · the folder is deleted and recreated once, when `startSelfTest` runs, so a run leaves exactly its own PNGs; a page reload within the run overwrites the same names (drafter) · a screenshot name is lowercase words of letters and digits joined by `-`, and two steps may not save one file; both are checked at handover, and a bad name fails the self-test as a clashing setting does (drafter) · the capture is `webContents.capturePage(undefined, { stayHidden: true })` then `toPNG()`, written with `writeFile` from `node:fs/promises` (the `Files` service writes text only) · the capture runs after the step's expect wait and its report, whether the line came or not (a failing step's picture helps the agent), after the page's next three frames, and before the step's fit check, which resizes the window (drafter) · an empty image (`isEmpty()`) fails the step rather than writing a blank PNG (fail loud) · switching transparency for a screenshot is the gallery's raw key (task 06); this task adds only the mechanism (plan.md)
GIVEN plugin `forms` and a step with `screenshot: 'gallery-full'` WHEN `screenshotFiles` runs THEN that step maps to `forms-gallery-full.png`
GIVEN a step with no `screenshot` WHEN `screenshotFiles` runs THEN the map has no entry for it
GIVEN a screenshot name `Gallery full` WHEN `screenshotFiles` runs THEN it throws naming the plugin and the name
GIVEN two steps that save one file WHEN `screenshotFiles` runs THEN it throws naming the file
GIVEN a script's `scrollsItself` list WHEN `withPrimitiveEllipsis` runs THEN it returns the list followed by the four primitive selectors, none twice
Tests:     `screenshotFiles_NamedStep_MapsToPluginDashName` — plugin `forms`, steps `[{ keys: ['j'], expect: 'x', screenshot: 'gallery-full' }]`: the map's value for that step object is `forms-gallery-full.png`
           `screenshotFiles_StepWithoutScreenshot_IsAbsent` — plugin `forms`, one step with no `screenshot`: the map's size is 0
           `screenshotFiles_NameWithCapitalsAndSpace_Throws` — plugin `forms`, `screenshot: 'Gallery full'`: throws `Self-test step of forms names screenshot "Gallery full": a screenshot name is lowercase letters and digits in words joined by -`
           `screenshotFiles_NameEndingInDash_Throws` — `screenshot: 'gallery-'`: throws the same message with `"gallery-"`
           `screenshotFiles_SameNameTwiceInOneScript_Throws` — plugin `forms`, two steps with `screenshot: 'round'`: throws `Two self-test steps save forms-round.png`
           `withPrimitiveEllipsis_ScriptList_AddsTheFourSelectors` — `['.scroller']`: `['.scroller', '.ui-row-label', '.ui-row-detail', '.ui-tab-label', '.ui-collapsible-summary']`
           `withPrimitiveEllipsis_ListAlreadyHoldingOne_DoesNotRepeatIt` — `['.ui-row-label']`: the four selectors, `.ui-row-label` once, and an empty list gives the four
           `screenshotFiles_DifferentPluginsSameFile_Throws` — plugin `a` with `screenshot: 'b-c'`, plugin `a-b` with `screenshot: 'c'`: throws `Two self-test steps save a-b-c.png`
Done when: compiles; `npm run typecheck`, `npm run lint` and `npm test` pass (the tests above among them); `npm run selftest` passes (the fit check treats the four primitive ellipsis selectors as allowed to clip, for every script) and its output holds `[selftest] PASS screenshot <repo>/.selftest/screenshots/forms-round.png`; that file exists after the run and `git status --short` does not list `.selftest/`
Commit:    one commit for the group

## Contract — `SelfTestStep`

`screenshot?: string`, documented in the type's comment: when set, the driver saves a PNG of the
window once the step's line has been waited for, as `<pluginId>-<screenshot>.png` in the run's
screenshot folder; the name is lowercase letters and digits in words joined by `-`.

## `screenshotFiles` — `src/main/selftest-config.ts`

Walks every handed script's steps in hand-over order. A step with `screenshot` must match
`^[a-z0-9]+(-[a-z0-9]+)*$`, or it throws the name message above. Its file is
`` `${pluginId}-${screenshot}.png` ``; a file already in the map throws
`` `Two self-test steps save ${file}` ``. Returns the map from each step object to its file name.

## Driver — `src/main/selftest.ts`

| Member | Now | After |
|---|---|---|
| `startSelfTest` | `(window, homeFiles, cleanUp)` (plus what plan A adds) | gains a last parameter `screenshotFolder: string`; first deletes it (`rmSync`, `recursive`, `force`) and recreates it (`mkdirSync`, `recursive`) |
| `closeHandover` | merges the configs inside a try that calls `failSelfTest('the self-test scripts merge', …)` | also runs `screenshotFiles(handed)` there; a throw fails the self-test with `failSelfTest('the self-test screenshots name', error, cleanUp)` and returns the empty config, as the merge failure does; the map is kept for the runs |
| the fit check's list | `cutOffAtMinimumWidth(window, script.scrollsItself)` is called from `startRun` with the script's own list (`script.scrollsItself`, passed down the chain) | the call passes `withPrimitiveEllipsis(script.scrollsItself)` (`selftest-config.ts`), so `.ui-row-label`, `.ui-row-detail`, `.ui-tab-label` and `.ui-collapsible-summary` join every script's `scrollsItself` in the driver and no plugin script lists them; the primitives clip their text with an ellipsis on purpose (05 defines the classes: check 05's spelling when this lands) |
| `waitForResizeRedraw` | waits for three page frames, named for the fit check | renamed `waitForRedraw`, its comment naming both callers (the fit check, a screenshot); body unchanged |
| `runStep` | waits for the step's line, reports it, then runs the fit check | receives the step's PNG path (`path.join(screenshotFolder, file)`, or none) through the call chain from `startRun`; after the line's report and before the fit check, when the step has one and the run is current: `waitForRedraw`, capture, then `report(true, \`screenshot ${png}\`)` on a write, or `report(false, \`screenshot ${png}: ${reason}\`)` where `reason` is `the capture came back empty` or the error's `errorText`; a failed capture makes the step return false |

The PNG path in the log line is absolute, so the agent opens it as printed.

## `main.ts`

The `startSelfTest` call passes `path.join(app.getAppPath(), '.selftest', 'screenshots')` as the
last argument. Nothing else changes.

## Fit check — the primitives' ellipsis parts

`withPrimitiveEllipsis` returns `scrollsItself` followed by each of `PRIMITIVE_ELLIPSIS_SELECTORS` it does not already hold. It is pure, so the two tests above cover the merge; the driver's one call site is in the table above.

## Self-test step

`src/plugins/forms/main/selftest-script.ts`: the second entry of `STEPS`, the first `j` step (line 133
today, measured at plan time, re-verify), `{ keys: ['j'], expect: '[page] j ran
forms.nextItem', checksFit: true }`, gains `screenshot: 'round'`, so every run proves the capture
end to end. Task 06 adds the gallery's screenshots.

## Live checks for task 08

- low-confidence (Electron's offscreen capture is not covered by a test, and its docs do not say
  `capturePage` works for an offscreen window): after `npm run selftest`,
  `.selftest/screenshots/forms-round.png` opens as the forms round at the window's size, not blank
  or black. If it is blank, the fallback is the frame the offscreen window's `paint` event hands
  over ("the image data of the whole frame"), which `startSelfTest` already listens to.
- expected: the PNG shows the step's state after its keys (the round with the item `j` moved to
  selected), not the state before them.

## Proof

Commit `bd6455e` · diff read: every Produces present (`SelfTestStep.screenshot`, `screenshotFiles`,
`PRIMITIVE_ELLIPSIS_SELECTORS`, `withPrimitiveEllipsis`, `startSelfTest(…, screenshotFolder)`) ·
typecheck passes · worker ran lint, test (1823) and selftest green; `forms-round.png` (900x700)
shows the round after `j`, so offscreen `capturePage` works and the paint fallback was not needed.
Concerns: none open.
