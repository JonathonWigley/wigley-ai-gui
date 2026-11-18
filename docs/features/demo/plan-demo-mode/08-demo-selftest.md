# 08 — Demo self-test and coverage check

Status: in progress
Type: Task
Rung: hard · adds a page-to-main report and a script that walks every plugin's landed steps before the `live` section; nothing a wrong guess here ships to the user's state
Wave: 4 · Depends on: 06, 07, 09 (its coverage check and step walk expect every plugin's step or skip to have landed), 10 (same), 11 (same), 12 (same), 13 (same), 14 (same), 15 (same)
Plan: [plan.md](plan.md)

Files:
- create `wigley-ai-gui/src/plugins/demo/main/selftest-script.ts` · test `wigley-ai-gui/src/plugins/demo/main/selftest-script.test.ts`
- create `wigley-ai-gui/src/plugins/demo/page/coverage.ts` · test `wigley-ai-gui/src/plugins/demo/page/coverage.test.ts`
- modify `wigley-ai-gui/src/plugins/demo/contract.ts`
- modify `wigley-ai-gui/src/plugins/demo/main/start.ts` · test `wigley-ai-gui/src/plugins/demo/main/start.test.ts` (06's file)
- modify `wigley-ai-gui/src/plugins/demo/page/start.ts` · test `wigley-ai-gui/src/plugins/demo/page/start.test.ts`

Consumes:
- `PluginManifest.demoSkip?: string` ← 01
- `PluginStatus.demoSkip: string | null` on the `core.plugins` slot (`src/contracts/core-state.ts`), written by the plugin switch ← 01
- `PageServices.demoSteps` ← 01
- `DemoChannel`, `demoManifest`, `REAL_SESSION_STEP_ID`, and the part `demoMainPart` with its `run` ← 06
- `demoPagePart`, its stop sequence, and the run driver's `failed(stepId, error)` dep ← 07
- Every built-in plugin's `page/demo-steps.ts` or `demoSkip` ← 09, 10, 11, 12, 13, 14, 15
- `corePluginsSlot` (`src/contracts/core-state.ts:82`) — in the tree
- `SelfTestScript`, `SelfTestGroup`, `SelfTestHost` (`src/contracts/plugin.ts:1005-1061`), handed over through `services.selfTest?.run(script)`, as `system-stats/main/start.ts` does — in the tree

Produces:
- `src/plugins/demo/contract.ts`:
  - `export interface DemoRunReport { missing: string[]; failed: string[] }`
  - `DemoChannel.invoke.report(report: DemoRunReport): void`
  - `DemoChannel.messages.selfTestOpened: number`
- `src/plugins/demo/page/coverage.ts`: `export function missingCoverage(plugins: readonly PluginStatus[], stepIds: readonly string[]): string[]`
- `src/plugins/demo/main/selftest-script.ts`:
  - `export interface DemoSelfTestDeps { open(run: number): void; nextReport(): Promise<DemoRunReport> }`
  - `export function demoSelfTestScript(deps: DemoSelfTestDeps): SelfTestScript`
  - `export function reportProblems(report: DemoRunReport): string[]`

## Decisions

- **Where the check gets the built-in list.** A plugin layer cannot import `src/plugins/manifests.ts`: its rules admit only `src/contracts`, `src/shared` and its dependencies' contracts (`scripts/layer-rules.mts`). The core's `core.plugins` slot lists every catalog plugin with its `origin`, and task 01 adds each row's `demoSkip`; the page reads the slot as the settings page does (`src/plugins/settings/page/start.ts:48`).
- **What counts** (`missingCoverage`): the ids of the slot's rows whose `origin === 'built-in'` and `demoSkip === null`, and for which no step id in `services.demoSteps.list()` starts with `<id>.`, in slot order. The check counts registrations, not entered steps: a step the walk never enters (the `live` section's) still covers its plugin.
  - A user plugin that replaces a built-in (`'replaces-built-in'`) is out of scope (plan.md Out of scope).
  - A run on the fake harness leaves `claude-code` out of the catalog (`src/plugins/manifests.ts`, `withoutRealHarnessPlugins`), so the self-test does not check it. Task 09 gives it a `demoSkip`.
  - Only page steps count. A main half alone shows nothing.
- **When the page computes it.** At the start of the stop sequence (07), before the driver leaves the held step: the plugin-switch hold still runs the off-by-default plugins then, so their page steps are in the registry.
  - The page logs `coverage: every built-in plugin has a step or a skip`, or `coverage: no step or skip for <ids joined by ", ">`.
  - The run's failed step ids are the ids 07's driver gave to `failed`, kept once each in first-failure order, and cleared at each run start. When some exist, the page logs `failed steps: <ids joined by ", ">`.
  - Then it invokes `report({ missing, failed })` and goes on with the stop. A rejection is logged and does not stop the stop.
- **Main's side.** `demoMainPart` handles `report`. When a self-test result waits, it resolves that result with the report. It hands the script over with `services.selfTest?.run(demoSelfTestScript({ open, nextReport }))`, where:
  - `open(run)` sends the message `selfTestOpened` with `run`; the page logs `self-test run <run>`.
  - `nextReport()` returns a promise that the next `report` resolves.
  - A `report` with no waiting result is dropped: the page reports at every stop, a user's own stop outside a self-test included, and a report held for a later `nextReport()` would settle a later run's result with a stale run's data. A second `nextReport()` while one waits replaces the waiter; the self-test opens one run at a time, so it does not happen in practice.
- **The script order.** Hand-over order is start order (`src/main/selftest.ts:233-246`). 06 put `demo` second to last, so this script runs after every other plugin's and before app-update's.
- **The script's groups.** The keys are all `<Space>`-led page keys, as in `system-stats/main/selftest-script.ts`. `FIRST` and `SECOND` are the ids of the first two steps in run order, read from the landed `page/demo-steps.ts` files: section `shell`, lowest `order`. At plan time 09's task gives `keys.hints` (order 1) and `gallery.mode` (order 2). Write the landed ids as constants.
  1. `start`: keys `[' ', 'd', 'd']`, expect `[demo] run started`, alsoExpect `/^\[demo\] showing FIRST beat 1 of \d+: .+$/`, `screenshot: 'started'`, `checksFit: true`.
  2. `first-beat`: `[' ', 'd', 'p']`, expect `[demo] at the first beat`.
  3. `panel`:
     - `['<A-l>', '<A-l>', '<A-l>']`: expect `[demo] panel focused`, alsoExpect `/^\[demo\] cursor on FIRST$/`. From main, `<A-l>` first moves between main's own panes, then enters the right bar's first stop, which is the Demo panel (`PANEL_ORDER = -10`, first in the right bar). From a right-bar stop, `<A-l>` only logs `no pane right` and keeps the stop (`focusFromRight`, `src/renderer/pane-targets.ts`: only down and up move between stops). So presses past the panel are harmless, and three reach it from a Chat tab with its hub and one more pane, in a filtered run and a full one alike. system-stats' script needs two presses from a Chat tab with its hub (`system-stats/main/selftest-script.ts:44-45`). A `repeat` does not fit: each press must log `expect` or `until` (`repeatUntil`, `src/main/selftest-runner.ts:170-210`), and a move between main's panes logs neither.
     - `['j']`: expect `[demo] cursor on SECOND`.
     - `['Enter']`: expect `[demo] went to SECOND`, alsoExpect `/^\[demo\] showing SECOND beat 1 of \d+: .+$/`, `screenshot: 'panel-cursor'`.
     - `['<A-h>']`: expect `[page] focus back in main`.
  4. `reset`: `[' ', 'd', 'r']`, expect `[demo] reset SECOND`.
  5. `real-sessions`: `[' ', 'd', 'h']` expect `[demo] real sessions shown`, then again, expect `[demo] real sessions hidden`.
  6. `autoplay`: `[' ', 'd', 'a']`, expect `[demo] autoplay on`, alsoExpect `/^\[demo\] moved next$/`, which comes once the 1 s dwell passes; then `[' ', 'd', 'a']`, expect `[demo] autoplay off`. The script's `settings` are `{ demo: { autoplaySeconds: 1 } }`. No other script reads them (`src/main/selftest-config.ts`, `mergeSelfTestConfigs`).
  7. `walk`: `[' ', 'd', 'n']`, `repeat: { until: LAST_LINE, max: 400 }`, expect `[demo] moved next`, `timeoutMs: 15000`, `screenshot: 'before-live'`.
     - The walk stops at the last beat of the last step before the `live` section and never enters a `live` step: live-view's step needs a Screen Recording grant for its stream, and the real-session step needs a real harness.
     - `LAST_LINE` is the `showing` line of that beat, written as a constant from the landed step files: `[demo] showing <id> beat <n> of <n>: <beat name>` for the step with the highest `order` in section `bars`. At plan time task 10 gives `[demo] showing auto-retro.section beat 1 of 1: Retro running, 2 queued`. The runner's `until` is an exact line (`src/main/selftest-runner.ts:178-203`).
     - This enters and leaves every registered step before `live`, so a step that throws reaches `failed` and the result.
     - The beat count was not measurable at plan time: no step had landed. A filtered run counts it from its `showing` lines; keep `max` above twice that count.
     - `timeoutMs` covers a step whose enter launches demo sessions. The default is 5000 ms (`src/main/drive/page-driver.ts:32`).
  8. `stop`: `[' ', 'd', 'x']`, expect `[demo] run stopped`, alsoExpect `/^\[demo\] coverage: /`.
- **The script's `open`, result and problems:**
  - `open(run)` calls `deps.open(run)`. It returns `shownLine: '[demo] self-test run <run>'` and `result: deps.nextReport()`.
  - `problems(result)` is `reportProblems(result as DemoRunReport)`: one `<id> has no demo step and no demoSkip` per missing id, then one `step <id> failed` per failed id, in report order. The runner prints them in one FAIL line (`src/main/selftest-runner.ts:585-589`), so the run names each plugin.
  - `pageBinds: []`, `scrollsItself: []`.
- **No end-of-run hook in `src/main/selftest.ts`.** The check rides the script's own result, so `npm run selftest -- --plugin demo` runs it (AGENTS.md § Intent, "Every feature has a demo step"). A core check beside `checkPlacement` would skip in every filtered run (`src/main/selftest.ts:129-135`).
- The `live` section's steps (live-view's and `demo.realSession`) are covered by the coverage check's registrations and by the live checks of task 17, not by the walk.

## Pinned values

- Log lines: `coverage: every built-in plugin has a step or a skip`, `coverage: no step or skip for <ids>`, `failed steps: <ids>`, `self-test run <run>`.
- Problem lines: `<id> has no demo step and no demoSkip`, `step <id> failed`.
- Screenshot names: `started`, `panel-cursor`, `before-live`.
- The `panel` group's focus keys: three `<A-l>` presses.
- The walk's `max: 400` and `timeoutMs: 15000`; the autoplay setting `1`.

GIVEN slot rows `a` (built-in, no skip), `b` (built-in, skip `'Draws nothing.'`), `c` (built-in, no skip) and `u` (user), and step ids `a.one` and `ab.two` WHEN `missingCoverage` runs THEN it returns `['c']`
GIVEN a report `{ missing: ['c'], failed: ['p.one'] }` WHEN `reportProblems` runs THEN it returns `['c has no demo step and no demoSkip', 'step p.one failed']`
GIVEN a run with a failed step WHEN the demo stops THEN the page logs the coverage line and `failed steps: p.one`, and main's waiting result resolves to the report
GIVEN no self-test result waits WHEN the page invokes `report` THEN main drops it, and a later `nextReport()` resolves only with the report after it

## Tests

- `coverage.test.ts`, `describe('missingCoverage')`: one `it.each` table of `{ name, plugins, stepIds, expected }` rows:
  - a step under the plugin's prefix covers it
  - a `demoSkip` covers it
  - a step id that only shares a prefix (`ab.two` for plugin `a`) does not cover it
  - a user plugin and a `replaces-built-in` row are never listed
  - order follows the slot
- `selftest-script.test.ts`, `describe('demoSelfTestScript')`:
  - `reportProblems_Report_NamesEachMissingThenFailed`: a table of `{ report, expected }`; the empty report gives `[]`.
  - `open_Run_SendsTheOpenAndWaitsForTheNextReport`: `open(3)` calls `deps.open(3)`, returns `shownLine` `[demo] self-test run 3`, and its result resolves to what `nextReport` resolves. `src/plugins/usage/main/selftest-script.test.ts` is the pattern.
- `src/plugins/demo/main/start.test.ts` (06's file), on `startMainPart` with a `services.selfTest` fake that records the handed-over script:
  - `report_AfterOpen_ResolvesTheResult`: the script's `open(2)` sends the channel message `selfTestOpened` with `2`; a `report({ missing: ['c'], failed: [] })` through the channel resolves `open`'s `result` to it.
  - `report_NoWaiter_IsDropped`: a `report` before any `open`, then `open(1)` and a second `report`; the result resolves to the second report. The break it catches is a stale run's report settling a later run's result.
- `src/plugins/demo/page/start.test.ts` (07's file): add `stop_FailedStep_ReportsCoverageAndFailures`. A registry holds one step that rejects, the fake `core.plugins` slot holds one uncovered built-in, and the test asserts the `report` invoke's argument and that it comes before `leaveStep`.
- The script itself runs in the test gate as `npm run selftest -- --plugin demo` (AGENTS.md § Running and testing). `wigley:make` owns when it runs.

Done when: `npm run typecheck`, `npm test` and `npm run lint` pass.

Commit: one commit for the group: "Demo self-test: Space d keys, a walk through every step, and the coverage check on PluginStatus.demoSkip"

## Proof
