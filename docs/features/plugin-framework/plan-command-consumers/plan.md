# Command consumers — plan

Feature: plugin framework, Wave 3 of `docs/features/intent-alignment/master-plan.md` · Implements: none · Ticket: none
Target: `main` of wigley-ai-gui · Written: 2026-11-04

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what Wave 3 lands.
- **Architecture** — the systems this plan touches.
- **Preconditions** — the repository state the plan rests on, with the commands that verify it.
- **Docs written ahead** — the docs committed before the plan.
- **Mandatory Reads** — the rule files every implementer reads.
- **Design Overview** — the after-state flow, the decisions and what is out of scope.
- **File Structure** — every shared name and signature, and the boundary rules.
- **Tasks** — the checklist by wave.
- **Run log** — written by `wigley:make`.

## Goal

Land Wave 3 of the intent-alignment master plan on the signatures `plan-commands-and-state/` landed:

1. Every click that changes anything runs a command.
2. Workflow stage actions as commands.
3. Sessions queries and row decorations, and Sessions stops knowing forms.
4. The user's work and place survive a page reload in chat, forms, primer, docs, notes, backlog and settings.
5. The standing rule in the AGENTS.md Intent.

## Architecture

Systems touched:

- **Layout host and kits** (`src/shared/page/layout-host/`, `src/shared/page/ui/`, each plugin's kit and `layout.d.ts`).
- **Shared page modules** (`src/shared/page/list-picker.ts`, `confirm-prompt.ts`, `session-form-tabs.ts`).
- **Shell chrome** (`src/renderer/shell/shell-chrome.ts`).
- **Plugins**: forms, primer, chat, sessions, agent-strip, visual, keys, settings, docs, notes, backlog, workflow, unity-pool.

Every change is in wigley-ai-gui.

## Preconditions

`wigley:make` re-runs each command before the first dispatch. `<gui>` is `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui`.

- `plan-commands-and-state` is closed, and its signatures are in the tree: `test ! -d <gui>/docs/features/plugin-framework/plan-commands-and-state`, `grep -q 'checkCommandArg' <gui>/src/shared/command-args.ts`. If either fails, stop and tell the user.
- The task documents were written against that plan's File Structure, before its code landed. Before the first dispatch, `wigley:make` compares each Consumes line with the tree, and reports a difference as a stale precondition.
- Lane L's and the forms chain of Lane E's items are not running: they rewrite the forms files (`master-plan.md`). Check `git -C <gui> worktree list` and ask the user about any branch named for them.
- `<gui>` is up to date with origin: `git -C <gui> fetch origin && git -C <gui> status -sb`.
- No user layout exists: `find ~/.config/wigley-ai-gui/layouts -name layout.js` prints nothing (measured at plan time, re-verify). A layout found here is updated in place when `kit.button` changes, and the report names it.

## Docs written ahead

The commit `Document the settled design for commands and state (Waves 0, 2, 3)` holds `docs/features/plugin-framework/design.md` § Commands and state (Waves 2 and 3). The task re-reading the docs checks it against the landed code. The standing rule goes into `AGENTS.md` in its own task, since it must be true when it lands.

## Mandatory Reads

- `<gui>/AGENTS.md`, every section.
- `<gui>/DESIGN.md`, for a task that changes what a view draws.
- `<gui>/docs/features/plugin-framework/design.md` § Commands and state (Waves 2 and 3).
- `<gui>/docs/features/layouts/design.md`, for a task that changes a layout contract.
- The session's machine and agent rules: `~/wigley-agents/AGENTS.md`, `~/wigley-agents/MacMachine.md`, `~/.agents/AGENTS.local.md`.

## Design Overview

### After-state flow

```
 click ─► kit.button(parent, label, commandId, { arg })  or  kit.command(id, arg)
       ─► commands.run ─► intercept chain ─► handler(context with arg) ─► onDidRun

 Settings / help ─► served commands, minus any with a declared arg and no bind;
                    Settings: one row per bound arg; help and which-key: one merged line

 page state: plugin ─► api.state.publish(page slot key) ─► written on each change
             next page load ─► writer.get() restores drafts, focus, view, selection
             forms, primer, notes autosave to main ─► flushed on pagehide

 close: page asks tab beforeClose (chat's confirm, docs' unsaved edits, a form being sent)
        ─► main's addCloseGuard (forms' and primer's open round) refuses with a reason ─► sessions toasts it
 close key on an open round: tab closesAtOnce ─► beforeClose(true) skips chat's confirm
        ─► main cancels the round and closes the row in one step ─► chat ends the process on sessions.closed
```

### Decisions

From the interview rounds of 2026-11-04 (the user took every recommendation). The reasons are in `plugin-framework/design.md` § Commands and state.

- Every click that changes anything runs a command, cursor moves and section collapses included. Drags, focus guards and `stopPropagation` stay out.
- `kit.button` takes a command id and an optional argument, and takes no function. `kit.run` goes: its actions become commands.
- A command with a declared `arg` lists in Settings and help only when a key binds it. Settings shows one row per bound argument. Help and which-key keep one merged line.
- A page reload keeps the user's work and place in chat, forms, primer, docs (unsaved edits included), notes, backlog and settings.
- Main's guard refuses with a reason, and holds forms' and primer's open round alone. A tab's `beforeClose` stays for what the page knows or must ask.
- The close key on an open round cancels the round and closes the session at once, with no confirmation (the user's answer of the last round, which replaces the page's close prompt).
- Decided by the agent and shown to the user:
  - `setStatus` gives way to a row part with the same look. `setBadge` is not added.
  - `rows` and `sessions` are the slots task 11 of `plan-commands-and-state` landed.
  - Page slots write on each change. Forms', primer's and notes' autosaves flush on `pagehide`.

### Out of scope

- Wave 4, the command palette and every other side lane.
- Survival across an app restart.
- Commands for drags.

## File Structure

### Shared names and signatures

Every task uses these names exactly. This plan consumes the names in `plan-commands-and-state/plan.md` § File Structure: `commands.run`, `CommandKey`, `CommandDecl.arg`, `api.state.publish`, `api.state.read`, `kit.state.read`. That folder is gone once the run starts, so each task document copies the signature it consumes.

`BaseKit` (task 01): `button(parent: HTMLElement, label: string, command: CommandId, options?: { arg?: CommandArg; variant?: ButtonVariant; keys?: string | null }): HTMLButtonElement`, and `command(id: CommandId, arg?: CommandArg): () => void`.

`plugin-framework` page reload slots (task 08): each plugin's page slot is a `SlotKey<…, 'page', '<id>'>`, or a `KeyedSlotKey` where the place is per session or per form, named `<id>PlaceSlot`, declared in that plugin's `contract.ts`.

Close guard (task 07): `addCloseGuard(mayClose: (sessionId: string) => string | null, cancelHold?: (sessionId: string) => void): Disposable`: a string refuses, and it is the toast sessions shows. `cancelHold` ends what holds the session when the user's close key asks. Tab seams: `SessionTabView.closesAtOnce?(): boolean` and `beforeClose(atOnce: boolean): boolean`.

A click on one item and a key on the focused item run two commands: the key's has no `arg`, the click's names the item. Shared list-picker row clicks are task 01's (`picker.chooseRow`, `picker.cancel`).

Each sweep task lists the commands it adds under Produces, each as `<plugin>.<short>` with its `arg` shape and the site it serves.

### Boundary rules

- A command with an `arg` that a click runs needs no key and no anchor. A key added for one follows `docs/keymap.md`.
- Two tasks in one wave touch no file in common.
- A sweep keeps what the user sees and what a key does. A change the sweep cannot avoid reports as a concern.
- Self-test `expect` lines move with any log line that changes.
- The whole self-test runs only when the user asks in the current turn. Filtered runs name the plugins the task touched.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Kit buttons run commands, and listing rules](01-kit-commands.md)

### Wave 2
- [x] [Sweep: forms and primer](02-sweep-forms-primer.md) — after 01
- [x] [Sweep: chat](03-sweep-chat.md) — after 01
- [x] [Sweep: agent-strip, visual, keys, shell](04-sweep-small.md) — after 01
- [x] [Sweep: docs, notes, backlog, settings, unity-pool](05-sweep-views.md) — after 01

### Wave 3
- [x] [Workflow stage actions as commands](06-workflow-actions.md) — after 05

### Wave 4
- [x] [Sessions queries, close seams and forms knowledge](07-sessions.md) — after 02, 03, 04

### Wave 5
- [x] [Work and place survive a page reload](08-page-state.md) — after 06, 07

### Wave 6
- [x] [Standing rule in AGENTS.md](09-standing-rule.md) — after 08

### Wave 7
- [x] [Doc re-read](10-doc-re-read.md) — after 09

### Wave 8
- [x] [Final verification](11-final-verification.md) — after 10

## Run log

Review base: 69550804

### Groups
- 01 · 84ca8726 · diff read (Produces present: button/command with arg, KitCommands.run(id,arg?), kitCommandsOf, keyRunner, commandArgLabel, CommandRow.label, picker.chooseRow/cancel, registerPickerCommands); typecheck 0; lint clean; worker: vitest 9974 pass, selftest unity-pool/docs/settings pass · concerns: settings rowsPerArg compares args with isSameJson (key-order blind); page-api picker run voids router.run, a sync throw would escape the click; 14 start.ts swaps covered by typecheck/vitest only; one blocked npx call (nothing downloaded); lint:fix reformatted run files only
- 04 · eeeb3d9d · diff read (six commands with args present: agent-strip.toggleBoxAt, visual.expand, sessions.selectRow/selectTab/favoriteProjectAt, core modes.show); worker: vitest 862 pass in touched areas, selftest agent-strip+sessions pass, lint clean in its files; whole-tree typecheck deferred to the Wave 2 end (peer workers in flight) · concerns: SessionsViewDeps gains selectTab beyond the plan; plugin-part-harness gains PagePartHarness.picked; one blocked npx call (local vitest, nothing downloaded); visual and keys have no self-test script
- 02 · 39302cc7 · diff read (eight forms *At/focus/rail/review commands with args, three primer commands, Kit.run and LayoutAction gone, Kit.position present); worker: typecheck clean in forms/primer, 883 forms+primer tests pass, selftest forms and forms,primer pass; whole-tree typecheck at the Wave 2 end · concerns: primer self-test alone fails one step that needs forms' Layout preview session (pre-existing ordering); Don't ask click now acts on the clicked item (intended); primer card mark goes through handler's boxIn wrapping; one blocked npx --no-install tsc (local, nothing downloaded); followups.md:47 stale (names kit.run, runLayoutAction) — for task 10
- 03 · e00e6b00 · diff read (nine chat click commands with session-naming args, runKey wiring, card.ts headClicked); worker: typecheck clean in chat, layer and style checks clean, 1532 chat tests pass, selftest chat 23/23 pass; whole-tree typecheck at the Wave 2 end · concerns: check-layers.mts gains a chat sublayer so chat-commands.test.ts imports src/plugins/keymap.ts (outside the Files list); shared card.ts gains an optional headClicked param
- 05 · 30e9fd24 · diff read (14 commands with target-naming args across docs, notes, backlog, settings, unity-pool); typecheck 0 and lint clean over the whole tree at the Wave 2 end; worker: vitest 10101 pass, filtered selftests docs/notes/backlog/settings/unity-pool pass, no expect line moved · concerns: docs.followLink arg widened to {viewId, href, docPath, docLine, title} ('' for absent fields, since checkCommandArg has no optional fields); a Linked from or Recent changes row pointing at the shown doc now scrolls within it instead of re-opening it; docs.editSectionAt keeps 'view' while the new docs commands use 'viewId'; one blocked npx call (nothing ran); files beyond the list: docs list-pane.ts, layout.d.ts comments, notes-page-fakes.ts
- 06 · 027ee094 · Diff read: every Produces present (StageActionArg, workflowStageActionCommand in contract.ts; workflow.stageAction in manifest; createWorkflowKit/testWorkflowKit take sessionId; WorkflowDraw takes sessionId; WorkflowPageExports drops runCommand); Done-when greps hold. Typecheck clean for 06's files except two row helpers missing task 07's in-flight SessionRow.markToast (07 adds them); lint clean; 710 vitest tests and the workflow-heavy/light/medium self-tests pass per worker. · concerns: countingEngineTimers spreads the harness api (breaks if the harness gains getters); probePart written twice (workflow start.test.ts, workflow-heavy-page.test.ts) beside visual's runListenerPart; keyRunner's comment in base-kit.ts says 'from a click' but now serves keys (task 10); stageAction's onDidRun fires even when the level rejects the action (runFor swallows it); Heavy page test now uses provider parts for sessions/chat because the harness only accepts fakes listed in dependsOn.
- 07 · 2401f08b · Grep of every Produces: addCloseGuard(mayClose, cancelHold), closeSession(id, atOnce): string|null, closesAtOnce, beforeClose(atOnce), tabShown, hidden?, tooltip?, MarkOptions, markToast, host, label in sessions/contract.ts; cancel(), HOST_DEADLINE_FIELD, label() in agent-forms.ts; takeOversAfterRelease, markToastText, isMarkToast, mayClose, closesAtOnce in tabs.ts; mayCloseSessionForm, formClosesAtOnce, mayCloseRound, mayClosePrimer present; setStatus, confirmClosesSession, askClose, deadlineSeconds: null gone. Typecheck exit 0, lint clean (lead run); worker: full vitest 10130 pass, self-tests sessions, forms+primer, chat, docs, notes pass. · concerns: Chat's confirmed close is a plain close, so with a round also open main refuses and the user presses again; cancelHold follows finish's wake path (collect message to an ending session); a background form no longer selects its session on refusal; select:true with the mode hidden no longer toasts; a non-number relay deadline_seconds now gets the default instead of refusing the hello; preview sessions lose their title-bar detail line; mark text frozen at mark time and can go stale; SessionRowInput.status removal breaks user layouts that read it; docs beforeClose ignores atOnce (intended); weak 'review cancel leaves session open' test; cancelHolds iterates the live guard Set; 89 files touched, beyond the list for deadlineSeconds/markToast cleanup; forms/primer listenForRounds/listenForPrimers lost an unused sessions param.
- 08 · a5771d49 · Grep: all nine place slot keys in their contract.ts and published from start.ts/sessions-view.ts; sessionIdOfSource, takeOversWithLiveTabs, tabsAfterRestoredAdd, placeWrites, pruneKeys, onPageHide present; forms, primer and notes pass onPageHide to autosave. Typecheck exit 0, lint 0 warnings (lead run). Workers: 08a 2038 tests (shared/page, forms, primer, sessions) and forms,primer + sessions self-tests pass; 08b 3068 tests (chat, docs, notes, backlog, settings) and their filtered self-test pass. Diff (67 files, +2671) left to the review by size. · concerns: 08a: primer cardColumn not in PrimerPlace (card focus lost on reload); a double reload before forms' late tab loses its selection; a tab disposed before its restored take over releases a saved record; AGENTS.md :124 and :215 stale (to task 09); new shared file session-form-places.ts; TakeOver, PrimerPane, TaskRow moved into contracts. 08b: chat stringifies its place on every drawFocus incl. scroll; settings sectionsCursor not clamped on restore; docs tree place covers only the view's initial tree view; files beyond the list (chat entry-focus.ts+test, chat-view.test.ts, docs-parts.test.ts); EntryFocus, BacklogFocus, NOTE_FIELDS/NoteField moved into contracts.
- 09 · a957faa9 · Diff read: Intent bullet and Contents line as the task's text; truth greps re-run by worker all pass (no kit.run, no textButton in workflow-kit.ts, PlaceSlot in all eight contracts, every textButton/iconButton hit passes); master-plan Wave 3 checkpoint ticked. · concerns: none; extra scope: AGENTS.md src/shared/page and sessions entries brought up to task 08.
- 10 · 56e6a3b2 · Diff stat read (7 files, +77/-62); GIVEN greps re-run by lead: five landed items count 0 in followups.md, Reload keeps/app restart count 4, no kit.run/runLayoutAction left in followups.md; workers: standing rule grep empty, Wave 3 all ticked. base-kit.ts change is a comment only. · concerns: 10a did not verify that the review's Cancel prompt never closes the session, nor the workflow wf key's nothing-to-run log wording; workflow design.md and keymap.md needed no edit.
- 11 · 17bfc173 · Report /tmp/claude-command-consumers/reports/11-1.md: one drive run, load 3 to 33. Checks 1, 3, 4, 5, 7, 8, 10, 11 passed (check 1's pagehide flush reached main for forms, primer and notes; 10 judged against code, no CSS in the diff). Check 2 partial (draft, image, open run held; cursor on a run or step lost under a user layout with activityInTranscript). Check 6 partial (settings, backlog, notes alone held; notes popup closes when docs restores an editor). Check 9: every reachable click passed. Self-tests: combined run hit the 60-minute limit with 3 fails; forms,primer and unity-pool pass alone; agent-lines narrow fit fails alone. · concerns: C1 notes popup closed by docs' restored editor via onBaseChanged (fix dispatched); C2 chat saved cursor applied once against the default layout's first draw, lost under activityInTranscript (fix dispatched); agent-lines narrow-fit self-test step fails alone, cause under investigation; C3 chip main action, strip secondary action and runs are not drawn by any default layout, so those clicks were unreachable; C4 drive commands slow late in the run (tooling).
### Contract changes
### Rulings
- Review base is 69550804, not c3a76bdb: the Docs wiki merge landed on main between preflight and the first dispatch. Tasks 05 and 08 re-grep the docs plugin, which that merge rewrote (main-page, list-page, list-pane, section-edit, wiki-main-source, tree-view).
- Task 06 is stale after the workflow levels split (workflow/stages, main/actions.ts and workflow-parts.ts moved to workflow-heavy; addStage is gone). User chose: run the other tasks, and rewrite 06 for the split before Wave 3 with the same goal and keys — the engine owns workflow.stageAction, Heavy declares its own session commands. The changed design goes in the report.
- Task 01 reuses the landed KitCommandArg, argShape and keys(command, arg?) rather than adding a CommandArg type; task 11's filtered self-test list names workflow-heavy, workflow-light and workflow-medium.
- Task 01 contract changes: kitCommandsOf also takes services.log; new RuntimeCommands.infoOf, read by PageApi.keys.command; new src/renderer/shell/shell-commands.ts; docs gains docs.editSectionAt {view, anchor} and loses SectionEditControlKit/openSection; unity-pool gains hold/release {pool, clone}; registerPickerCommands throws 'no picker for owner <owner>' (the registry logs it). · group 01
- User settled task 06's four open calls, each as recommended and as 06 is written: runAction stays the seam behind workflow.stageAction; keys and buttons both run workflow.stageAction and the runCommand export goes; Light and Medium keep their rejecting stubs; Heavy's closed main-side actions record stays behind its channel.
- CommandKey constants take the tree's ...Command suffix (agentStripToggleBoxAtCommand, visualExpandCommand, sessionsSelectRowCommand, sessionsSelectTabCommand, sessionsFavoriteProjectAtCommand); core keys keep the SCREAMING style (MODES_SHOW, as PICKER_CHOOSE_ROW). · group 04
- Task 05 adds the Docs wiki clicks the plan predates (switchTreeView, openListRow, createMain) to the sweep, per the 'every click runs a command' decision. · group 05
- Task 07 runs alongside task 06 rather than after it: 07 waits only on 02, 03 and 04, and the two share no file. 07 may rename deadlineSeconds in workflow-heavy-main.test.ts and workflow/main/start.test.ts, which 06 does not touch.
- Task 06's key constant is workflowStageActionCommand (the ...Command suffix ruling), not workflowStageActionKey. · group 06
- Task 07: SessionsMainExports does not export closeSession; activate on a selected row clearing markToast writes and returns true; a take-over handle releases once; nouns from roundType.noun/primerType.noun; self-test close-prompt steps reworked or dropped; AgentFormMarkOptions restates MarkOptions in contracts. · group 07
- Task 08 runs as two workers by sizing: 08a (place-slot.ts, page-hide.ts, autosave, session-form-tabs, sessions, forms, primer) and 08b (chat, docs, notes, backlog, settings); 08a owns the shared helpers and writes them first, 08b imports them; one commit for the group.
- Task 08: a fresh take over replaces only a saved record no take over in this page claimed (savedTakeOverTabIds); placeRestored runs on the read route only, again on a form's first activation; prune after the forms read keeps read forms plus store forms; docs place key is the view's source id, not the generated view:<n>; chat writes its place from drawFocus and expander toggles, not only changed(), and writes nothing before its box mounts. · group 08
- Fix round 1 #27 (08169f16): the user's pick named one docs.openDocAt for the aside rows; Recent rows reopen the shown doc while section links scroll within it, so one command cannot keep both — a third, docs.openRecentPage {viewId, path}, keeps Recent rows' pre-run reopen. Section links with no line pass line 0 (top), since command args have no optional fields.
### Review rounds
- Round 1 at 829145c6: 10 lanes; NEEDS FIXES. 10 lead-applied prose fixes (2c86a6d5); 24 determined findings dispatched (6 Important: chat marks moves unwritten, at-once close reselect, primer cardColumn, docs unshown restored edits close, two test gaps); 20 open to triage. Report /tmp/claude-command-consumers/review-829145c6.md.
- Re-review 1 at 8fab85b3 (R1 chat/sessions/CSS/fixture, R2 docs/notes/restores, R3 forms/primer/settings/test-support + drive verify2): NEEDS FIXES — 36 prior findings closed; new 45-57 (5 Important incl. drive F1 transcript-layout block cursor drifting up per reload). Fix cycle 2 dispatched, every recommendation taken.
### Test gate
- At 8cfb0087: typecheck 0, lint 0 warnings, full vitest 530 files / 10197 tests pass. Filtered self-tests: task 11's combined run (16 plugins) plus forms,primer and agent-lines,unity-pool alone; fix workers re-ran notes (30 pass) and chat (exit 0). Open: agent-lines narrow-fit step fails alone (No workflow tag overflow, likely pre-existing on main, unproven). Fixes C1 78eaa882 and C2 8cfb0087 from task 11's drive checks; their live re-checks not re-run.
- Fix round 1 at 8fab85b3: typecheck 0, lint 0, vitest 531 files 10248 tests pass; self-tests chat, notes, sessions, forms+primer, settings, agent-lines (narrow step now passes), agent-strip pass; docs+backlog failed once on the outside-write step (timing), passed on two reruns.
