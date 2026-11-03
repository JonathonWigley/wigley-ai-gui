# 04 — Chat reads a restored row's saved usage

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
Consumes:  `AgentHarness.lastUsage(sessionId, projectDir, profileDir)` ← 01; the fake harness's scriptable `lastUsage` ← 01
Produces:  `restoreRecord` emitting a restored row's saved usage as its `agentEvent`
Decisions:
- In `restoreRecord`, after the row opens: when `record.sent` and the profile is found, call
  `harness.lastUsage(hostSessionId, record.projectDir, profileDirOf(profile))` (the chat harness, as `requireHarness`
  finds it). A non-null result is emitted through `deps.emit('agentEvent', { sessionId, profileDir, hostSessionId, event })`.
  A result that settles after the row closed or its host id changed (the `isClosedOrCleared` check `prependHistory`
  uses) emits nothing.
- A rejection logs `chat` `saved usage of <hostId> not read: <reason>` and emits nothing; the row keeps the zero line.
- Only restore reads it: a resume or a send on a resting row starts a process, which seeds itself (01).
GIVEN a saved sent session WHEN chat restores it THEN chat emits its `lastUsage` result as that row's `agentEvent`
GIVEN a restored row closed before its read resolves WHEN the read resolves THEN nothing is emitted
Tests:     `chat-sessions.test.ts`: restore emits the scripted usage for a sent record and reads nothing for an unsent one (table rows); a read resolving after close emits nothing; a rejecting read logs and emits nothing
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof

