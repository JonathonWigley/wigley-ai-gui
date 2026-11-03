# 02 — Drive: `chat.start` returns the session's host id

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Why: 05 opens a round in a chat-owned session with `forms.openRound` / `primer.openPrimer`. Those actions take the
session's **host** id, and join the owned row only when that id matches it (`sessions` `connect` →
`entriesHolding(hostId)`). `chat.start` returns only the row id today, and a chat session's host id is a random
UUID no drive action exposes. Without this task, 05's round lands in a new non-owned row and no wake is sent.

Files:     modify `src/plugins/chat/main/chat-sessions.ts` · modify `src/plugins/chat/main/start.ts` ·
           test `src/plugins/chat/main/chat-sessions.test.ts` · modify `.agents/skills/drive/SKILL.md` only where it
           states `chat.start`'s result
Consumes:  `HeldSession.hostId` (tree, `chat-sessions.ts`)
Produces:  `ChatSessions.hostSessionIdOf(sessionId: string): string | null` in `src/plugins/chat/main/chat-sessions.ts`:
           the held session's current `hostId`, null for a row chat does not hold
           `chat.start` drive result `{ sessionId: string; hostSessionId: string }` in `src/plugins/chat/main/start.ts`

Decisions:
- `addDriveActions`' `ChatDriveDeps.chat` `Pick` gains `'hostSessionIdOf'`. `start.run` returns
  `{ sessionId, hostSessionId }`; a null there (it cannot be null right after `start`) throws
  `chat started ${sessionId} but holds no host id for it`.
- The action's `description` string gains: `Returns { sessionId, hostSessionId }: hostSessionId is the id forms.openRound and primer.openPrimer take to open a form in this session.`
- After a `clear`, `hostSessionIdOf` returns the new host id (it reads the held session's live `hostId`).

GIVEN a session chat started WHEN hostSessionIdOf reads its row THEN it returns that session's host id
GIVEN a row id chat does not hold WHEN hostSessionIdOf reads it THEN it returns null
Tests:     `chat-sessions.test.ts`: one `it.each` over the two GIVENs, following the file's existing setup. The started row's
           expected host id is the value the test's fake `randomUuid` hands out, written literally.
Done when: `npm run typecheck` passes; the test gate runs the new rows.
Commit:    one commit for the group

## Proof

