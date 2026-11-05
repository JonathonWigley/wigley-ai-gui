# 01 — Sessions: the owned flag and the title rule

Status: done
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/session-title.ts` · modify `src/plugins/sessions/page/rename-dialog.ts` · modify `src/plugins/sessions/main/session-list.ts` · test `src/plugins/sessions/session-title.test.ts` · test `src/plugins/sessions/main/session-list.test.ts` · test fixtures that emit `sessions.connected`: `src/plugins/primer/main/start.test.ts`, `src/plugins/forms/main/start.test.ts`, `src/plugins/docs/main/start.test.ts`, `src/plugins/sessions/main/start.test.ts`, `src/plugins/workflow/main/start.test.ts`
Consumes:  none
Produces:  `export function editableTitle(titles: SessionTitles): string` in `src/plugins/sessions/contract.ts`
           `export interface ConnectedSessionEvent extends AgentSession { owned: boolean }` in `src/plugins/sessions/contract.ts`
           `connected: ConnectedSessionEvent` in `SessionsMainEvents`
Decisions: the flag sits on the event payload only, so `AgentSession` and its constructors stay as they are · `editableTitle` moves unchanged, because `session-log` may import only the contract (`wigley:writing-code`: a helper is widened, never copied)

- `session-list.ts` emits `connected` in `connect` and `open`. After this task, `connect` emits `owned: false`, and `open` emits `owned: true`. Both spread `entry.session`.
- Every `editableTitle` import moves to the contract. `session-title.ts` keeps the other title rules.

GIVEN a relay connects WHEN `connected` fires THEN `owned` is false
GIVEN a plugin calls `open` WHEN `connected` fires THEN `owned` is true
Tests:     add a table test in `session-list.test.ts`, `connected_ConnectAndOpen_SayIfOwned`: connect gives false, open gives true. The `editableTitle` test stays in `session-title.test.ts` and imports from the contract.
Done when: compiles; lint passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 2ca6ca8b · proof: diff read; typecheck and lint pass · concerns: Files line named primer, forms and sessions start.test.ts as connected emitters, but they emit none and stayed unedited; connected payload is now a shallow copy, its listeners read only id and info; connected_ConnectAndOpen_SayIfOwned overlaps three existing connected assertions
