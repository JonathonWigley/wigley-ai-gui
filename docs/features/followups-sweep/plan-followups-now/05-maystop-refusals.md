# 05 — Switch-off refuses while unsaved work is open

Status: not started
Type: Batch
Rung: hard · adds stop refusals to two page parts' lifecycle and builds a new part-harness test for session-stash
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-ups: `followups.md`, "Switching off docs-session-tab drops unsaved Docs tab edits" and "Switching off
session-stash drops a note being typed".

Files:
- modify `src/plugins/docs-session-tab/page/start.ts`
- test `src/plugins/docs-session-tab/page/start.test.ts`
- modify `src/plugins/session-stash/page/start.ts`
- create `src/plugins/session-stash/page/start.test.ts`

Preconditions (run from `wigley-ai-gui/`):

| Claim | Command | Expected |
|---|---|---|
| Neither part has a `mayStop` | `grep -n mayStop src/plugins/docs-session-tab/page/start.ts src/plugins/session-stash/page/start.ts` | no output |
| The page part contract offers it | `grep -n 'mayStop?(): string \| null;' src/contracts/plugin.ts` | two lines (page start ≈918, main start ≈1188) |
| The view handle tells unsaved edits | `grep -n 'hasUnsavedEdits(): boolean;' src/plugins/docs/contract.ts` | one line |
| The note dialog tells it is open | `grep -n 'isOpen(): boolean;' src/plugins/session-stash/page/note-dialog.ts` | one line |
| session-stash has no page part test | `ls src/plugins/session-stash/page/start.test.ts` | no such file |
| Docs' own refusal is the model | `grep -n 'Save or discard the edits to' src/plugins/docs/page/start.ts` | one line (≈488) |

Consumes: `PageStart.mayStop` in `src/contracts/plugin.ts`; `DocsViewHandle.hasUnsavedEdits` in
`src/plugins/docs/contract.ts`; `NoteDialog.isOpen` in `src/plugins/session-stash/page/note-dialog.ts`;
`sessionsRowsSlot` in `src/plugins/sessions/contract.ts`; `startPagePart`, `fakeDependency` in
`src/shared/plugin-part-harness.test-support.ts` (all tree).

Produces: a `mayStop(): string | null` member on each part's returned `PageStart`.

Decisions:
- **docs-session-tab.** `mayStop` walks `sessionDocs` in insertion order and returns, for the first held view whose
  `view.hasUnsavedEdits()` is true, `Save or discard the edits in <label>'s Docs tab first`, `<label>` being the
  session's row label from `api.state.read(sessionsRowsSlot)` (`rows.get(sessionId)?.label ?? sessionId`, the name
  docs' own `placeNameOf` gives a session tab); null when none holds unsaved edits. `DocsViewHandle` has no unsaved
  path, and adding one would edit docs' contract for wording only, so the text names the tab, not the file.
- **session-stash.** `mayStop` returns `Stash or cancel the open stash note first` while `noteDialog.isOpen()`, else
  null.
- **Only a switch-off asks.** The contract's rule stands: a restart and quit do not ask `mayStop`, so neither part
  changes how it stops.
- **The session-stash test file.** It follows `src/plugins/notes/page/start.test.ts`, with
  `installFocusFakeDom(vi.stubGlobal)` in place of `installFakeDom`, as `note-dialog.test.ts` does: `noteDialog.open`
  reads `document.activeElement` and focuses the input. `layoutShow` is left unset: the part ignores the show's
  `draw`, and the dialog draws through `createSessionStashParts`' default layout until `setLayouts` runs.
  `startPagePart(sessionStashPagePart, { dependencies: [<sessions fake>], invoke })`, where the
  sessions fake (`fakeDependency(sessionsPageKey, …)`) answers `shownSessionId()` with `'s1'` and `closeSession`
  with a resolved promise, `invoke` resolves `undefined` for `forgetKept`, and the harness publishes
  `sessionsRowsSlot` with a row for `'s1'` (`sessionRow` from `src/plugins/sessions/contract.test-support.ts`).

GIVEN a Docs tab of session `s1` whose view holds unsaved edits
WHEN the switch asks docs-session-tab's `mayStop`
THEN it answers `Save or discard the edits in s1's Docs tab first`

GIVEN no Docs tab with unsaved edits
WHEN the switch asks
THEN it answers null

GIVEN session-stash's note dialog open over `s1` (its `stash` command ran)
WHEN the switch asks session-stash's `mayStop`
THEN it answers `Stash or cancel the open stash note first`

GIVEN the dialog opened and then cancelled (`noteCancel`)
WHEN the switch asks
THEN it answers null

Tests:
- `docs-session-tab/page/start.test.ts`: `mayStop_RefusesOnlyOverUnsavedEdits ($state)`, a table over
  `startWithRows(['s1'])` with `seen.hasUnsavedEdits` false → `null`, true → `"Save or discard the edits in s1's Docs tab first"`
- `session-stash/page/start.test.ts` (new): `mayStop_RefusesOnlyWhileTheNoteDialogIsOpen ($state)`, a table: fresh
  start → `null`; after `commands.stash` → `'Stash or cancel the open stash note first'`; after `commands.stash` then
  `commands.noteCancel` → `null`. Each row ends with `await harness.stop()`.

Done when: compiles; `npm test` runs both tests and they pass.

Commit: one commit, "docs-session-tab, session-stash: refuse a switch-off over unsaved edits or an open note (switch-off drops follow-ups)".

## Proof
