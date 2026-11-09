# 01b — docs and workflow follow a relocated row

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/main/start.ts` · modify `src/plugins/workflow/main/start.ts` ·
           test `src/plugins/docs/main/start.test.ts` · test `src/plugins/workflow/main/start.test.ts`
Consumes:  `SessionsMainEvents.relocated: AgentSession` (01)
Produces:  nothing another task reads
Decisions: two plugins copy a session's `info.projectDir` when `sessions.connected` fires, and a pool project's row
           connects in the placeholder clone before chat relocates it (task 03); each re-reads the folder on
           `sessions.relocated`, the way each already re-reads the host id on `sessions.hostSessionChanged`

Read `docs/features/projects/design.md` § Pool projects and the `relocated` comment in
`src/plugins/sessions/contract.ts` (task 01) first.

## Changes

- **docs** (`src/plugins/docs/main/start.ts`, beside the `sessions.hostSessionChanged` listener): on
  `sessions.relocated`, dispose the row's session source and add it again from the event's session — the same body
  the `hostSessionChanged` listener runs. Share that body as one named local (`replaceSessionSource`) both listeners
  call, rather than a second copy. A row with no source does nothing.
- **workflow** (`src/plugins/workflow/main/start.ts`, beside its `sessions.connected` listener): on
  `sessions.relocated`, after `ready`, overwrite the `connected` entry for the row's id with the event's
  `{ hostSessionId: info.sessionId, projectDir: info.projectDir }`, under the same non-null check the connected
  listener uses. Share the check-and-set as one named local both listeners call.

## Tests

- `src/plugins/docs/main/start.test.ts` — a row to the test that pins the `hostSessionChanged` rebuild
  (`docs.emit('sessions.hostSessionChanged', …)` near line 325, measured at plan time): the same arrangement driven
  by `sessions.relocated` with `info.projectDir` changed from `/p` to `/q`; the rebuilt session source reads the new
  folder (a doc path under `/q` resolves, one under `/p` does not). Break caught: the listener missing, or re-adding
  from the stale copy.
- `src/plugins/workflow/main/start.test.ts` — one test: `sessions.connected` for `s1` in `/old`, then
  `sessions.relocated` for `s1` in `/new`, then `chat.sessionOpened` for `s1`; the flow opens with `projectDir`
  `/new`. Follow the file's `session(...)` helper and `workflow.emit` shape. Break caught: the opened flow keeping
  the placeholder folder.

Done when: `npm run typecheck`, `npm run lint` and the two test files pass.
Commit:    `docs and workflow re-read a session's folder when its owner relocates it`.

## Proof
