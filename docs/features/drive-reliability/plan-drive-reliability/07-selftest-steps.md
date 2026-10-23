# 07 — Self-test steps in named groups, with `why`, a held `width` and `repeat`

Status: not started
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` · modify `src/main/selftest.ts` · modify `src/main/selftest-config.ts` ·
           modify `src/main/drive/page-driver.ts` · modify `src/main/drive/fake-driven-window.ts` ·
           modify `src/plugins/forms/main/selftest-script.ts` · modify `src/plugins/docs/main/selftest-script.ts` ·
           modify `src/plugins/chat/main/selftest-script.ts` · modify `src/plugins/settings/main/selftest-script.ts` ·
           test `src/main/selftest-steps.test.ts` (create) · test `src/main/selftest.test.ts` ·
           test `src/main/selftest-config.test.ts`
Consumes:  `LogMark`, `markLog`, `waitForNewLogLine` ← 02 (selftest.ts and page-driver.ts are shared with 02, hence
           the wave); `cutOffAtWidth`, `waitForPageWidth`, `waitForRedraw` (tree)
Produces:  in `src/contracts/plugin.ts`:
           `export interface SelfTestGroup { name: string; why: string; steps: SelfTestStep[] }`
           `SelfTestStep` gains `why?: string`, `width?: number | 'start'`, `repeat?: { until: string; max: number }`
           `SelfTestScript.groups: SelfTestGroup[]` in place of `steps: SelfTestStep[]`
           in `src/main/drive/page-driver.ts`:
           `export async function resizeContentWidth(window: DrivenWindow, width: number): Promise<boolean>` — sets the
           width, waits for the page to report it and redraw; false when either never lands
           `export function waitForAnyNewLogLine(window: DrivenWindow, lines: readonly string[], mark: LogMark, timeoutMs = STEP_TIMEOUT_MS): Promise<string | null>`
           — the first of `lines` logged since the mark, or null; `waitForNewLogLine` becomes a call to it
           in `src/main/selftest-config.ts`:
           `screenshotFiles(handed): Map<SelfTestStep, string[]>` — each step's files, one, or `max` for a repeat
           `export function checkGroups(handed: readonly HandedScript[]): void`
Decisions: groups with a required `why`, an optional step `why` (round 1, choice 1) · `width` held until another
           step's `width` or the script's end; `'start'` returns to the start width (round 1, choice 1; `'start'`
           while writing the docs step) · `repeat` presses again after each `expect` until `until`, one screenshot per
           press (round 1, choice 1) · the runner owns the held width and its restore (design review: depth) · repeat
           files come from the existing name check (design review: leverage) · the AGENTS.md wording is written ahead
           (6e65c67)

## Behaviour

### Contract (`plugin.ts`)

- The `SelfTestStep` comment adds the three fields in the words `AGENTS.md` § Running and testing now uses (6e65c67);
  a `SelfTestGroup` comment: `name` is short words naming what the group covers, unique within its script; `why` says
  what the group proves.

### The runner (`selftest.ts`)

- `runScript` walks `script.groups`; before each group's steps it reports `[selftest] group <pluginId>: <name>`.
- `startSelfTest` reads the window's content width once, before any run (`startWidth`, a property of the window,
  not of a run), and passes it down. `runScript` resizes back to it when it opens on a different width (a reload
  that interrupted a held width), as well as at its end. A step with `width` resizes before its
  `writeFile` and keys (`'start'` means `startWidth`) through `resizeContentWidth`; a resize that never lands fails
  the step with `width <n> never landed` and skips its keys. The width then holds: the fit check already restores
  the width it read, which is the held one. When the script ends (after its result is checked, and also when a
  reload interrupts it) and the width is not `startWidth`, it resizes back.
- A step with `repeat`: after the first `expect` line, presses the keys again and waits with `waitForAnyNewLogLine`
  for `expect` or `repeat.until`, each wait from a fresh mark taken before the press. `until` ends the step as
  passed; `expect` presses again; a press that logs neither within the step timeout, or `until` not reached after
  `max` presses in all, fails the step. The first press counts toward `max`.
- A repeating step reports one PASS/FAIL line, `<keys> ×<presses> -> <until>`; a failure appends
  `: <expect> or <until> never logged after press <n>` or `: <until> not reached in <max> presses`. Each saved file
  reports its own `screenshot …` line, as today. `checksFit` runs once, after the `until` press. A failed press saves
  its file and ends the step.
- Screenshots: a step saves `files[0]` as today; a repeating step saves `files[n - 1]` after the `n`-th press's line
  (`expect` or `until`), so the last file saved is the page at `until`.
- A failed step also reports `[selftest]   group why: <group.why>`, and `[selftest]   step why: <step.why>` when it
  has one.

### Hand-over checks (`selftest-config.ts`)

- `screenshotFiles` walks every group's steps. A repeating step's files are `<pluginId>-<name>-<n>.png` for
  `n` = 1..`max`; every file is checked against every other step's, as today.
- `checkGroups` throws on a group with an empty `name` or `why`, on two groups of one script with the same name, on a
  `repeat` with `max` below 2 or an empty `until`, and on a `width` that is not `'start'` or a positive integer.
  `closeHandover` calls it beside `screenshotFiles`, failing the self-test the same way.

### The fake window (`fake-driven-window.ts`)

- `setContentWidth` and `setSize` record the width, and `contentSize` returns it (800 × 600 at start), so a runner
  test reads the resizes.

### The four scripts, one group each

Each script's `steps: …` becomes one group, its steps array left where it is, so tasks 08–10 split it:

| Script | `name` | `why` |
|---|---|---|
| forms | `forms` | `Every forms key path over the fixture rounds, the keys and gallery steps included` |
| docs | `docs` | `Every docs key path over the docs fixture, in Docs mode and a session Docs tab` |
| chat | `chat` | `Every chat key path over the fake agent harness` |
| settings | `settings` | `The settings form editing settings.json and keymap.json, and outside edits to both` |

GIVEN a step with `width: 600` then a later step with no width WHEN the script runs THEN the window is 600 wide for
both, and back at the start width after the script
GIVEN a step with `width: 'start'` after one with `width: 600` WHEN it runs THEN the width returns to the start width
GIVEN a repeating step whose page logs `expect` twice then `until` WHEN it runs with `max: 5` THEN it passes after 3
presses and saves files 1 to 3
GIVEN a repeating step whose page never logs `until` WHEN `max` presses have run THEN the step fails
GIVEN a failing step in a group WHEN it is reported THEN the group's why, and the step's why when set, are printed
GIVEN two groups of one script named alike, or a repeat with `max: 1` WHEN the scripts are handed over THEN
`checkGroups` throws naming the plugin and the group
GIVEN a repeating step with `screenshot: 'pages'` and `max: 3` WHEN `screenshotFiles` runs THEN its files are
`forms-pages-1.png` to `forms-pages-3.png`, and another step's `pages-2` clashes

Tests:     the runner cases in a new `src/main/selftest-steps.test.ts` that mocks only `electron` and drives
           `runScript` over `fakeDrivenWindow`, with answers for `#log li`, `innerWidth` (the fake's recorded width),
           `window.redrawFrames` and `elementFromPoint`, and `screen.captured` set (`selftest.test.ts`'s file-wide
           mock of `./drive/page-driver` hides the log these cases read); `selftest.test.ts`'s window stand-ins gain
           `contentSize` so its existing tests pass; the hand-over cases in
           `src/main/selftest-config.test.ts`. New tests take the file's sentence style; the existing
           `Name_Case_Result` names there stay (renaming them is master-plan step 22).
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above and `npm run selftest`
           (every script still passes as one group)
Commit:    one commit for the group

## Proof

