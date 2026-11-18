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
- [x] [Docs view state](01-docs-view-state.md)
- [x] [One ownsRoot helper](02-docs-owns-root.md)
- [x] [Sessions pane clicks and presses](03-sessions-pane-presses.md)
- [x] [Step and tool-call durations](07-step-durations.md)
- [x] [One DEFAULT_NAME](09-default-name.md)
- [x] [Window adapter hears page load 1](12-window-page-load.md)
- [x] [Drive wait-log and test titles](13-drive-wait-log.md)
- [x] [Memory Files reports folder events](16-memory-files-folders.md)
- [x] [Auto-retro claims restored rows](17-auto-retro-rows.md)
- [x] [Chat close after dispose](18-chat-close-after-dispose.md)
- [x] [Claude adapter: interrupt and hand-back](19-claude-adapter-fixes.md)
- [x] [Terminal session name from its own profile](21-terminal-session-name.md)

### Wave 2
- [x] [Sessions page model](05-sessions-page-model.md) — after 03
- [x] [Chat cursor follows tall blocks and hidden tabs](06-chat-cursor.md) — after 07
- [x] [Test naming, the rest](14-test-naming-rest.md) — after 01, 02
- [x] [Local commands do not title a row](20-local-command-titles.md) — after 13

### Wave 3
- [x] [Split subscribes to its width key](10-split-width.md) — after 01, 05, 07
- [x] [Git.commitPaths removed](15-git-commit-paths.md) — after 01, 05

### Wave 4
- [x] [DrawnPart reports drewBundled](08-drawn-part-bundled.md) — after 07, 09, 10
- [x] [Self-test click step and step helpers](23-selftest-steps.md) — after 15

### Wave 5
- [x] [Shared tick and fake timers](11-shared-tick.md) — after 07, 08, 10

### Wave 6
- [x] [Teardown rules after a stop](24-teardown-rules.md) — after 08, 11, 23

### Wave 7
- [ ] [Every view's dispose against what it drew](25-view-dispose-audit.md) — after 24

### Wave 8
- [ ] [Doc re-read and follow-up removal](26-doc-re-read.md) — after every group
- [ ] [Final verification](27-final-verification.md)

## Run log

Review base: 97ec691cb85c30deb7b7322bf873ec04aaf83aa4

### Groups
- 02 · standard; compile error back on standard (JsonObject lacks typed source) · 7ab23142d b3c225cb0 · diff read; wave-1 tsc --noEmit and lint (layers, styles, oxlint, oxfmt) clean at 060ad4e67 · concerns: none
- 03 · hard; compile error back on hard (test name shadowed) · f89425e18 7628ffdcc · diff read; wave-1 tsc --noEmit and lint (layers, styles, oxlint, oxfmt) clean at 060ad4e67 · concerns: drawStrip assumes the tab strip holds only tab elements (user layouts unchecked); start.test.ts selection test relies on fireWindow and the stubbed getSelection sharing one window
- 09 · standard · 31b786cf7 · diff read; wave-1 tsc --noEmit and lint (layers, styles, oxlint, oxfmt) clean at 060ad4e67 · concerns: none
- 16 · standard · 51f0ce8e5 · diff read; wave-1 tsc --noEmit and lint (layers, styles, oxlint, oxfmt) clean at 060ad4e67 · concerns: watch-based tests may hear an extra folder key (plan-watch, workflow-large-main, pool-watch, layout-registry, docs doc-files and start, user-folder-source, audio-reads, problem-store): test gate scope; four new test titles use subject_Case_Result form
- 17 · deep · c1fb07efb · diff read; wave-1 tsc --noEmit and lint (layers, styles, oxlint, oxfmt) clean at 060ad4e67 · concerns: the first-message claim also runs on a row chat's resume adds, so a resumed old retro session mid-run is claimed and closed finished once idle
- 19 · deep · a1b694bf3 b3c225cb0 · diff read; wave-1 tsc --noEmit and lint (layers, styles, oxlint, oxfmt) clean at 060ad4e67 · concerns: a subagent's own content line inside the held window after a hand-back's init also opens a new events entry
- 18 · hard · 961120ddd · diff read: isDisposed/requireRunning reject close and closeSessionsIn; typecheck clean, lint clean but formatting (oxfmt run as lead) · concerns: contract.ts comment says both 'resolves ... or chat stops' and 'rejects once chat has stopped'
- 13 · standard · f2a296ec7 4a0ef5f0c · diff read: wait-log since in drive-commands, drive-args, SKILL.md, tests; typecheck clean, lint clean but formatting (oxfmt run as lead) · concerns: none
- 21 · standard · cd9e08828 · diff read: hostSessionName passes profileDir ?? harness.configFolder(null); typecheck clean, lint clean but formatting (oxfmt run as lead) · concerns: none
- 12 · hard · 836232d5c · diff read: loadAppPage after drive-run block, one electronDrivenWindow for selfTest/drive; typecheck clean, lint clean but formatting (oxfmt run as lead) · concerns: followups.md:71 entry left for task 26
- 07 · hard (compile error back on hard) · 023a8d3d1 e6fcb5480 · diff read: stepDurationMs, StepDuration on tool/thinking inputs, card trailing, fillStepTime; compile error in read-chat-layout InputAddition fixed on the same rung; typecheck clean, lint clean but formatting (oxfmt run as lead) · concerns: layout.test asserts '· 65s' not '· 1m 05s' (fake kit counts whole seconds)
- 20 · deep · 59726fbeb · diff read: titleCandidates settled by entry delivery, cleared on drop/beginProcess/clear; typecheck clean, lint clean but formatting (oxfmt run as lead) · concerns: a test reading a first-message title right after an unawaited send now finds none; relaunch row relies on the silent fake's second process
- 06 · hard · 12af5da63 · diff read: scrollsToStop also needs the list off its bottom; scrollToFocus settles a following cursor with by='list'; typecheck clean, lint clean but formatting (oxfmt run as lead) · concerns: rebuilds of a shown list now settle the cursor, which may move existing rebuild tests
- 01 · deep · 7112b86a0 f36b10d57 · diff read: DocsTreePlace per view, sideBarNarrowed told on beside→hidden, rowIdsIn/selectNearestIn reselect after outside rename/trash, askedOpens on every open checked after both waits; typecheck and lint clean (oxfmt run as lead) · concerns: D makes a reload's restored open lose to any open asked before the first index read (its edits toast as not restored); outside-change page test uses two added views; a page-scoped saved place in the old shape is not read back after this change
- 14 · standard · fc63ebd3e · diff read: title-only renames in main-api, docs-state and tree-view tests; old-form and old-title-in-docs greps print nothing; typecheck and lint clean · concerns: tree-view.test.ts keeps other old-form titles outside the task's two
- 05 · hard · f36d169c3 89a777915 · diff read: createSessionsPageModel and its Deps/View/Model interfaces present, start.ts closure-state grep empty, model has no DOM reads; typecheck and lint clean (oxfmt run as lead) · concerns: view callbacks and keysToFocusedPane reference model before its declaration (safe: the mount calls no callback synchronously); model echo test relies on the fake focus calling panesChanged before paneFocused
- 15 · standard · 8213e6a96 · diff read: commitPaths gone from contract, adapter, tests, two fakes and AGENTS.md git/ entry; grep empty; typecheck and lint clean · concerns: none
- 10 · hard · ee3469550 · diff read: UiState.on in contract, page store and uiStateOver fake; createSplitDivider subscribes and disposes; manual reloads gone from primer, docs shown, side-sections; typecheck and lint clean · concerns: forms round-view.ts:214 still calls split.reloadWidth() (left per the plan); notes/popup.test.ts's cast fake has no on; harness listeners shared only within one services object
- 08 · standard · 85f3723d5 · diff read: DrawnPart.drewBundled replaces drewPick, set true only by the bundled-default fallback; chat isBundledView and the primer read it; typecheck and lint pass · concerns: entry-list.test's new row asserts a guessed slot value (chat-entry chat-assistant@default); the renamed table test keeps the subject_Case title form
- 23 · deep · b1ce47c79 37a37f861 · diff read: SelfTestStep.click runs after write/remove and before keys; stepToSessionRow replaces forms' stepToRow and sessions' stepNextTo; chat steps by single presses and clicks an unfocused pane's hub head; compile fix 37a37f861 on the same rung; typecheck and lint pass · concerns: the cross-Bridge bind and the first click on an unfocused pane's hub head are checked only live (test gate and live session); chat and forms imports from sessions/contract are now value imports
- 11 · hard · d17f69752 · diff read: createPendingTick replaces the four pendingTick copies (grep pendingTick src empty); shared fakeTimers replaces eleven suite copies (grep 'function fakeTimers' src prints only the shared file); typecheck and lint pass · concerns: toasts.test moved to the shared fake beyond Files; its draw-throws row now asserts armed.size 0, which also passes on a set-then-cleared timer
- 24 · deep · 592af3fa5 · diff read of the Rule 2 router, switch wiring, detachAll, chat main dispose and session-tabs drop; the sweep sites checked against the worker's per-file list; typecheck and lint (after lead oxfmt over four files) clean · concerns: Rule 3 sweep sites have no test rows (task asks a row per changed site in a tested file); popup.test flipped: a note send landing after stop now toasts nothing; workflow-large countdown timers are guarded, not cancelled; scheduling main's nested finally lets a later error win; residual log-only continuations in rename-dialog, stash-flow, account-commands, sign-in-flow, attachments, and forms/main/start.ts untouched
### Contract changes
### Rulings
- 02: the raw-JSON site in malformedEntryField passes { source } to ownsRoot rather than widening its parameter · group 02
- 09: layout-url.ts's local DEFAULT_NAME comment dropped; the exported constant's comment covers it · group 09
- 16: foldersAtOrUnder also reports the implicit ancestors of each made folder, not only of files · group 16
- 19: releaseHeld sends the events entry once after every held line joins it, not once per held line, as the task's own test needs · group 19
- 18: contract.ts comments edited outside Files to match the new rejection · group 18
- 13: practice/page/start.test.ts table titles renamed too, under the same $case suffix rule · group 13
- 12: requireDrivenWindow helper in main.ts throws for a selfTest or drive run with no driven window · group 12
- 20: setFirstMessageTitle became firstMessageTitleToSet with the same guards; a candidate is recorded only for a message that would title the row; a save follows the delayed title · group 20
- 06: settleInBand takes the PlaceChange; scrollToFocus's settle reports 'list' so a restored place survives · group 06
- 01: start.test.ts edited outside Tests: startDocsPage passes fakeFuzzyMatcher and restorePending's saved place takes the new shape · group 01
- 05: rows.on/selection.on and followRows subscribe after the view mounts (before: ahead of the mount); the view takes neither slot, so listener order is unchanged · group 05
- 10: reloadWidth checks !isDisposed as well as !isDragging (the tree checked only dragging); reloadWidth stays on Split for theme-token widths and forms' caller · group 10
- The forms.choose live step (L224) is struck: a self-test page bind to another process's command makes the page throw 'Keymap names unregistered commands' (renderer.ts:507), since selftest-config.ts:183 skips the check that drops such a bind; the fix needs a page runtime command in forms' page part, so the follow-up stays open with this finding · group 23
- The folder-picker <A-S-i> step stays unconverted: stepToSessionRow covers session rows only · group 23
- toasts.test.ts joins group 11: a merge brought back its fakeTimers copy · group 11
- Contract changes inside plugins: PluginChannels.dropParked and PluginSwitchDeps.dropParked; MainApiDeps.channels narrowed to Pick<PluginChannels,'forPlugin'>; startMainParts takes channels; isStopped deps on FinishFormDeps, the forms/primer/picker command deps, SessionsPageModelDeps, WorkflowActionsDeps, ChatCommandDeps, StartPromptDeps, ImportBoxDeps; SettingsView.dispose · group 24
- A reload reply's reloaded ids count as stopped for dropParked; a parked invoke is answered a microtask after its method registers again · group 24
### Review rounds
### Test gate
