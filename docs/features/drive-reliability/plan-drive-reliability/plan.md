# Drive reliability and tooling — plan

Feature: drive reliability (master-plan step 2) · Implements: none · Ticket: none
Target: `main`, in the main tree, after step 1 · Written: 2026-10-23

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Every later step's live checks run through the drive run and the self-test, so make both dependable and give them
the tools the follow-ups asked for:

- a page reload under a drive script costs one re-poll, not a 30 s hang (the `restart` hang)
- dev drive and self-test starts stop launching over each other's `.vite/build`
- `wait-log` and every log wait catch a reload that lands between the log read and the wait
- `drag --hold` / `release`
- self-test steps in named groups with a `why`, a held `width`, and `repeat` until a line
- the docs hidden-tree self-test step, the gallery without its page count
- drive fixtures for the docs load states and for a fake session that ends itself

## Architecture

Systems touched:

- the drive's window seam: `DrivenWindow` (`src/main/drive/driven-window.ts`), its Electron adapter
  (`src/main/electron-driven-window.ts`) and its fake (`src/main/drive/fake-driven-window.ts`)
- the page driver and the drive commands (`src/main/drive/page-driver.ts`, `src/main/drive/drive-commands.ts`)
- the drive and self-test CLIs (`scripts/drive.mts`, `scripts/drive-args.mts`, `scripts/selftest.mts`), with a new
  shared start lock (`scripts/start-lock.mts`)
- the self-test contract and runner (`src/contracts/plugin.ts`, `src/main/selftest.ts`, `src/main/selftest-config.ts`)
  and the four plugins' self-test scripts (forms, docs, chat, settings)
- the fake agent harness (`src/shared/fake-agent-harness.ts`) and the docs drive fixture
  (`src/plugins/docs/main/start.ts`, `src/plugins/docs/main/selftest-fixture.ts`)

Root cause of the restart hang (debugger report, 2026-10-23, recorded in `followups.md`): Electron's
`webContents.executeJavaScript` never settles when its document is replaced during the call, and `holdsBefore` races
each check against the whole remaining deadline, so one lost check eats the 30 s. Startup polls run across the dev
server's two page loads. Overlapping `electron-forge start`s, which all empty and rewrite `.vite/build` (fixed at
`<project>/.vite` by forge plugin-vite 8.0.1, `VitePlugin.js:165`), add navigations and the "Error launching app"
dialog. Measured: about 1 in 60 restarts for one run alone; 8 in 36 for three runs restarting together.

## Preconditions

`wigley:make` re-runs each before the first dispatch.

- Step 1 is finished: its session has said so, and `git status --short -- src` prints nothing, so no peer's
  uncommitted edit sits in a file this plan changes. Until both hold, the run waits: a peer's dev start shares this
  tree's `.vite/build` (AGENTS.md § Dev quirks), and its edits would be swept into this run's commits.
- The docs written ahead are in the tree: `git merge-base --is-ancestor 6e65c67 HEAD` exits 0.
- Electron is 44.9.1: `grep '"electron"' package.json`. Task 01 checks its `render-process-gone` event
  shape in Electron 44's docs.
- Forge plugin-vite is 8.0.1 and fixes its build folder: `grep '"version"' node_modules/@electron-forge/plugin-vite/package.json`
  and `command grep -n "path.join(dir, '.vite')" node_modules/@electron-forge/plugin-vite/dist/VitePlugin.js`.
- The self-test scripts hand `steps` today: `grep -n 'steps:' src/plugins/*/main/selftest-script.ts` prints forms
  `STEPS`, docs `docsSteps(paths, homeDir)`, chat `STEPS`, settings `STEPS` (measured at plan time, re-verify).
- Step counts per script, re-measured at preflight with `grep -c 'expect:'`, since step 1 landed steps while this
  plan was written: forms 145, docs 123, chat 88, settings 28 (measured on `af08f01`, step 1's last code commit).

## Docs written ahead

Commit `6e65c67`:

- `AGENTS.md` § Running and testing: step groups and `why`, `width`, `repeat`; § Dev quirks: the shared `.vite/build`
  and the start lock
- `.agents/skills/drive/SKILL.md`: the navigation rejection and capped re-poll, the start lock, `drag --hold` / `release`
- `docs/features/followups.md`: the restart entry corrected with its root cause; the per-run build follow-up
- `docs/features/master-plan.md`: step 2's restart line; the per-run build as step 24

## Mandatory Reads

- `AGENTS.md` (the whole file; § Architecture, § Running and testing and § Dev quirks above all)
- `.agents/skills/drive/SKILL.md`
- `DESIGN.md` — for task 12's screen checks only
- No `CLAUDE*.md`, `AGENTS.local.md` or `.claude/rules/*.md` exist in this repo (`find . -path ./node_modules -prune -o -path ./.drive -prune -o -path ./.vite -prune -o \( -name 'CLAUDE*.md' -o -name 'AGENTS*.md' -o -path '*/.claude/rules/*' \) -print`
  prints only `./AGENTS.md`; re-verify)

## Design Overview

### Flow after the change

```
 drive CLI / selftest CLI
   │  dev start: take .drive/start.lock ── spawn electron-forge ── app writes drive.json / first [selftest] line ── release
   ▼
 app main ── drive commands ──► page driver ──► DrivenWindow.run(script)
                                   │                │
                                   │                ├─ settles ──────────────► result
                                   │                └─ page commits a navigation / renderer gone
                                   │                       └─► rejects PageNavigatedError
                                   ▼
                     waitFor: each check capped at CHECK_TIMEOUT_MS;
                     PageNavigatedError or a capped check = "not yet", poll again
                                   │
                     markLog → LogMark { navigation, length } → waitForNewLogLine / linesAfter

 self-test runner: script.groups ─► group name printed ─► each step:
     width? → set and hold · writeFile → keys → expect · repeat? → keys again until `until`
     screenshot (one per press when repeating) · checksFit (returns to the held width)
     failure → prints the group's and the step's why
   script end → start width restored
```

### Decisions

- The window adapter rejects every pending `run` when the main frame commits a navigation or the renderer goes, with
  `PageNavigatedError` (round 2, design review: depth, locality). `waitFor` caps each check at 2 s and reads
  `PageNavigatedError` as "not yet".
- One opaque `LogMark` replaces the separate length and navigation reads (round 1, design review: depth).
- `drag` with `hold: true` leaves the button down; `release` lifts it; the held drag is per-run state in the drive
  commands (round 1, design review: locality).
- Dev drive and self-test starts take one lock under `.drive/` (round 2, choice 1). The per-run build is master-plan
  step 24.
- Self-test steps sit in named groups, each with a required `why`; a step may add an optional `why` (round 1, choice 1).
- `width` holds until a later step sets another or the script ends; `width: 'start'` returns to the start width
  mid-script; `repeat: { until, max }` presses again; a repeating screenshot saves `<name>-<n>` (round 1, choice 1;
  `'start'` decided while writing the docs step, so a script can widen again without knowing the start width).
- `fake: end` ends its own fake session (round 1). `docs.seed` / `docs.connectSession` take `loadStates: true`
  (round 2).
- Regrouping the four scripts lands in the last code wave, and splits each script's existing step array into
  top-level consts at group boundaries rather than nesting and re-indenting it, so step 1's added steps merge (round 2).

### Out of scope

- A per-run build that frees the user's `npm start` (master-plan step 24).
- Every other `followups.md` entry, step 1's bug sweep included.

### Landing

The run commits on `main` in the main tree, once step 1 is finished, so there is no branch to merge. The user's own
`npm start` shares `.vite/build` with the run's dev starts and is outside the start lock, so the run's drive and
self-test starts wait while it is open. The slash-completion plan (`docs/features/agent-chat/plan-slash-completion/`)
edits `src/contracts/plugin.ts`, `src/shared/fake-agent-harness.ts`, `src/plugins/chat/main/start.ts` and chat's
self-test script; it runs before or after this plan, not beside it.

## File Structure

Existing files modified:

| File | Tasks |
|---|---|
| `src/main/drive/driven-window.ts` | 01 |
| `src/main/electron-driven-window.ts` | 01 |
| `src/main/drive/fake-driven-window.ts` | 01, 07 |
| `src/main/drive/page-driver.ts` (+ test) | 01, 02, 07, 03 |
| `src/main/drive/drive-commands.ts` (+ test) | 02, 03 |
| `src/main/selftest.ts` | 02, 07 |
| `src/main/selftest.test.ts` | 02, 07 |
| `scripts/drive.mts` | 04 |
| `scripts/selftest.mts` | 04 |
| `scripts/drive-args.mts` (+ test) | 03 |
| `src/shared/fake-agent-harness.ts` (+ test) | 05 |
| `src/plugins/chat/main/start.ts` | 05 (the `chat.start` description string only) |
| `src/plugins/docs/main/start.ts` | 06 |
| `src/plugins/docs/main/selftest-fixture.ts` | 06 |
| `src/shared/drive-args.ts` (+ test) | 06 |
| `src/contracts/plugin.ts` | 07 |
| `src/main/selftest-config.ts` (+ test) | 07 |
| `src/plugins/forms/main/selftest-script.ts` | 07 (one line), 08 |
| `src/plugins/docs/main/selftest-script.ts` | 06 (`connectDocsFixtureSession`), 07 (one line), 09 |
| `src/plugins/chat/main/selftest-script.ts` | 07 (one line), 10 |
| `src/plugins/settings/main/selftest-script.ts` | 07 (one line), 10 |

New files:

- `scripts/start-lock.mts` and `scripts/start-lock.test.mts` (04) — the lock both CLIs take; one module so the two
  starts share one rule, beside `drive-args.mts`, the CLIs' other shared module.
- `src/plugins/docs/main/selftest-fixture.test.ts` (06) — the fixture has no test file today.
- `src/main/selftest-steps.test.ts` (07) — runner cases over the fake window, apart from `selftest.test.ts`'s
  file-wide page-driver mock.

Names more than one task uses:

- `export class PageNavigatedError extends Error` in `src/main/drive/driven-window.ts` (01) — used by 01's page
  driver change.
- `export interface LogMark` and `export async function markLog(window: DrivenWindow): Promise<LogMark>` in
  `src/main/drive/page-driver.ts` (02) — used by 02's callers in `drive-commands.ts` and `selftest.ts`, and kept by 03.
- `export interface SelfTestGroup { name: string; why: string; steps: SelfTestStep[] }` and the new
  `SelfTestStep` fields in `src/contracts/plugin.ts` (07) — used by 08, 09, 10.

Boundary rules: everything stays in this repo; `src/main/drive/` keeps no `electron` import (AGENTS.md
§ Architecture), so `PageNavigatedError` lives in `driven-window.ts` and the Electron adapter imports it.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Script calls reject on navigation; capped checks](01-navigation-rejects-runs.md)
- [x] [Start lock for dev starts](04-start-lock.md)
- [x] [Fake session that ends itself](05-fake-end.md)
- [x] [Docs fixture with every load state](06-docs-load-states.md)

### Wave 2
- [x] [Log mark](02-log-mark.md) — after 01

### Wave 3
- [x] [Self-test groups, why, width, repeat](07-selftest-steps.md) — after 02

### Wave 4
- [x] [Drag hold and release](03-drag-hold.md) — after 02, 07 (shares `page-driver.ts`)
- [x] [Forms script in groups; gallery repeat](08-forms-groups.md) — after 07
- [x] [Docs script in groups; hidden-tree step](09-docs-groups.md) — after 07
- [x] [Chat and settings scripts in groups](10-chat-settings-groups.md) — after 07

### Wave 5
- [x] [Doc re-read](11-doc-re-read.md) — after every code task

### Wave 6
- [ ] [Final verification](12-final-verification.md) — after 11

## Run log

Review base: 5b2bc38096dafc34abedca7cf3e261e5117ffdd1

### Groups
- 05 · 0558ba9 · diff read matches spec; FAKE_END_TEXT present; typecheck passes · concerns: user-entry emit moved to a local closure shared by both branches; one interface-comment line left unwrapped
- 01 · 0187f44 · diff read matches spec; PageNavigatedError and CHECK_TIMEOUT_MS present; typecheck passes · concerns: pending-reject set and reject loop duplicated in the Electron adapter and the fake; render-process-gone listener ignores its (event, webContents, details) args
- 04 · a976d99 · diff read matches spec; takeStartLock, StartLock, StartLockOptions present; typecheck passes · concerns: stale-lock clear is not atomic (two takers vs one dead holder can delete a fresh lock); temp file name shared within one process, safe only while write/link/unlink stay synchronous; a throwing runSelfTest leaves the lock to be cleared as a dead holder's
- 06 · 88bb0f5 · diff read matches spec; DocsFixtureOptions, writeDocsFixture options, connectDocsFixtureSession options, optionalBoolean, both action args present; typecheck passes · concerns: .agents/skills/drive/SKILL.md line 53 names docs.seed and docs.connectSession without args, so loadStates is undocumented (task 11)
- 02 · 9f238ce · diff read matches spec; LogMark, markLog, waitForNewLogLine(mark), linesAfter present; typecheck passes · concerns: markLog still rejects on a reload mid-read and callers do not retry (unchanged behaviour); the mark-to-wait race is covered at waitForNewLogLine level only, not through the commands
- 07 · b8710cf · diff read matches spec; SelfTestGroup, step why/width/repeat, groups, resizeContentWidth, waitForAnyNewLogLine, screenshotFiles string[], checkGroups present; typecheck passes · concerns: no runner test waits out a 5 s timeout (width never landing, a press logging neither); elementFromPoint answer unused; fake-driven-window comment rewrapped raggedly
- 03 · d57e4fe · diff read matches spec; dragAndHold, release, drag hold arg, release command, CLI forms present; typecheck and lint pass · concerns: a held drag is not released when the run disposes or quits
- 08 · aefdfde · expect sequence identical but the 8 folded gallery steps; 145 → 137 expect lines; 12 groups in the planned order; typecheck and lint pass · concerns: DESIGN.md:316-317 names the old gallery shot names; followups.md:268 and master-plan.md:48 describe the gallery page-count problem this removes; the reduced repeat's last press saves gallery-reduced-5, the end page, duplicating gallery-reduced-end
- 09 · 37e5dd4 · step sequence identical but the two narrow window steps; 123 → 125 expect lines; 13 groups in the planned order; typecheck and lint pass · concerns: inline step comments inside the group arrays stay (only the narration block was deleted); the narrow step assumes the self-test starts at 680 px or wider, though its expect holds either way
- 10 · a250702 · expect sequences identical (formatting only); chat 88, settings 28 expect lines; chat 14 groups, settings 6; typecheck and lint pass · concerns: the two sessions why reads the narration as visual mode surviving a blur
- 11 · a1515bb · every listed line checked; AGENTS.md running/testing and dev quirks, drive SKILL.md navigation, lock, drag rejections and loadStates, DESIGN.md gallery names fixed; wait-log and per-run build entry clean; lint passes · concerns: followups.md restart entry, hidden-tree entry (line ~41) and fixture entry (line ~37) now describe resolved states, left for Close; new doc lines exceed the files' wrap width
### Contract changes
- StartLock.release(): deletes the file → deletes it on the first call only · why: selftest releases at the first [selftest] line and again on close, and a second delete could remove another start's lock · consumers: 04 · group 04
- takeStartLock timeout message: names .drive/start.lock literally → names the lockFile path passed in (absolute from both CLIs) · why: the path is a parameter · consumers: 04, 11 (docs quoting the message) · group 04
- runScript (not a listed Produces): gains startWidth after screenshots; screenshots is ReadonlyMap<SelfTestStep, readonly string[]> · why: the runner owns the held width · consumers: selftest.ts and its tests only · group 07
- checkGroups: also rejects a non-integer repeat.max; blank name/why/until judged after trim · why: a fractional max gives a file list that does not match the presses · consumers: none · group 07
### Rulings
- a self-end marks the process ended synchronously in send, emitting entry and ended in the microtask — a call between send and the microtask must see an ended process — a caller reading record.ended right after send sees true · group 05 · group 05
- a FAKE_END_TEXT exit ignores holdEnd — a CLI exiting on its own is not held by the test's end gate — a test holding ends sees a self-end early · group 05 · group 05
- the fake registers a run as pending before asking for its answer, so an answer that calls navigate() rejects its own call — mirrors a commit mid-script — a test navigating inside an answer sees a rejection, not the answer · group 01 · group 01
- the cap is computed in waitFor and passed as holdsBefore's deadline; holdsBefore maps PageNavigatedError to false — keeps holdsBefore a plain answer-before-deadline helper — none · group 01 · group 01
- drive start takes the lock after .drive/current is written and the home prepared, right before spawnApp; the ready send runs outside the lock — the lock guards the build, not readiness — a second start could spawn while the first is still answering ready · group 04 · group 04
- the two-takers test waits 30 ms after the winner resolves before asserting the loser still waits — the one wall-clock wait — on a slow machine it proves less, never fails falsely · group 04 · group 04
- load-state entries carry meta { imports: [] } like the fixture's other instructions entries — the plan named no meta — only four drive-only entries change if wrong · group 06 · group 06
- flag-off cleanup trashes the whole .claude/load-states folder when it exists — leaves no empty folder — none · group 06 · group 06
- the four entries go after the existing eight, so sessionDocument's positions and the self-test index are unchanged with the flag off — none · group 06 · group 06
- linesAfter returns every line when the log is shorter than the mark (was none) — same rule as the wait — key/type/click/drag/setting return the whole new log after a reload that shortened it · group 02 · group 02
- ported waitForNewLogLine_* tests use literal marks to keep their read counts; new cases use markLog — none · group 02 · group 02
- an interrupted run does not restore the start width itself; the next run restores it on open — a late restore could overwrite the new run's held width — a self-test ending right after an interruption leaves the window at the held width, read by nothing · group 07 · group 07
- every press of a repeating step, the first included, waits for until or expect, until winning a tie — the spec presses again after the first expect — a first press logging until passes as x1 · group 07 · group 07
- the log is marked before the width resize, so a line the resize alone causes counts — as writeFile does — a stale resize line could satisfy expect · group 07 · group 07
- resizeContentWidth waits for the asked width, not the one the window took — a clamped width fails the step as never landed — a width below the minimum fails rather than clamps · group 07 · group 07
- unnamed report texts: width never landed as <label> -> <expect>: width <n> never landed; failed restore as <pluginId> start width <n> never landed; checkGroups throw as the self-test groups check — none · group 07 · group 07
- release is a positional CLI form taking zero positionals, not the json fallback — the brief lists a release usage line — the CLI refuses release {} · group 03 · group 03
- release clears held inside the act right after the mouseUp; a failure before the send keeps the drag held — no stale held drag after a later redraw failure — only post-error state differs · group 03 · group 03
- click and drag check held before validating their args — the held drag is named even with bad args — none · group 03 · group 03
- the Option+Shift+o step back to the selftest session closes the gallery group; each later group starts on the move to its item — boundaries only — a group's why covers one step more or less · group 08 · group 08
- the two inline keymap comments became the user keymap group why and step whys — they read as narration — none · group 08 · group 08
- pickers group holds the a/Esc place picker and the context picker sequence through Space v t show; side bar starts at Space k d — the narration treats each as one sequence — a why covers one step more or less · group 09 · group 09
- group arrays and their whys sit in a top-level GROUPS const handed as groups: GROUPS — keeps step arrays unindented and open() short — moving one literal · group 10 · group 10
- chat's resume Enter step sits in the archive group with its own why — no group of one step — none · group 10 · group 10
### Review rounds
### Test gate
- unit: page-driver, drive-commands, selftest, selftest-steps, selftest-config (runner, waits, marks, drag hold, groups/width/repeat added or edited by 01/02/03/07), fake-agent-harness (05), shared drive-args, docs selftest-fixture and docs start (06), start-lock and scripts drive-args (03/04) · 11 files, 140 passed; npm run selftest (01 startup-reload stand-down, 06 docs fixture unchanged, 07–10 groups) pending: the user's open forms round holds the app (pid 28090)
- npm run selftest (01 stand-down on a startup reload, 06 fixture unchanged with loadStates off, 07 runner groups/width/repeat, 08–10 regrouped scripts, 09 narrow window step) · all passed, 454 PASS lines, 45 group headers in order, both gallery repeats ×5, narrow-window j passed; no startup reload landed mid-run this time, so 01's stand-down was not exercised (task 12's restart loop covers navigation) · log /private/tmp/claude-502/-Users-jonathonwigley-Documents-dev-wigley-ai-gui/b18036e1-0824-436b-9728-681d086584bd/scratchpad/selftest-1.log
