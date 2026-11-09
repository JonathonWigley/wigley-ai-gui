# 01 — Sessions: owned rows

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · `src/plugins/sessions/main/session-list.ts` ·
           `src/plugins/sessions/page/start.ts` · `src/plugins/sessions/page/preview.ts` ·
           `src/plugins/sessions/contract.test-support.ts` · test `src/plugins/sessions/main/session-list.test.ts` ·
           `src/plugins/sessions/page/start.test.ts` · `src/plugins/notes/page/start.test.ts` (row literal only)
Consumes:  `OpenOptions` (`src/plugins/sessions/contract.ts:177`, today `{ select: boolean; rowId?: string }`);
           `SessionRow` (`contract.ts:337`); `createSessionList` (`src/plugins/sessions/main/session-list.ts:263`);
           the page's `currentState()` (`src/plugins/sessions/page/start.ts:777`).
Produces:  `OpenOptions.owner?: string` and `SessionRow.owner: string | null` in `src/plugins/sessions/contract.ts`;
           `sessionRow(sessionId, overrides)` in `contract.test-support.ts` returns `owner: null` unless overridden.
Decisions:
- Term. In this task "a row with an owner" is a row whose `owner` is non-null. Do not call it an "owned row" or
  "owned session" in code or comments: sessions already uses "owned" for a session `open` started
  (`SessionEntry.owned`, `ConnectedSessionEvent.owned`, AGENTS.md § Sessions). Every chat row is "owned" in that
  sense. Source: this task's read of the tree.
- Sessions keeps the owner; it does not save it. Sessions main persists no rows: the rows live in slots that
  creation clears (`session-list.ts:301-306`), and chat's saved record brings each row back through `open`
  (`openRestoredRow`, `src/plugins/chat/main/chat-sessions.ts:2586`). Task 02 saves the owner in chat's record and
  passes it to `open` again. Source: design.md § Chat and sessions changes ("Sessions keeps the owner on the row and
  saves it": chat's record is that save).
- A row with an owner stays in `sessionsRowsSlot`. Readers that work per session (chat page, forms, primer,
  docs-session-tab, agent-strip, usage, workflow, session-stash, auto-retro, context-sources, agent-skills,
  agent-lines, notes, unity-pool) keep their behaviour: they read the row by id, and chat's view needs the row
  (task 03 reads `owner` from it). Source: design.md § Chat and sessions changes.
- Main never selects a row with an owner. This rule keeps the page safe: the page treats a selection that names no
  row it holds as mid-operation (`start.ts:792-826`), so a selected row the page left out would freeze its focus.
  The rule in `session-list.ts`:
  - `open` with `owner`: the row is added unmarked and not selected, whatever `select` says.
  - The `mark` and `activate` rules read `entry.owner` (the `SessionEntry` field below), not the row. Reason: the
    row can be missing while the entry exists (the user closed it, or `mark` has not added it yet).
  - `mark` of a session whose entry has an owner: logs `mark for session <id> with an owner ignored` and writes
    nothing (no row, no mark, no selection, no `markToast`).
  - `activate` of such a session: logs `activate for session <id> with an owner ignored`, calls no `activated`,
    writes nothing and returns false. `activateExistingRow`: the same, with its own name in the line. Put the owner
    check before the call to `activateRow` (`session-list.ts:370`), because `activateRow` calls `deps.activated`
    first.
  - `removeRow` (the selected row closes or ends): the first row with no owner to the right takes the selection,
    else the nearest row with no owner to the left, else none. Today it takes `ids[position + 1] ?? ids[position - 1]`.
  Source: design.md § Owned rows ("pane placement skip an owned row"); AGENTS.md § A chat pane (a session shows in
  at most one pane).
- The owner is fixed at `open` for the session's life. `SessionEntry` gains `owner: string | null` (`connect` sets
  null), and `rowOf(entry)` copies it, so every row write (project lookup, `setTitle`, `setHostSessionId`) keeps it.
- The page filters once, at its input. `currentState()` (`start.ts:777-780`) returns only rows whose `owner` is
  null. Every page rule then skips a row with an owner: the side bar and the sections' `claims` (`view.render`), the
  session step keys (`view.orderedRows()`, `start.ts:854-873`), the split picker (`start.ts:980`), pane placement,
  pane restore and `fillPlan`, rename and the project keys. `sidebar-order.ts`, `sidebar-view.ts`, `tabs.ts` and
  `pane-sessions.ts` do not change. A tab or popup another plugin adds for a session with an owner waits for a row
  the page never holds, so it never shows (task 03 keeps chat from adding one). Source: this task (one seam owns
  the rule, writing-code § reuse).
- The page's `exports.activate(sessionId)` for a session with an owner places nothing (`rowOf` finds no row) and
  sends `activate` to main, which ignores it. No page change for this.
- `preview.ts` sample rows get `owner: null`.

GIVEN `open(info, { select: true, owner: 'practice' })` WHEN the row is added THEN the row has `owner: 'practice'` and
the selection does not change.
GIVEN `open(info, { select: true })` WHEN the row is added THEN the row has `owner: null` and is selected (today's rule).
GIVEN a row with an owner and no selection WHEN `mark` runs for it THEN nothing is written and a log line names it.
GIVEN a row with an owner WHEN `activate` or `activateExistingRow` runs for it THEN nothing is written, `activated` is
not called, `activate` returns false, and a log line names it.
GIVEN rows `a` (selected), `o` (owner `practice`), `b` WHEN `a` closes THEN `b` is selected.
GIVEN rows `o` (owner `practice`), `a` (selected) WHEN `a` closes THEN the selection is null.
GIVEN rows `s1` (selected), `o1` (owner `practice`), `s2` on the page WHEN the user steps with next and previous
session or walks the side bar list THEN `o1` is never activated and the list cursor never stops on it.

Tests:
- `open_Owner_KeepsItOnTheRowAndNeverSelectsIt` in `session-list.test.ts`, an `it.each` over
  `{ options, owner, selected }`: `{ select: true }` → owner `null`, selection the new row; `{ select: true, owner:
  'practice' }` → owner `'practice'`, selection `null`; `{ select: false, owner: 'practice' }` → owner `'practice'`,
  selection `null`. Assert `list.state()`'s row `owner` and `selectedSessionId`. Catches a dropped owner and an
  owner row that `select` still selects. Also add `owner: null` to the full-row literal in
  `opens an owned session with a selected row and emits connected` (`session-list.test.ts:1419`).
- `rowWithAnOwner_MarkAndActivate_WriteNothingAndLog` in `session-list.test.ts`, an `it.each` over the call:
  `mark` with no selection, `mark` with another row selected, `activate`, `activateExistingRow`. Each row opens
  `o` with `{ select: false, owner: 'practice' }` (and, in the second row, a connected row selected first), records
  `states.length`, runs the call, and asserts: no new state sent, `activated` is `[]`, the last `logged` line matches
  `/<call> .*<o's id>.*owner/`, and for `activate` the return is `false`. Catches a mark from none that selects a row
  the page cannot show.
- `closeSession_SelectedRowBesideARowWithAnOwner_SkipsIt` in `session-list.test.ts`, an `it.each`:
  rows `[a, o, b]`, `a` selected, close `a` → selection `b`; rows `[a, o]`, `a` selected, close `a` → selection
  `null`; rows `[b, o, a]`, `a` selected, close `a` → selection `b`. `a` and `b` are connected with `connectWithRow`,
  `o` opened with `{ select: false, owner: 'practice' }`; select `a` with `activate`. Close `a` with
  `list.release(a)`. Catches the neighbour rule
  taking the row with an owner.
- `rowWithAnOwner_StaysOutOfTheSideBarAndTheStepKeys` in `src/plugins/sessions/page/start.test.ts`, in
  `describe('the sessions list in the page part')`, an `it.each` over the act. Setup: `startWithList(['s1', 's2'],
  's1')`, then `setup.rows.set('o1', { ...hostRow('o1'), owner: 'practice' })` and `await settle()`. Rows:
  - `next and previous session`: run `commands.nextSession` twice and `commands.prevSession` twice; assert
    `setup.activations` contains `'s2'` and does not contain `'o1'`.
  - `the side bar list`: `mode.focusSideBar?.()`, then `commands.listDown` three times; assert no line from
    `linesFrom(start)` contains `label o1`, and one line is `list cursor on label s2`.
  Catches a page rule that reads the rows slot without the owner filter.
Approach:
- `contract.ts`: add `owner?: string` to `OpenOptions` and `owner: string | null` to `SessionRow`. Update these doc
  comments, so the prose lands with the code:
  - `OpenOptions` (`:173-176`): `owner` names the plugin the row belongs to (`practice`); such a row is never
    selected, and the Sessions page leaves it out of its side bar, its session step keys and its panes; the owner
    shows the session itself.
  - `SessionsMainExports.open` (`:229-232`), `mark` (`:234-242`), `activate` (`:244-246`), `activateExistingRow`
    (`:248-249`): state the rules in Decisions.
  - `SessionRow` (`:328-336`): `owner` is the plugin the row belongs to, fixed at `open`; null for every other row.
  - The `addSection` paragraph (`:549-555`): `claims` is asked of every row with no owner.
  - `sessionsRowsSlot` (`:632-635`): the slot holds rows with an owner too; the Sessions page leaves them out.
- `session-list.ts`: `SessionEntry.owner`; `addEntry(info, owned, id, owner)` or an equal change; `rowOf` copies
  `owner`; the rules in Decisions in `open`, `mark`, `activate`, `activateExistingRow` and `removeRow`. Update the
  `createSessionList` comment (`:228-262`) with one sentence for the rules.
- `page/start.ts`: filter in `currentState()`; add one sentence to the part's header comment (`:224-268`): rows with
  an owner are left out of the page's state, so no page rule sees them.
- TypeScript names every row literal that lacks `owner` (`preview.ts:56`, `notes/page/start.test.ts:194`): add
  `owner: null`.
Done when: `npm run typecheck` passes, `npm run lint` passes, and the test gate runs `session-list.test.ts`,
`src/plugins/sessions/page/start.test.ts`, `src/plugins/sessions/page/preview.test.ts` and
`src/plugins/notes/page/start.test.ts`, all green.
Commit:    one commit for the group

## Proof

