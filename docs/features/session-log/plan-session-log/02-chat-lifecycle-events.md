# 02 — Chat lifecycle events

Status: in progress
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` · test `src/plugins/chat/main/start.test.ts` · test fixtures `src/plugins/usage/main/start.test.ts`, `src/plugins/workflow/main/start.test.ts`
Consumes:  none from other tasks; `sessions.titles` is in the tree
Produces:  `SessionOrigin`, `SessionCloseReason`, `ProcessEndReason` in `src/plugins/chat/contract.ts`, as `plan.md` § File Structure writes them
           the `ChatMainEvents` members `sessionOpened`, `sessionClosed`, `sessionCleared`, `processEnded`, `sessionArchived` in `src/plugins/chat/contract.ts`, as `plan.md` writes them
           `closed(sessionId: string, reason: SessionCloseReason): void` on `ChatSessions` in `src/plugins/chat/main/chat-sessions.ts`
Decisions: chat fires its own close event, because `sessions.closed` reaches a later listener after a resting row's titles are gone, and misses `closeSessionsIn` · `sessionOpened` grows in place, because its listeners destructure it · no event fires on a replay

Each event, its place and its values:

- **`sessionOpened`**: `openRow` fires it where it fires today, with the same `profileDir !== null` guard. `openRow`'s opening gains `origin: SessionOrigin`.
  - `start` and drive `chat.start` pass `new`.
  - `launch` passes `launched`. `startNew` gets the origin from its caller.
  - `resume` passes `resumed` on both paths: `openAndStart` and `openAndAttach`.
  - `restoreRecord` passes `restored`.
  - An `activateRowOf` hit opens no row and fires nothing.
- **`sessionClosed`**: `closed` fires it first, before `drop`, with `sessions.titles(sessionId) ?? NO_TITLES`. A session chat does not hold fires nothing.
  - `start.ts`'s `sessions.closed` listener passes `user`.
  - `start.ts`'s drive `start` activate failure passes `start-failed`.
  - `closeSessionsIn` passes `project-closed`.
- **`openAndStart`'s failed start**: its catch fires `sessionClosed` with reason `start-failed`, before its `drop`.
- **`sessionCleared`**: `clear` fires it after `session.hostId = newHostId`. `sent` holds the value `session.sent` had before `clear` set it to false. `titles` is `sessions.titles(sessionId) ?? NO_TITLES`, read where the event fires. It fires before `startProcess`, so a failed restart still logs the clear.
- **`processEnded`**: the process `ended` callback fires it after the `isLive` guard, when `replay.isReplaying` is false. `hostSessionId` is the host id captured at the process start.
  - `session.isStopRequested` gives `stopped`.
  - Else `code === 0` and a null `error` give `clean`.
  - Else the reason is `crash`.
- **`sessionArchived`**: `setArchived` fires it after `deps.archived.set` resolves. A rejected write fires nothing, and the rejection reaches the caller as it does today.

GIVEN each of a new start, a launch, a resume and a restore WHEN the row opens THEN `sessionOpened` carries `new`, `launched`, `resumed`, `restored`, the host id, the folder and the profile name
GIVEN a resting row with an agent title WHEN `closed` runs THEN `sessionClosed` carries that title and `sent`, and fires before `sessions.ended`
GIVEN a row is restored and the app then stops WHEN `detachAll` runs THEN no `sessionClosed` fires
GIVEN a sent row WHEN `clear` runs THEN `sessionCleared` carries both host ids and `sent: true`
GIVEN each of a stop, an exit with code 0 and an exit with code 1 WHEN `ended` runs THEN `processEnded` carries `stopped`, `clean`, `crash`
GIVEN a re-attach replay WHEN `ended` runs during it THEN `processEnded` does not fire
GIVEN a failed start WHEN the catch runs THEN `sessionClosed` carries `start-failed`
GIVEN the user closes a row WHEN `sessions.closed` reaches chat THEN `sessionClosed` carries `user`
GIVEN a drive `chat.start` whose activate fails WHEN chat closes the row THEN `sessionClosed` carries `start-failed`
GIVEN a rejected archive write WHEN `setArchived` runs THEN `sessionArchived` does not fire
Tests:     add `describe('createChatSessions lifecycle events')` to `chat-sessions.test.ts`, with a table per event: `sessionOpened_EachPath_CarriesOrigin` (rows for `resume` by a fresh start and by a re-attach), `sessionClosed_RestingRow_CarriesTitlesBeforeEnded`, `sessionCleared_SentRow_CarriesBothIds`, `processEnded_EachExit_CarriesReason`, `processEnded_DuringReplay_FiresNothing`, `sessionClosed_FailedStart_SaysStartFailed`, `sessionArchived_AfterWrite_Fires` (a row for the rejected write). Add `sessionsClosed_UserClose_SaysUser`, `driveStart_ActivateFails_SaysStartFailed`, `exports_CloseSessionsIn_ClosesWithProjectClosed` and `stop_HeldRows_FiresNoSessionClosed` to `start.test.ts`.
Done when: compiles; lint passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

