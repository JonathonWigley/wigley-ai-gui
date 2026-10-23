# Drive reliability and tooling — plan

Feature: drive reliability (master-plan step 2) · Implements: none · Ticket: none
Target: branch `drive-reliability`, run in a git worktree beside step 1 · Written: 2026-10-23

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

`wigley:make` re-runs each before the first dispatch, from the worktree.

- The worktree: `git worktree add ../wigley-ai-gui-drive-reliability -b drive-reliability main` from the main tree,
  after this plan folder is committed on `main`; then `ln -s
  /Users/jonathonwigley/Documents/dev/wigley-ai-gui/node_modules
  /Users/jonathonwigley/Documents/dev/wigley-ai-gui-drive-reliability/node_modules` (round 2: link, never install).
  The worktree has its own `.vite/`, `.drive/` and `.selftest/`, all git-ignored (`grep -n '^\.vite/\|^\.drive/\|^\.selftest/' .gitignore`
  prints three lines).
- The docs written ahead are in the tree: `git merge-base --is-ancestor 6e65c67 HEAD` exits 0.
- Electron is 44.9.1: `grep '"electron"' package.json`. Task 01 checks its `render-process-gone` event
  shape in Electron 44's docs.
- Forge plugin-vite is 8.0.1 and fixes its build folder: `grep '"version"' node_modules/@electron-forge/plugin-vite/package.json`
  and `command grep -n "path.join(dir, '.vite')" node_modules/@electron-forge/plugin-vite/dist/VitePlugin.js`.
- The self-test scripts hand `steps` today: `grep -n 'steps:' src/plugins/*/main/selftest-script.ts` prints forms
  `STEPS`, docs `docsSteps(paths, homeDir)`, chat `STEPS`, settings `STEPS` (measured at plan time, re-verify).
- Step counts per script, re-measured at preflight with `grep -c 'expect:'`, since step 1 landed steps while this
  plan was written: forms 145, docs 113, chat 88, settings 28 (measured at plan time on `dc9bdae`).
- Step 1's code is on `main` (`git log --oneline -- src | head` shows its commits through `cebc48a`); cut the
  worktree after step 1's final verification commits, so no step-1 fix lands under this run.

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

The run works in the worktree on `drive-reliability`, so its forge starts never meet a peer's or the user's
`npm start`. Step 1's code is already on `main`, so the worktree starts on top of it. Landing the branch on `main` is
the user's call after the run. Merge conflicts are expected only with work that lands on `main` meanwhile: the
slash-completion plan (`docs/features/agent-chat/plan-slash-completion/`) edits `src/contracts/plugin.ts` (another
interface), `src/shared/fake-agent-harness.ts`, `src/plugins/chat/main/start.ts` and chat's self-test script. After
the merge, `npm run selftest` passes before the merge commit lands.

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
- [ ] [Script calls reject on navigation; capped checks](01-navigation-rejects-runs.md)
- [ ] [Start lock for dev starts](04-start-lock.md)
- [ ] [Fake session that ends itself](05-fake-end.md)
- [ ] [Docs fixture with every load state](06-docs-load-states.md)

### Wave 2
- [ ] [Log mark](02-log-mark.md) — after 01

### Wave 3
- [ ] [Self-test groups, why, width, repeat](07-selftest-steps.md) — after 02

### Wave 4
- [ ] [Drag hold and release](03-drag-hold.md) — after 02, 07 (shares `page-driver.ts`)
- [ ] [Forms script in groups; gallery repeat](08-forms-groups.md) — after 07
- [ ] [Docs script in groups; hidden-tree step](09-docs-groups.md) — after 07
- [ ] [Chat and settings scripts in groups](10-chat-settings-groups.md) — after 07

### Wave 5
- [ ] [Doc re-read](11-doc-re-read.md) — after every code task

### Wave 6
- [ ] [Final verification](12-final-verification.md) — after 11

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
