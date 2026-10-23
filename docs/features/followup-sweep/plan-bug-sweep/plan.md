# Step-1 bug sweep — plan

Feature: follow-up sweep (master-plan step 1) · Implements: none · Ticket: none
Target: main · Written: 2026-10-23

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Fix the 18 small correctness and UI bugs of `docs/features/master-plan.md` step 1, each with the test or live check
it earns, and remove each fixed entry from `docs/features/followups.md` and from step 1 of the master plan.

## Architecture

Systems touched, each through its existing seam:

- **forms** (page and main): finishing a round waits for main, the cancel prompt's key scope, the background-close
  guard, the review list redraw, the review rail, `forms.css` scoping.
- **core shared**: the event bus (`pluginEvents`), the `Files` contract and its three adapters, the layout registry's
  copy, the `Split` primitive.
- **core main**: the ConfigStore's dispose, the user keymap's leader read.
- **core page**: the modes registry and `ModeHandle` (new `picked()`), the doc editor theme.
- **chat** (main and page): the `askPermission` drive action, the new `loaded` channel message; the Claude adapter's
  `raw` comment.
- **sessions**: the main drive actions' `connected` map; the page sidebar row click calls `picked()`.
- **docs** (page): the tree's empty and filtered lines, the new `docs.toggleTree` command on `Space v t`, `picked()` on
  a doc open.

## Preconditions

`wigley:make` re-runs each before the first dispatch.

- Target `main` at `9dab181` or a descendant holding it: `git merge-base --is-ancestor 9dab181 HEAD`.
- No uncommitted change to a tracked file: `git status --short --untracked-files=no` prints nothing. Peer sessions
  keep their own plan folders untracked beside this one; those are theirs, never committed or reverted here.
- Peer plans written at the same time touch some of the same files: agent-chat plan D (`c401792`: fuzzy `/` filters,
  the docs tree's included) and master-plan step 2 (`6e65c67`: self-test step groups and `why`). Before dispatch, run
  `git log --oneline 9dab181..HEAD -- src/plugins/docs/page src/plugins/forms/main/selftest-script.ts src/plugins/docs/main/selftest-script.ts src/main/selftest.ts src/contracts/plugin.ts`;
  a landed change there is read before tasks 02, 10, 11 and 12 run, and their self-test steps follow the step shape
  on the tip.
- Unit suite green: `npm test` → 165 files, 2503 tests passed (measured at plan time, re-verify).
- Typecheck clean: `npm run typecheck` exits 0.
- No `.answer-label` rule in `src`: `grep -rn answer-label src` prints nothing.
- `Split.setStartHidden` has no caller: `grep -rn setStartHidden src` lists only `split.ts` (and its CSS class in
  `split.css`).
- No `<Leader>v` bind: `grep -n "Leader>v" src/plugins/keymap.ts` prints nothing.

Every command runs through Node from `.nvmrc`: `source ~/.nvm/nvm.sh && nvm use && npm …`.

## Docs written ahead

Commit `9dab181`:

- `AGENTS.md` — the `files/` line (byte reads), the mode bullet (`picked()` closes the narrow overlay).
- `docs/keymap.md` — the `v` view group row with `vt`; `v` leaves the reserved list.
- `docs/features/docs-browser/design.md` — `Space v t`, the overlay closing on a pick, the tree's empty and filtered
  lines.
- `docs/features/agent-chat/design.md` — streaming deltas left out of `raw`.
- `docs/features/followups.md`, `docs/features/master-plan.md` — the stale `.answer-label` half removed.

The commit that adds this plan folder:

- `docs/features/settings/design.md` — a section opened by click or Enter closes the narrow side bar overlay.

## Mandatory Reads

- `AGENTS.md` (every task)
- `DESIGN.md` (tasks touching a view, CSS or a key hint: 01, 02, 03, 04, 10, 11, 12, 13)
- `docs/keymap.md` (task 12)
- `.agents/skills/drive/SKILL.md` (task 15)
- `docs/features/docs-browser/design.md` (tasks 10, 11, 12)

## Design Overview

### Finishing a round (task 01), after

```
 page: submit / confirmCancel
   │  store: round marked sending (keys on it do nothing, status reads "Sending…")
   ▼
 channel.invoke('finish', roundId, end) ──► main: listener.finish(end) ─┬─ ok ──► open.delete(roundId)
   │                                                                     │         send roundClosed(roundId)
   │                                                                     └─ throws ──► entry kept, rejection
   ▼                                                                                   returns to the page
 page on roundClosed: close round, toast "Answers sent" / "Round cancelled", close session if asked
 page on rejection:   round stays (answers, focus, editors kept), toast "Round not sent: <error>" (error tone)
```

### Narrow side bar overlay (task 10), after

```
 sessions row click ─┐
 docs leaf open      ├──► ModeHandle.picked() ──► modes: sideBarAfterPick(state) ──► overlay closes when narrow
 (click, l, Enter)  ─┘                                                               (no-op when wide or hidden)
 docs group expand/collapse ──► nothing
```

### Decisions

From the interview round (every recommendation taken):

- A round closes on the page only when main says it closed; a failure keeps it open with an error toast. `roundClosed`
  now also fires for a round the page finished, and main drops its open entry only after `finish` succeeds.
- Closing a background session's row: toast `Finish or cancel <label>'s round first` and select that session.
- A pick in the narrow overlay closes it: a session row, a doc opened by click, `l` or Enter, a Settings section
  opened by click or Enter (final round). A group toggle does not.
  Plugins say so through a new `ModeHandle.picked()`.
- The docs tree shows three lines: `No docs match "<filter>"` (`/` then `Esc` to clear), `No docs in this index` (`R`
  to rescan), and above rows while a filter is on, `Filtered: <filter>` (`/` to change). Keys as Kbd through
  `keysFor`, redrawn on a rebind.
- `Space v t` runs a new `docs.toggleTree` that hides or shows the tree of whichever docs view shows; `Space k d` is
  unchanged.
- A notice's rail entry in the review jumps back to the notice's card without focusing its comment box, as question
  entries do.
- `Files` gains `readBytes(path): Promise<Uint8Array>` beside `writeBytes`; `MemoryFiles`' sync test helper of that
  name becomes `bytesOf`; layout copy copies every file through bytes.

Settled by the agent (Decided notices):

- `pluginEvents` wraps each listener in a catch that logs `<event> listener failed: <error>` under the listening
  plugin's id; the bus itself stays bare.
- `chat.askPermission` defaults `input` only when it is left out.
- Chat's page sends `loaded` once at start, which cancels a stale sign-in; `sessions` is a plain read.
- Sessions' drive `connected` map drops an entry on `sessions.ended`.
- `ConfigStore.dispose` sets `isDisposed`; a running rebuild then neither publishes nor loops.
- `readLeader` refuses a leader that resolves to `<`.
- The review list skips its rebuild when the round's answers, finding answers, review row and round are the same
  references as at the last draw.
- The forms cancel prompt pushes its own key scope and dismisses on `onBaseChanged`.
- `forms.css` scopes the Form tab's generic classes with `:where(.form-tab)`; the status line and the overlay prompt
  stay unscoped.
- `Split` ends a drag on a window `pointerup` or `pointercancel` for its pointer.
- `.wg-document-editor` takes `isolation: isolate`, so the focus ring's z-index stays inside the editor.
- While a round is sending, the save status reads `Sending…` and the round's keys do nothing.
- A session Docs tab's hidden tree is per tab and not stored, as Docs mode's is not; its tree commands route to the
  doc as Docs mode's do.

### Out of scope

Every other entry of `followups.md` and every later master-plan step. The forms self-test cannot click, so the rail
and CSS checks are drive checks only.

## File Structure

Shared names more than one task uses:

- `ModeHandle.picked(): void` in `src/contracts/plugin.ts` ← 10; used by 10's sessions and docs call sites only.
- `Files.readBytes(path: string): Promise<Uint8Array>` in `src/contracts/files.ts` ← 05.
- `pluginEvents(bus, pluginId, log)` in `src/shared/event-bus.ts` ← 06.

Boundary rules: plugins reach the core only through `src/contracts`; `npm run lint` (`check-layers.mts`,
`check-styles.mts`) must pass after every task.

Files by task (each task document lists its own as create, modify or test):

| Task | Area | Files |
|---|---|---|
| 01 | forms finish | `forms/main/channel-presenter.ts`, `forms/contract.ts`, `forms/page/forms-commands.ts`, `forms/page/start.ts`, `forms/page/form-state.ts`, `forms/page/view-model.ts`, `forms/page/forms-view.ts` (the `Sending…` status) + tests |
| 02 | forms prompt, background close | `forms/page/forms-view.ts`, `forms/page/forms-commands.ts`, `forms/page/start.ts`, `forms/main/selftest-script.ts` + tests |
| 03 | forms review | `forms/page/round-view.ts`, `forms/page/view-model.ts`, `forms/page/form-state.ts` + tests |
| 04 | forms CSS | `forms/page/forms.css`, `scripts/style-rules.test.mts` (test, outside `src/`) |
| 05 | files, layout copy | `contracts/files.ts`, `main/files/node-files.ts`, `shared/memory-files.ts`, `shared/scoped-files.ts`, `shared/layouts/layout-registry.ts` + tests and `readBytes` helper callers |
| 06 | event bus | `shared/event-bus.ts`, `main/plugins/main-api.ts`, `renderer/plugins/page-api.ts`, `contracts/plugin.ts` + tests |
| 07 | chat | `plugins/chat/main/start.ts`, `plugins/chat/contract.ts`, `plugins/chat/page/start.ts`, `contracts/agent.ts`, `main/claude-code/stream-decoder.ts` + tests |
| 08 | sessions, config, keymap | `plugins/sessions/main/start.ts`, `main/config/config-store.ts`, `main/config/user-keymap.ts` + tests |
| 09 | split | `shared/page/ui/split.ts` + test |
| 10 | overlay pick | `contracts/plugin.ts`, `renderer/shell/modes.ts`, `plugins/sessions/page/start.ts`, `plugins/docs/page/start.ts`, `plugins/docs/page/docs-view.ts` (`leafOpened` hook), `plugins/settings/page/settings-view.ts` (`sectionPicked` hook), `plugins/settings/page/start.ts` + tests |
| 11 | docs tree lines | `plugins/docs/page/tree-view.ts`, `plugins/docs/page/docs-view.ts`, `plugins/docs/page/docs-state.ts`, `plugins/docs/page/docs.css`, `plugins/docs/main/selftest-script.ts` + tests |
| 12 | `Space v t` | `plugins/docs/manifest.ts`, `plugins/keymap.ts`, `plugins/docs/page/start.ts`, `plugins/docs/main/selftest-script.ts` + tests |
| 13 | focus ring | `renderer/codemirror-vim/editor-theme.ts` |
| 14 | doc re-read | the docs written ahead, `docs/features/followups.md`, `docs/features/master-plan.md` |
| 15 | final verification | none (drive and self-test runs) |

Paths are under `src/` except the docs. The drafters confirm each path and may add a test file or a fixture; a task
that needs a file another task in its wave also lists is moved to a later wave.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Round finish waits for main](01-round-finish-waits-for-main.md)
- [x] [Forms CSS scoping](04-forms-css-scoping.md)
- [x] [Files read bytes](05-files-read-bytes.md)
- [x] [Event bus catches listeners](06-event-bus-catches-listeners.md)
- [x] [Chat askPermission and loaded](07-chat-ask-permission-and-loaded.md)
- [x] [Sessions, config and keymap fixes](08-sessions-config-keymap.md)
- [x] [Split ends drag on pointer up](09-split-ends-drag-on-pointer-up.md)
- [x] [Docs tree empty and filter lines](11-docs-tree-empty-and-filter-lines.md)
- [x] [Focus ring isolation](13-focus-ring-isolation.md)

### Wave 2
- [x] [Cancel prompt and background close](02-cancel-prompt-and-background-close.md) — after 01
- [x] [Review redraw and rail notice](03-review-redraw-and-rail-notice.md) — after 01
- [x] [Overlay closes on pick](10-overlay-closes-on-pick.md) — after 06, 11

### Wave 3
- [x] [Docs toggle tree key](12-docs-toggle-tree-key.md) — after 10, 11

### Wave 4
- [x] [Doc re-read](14-doc-re-read.md) — after every code task

### Wave 5
- [x] [Final verification](15-final-verification.md) — after 14

## Run log

Review base: 2bd62ed (peer sessions share this tree: the review range is this run's commit list)

### Groups
- 05 Files read bytes · 24fe14f · diff read, Produces all present; typecheck clean in its files (errors only in running groups 01 and 11) · concerns: none
- 07 Chat askPermission and loaded · 80c86cd · diff read, Produces present (loaded invoke and handler); typecheck clean in its files · concerns: chatMainPart header comment left as is, still true
- 06 Event bus catches listeners · e223013 · diff read, pluginEvents signature as planned; typecheck clean in its files · concerns: worker ran npx prettier (cached, not a dependency) on its five files and restored them with oxfmt — hard-gate breach reported to the user
- 04 Forms CSS scoping · e5cdd22 · diff read: stripping the :where(.form-tab) prefix and the new comment gives the old file byte for byte; only .form-tab and .status- rules start a line · concerns: none
- 09 Split ends drag on pointer up · 0d2ae5d · diff read, createSplit and Split unchanged; window listeners added at pointerdown and removed in endDrag; lostpointercapture guard keeps a single save · concerns: endDragOnRelease and endDrag refer to each other (safe: neither runs before both exist)
- 11 Docs tree empty and filter lines · d652347 · diff read, every Produces present plus hasIndex; document set before setTree in docs-view; checksFit is a SelfTestStep field · concerns: no-match line sits near the pane top, not vertically centred (.ui-empty centres horizontally only) — task 15 screenshot; hidden slots drop out of grid placement, rows scroll left to task 15's G check
- 08 Sessions, config and keymap fixes · 687221f · diff read, addDriveActions signature as planned; each new test failed with its guard removed (worker) · concerns: followups.md still lists the < leader entry — task 14 removes it; a sessions start.ts comment line exceeds the wrap width
- 13 Focus ring isolation · bf6d8d2 · diff read, isolation: isolate on the rule; ring rule unchanged · concerns: none
- 01 Round finish waits for main · 44968c9 · diff read, every Produces present as named; typecheck, lint and the forms tests pass (worker) · concerns: roundClosed vs finish-reply order over real IPC untested (page does not depend on it) — task 15 live check
- 10 Overlay closes on pick · af1991a · diff read, every Produces present; treeHidden, sideBarHidden and doc.open's boolean confirmed in the tree; modes.test passes (worker) · concerns: sessions, docs and Settings call sites have no unit test — task 15 live checks
- 03 Review redraw and rail notice · 780b705 · diff read, every Produces present; reviewJumpItem is outside SENDING_ACTIONS so inert while sending; typecheck and the two test files pass (worker) · concerns: is-disabled toggle removed (ui-row drops clicks on is-disabled rows); followups.md:24 entry for task 14
- 02 Cancel prompt and background close · 480f264 · diff read, every Produces present; self-test expect strings match the modes log; typecheck, lint and forms-commands tests pass (worker) · concerns: dismiss-on-base-change relies on Sessions hidden() running before Docs shown(); while a cancel sends, the confirm scope stays pushed until roundClosed (spec allows); two comment lines past the wrap width
- 12 Docs toggle tree key · cebc48a · diff read, every Produces present (manifest command, <Leader>vt bind, view group, toggleTree); typecheck, lint, keymap test pass (worker) · concerns: session <A-h> step expects [docs] tree shown with tree focused logged after it in the same key — self-test confirms
- 14 Doc re-read · 5fe1577 · diff read: 19 entries removed, each re-verified; step 1 removed, peer lines kept; written-ahead lines checked against the code · concerns: two rewrapped lines exceed the 120-column wrap (agent-chat/design.md, master-plan.md) — for the review
- 15 Final verification · 573aebc · run 1 (reports/15-1.md): self-test failed on the docs first step (02's forms Space k d now builds the index first), / drawn as the or-separator (11), editor ring gone with vim's : line open (13); leader not routed in the docs filter box (12) predates the run; 02 background-close click and 08 ended unreachable. Fixed in 64e81dd, 4c74094, 5c7af88. Run 2 (reports/15-2.md) at 573aebc: typecheck, lint, 165 files / 2568 tests, self-test all passed; / is a key, no-match line wraps at the 160px tree, ring stays with : open, review cursor row in view on reopen; sending-close toast and failed-send dismiss unreachable (no drive action holds or rejects a finish) · concerns: leader in the docs filter box and vim insert mode goes to step 8
### Contract changes
- TreeViewDeps: keysFor, kbd → also hasIndex(): boolean, wired as () => document !== null · why: a null document and an empty index both reach setTree as [] · consumers: none (10 and 12 edit docs-view later) · group 11
- FormsView.isFormShown(): on the interface → a local inside mountFormsView · why: its only outside caller, start.ts' store.subscribe, is deleted · consumers: none · group 02
### Rulings
- Existing pluginEvents tests whose log nothing asserts pass logInto([]) inline — keeps those tests unchanged but for the argument — cost: none beyond style · group 06
- plan.py is missing from the installed wigley 1.8.0 (no scripts/plan); the Run log, boxes and Status lines are kept through a hand stand-in with the same edits — cost: none if the edits match plan-folder.md · lead
- forms.css: the :where() comment sits in its own block above the round rules, leaving the existing comment's wording — cost: a one-line move · group 04
- Split: one endDragOnRelease closure serves both pointerup and pointercancel — same behaviour as two — cost: none · group 09
- Tree line hasTree follows the latest setTree, not a sticky flag — no empty-index line shows under a failed read after a good one — cost: a failed read hides the line · group 11
- Tree keysChanged recomputes the line and redraws only when the key strings differ — cost: kbd drawing a same string differently would not redraw · group 11
- readLeader computes page keys once inside the try so the < refusal joins the single refusal if — cost: shape only · group 08
- Forms apply checks a SENDING_ACTIONS allow-list while the active round sends; sendStarted and sendFailed carry no view check (finishActiveRound checks it) — cost: none today · group 01
- Extra comments at the sessions activate dep and Settings sectionPicked dep saying a pick closes the overlay and why mode is safe to read — cost: two comment lines · group 10
- RoundParts.reviewRowAt dropped (only the click handler read it, through a local); reviewJumpItem on the already-focused notice still switches to the forms view — cost: none · group 03
- docs start: a local toggleSideBar serves showMode and toggleTree; toggleTree finds a session view's state through sessionDocsOf; onActiveView returns early on no active view — cost: none · group 12
- task 15 live-check failures: docs selftest first step (caused by 02's Space k d step) and the lone `/` hint drawn as the or-separator (11) go back as fixes; leader not routed in the docs filter box / vim insert, and the editor ring gone while vim's `:` line holds focus, predate this run (12 and 13 did not touch those paths) and go to step 8
### Review rounds
- round 1 · 2bd62ed..dc9bdae (head dc9bdae; peer 9028e66 after the pin, outside) · 6 correctness + 4 plan-and-design lanes · NEEDS FIXES · 17 findings (3 important) · 3-8 lead-applied in 1b5feea (prose-only) · 9, 10 dispatched with the task 15 live-check fixes (docs selftest first step, lone `/` Kbd) · 1, 2, 11-17 to triage
- round 2 (re-review) · 1b5feea..573aebc · 2 correctness lanes · R1 findings 1, 2, 7, 9-17 and optional F1 closed · 2 rewraps lead-applied in dc6720b · 1 open repeat (a main-side close during a closing cancel leaves the session open) to step 8
- round 3 (re-review of step-8 fixes) · dc6720b..85555f7 · 2 correctness lanes · step-8 items 1-8 closed · 2 comment fixes lead-applied in 683a2df · open: self-test regression from 85555f7 (62 failed after docs Space k d; first mode switch while narrow does not open the overlay), narrowing cancels an open docs dialog, forms status lingers during a cancel send, jump logs on a no-op, Enter on a filtered group · fix cycles exhausted (2), sent to the user
round 4 (user's round-4 answers, then re-review) · 683a2df..8b399a5 · 1 correctness lane · round-3 open items fixed in 4588faf, 8b399a5 · NEEDS FIXES: filter box kept in a hidden side bar, session Space v t cancelling a pushed scope, open-over ending a pushed scope, filtered step-in onto a hidden child, missing self-test steps · all fixed as Decided (user's standing rec) in af08f01 · self-test all passed, full suite 165 files / 2594 tests · narrowing-hides-filter gap carried to followups.md
### Test gate
- picked: the 17 test files the range added or edited (each task's named tests); main-api and page-api tests (pluginEvents callers, 06); keymap, keymap-checks, plugin-manifests, hidden-tree-keys, help-sections, which-key, keymap-rows and user-config tests (they read the default keymap or manifests that 12 changed: new view group and docs.toggleTree) · typecheck clean · 27 files, 735 tests passed
