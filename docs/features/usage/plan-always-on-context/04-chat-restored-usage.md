# 04 — Chat reads a restored row's saved usage

Status: in progress
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
Consumes:  `AgentHarness.lastUsage(sessionId, projectDir, profileDir)` ← 01
           `FakeAgentHarness.setLastUsage`, `failNextLastUsage`, `holdNextLastUsage`, `lastUsageCalls` ← 01
Produces:  `restoreRecord` emitting a restored row's saved usage as its `agentEvent`
Decisions:
- In `restoreRecord`, after the row opens, when `record.sent` and the profile is found: start
  `harness.lastUsage(hostSessionId, record.projectDir, profileDirOf(profile))` (the harness `requireHarness` returns)
  as a fire-and-forget read, so `restore` stays synchronous.
- On a non-null result, emit `deps.emit('agentEvent', { sessionId: session.state.sessionId, profileDir:
  profileDirOf(profile), hostSessionId, event })`: the row id as `sessionId`, which the usage store keys by.
- A result that settles after the row closed or its host id changed emits nothing. `prependHistory`'s inline
  `isClosedOrCleared` expression is extracted into one local function, `isClosedOrCleared(session, sessionId, hostId)`,
  which both callers use. `killAll` sets `isKilled` but leaves rows held, so the restore read also emits nothing once
  `isKilled` is true.
- A rejection logs `chat` `saved usage of <hostId> not read: <reason>` and emits nothing; the row keeps the zero line.
- Only restore reads it: a resume, or a send on a resting row, starts a process, which seeds itself (01).
GIVEN a saved sent session WHEN chat restores it THEN chat emits its `lastUsage` result as that row's `agentEvent`, keyed by the row id
GIVEN an unsent saved session WHEN chat restores it THEN `lastUsage` is not called
GIVEN a restored row closed before its read resolves WHEN the read resolves THEN nothing is emitted
Tests:     `chat-sessions.test.ts`: a restore table — sent record with a scripted event → one `agentEvent` with the row id and that event; unsent record → `lastUsageCalls` empty; scripted null → no event. Separate cases: a held read released after the row closes emits nothing; a `failNextLastUsage` read logs and emits nothing
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof

