# 02 — Presenter releases the session on close

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent-forms.ts` · modify `src/shared/agent-forms/channel-presenter.ts` ·
           modify `src/shared/agent-forms/drive-actions.ts` · test `src/shared/agent-forms/channel-presenter.test.ts`
Consumes:  `release(sessionId: string): void` on `SessionsMainExports` ← 01
Produces:  `release(sessionId: string): void` on `AgentFormSessions` in `src/contracts/agent-forms.ts`
Decisions:
- `AgentFormSessions` gains `release`. Forms and primer already hand the presenter the whole `SessionsMainExports`,
  which satisfies it after 01; their `start.ts` files need no edit.
- The presenter's `close(formId)`: after `open.delete(formId)`, the `formClosed` send and the count update, call
  `sessions.release(entry.form.sessionId)`. Its own close guard then allows, since the form is gone; another open
  form in the same session (this type's or the other type's) keeps the row through its guard. Quiet forms release
  too. A `formId` not open does nothing, as now.
- Update the presenter's doc comment: each form marked on its session's row, the row kept while the form is open
  and released when it closes.
- `drive-actions.ts`: the `AgentFormDriveSessions.connect` comment becomes `Connects a session for the host session
  id, with no row until a form shows, or joins the owned session holding it.` No code change.
GIVEN an open form WHEN the page finishes it (submit or cancel) THEN `release` is called once with its session id, after `formClosed` is sent
GIVEN an open form WHEN main closes it THEN `release` is called once with its session id
GIVEN a form id not open WHEN close runs THEN `release` is not called
Tests:
- The test's `AgentFormSessions` fake records `release` calls.
- `ends a form the page finishes and drops what arrives after` and `closes an open form on the page, not by its
  finish, and ignores a form already gone` each assert the release calls (one, with the session id; none for the
  form already gone). No new test: these two own the close behaviour.
Done when: compiles; the test gate runs `src/shared/agent-forms/channel-presenter.test.ts`
Commit:    one commit for the group

## Proof

Commit def3f45 · proof: diff read: release on AgentFormSessions present, presenter close releases after formClosed; worker typecheck clean; presenter test 12 pass; tree-wide typecheck re-run after 03 lands · concerns: none; presenter doc comment line runs past the file's width
