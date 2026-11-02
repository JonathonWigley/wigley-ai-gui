# 02 — Owned session host id change

Status: done
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/main/session-list.ts` · modify `src/plugins/sessions/page/tabs.ts` · modify `src/plugins/sessions/page/start.ts` · test `src/plugins/sessions/main/session-list.test.ts` · test the `rowChanges` test beside `tabs.ts`
Consumes:  `OwnedSession`, `SessionsMainEvents`, `SessionRow` (in the tree)
Produces:  `setHostSessionId(hostSessionId: string): void` on `export interface OwnedSession` in `src/plugins/sessions/contract.ts`
           `hostSessionChanged: AgentSession` on `export interface SessionsMainEvents` in `src/plugins/sessions/contract.ts`
           `sessionHostChanged: { sessionId: string; hostSessionId: string | null }` on `export interface SessionsPageEvents` in `src/plugins/sessions/contract.ts`
           `rowChanges` also returns `changed: SessionRow[]` in `src/plugins/sessions/page/tabs.ts`
Decisions: the row keeps its app id, place and tabs while its host id changes (design review) · an event any plugin can hook, not a mutated `info` read later (design review) · page holders follow too (plan reader gap, Decided as adjacent work)

- `setHostSessionId` on the owned session's handle: throws naming both ids when another session (owned or
  connected) already holds `hostSessionId`; does nothing after the session ended. Otherwise it replaces the
  entry's `session.info` with a copy carrying the new `sessionId` (the `AgentSession` object keeps its identity, so
  tool sessions started with it read the new info), updates the row's `hostSessionId`, sends the state, logs
  `owned session <app id> now host <new id>`, and emits `hostSessionChanged` with the `AgentSession`.
- A relay `connect` carrying the new id joins the owned entry; one carrying the old id no longer does (it gets its
  own row, as any unknown id does). A relay already joined keeps its join.
- `open` and `connect` lookups (`entriesHolding`) read the current info, so no other change is needed there.
- Contract comments: `SessionRow` says `hostSessionId` is fixed at connect — now "at connect, or changed by the
  owner through `setHostSessionId`". `SessionsMainEvents`' comment gains one line for `hostSessionChanged`.
- Page side, so page holders of the host id follow it (the notes page caches it from `sessionAdded`, task 04):
  `rowChanges(before, after)` also returns `changed` — rows present in both whose `hostSessionId` differs, in
  `after`'s order. The page's state handler (`page/start.ts`, where it calls `rowChanges`) emits
  `sessions.sessionHostChanged` once per changed row, after the `sessionAdded`/`sessionRemoved` events of the same
  state. `SessionsPageEvents`' comment gains its line.

GIVEN an owned session opened with host id `a` WHEN `setHostSessionId('b')` runs THEN the state's row has `hostSessionId: 'b'`, a relay connecting with `b` joins it (no new row), a relay connecting with `a` adds a row, and `hostSessionChanged` was emitted once with the session whose `info.sessionId` is `b`
GIVEN two owned sessions `a` and `b` WHEN the first calls `setHostSessionId('b')` THEN it throws and nothing changes

Tests:     `setHostSessionId_MovesRowAndJoinToNewId` — the first GIVEN, asserting row, joins, emitted event.
           `setHostSessionId_IdHeldElsewhere_ThrowsAndChangesNothing` — the second.
           `rowChanges lists added rows in their order and removed ids` (`tabs.test.ts`) — extended to assert `changed` holds a kept row whose `hostSessionId` moved and not a kept row that did not.
Done when: compiles; the test gate runs the tests above and `session-list.test.ts`'s join tests.
Commit:    one commit for the group

## Proof

Commit d79c347 + fmt f12ceae · proof: diff read: setHostSessionId, hostSessionChanged, sessionHostChanged, rowChanges.changed present; typecheck and lint clean; 609 wave-1 tests pass · concerns: chat-sessions.test.ts OwnedSession double (task 01's file) needed setHostSessionId, added by 01's worker on the lead's note; worker ran npx --version once (nothing installed)
