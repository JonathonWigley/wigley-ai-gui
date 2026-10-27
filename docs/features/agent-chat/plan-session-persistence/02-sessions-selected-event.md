# 02 — Sessions selected event

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/main/session-list.ts` ·
           test `src/plugins/sessions/main/session-list.test.ts`
Consumes:  nothing
Produces:  `selected: { sessionId: string | null }` in `SessionsMainEvents`, `src/plugins/sessions/contract.ts`
Decisions: a generic event in the sessions plugin, which knows no harness, so chat saves the selected row without
           polling (design review: chat owns persistence, sessions stays generic)

Behaviour:

- `session-list.ts` emits `selected` with the new `selectedSessionId` every time that value changes, after the state
  it changed is sent: `open` with `select` true, `activate` of another row, `mark` selecting a row when none was
  selected, a close or an end of the selected row moving the selection to a neighbour or to null.
- It emits nothing when the value stays the same: `activate` of the selected row (even one that was marked),
  `open` with `select` false, a close of an unselected row.
- Put the comparison in one place (the `select` helper or a wrapper both `select` call sites and `removeRow` share),
  so a future selection change cannot forget the event.
- The event's doc comment in the contract states when it fires, in the style of `closed`'s.

GIVEN rows a (selected) and b WHEN the user closes a THEN `selected` fires once with b's id.

Tests:     `selected_SelectionChanges_EmitsOncePerChange` — table over the cases above: each row lists the
           actions and the exact `selected` payloads expected (an empty list for the no-change rows), asserting the
           emit fake's recorded `selected` calls
Done when: compiles; the test gate runs the test above and `session-list.test.ts` as a whole
Commit:    one commit for the group

## Proof
