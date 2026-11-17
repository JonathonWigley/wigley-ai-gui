# 23 — Session list: no selection on a claimed row after a close, and a joined relay's host fields

Status: done
Type: Batch
Wave: 3 · Depends on: 05, 09
Rung: hard · adds the page-owned `sessionsClaimedSlot` that main reads, and changes when forms reads a deadline
Plan: [plan.md](plan.md)

Two follow-ups from `docs/features/followups.md` § Bugs seen in use, one batch because both change
`src/plugins/sessions/main/session-list.ts` and its tests:

- **After a close, the selection lands on the new retro row.** The same holds for every row a plugin section claims,
  the Scheduled runs section of task 16 included.
- **Chat sessions get forms' 240 s deadline, not the relay's 300 s.**

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/main/session-list.ts` ·
           modify `src/plugins/sessions/main/start.ts` · modify `src/plugins/sessions/page/sessions-view.ts` ·
           modify `src/plugins/sessions/page/start.ts` · modify `src/shared/agent-forms/form-service.ts` ·
           test `src/plugins/sessions/main/session-list.test.ts` · test `src/plugins/sessions/page/start.test.ts` ·
           test `src/shared/agent-forms/form-service.test.ts` ·
           modify `docs/features/followups.md` (removes the two entries)

Consumes:  `session-list.ts` and `contract.ts` as task 05 leaves them (← 05); `sessions/main/start.ts` as task 09 leaves
           it (← 09). Tree members: `removeRow`, `join`, `connect` (`session-list.ts`); `SidebarSection.claims`,
           `guardedSections` (`sessions-view.ts`); `deadlineSeconds`, `startSession`, `SessionContext`
           (`form-service.ts`); `HOST_DEADLINE_FIELD` (`src/contracts/agent-forms.ts`).

Produces:
- In `src/plugins/sessions/contract.ts`:
  ```ts
  // The rows a registered side bar section claims, by sessionId, as the side bar's last draw found them; [] before the
  // first draw and at each page start. Main's post-close selection skips them.
  export const sessionsClaimedSlot: SlotKey<readonly string[], 'page', 'sessions'> = {
    id: 'sessions.claimed',
    process: 'page',
    kind: 'value',
  };
  ```
- `SessionListDeps.claimed(): readonly string[]`, which `start.ts` fills from `api.state.read(sessionsClaimedSlot)`.

Decisions:
- **Where the claim is known.** Section claims live on the page (`addSection`), and main picks the selection after a
  close (`removeRow`). The page publishes the claimed ids; main reads them. Reason: the section's `claims` is the one
  source of truth for which rows a section holds, so no plugin declares its rows twice. A page-owned slot is held in
  main's memory (AGENTS.md § A slot), so main reads it with `api.state.read`. If the compiler or the state service
  refuses a main read of a page-owned slot, stop and report it as a concern; do not add a channel message instead.
- **The page write.** At each side bar draw, the page writes the sessionIds every guarded section claims, in draw
  order, and writes only when the list differs from the last one written. It writes `[]` at the part's start.
- **The pick.** `removeRow` keeps its rule (nearest row with no owner to the right, else to the left) and also skips a
  row whose sessionId `deps.claimed()` holds. When every other row is claimed or owned, the selection is null. A
  close of a row that is itself claimed uses the same pick. Update the comment above `removeRow`.
- **Known gap, accepted.** A row a section claims only after the page's next draw is not in the slot yet. A close in
  that window can still land on it. The retro case of the follow-up is the second close after a launch, which comes
  after the draw.
- **The join keeps the hello's host fields.** `connect` passes its `info` to `join`. When `info.host` is not
  undefined, `join` sets `entry.session.info.host = info.host` on the session's one info object, as
  `setHostSessionId` changes `sessionId` in place. An undefined `info.host` leaves the row's host fields as they are.
- **Forms reads the deadline at each use.** A chat row's tool sessions start at `open` (`addEntry`), before the relay
  joins, so `startSession` fixes the deadline too early. Replace the `deadlineSeconds: number` field of
  `SessionContext` with a read at each use: `deadlineSeconds(session.info, deps.defaultDeadlineSeconds())` at every
  read of `session.deadlineSeconds` (six at plan time). Check that `owner.info` in `startSession` is the session's one info
  object (the object sessions hands to a tool session's `start`). If forms copies it anywhere on the way, report it
  as a concern.
- Test names follow each file's existing form.

GIVEN rows A (selected), R and B in that order, where a section claims R
WHEN A closes
THEN the selection is B

GIVEN rows A (selected) and R, where a section claims R
WHEN A closes
THEN the selection is null

GIVEN an owned row opened with no host record
WHEN a relay joins it with a hello whose host fields hold `deadline_seconds: 300`
THEN the session's `info.host` holds 300, and a round opened after the join waits 300 s

Tests:
- `session-list.test.ts`, one table over the post-close pick: rows claimed to the right (skip to the next unclaimed);
  every other row claimed (null); claimed and owned rows mixed (the first plain one); nothing claimed (today's pick).
  The deps' `claimed` returns the row's list. Break: a pick that ignores claims.
- `session-list.test.ts`, the join row of the follow-up: the third GIVEN/WHEN/THEN, asserting `info.host` and that a
  hello with no host fields keeps the earlier ones.
- `form-service.test.ts`: a session started with no host fields whose `info.host` gets `deadline_seconds: 300` before
  the round opens waits 300 s, not the default. Break: a deadline read once at start.
- `sessions/page/start.test.ts`: one wiring case: a section that claims one row makes the page write `[<that id>]`
  to `sessions.claimed`.

Done when: `npm run lint` and `npm run typecheck` pass; `npm test` passes for the three test files above. The two
follow-up entries ("After a close, the selection lands on the new retro row" and "Chat sessions get forms' 240 s
deadline, not the relay's 300 s") are gone from `docs/features/followups.md`. No live check in this task: a chat row's
round deadline is a task 21 check (an amendment the lead adds to 21).

Commit:    one commit for the group: "Sessions: post-close selection skips claimed rows; a relay join keeps its host fields".

## Proof

Commit fb012319f · proof: diff read: Produces present; wave 3 typecheck and lint pass after 29482b015 · concerns: edited agent-form-drive.test.ts and sessions-view-fakes.ts for the new required claimed member; a deadline setting change now reaches live sessions
