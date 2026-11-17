# 08 — Primer restores a review cursor in range

Status: not started
Type: Task
Rung: standard · a reducer-only clamp through the existing `moveReviewRow` helper in `src/plugins/primer/page/primer-state.ts`
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md` L926, "Primer `placeRestored` may restore a stale review cursor".

Files:     modify `src/plugins/primer/page/primer-state.ts` · test `src/plugins/primer/page/primer-state.test.ts`

Preconditions (checked 2026-11-17 on `main` 9b671bd16, from the `wigley-ai-gui/` folder):

| Claim | Command | Expected |
|---|---|---|
| `restorePlace` never touches `reviewRow` | `sed -n 317,338p src/plugins/primer/page/primer-state.ts \| grep -c reviewRow` | `0` |
| `moveReviewRow` clamps the cursor to the review's rows | `grep -n "function moveReviewRow" src/plugins/primer/page/primer-state.ts` | one line, near 573 |
| The review draws its cursor by `row === primer.reviewRow` | `grep -n "row === primer.reviewRow" src/plugins/primer/page/primer-review.ts` | one line, near 59 |

Trace (why the bug is latent): `restorePrimer` opens every primer with `reviewRow: 0`, and `followSessionFormPlaces`
(`src/shared/page/session-form-places.ts`) restores a place only into a primer that was not yet active, so every
restore the page makes today meets a cursor of 0. The reducer itself does not hold the rule: a primer that left the
review by `reviewJump` keeps its old `reviewRow`, `removeExtraTask` can then shrink the review's rows, and a
`placeRestored` with `view: 'review'` puts the view back with the cursor past the last row. There the review draws no
cursor row and `reviewJump` does nothing (`reviewEntries(primer)[primer.reviewRow]` is undefined).

Consumes:  nothing from another task
Produces:  no new export. `restorePlace` (private, `primer-state.ts`) also clamps `reviewRow` into the review's rows.

Decisions:
- Clamp, not reset. `PrimerPlace` carries no review row, so the restore has nothing to put back; it keeps the
  primer's cursor and only pulls it into range, which changes nothing on any path the page reaches today. Resetting
  to 0 would move a cursor that is in range.
- Inside `restorePlace`'s `updateForm` callback, run the restored primer through `moveReviewRow(primer, (row) => row)`
  (it clamps to `[0, max(reviewEntries(primer).length - 1, 0)]` and returns the same object when nothing moves). The
  clamp applies whatever `place.view` is, so a primer restored into view `primer` also holds a cursor in range for
  its next restore into the review.
- `isSamePlace` gains `a.reviewRow === b.reviewRow`, so a restore whose place is unchanged but whose cursor clamps
  keeps the clamp, and a restore that moves nothing still returns the same primer object (the existing identity rule
  of the reducer).

GIVEN a primer that reviewed to its last row (2 of `1`, `s1`, `extra-1`), jumped back to `extra-1` and removed it
WHEN `placeRestored` puts it back in view `review`
THEN `reviewRow` is 1, the review's last row, and `reviewJump` selects task `s1`.

GIVEN a restore whose place and cursor are already in range WHEN `placeRestored` runs THEN the primer object is the
same one (`===`), as today.

Tests:     one new `it` in `describe('placeRestored')` of `primer-state.test.ts`, named
           `'clamps a review cursor the removed tasks left past the last row'`:
           build `stateWith()`, then `applyAll` with `{ type: 'openReview' }`, `{ type: 'reviewBottom' }`,
           `{ type: 'reviewJump' }`, `{ type: 'removeExtraTask' }`; assert the setup holds `reviewRow` 2 with two review
           rows left (`primerOf(state).reviewRow === 2`); then apply
           `{ type: 'placeRestored', formId: 'p1', place: { selectedTask: { kind: 'feature' }, selectedItem: null,
           pane: 'tasks', cardColumn: 'tasks', view: 'review', confirmReturnView: 'review' } }` and assert
           `restored.view === 'review'`, `primerOf(restored).reviewRow === 1`, and that
           `apply(restored, { type: 'reviewJump' })` selects `{ kind: 'task', entryId: 's1' }`.
           Two more `it`s in the same `describe`:
           - `'clamps the cursor when the restored place matches the primer's own'`: the same setup, then
             `placeRestored` with `place: primerPlace(state, primerOf(state))` (exported from `primer-state.ts`);
             assert `primerOf(restored).reviewRow === 1`. This pins the `isSamePlace` clause: without it the
             unchanged place hands back the old primer with the cursor still at 2.
           - `'keeps the same primer when the place and cursor are already in range'`: `before = applyAll(stateWith(),
             [{ type: 'openReview' }, { type: 'reviewBottom' }])` (cursor 2 of three rows); `placeRestored` with
             `place: primerPlace(before, primerOf(before))`; assert `primerOf(restored) === primerOf(before)`.
           The existing `placeRestored` table keeps passing unchanged.
Done when: compiles; `npm test` runs `src/plugins/primer/page/primer-state.test.ts` green.
Commit:    one commit: "Primer: a restored review clamps its cursor into the review's rows (follow-up: placeRestored
           may restore a stale review cursor)".

## Proof

