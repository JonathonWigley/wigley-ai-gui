# 06 — Forms and primer set needs you

Status: not started
Type: Task
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/shared/page/session-form-tabs.ts` · modify `src/plugins/forms/page/forms-view.ts` · modify `src/plugins/primer/page/primer-view.ts` · modify each of their page `start.ts` files only if the deps are built there · test `src/shared/page/session-form-tabs.test.ts`
Consumes:  `SessionsPageExports.setActivity`, `NEEDS_YOU_ACTIVITY` ← 03
Produces:  `SessionFormTabsDeps.formShown(sessionId: string, shown: boolean): void` in `src/shared/page/session-form-tabs.ts` (`src/shared/page` may not import a plugin contract, so the helper says only whether a form shows)
Decisions:
- `FormTab` gains a `shown: boolean` (false at mount). `sync(statusOf)` sets it from `statusOf(sessionId) !== null` — not from the status text, which can be `''` while a form shows — and calls `formShown(sessionId, shown)` only when it changed.
- Forms and primer each pass `formShown: (id, shown) => sessions.setActivity(id, '<plugin id>', shown ? NEEDS_YOU_ACTIVITY : null)` (`'forms'`, `'primer'`), so the two never overwrite each other's; their views' `sessions` Picks gain `'setActivity'`. That wiring is checked by the compiler.
- The status line `sync` sends stays as it is.
- `forget(sessionId)` needs no activity call: sessions drops the row's activities with the row.
GIVEN a session's tab with no form WHEN `sync` sees a form for it THEN `formShown` is called once with true
GIVEN a form showing WHEN `sync` runs again with the form still showing THEN `formShown` is not called again
GIVEN a form showing WHEN its form closes and `sync` runs THEN `formShown` is called with false
Tests:     `session-form-tabs.test.ts` — add rows to the `sync` test with exact call lists: form appears in `s1` → `[['s1', true]]`; unchanged → `[]`; form gone → `[['s1', false]]`; a form whose status is `''` → `[['s1', true]]`; the status line calls unchanged.
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof
