# 04 — Docs source and notes follow the host id

Status: done
Type: Batch
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/main/start.ts` · modify `src/plugins/notes/page/start.ts` · test `src/plugins/docs/main/start.test.ts`
Consumes:  `hostSessionChanged: AgentSession` ← 02 · `sessionHostChanged: { sessionId: string; hostSessionId: string | null }` ← 02
Produces:  a `sessions.hostSessionChanged` listener in `src/plugins/docs/main/start.ts`
           a `sessions.sessionHostChanged` listener in `src/plugins/notes/page/start.ts`
Decisions: each holder of a row's host id hooks the event (design review; notes from the plan reader, Decided as adjacent work)

- Docs main: today `sessions.connected` builds a `SessionSourceSpec` from `info` once and registers the source in
  `sessionSources` keyed by the row id. On `sessions.hostSessionChanged` for a row in `sessionSources`, dispose its
  source and register a new one built the same way from the event's `info`, under the same source id. A row not in
  `sessionSources` is ignored. Share the build-and-register code between both listeners (one helper). The new
  source sits in `sessionSources`, so the existing dispose loop covers it.
- Notes page: on `sessions.sessionHostChanged` for a row in `rows`, replace that `NoteSession`'s `hostSessionId`
  (a null host id deletes the row, as `sessionAdded` never stores one). Log as `sessionAdded` does:
  `session <hostSessionId> listed`.

GIVEN a connected session with host id `a` WHEN `hostSessionChanged` arrives with `info.sessionId` `b` THEN the row's session source loads by running the index script's `session` command with `b`

Tests:     `sessionSource_HostSessionChanged_LoadsNewId` — beside `sessionSource_RegisteredWhileConnected`, using its fakes.
           Notes: none new (a map update the self-test or drive covers; no notes page test file exists to hold it).
Done when: compiles; the test gate runs the test above and `sessionSource_RegisteredWhileConnected`.
Commit:    one commit for the group

## Proof

Commit cb04f23 · proof: diff read: both listeners present; worker's typecheck and lint clean; docs start.test.ts 21 pass incl. sessionSource_HostSessionChanged_LoadsNewId · concerns: a notes row added with a null host id that later gains one stays out of the notes list (event lacks harness/projectDir to rebuild it)
