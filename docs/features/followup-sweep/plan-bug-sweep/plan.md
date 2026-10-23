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
- [ ] [Round finish waits for main](01-round-finish-waits-for-main.md)
- [ ] [Forms CSS scoping](04-forms-css-scoping.md)
- [ ] [Files read bytes](05-files-read-bytes.md)
- [ ] [Event bus catches listeners](06-event-bus-catches-listeners.md)
- [ ] [Chat askPermission and loaded](07-chat-ask-permission-and-loaded.md)
- [ ] [Sessions, config and keymap fixes](08-sessions-config-keymap.md)
- [ ] [Split ends drag on pointer up](09-split-ends-drag-on-pointer-up.md)
- [ ] [Docs tree empty and filter lines](11-docs-tree-empty-and-filter-lines.md)
- [ ] [Focus ring isolation](13-focus-ring-isolation.md)

### Wave 2
- [ ] [Cancel prompt and background close](02-cancel-prompt-and-background-close.md) — after 01
- [ ] [Review redraw and rail notice](03-review-redraw-and-rail-notice.md) — after 01
- [ ] [Overlay closes on pick](10-overlay-closes-on-pick.md) — after 06, 11

### Wave 3
- [ ] [Docs toggle tree key](12-docs-toggle-tree-key.md) — after 10, 11

### Wave 4
- [ ] [Doc re-read](14-doc-re-read.md) — after every code task

### Wave 5
- [ ] [Final verification](15-final-verification.md) — after 14

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
