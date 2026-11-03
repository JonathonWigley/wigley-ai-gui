# 02 — Chat main owns and saves the clock

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` ·
           modify `src/plugins/chat/main/open-sessions.ts` · modify `src/plugins/chat/main/preview/chat-preview.ts` ·
           test `src/plugins/chat/main/chat-sessions.test.ts` · test `src/plugins/chat/main/open-sessions.test.ts` ·
           modify every test fixture that builds a `ChatSessionState` literal (the compiler lists them)
Consumes:  `ActiveTime`, `NO_ACTIVE_TIME`, `startActiveTime`, `stopActiveTime`, `activeMsAt` ← 01
Produces:  in `src/plugins/chat/contract.ts`:
           `activeTime: ActiveTime` on `interface ChatSessionState`
           `activeTime: { sessionId: string; activeTime: ActiveTime }` on `ChatChannel['messages']`
           in `src/plugins/chat/main/open-sessions.ts`:
           `activeMs: number` on `interface SavedSession`
Decisions: the clock runs while `activity === 'working'` or `background > 0` (round 1) · saved with the session; a
           history resume starts at 0 (round 1) · save on each clock start and stop, and once in `killAll` (Decided) ·
           a stored session without `activeMs` reads as 0, as `titles` does today (Decided)

Changes in `chat-sessions.ts`:

- Add a private helper that reads whether a held session is active: `session.state.activity === 'working' ||
  session.state.background > 0`. This is the same rule `rowActivity` in `src/plugins/chat/page/chat-state.ts` uses
  for the `working` row activity.
- Add one function that runs after every change to `state.activity` or `state.background`: `updateActivity`,
  `showRestingIdle` and `sendBackground` each call it after they set their field and after they send their own
  `activity` or `background` message. It starts or stops `state.activeTime` at `deps.clock.now()`. When the record
  changes, it sends the `activeTime` message and calls `save()`. When the record does not change, it does nothing.
- `since` is epoch ms. Chat main's `deps.clock` and the page's `services.clock` both read the same wall clock, so
  the page computes `activeMsAt(time, pageNow)` from a `since` main wrote.
- `openRow`'s `opening` argument gains `activeMs: number`. `openRow` builds `activeTime: { totalMs:
  opening.activeMs, since: null }` before it sends `sessionStarted`, so the page gets the total in that message.
  Every caller passes 0, except `restore`, which passes `saved.activeMs`. A session opened through `resume` (the
  history picker) passes 0.
- `savedSessionOf` writes `activeMs: activeMsAt(session.state.activeTime, now)`: the total at the save, the open
  span included. Pass `now` from `snapshot()`, which reads `deps.clock.now()` once per snapshot.
- `clear(sessionId)` (`/clear`) resets the clock: after `endForClear` stops it, `clear` sets `state.activeTime` to
  `NO_ACTIVE_TIME`, sends the `activeTime` message and saves. The run time describes the conversation in the row,
  and `/clear` starts a new one (round 3).
- `chat-preview.ts` builds its sample state with `activeTime: NO_ACTIVE_TIME`.
- Add a doc comment to `ChatSessionState.activeTime` and `SavedSession.activeMs` stating these rules.
- `killAll` calls `save()` once before it sets `isKilled = true`. The save is not awaited; a save that does not land
  before the process ends keeps the last saved total.

Changes in `open-sessions.ts`:

- `StoredSession` makes `activeMs` optional, as it does `titles` (`Omit<SavedSession, 'titles' | 'activeMs'>`). The type check accepts a missing `activeMs` or a
  finite number of 0 or more. The read maps a missing `activeMs` to 0.

GIVEN a working turn from t=1000 WHEN the turn goes `waiting` at t=4000 THEN the session's `activeTime` is
`{ totalMs: 3000, since: null }` and one `activeTime` message is sent at each change
GIVEN a turn working from t=1000 that goes `idle` at t=5000 while `background` is 1 WHEN the background drops to 0
at t=9000 THEN the sent records are `{ totalMs: 0, since: 1000 }` then `{ totalMs: 8000, since: null }`
GIVEN a session with `activeTime` `{ totalMs: 30000, since: null }` WHEN the user runs `/clear` THEN the last sent
record is `{ totalMs: 0, since: null }` and the saved `activeMs` is 0
GIVEN a saved session with `activeMs: 42000` WHEN chat restores it THEN its `sessionStarted` message carries
`activeTime: { totalMs: 42000, since: null }`

Tests:     in `chat-sessions.test.ts`, `setUp`'s clock becomes settable: a `now` the test assigns, defaulting to
           `options.clockNow ?? 1000`, so existing tests keep their results. One `it.each` table over a sequence of
           (time, harness activity or background) steps, asserting the exact list of sent `activeTime` records:
           working 1000 → idle 4000 gives `{0, 1000}`, `{3000, null}`; working 1000 → waiting 4000 gives the same;
           the GIVEN above; waiting with background 1 from 2000 → background 0 at 6000 gives `{0, 2000}`,
           `{4000, null}`. One test that a restored session's `sessionStarted` carries its saved total, and one
           that the snapshot saved at a stop carries `activeMs` equal to the stopped total. One test for the
           `/clear` GIVEN, beside the existing `clear` tests. Add a row to the existing
           `open-sessions.test.ts` read table: a stored session without `activeMs` reads as 0.
Done when: compiles; `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

