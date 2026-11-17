# Follow-ups sweep, after Lane H — plan

Feature: follow-ups sweep · Implements: none · Ticket: none
Target: main (the `ai` repo; paths below are under `wigley-ai-gui/`) · Written: 2026-11-17

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Land every *agent-ready* follow-up in `docs/features/followups.md` that is still true but sits in code that Lane H
(harness seams) or the scheduled-tasks run rewrites: 36 items in 23 groups. The plan starts only once both
have merged into `main`, so each fix lands on their code rather than racing them. It runs headless: every decision is
settled below or in its task document. When the run closes, each landed item is gone from `followups.md`.

## Architecture

Systems touched, all inside `wigley-ai-gui`, at the paths Lane H leaves (the Claude adapter under
`src/plugins/claude-code/main/`):

- **Docs page**: tree view place, filter keys, selection on outside changes, the open rule, the source ownership
  helper (`src/plugins/docs/`, `src/renderer/shell/modes.ts`).
- **Sessions page**: pane clicks and presses, the page model (`src/plugins/sessions/page/`).
- **Chat page**: cursor following, step and tool-call durations (`src/plugins/chat/page/`, chat's layouts).
- **Layout host and UI primitives**: `DrawnPart`, one `DEFAULT_NAME`, Split's width subscription, a shared one-shot tick
  and fake timers.
- **Main and the Claude adapter**: the window's first page load, drive's wait-log, the git adapter's dead
  `commitPaths`, Memory Files folder events, auto-retro's restored rows, chat main's close after dispose, the turn
  tracker and stream decoder, local-command titles, a terminal session's name.
- **Self-tests**: a click step, step helpers, the docs host-id change step, `forms.choose` proved through
  `runCommand`, test names.
- **Teardown**: sends and invokes after a stop, teardown that runs every step, and a dispose audit of every view.

## Preconditions

`wigley:make` re-runs these before the first dispatch. Plan time was 2026-11-17, with `main` at 9b671bd16, Lane H at
9016884f0 (in review) and scheduled-tasks running. Run the commands from the `ai` clone's root.

| Claim | Command | Expected |
|---|---|---|
| **Gate**: Lane H has merged | `git merge-base --is-ancestor lane-h-harness-seams main && echo merged` (or the branch is gone and `test -d wigley-ai-gui/src/plugins/claude-code/main` holds `stream-decoder.ts`) | `merged`. Plan time: not merged. Until it holds, the run does not start |
| **Gate**: the scheduled-tasks run has merged | `git merge-base --is-ancestor scheduled-tasks-plan main && echo merged` (or `test -d wigley-ai-gui/src/plugins/scheduling`) | `merged`. Plan time: not merged |
| **Gate**: `plan-followups-now` has closed | `test -d wigley-ai-gui/docs/features/followups-sweep/plan-followups-now && echo open` | nothing printed |
| Files a later lane may also change | `git diff --name-only main...<branch> -- wigley-ai-gui` for each lane still running (Lane E, Lane L, Lane P), against every task's Files | a shared path is re-read on the merged code before its task dispatches. Known at plan time: task 10 adds a one-line fake to `src/plugins/forms/page/round-view.test.ts` and `forms-view.test.ts` (Lane L tasks 12–13 may rewrite them); task 14 renames titles in `src/main/plugins/main-api.test.ts` (Lane P tasks 02 and 04 edit it). A lane that has merged first leaves the task to work on its landed file |
| Each task's own claims hold on the merged code | each task document's Preconditions | as each task states; a task whose anchor moved is re-read against the merged code before dispatch, and a fix that no longer applies is struck with its reason |

Task documents were drafted against the Lane H branch and the scheduled-tasks branch as they stood on 2026-11-17, so
line numbers are approximate: each task names its symbols, and the symbol is the anchor.

## Docs written ahead

The follow-ups triage, shared with `../plan-followups-now/` and committed with it. No other doc is written ahead. Each
task updates the doc lines its own change makes untrue (`AGENTS.md:224`'s "a commit of named paths" in task 15
among them), and the doc re-read task removes every landed item's entry from `followups.md` in one commit.

## Mandatory Reads

- `AGENTS.md` (the wigley-ai-gui folder's), sections by task: § Architecture (the source tree, A plugin, A registration,
  A slot, An agent harness, An agent event, A session tab, A chat pane, A focus target, A layout, A chat layout),
  § Running and testing (the self-test: filtered only).
- `docs/features/agent-harnesses/design.md` for tasks 19–21; `docs/features/agent-chat/design.md` for 06, 07, 20.
- `wigley:codebase-design`, `wigley:writing-code`, `wigley:writing-tests` (TypeScript: `typescript-vitest.md`).
- No `CLAUDE*.md`, nested `AGENTS*.md` or `.claude/rules/` exist in the wigley-ai-gui folder.

## Design Overview

Each group is an independent fix. Where a task adds an internal seam (Split's width subscription, the shared tick,
the self-test click step), the task document states its shape. Each is a seam inside
one project, settled by the agent under `wigley:codebase-design`.

### Decisions (interview round 1, 2026-11-17; the user took the recommendation)

- **Written now, gated on the merges.** This plan is written now so the batch is tracked. It starts only after Lane H
  and the scheduled-tasks run merge (Preconditions).
- **Forms' Split caller waits for Lane L.** Task 10 moves every Split caller to the width subscription except forms'
  `round-view.ts`, which Lane L tasks 12–13 rewrite.
- **Follow-up removal happens once.** The doc re-read task removes each landed item from `followups.md`.

Settled while drafting (Decided notices, 2026-11-17):

- **Esc on a new split's Folder picker (L865) is not in this plan.** `docs/features/chat-panes/design.md` § Splitting,
  the picker and closing keeps the pane empty on purpose, so closing it overturns a design choice: the user's call.
  The triage retags it *needs a feature plan*.
- **Forms tool table (L547) is left to Lane E task 06**, which already replaces `FORMS_TOOLS` and shares the answer
  results.
- **New test titles are sentences** (`typescript-vitest.md` § Naming). A task document that names a new test in the
  `subject_Case_Result` form gives its parts; the worker writes it as a sentence. Existing titles a task does not
  rename keep their form.

### Out of scope

The items left to running lanes (Lane E, L, P, L547 to Lane E included), the scheduled-tasks run's six, the retagged
items (L865 included), and L575 (date-gated).

## File Structure

Each group's files are in its task document. Names that more than one group reads:

- `src/contracts/ui-state.ts`: `UiState.on(key: string, listener: () => void): Disposable` (10, required; every
  `UiState` fake gains it).
- `src/shared/fake-ui-state.test-support.ts`: `uiStateOver(values: Map<string, unknown>, onSet?): UiState` (10).
- `src/shared/pending-tick.ts`: `createPendingTick(timers, ms, run): PendingTick` with `setNeeded(isNeeded)` (11).
- `src/shared/fake-timers.test-support.ts`: `fakeTimers()` returning `{ timers, armed, cleared, fireAll(), runAfter(ms) }`
  (11; it replaces ten test copies, among them `split.test.ts`'s, after 10 lands).
- `DrawnPart.drewBundled` (08).
- `DEFAULT_LAYOUT_NAME` in `src/contracts/layouts.ts` (09).
- `StepDuration`, and `trailing` on `CollapsibleCardOptions` (07).
- The drive command `wait-log` takes `{ line, timeoutMs?, since? }` (13); the final verification task uses it.
- `SelfTestStep.click?: string` in `src/contracts/plugin.ts`, and `stepToSessionRow(key, until, max)` in
  `src/plugins/sessions/contract.ts` replacing forms' `stepToRow` and sessions' `stepNextTo` (23).
- `startFormEvents`, `startFormsEvents` and `startPrimerEvents` return a `Disposable`; `FinishFormDeps.isStopped()` in
  `src/shared/page/session-forms.ts` (24).
- `PluginChannels.dropParked(pluginId)` in `src/main/plugins/plugin-channel.ts`, called by the plugin switch when a
  page part stops (24).
- `AGENTS.md` is edited by 01 (§ A mode), 05 (the `sessions/` entry), 15 (the `git/` entry), 23 (the self-test
  paragraph) and 25 (the "A registration" bullet, with 24's rules), each in its own wave.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 03 → 05 → 10 → 08 → 11 → 24 → 25 → 26. 24 runs after the last code wave because its sweeps edit
`dispose` bodies no Files line names.

### Wave 1
- [ ] [Docs view state](01-docs-view-state.md)
- [ ] [One ownsRoot helper](02-docs-owns-root.md)
- [ ] [Sessions pane clicks and presses](03-sessions-pane-presses.md)
- [ ] [Step and tool-call durations](07-step-durations.md)
- [ ] [One DEFAULT_NAME](09-default-name.md)
- [ ] [Window adapter hears page load 1](12-window-page-load.md)
- [ ] [Drive wait-log and test titles](13-drive-wait-log.md)
- [ ] [Memory Files reports folder events](16-memory-files-folders.md)
- [ ] [Auto-retro claims restored rows](17-auto-retro-rows.md)
- [ ] [Chat close after dispose](18-chat-close-after-dispose.md)
- [ ] [Claude adapter: interrupt and hand-back](19-claude-adapter-fixes.md)
- [ ] [Terminal session name from its own profile](21-terminal-session-name.md)

### Wave 2
- [ ] [Sessions page model](05-sessions-page-model.md) — after 03
- [ ] [Chat cursor follows tall blocks and hidden tabs](06-chat-cursor.md) — after 07
- [ ] [Test naming, the rest](14-test-naming-rest.md) — after 01, 02
- [ ] [Local commands do not title a row](20-local-command-titles.md) — after 13

### Wave 3
- [ ] [Split subscribes to its width key](10-split-width.md) — after 01, 05, 07
- [ ] [Git.commitPaths removed](15-git-commit-paths.md) — after 01, 05

### Wave 4
- [ ] [DrawnPart reports drewBundled](08-drawn-part-bundled.md) — after 07, 09, 10
- [ ] [Self-test click step and step helpers](23-selftest-steps.md) — after 15

### Wave 5
- [ ] [Shared tick and fake timers](11-shared-tick.md) — after 07, 08, 10

### Wave 6
- [ ] [Teardown rules after a stop](24-teardown-rules.md) — after 08, 11, 23

### Wave 7
- [ ] [Every view's dispose against what it drew](25-view-dispose-audit.md) — after 24

### Wave 8
- [ ] [Doc re-read and follow-up removal](26-doc-re-read.md) — after every group
- [ ] [Final verification](27-final-verification.md)

## Run log

Review base: 97ec691cb85c30deb7b7322bf873ec04aaf83aa4

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
