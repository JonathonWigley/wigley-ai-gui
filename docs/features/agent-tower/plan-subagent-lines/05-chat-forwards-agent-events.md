# 05 — Chat forwards agent events

Status: done
Type: Batch
Wave: 2 · Depends on: 02 (precondition: the usage plan `docs/features/usage/plan-usage/` has landed; its task 04, `04-chat-forwarding.md`, already emits `chat.agentEvent`)
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` · any listener of `chat.agentEvent` the compiler names (expected: none needs a change, since the field is added)
Consumes:  `AgentEvent` (widened) ← 02
           `ChatMainEvents` with `agentEvent: { sessionId: string; profileDir: string | null; event: AgentEvent }`, chat main's `emit` dep, and the forwarding in `processEvents` ← the usage plan's task 04 (in the tree)
Produces:  in `src/plugins/chat/contract.ts`:
           `export interface ChatAgentEvent { sessionId: string; profileDir: string | null; hostSessionId: string; event: AgentEvent }`
           `ChatMainEvents.agentEvent: ChatAgentEvent` (the usage plan's inline payload, named and widened)
           the bus event `chat.agentEvent` carrying `hostSessionId`
Decisions: **widen, don't rebuild** (lead's ruling): the usage plan already types chat's bus events, passes chat main an `emit`, and forwards each owned session's agent events. This task adds `hostSessionId: string`, the harness's session id (`session.hostId`), to the payload. The agents log is keyed by it (plan.md Decided). It also names the payload `ChatAgentEvent` so the agents plugin imports one type. `sessionId` (the sessions row id) and `profileDir` stay as the usage plan set them. Comment above `ChatAgentEvent`: `sessionId` is the sessions plugin's row id, `hostSessionId` the harness's session id, which a resumed session keeps
           **forwarding after the row is gone**: a closed row's process still ends after the row drops, and its `sessionEnded` must reach the agents plugin, to empty that session's roster and close its log. Read the usage plan's forwarding in `processEvents`:
           - if it forwards under the `isLive` guard, as `entry` does, keep the guard for every event except `sessionEnded`, which is forwarded whatever the guard says. Late `usage` from a closed session then still never reaches the usage plugin, which drops a session when it closes
           - if it has no guard, change nothing here
           State in the Proof which case held. The event object is passed through unchanged; chat never builds, reorders or drops one beyond that guard
           **boundary**: chat names no Claude field (plan.md Boundary rules); it only passes the record on
GIVEN a started session whose row is `row-1` with host id `uuid-1` WHEN its fake process calls `agentEvent` with a `toolStarted` THEN the emitter records `agentEvent` with `{ sessionId: 'row-1', profileDir: <the profile's dir>, hostSessionId: 'uuid-1', event }`, the same event object
GIVEN that session closed (row dropped) WHEN its process then calls `agentEvent` with `sessionEnded` THEN the emitter still records it with the same ids
Tests:     `chat-sessions.test.ts`: find the usage plan's test that owns forwarding (it records the `emit` dep's calls). Add `hostSessionId` to its expected payload, and make it an `it.each` `agentEvent_$case_ReachesTheBusWithBothIds` with rows `running` (first GIVEN) and `after close` (second GIVEN, closing through `chat.closed(ROW_ID)` before the call). The `running` row catches a missing or wrong `hostSessionId`. The `after close` row catches a liveness guard that drops `sessionEnded`
Done when: compiles; the test gate runs `chat-sessions.test.ts`; `npm run lint` passes
Commit:    one commit for the group

## Proof

Commit 30227b4 · proof: diff read: ChatAgentEvent and ChatMainEvents.agentEvent present, hostSessionId = session.hostId; typecheck clean; worker ran chat-sessions.test.ts (102 pass) and lint · concerns: usage/main/start.test.ts sends chat.agentEvent payloads without hostSessionId (loosely typed emit, outside Files); describe block still named 'usage forwarding'
