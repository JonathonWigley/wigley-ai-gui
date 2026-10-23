# 03 — The review redraws its rows only when they change, and a notice's rail entry jumps to its card

Status: in progress
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/page/round-view.ts` · `src/plugins/forms/page/view-model.ts` ·
           `src/plugins/forms/page/form-state.ts` · test `src/plugins/forms/page/view-model.test.ts` ·
           `src/plugins/forms/page/form-state.test.ts`
Consumes:  `RoundState`, `FormsAction`, `FormsView` in `src/plugins/forms/page/form-state.ts` as 01 leaves them
           (01 adds `RoundState.sending`, which the review rows do not read)
Produces:  `export function reviewRowsChanged(drawn: RoundState | null, current: RoundState): boolean` in
           `src/plugins/forms/page/view-model.ts`
           `export function railPickAction(view: FormsView, position: number, reviewRow: number | undefined): FormsAction | null`
           in `src/plugins/forms/page/view-model.ts` (moved from `round-view.ts`, where it was module-private)
           `FormsAction` member `{ type: 'reviewJumpItem'; item: number }` in `src/plugins/forms/page/form-state.ts`
Decisions: the review list skips its rebuild when the round's answers, finding answers, review row and round are the
           same as at the last draw (Decided notice) · a notice's rail entry in the review jumps back to the notice's
           card without focusing its comment box, as question entries do (interview) · the comparison and the rail
           rule sit in `view-model.ts`, so they are unit-tested; `round-view.ts` has no DOM harness

## Behaviour

GIVEN the review shows WHEN the user types in the Round note, a draft saves, or any other change leaves the round's
answers, finding answers, review row and round as they were THEN the review's rows are not rebuilt and the cursor row
is not scrolled into view; the summary line and the buttons' key hints still redraw.
GIVEN the review shows WHEN an answer, a finding answer or the review cursor changes THEN the rows rebuild and the
cursor row scrolls into view, as today.
GIVEN the review shows WHEN the keymap changes or a new layout rebuilds the view THEN the rows rebuild, so the cursor
row's key hint reads the new keys.
GIVEN the review shows WHEN the user clicks a notice's rail entry THEN the forms view shows that notice's card, the
review cursor stays where it was, and no box takes focus.
GIVEN the review shows THEN no rail entry carries `is-disabled`.

## Approach

1. **`reviewRowsChanged(drawn, current)`** is true when `drawn` is null, or when any of `round`, `answers`,
   `findingAnswers` (each compared by reference) or `reviewRow` (by value) differs between the two. It reads nothing
   else: `ReviewRow` is built from those fields and the round's static text.
2. **`buildReview`** keeps the round it last drew rows from (null at build). `update(current)` recomputes the summary
   and redraws both key hints as now, then rebuilds the list and scrolls the cursor row into view only when
   `reviewRowsChanged(drawn, current)`; after a rebuild it keeps `current` as the drawn round. Its returned part gains
   `forgetRows(): void`, which clears the drawn round so the next `update` rebuilds. Widen `RoundParts.review` to
   `{ element: HTMLElement; update(round: RoundState): void; forgetRows(): void }`.
3. **Keymap changes**: the `keysChange` listener in `createRoundView` calls `parts.review.forgetRows()` before its
   existing redraws, whether or not the view shows. `setLayout` builds a new review part, which starts with nothing
   drawn.
4. **`reviewJumpItem`** in `form-state.ts`: when the view is `review`, a round is active and `item` is a position in
   `railItems(round.round)`, it sets that round's `focus` to `item` and the view to `forms`, leaving `reviewRow`;
   otherwise it returns `state` itself. Comment the member: `item` is a rail position; the review's rail sends it for
   a notice, which has no review row.
5. **`railPickAction`** moves to `view-model.ts`, exported, with its comment updated: in `forms` it returns
   `{ type: 'focusItem', item: position }`; in `review` it returns `{ type: 'reviewJump', row: reviewRow }` when
   `reviewRow` is defined, else `{ type: 'reviewJumpItem', item: position }`; in `confirm` and `idle` it returns null
   (under the confirm the dialog's scrim takes the pointer).
6. **`round-view.ts`**: import `railPickAction` from `view-model.ts`. In `update`, delete the per-entry
   `railPickAction` call, the `isInertNotice` toggle of `is-disabled` and the comment above it; `updateRailEntry`
   stays. The click handler built in `buildRoundParts` is unchanged apart from the import.

## Tests

`src/plugins/forms/page/view-model.test.ts`:
- New `describe('reviewRowsChanged')`, its states built once from `stateAfter({ type: 'openReview' })` (questions Alpha
  and Beta) and stepped with `apply`, so unchanged fields keep their references:
  - `is true with nothing drawn` — `reviewRowsChanged(null, round)` is true.
  - `is false after a Round note edit` — `setText` `{ field: 'note' }` with `'checked'`.
  - `is false after a draft save starts and finishes` — the round after one note edit against the round after
    `saveStarted` then `saveFinished` (`ok: true`) for revision 1.
  - `is true after the review cursor moves` — `reviewNext`.
  - `is true after a question's notes change` — `setText` on question 1's `notes`.
  - `is true after a finding's answer changes` — over a round with finding Delta (`mixedRoundAfter`'s fixture built
    as a `FormsState`), `setText` on finding 1's `notes`.
- New `describe('railPickAction')`:
  - `focuses the clicked item in the forms view` — `railPickAction('forms', 2, 1)` equals
    `{ type: 'focusItem', item: 2 }`.
  - `jumps to a finding's or question's row in the review` — `railPickAction('review', 2, 1)` equals
    `{ type: 'reviewJump', row: 1 }`.
  - `leaves the review for a notice's card` — `railPickAction('review', 0, undefined)` equals
    `{ type: 'reviewJumpItem', item: 0 }`.
  - `does nothing under the cancel prompt or with no round` — `railPickAction('confirm', 0, undefined)`,
    `railPickAction('confirm', 2, 1)` and `railPickAction('idle', 0, undefined)` are null.

`src/plugins/forms/page/form-state.test.ts`, in `describe('review')`, over the notice N1, finding F1, question Q1
round the existing `jumps from a finding row to the finding in the forms view` builds (rail positions: 0 notice,
1 finding, 2 question):
- `jumps from a notice in the rail to its card, keeping the review cursor` — `openReview`, `reviewNext`,
  `{ type: 'reviewJumpItem', item: 0 }`: view `forms`; `active(state).focus` is 0; `active(state).reviewRow` is 1.
- `ignores a rail jump outside the review` — in the forms view, `reviewJumpItem` with `item: 0` returns the same
  state object.
- `ignores a rail jump to a position outside the rail` — in the review, `item: 3` and `item: -1` each return the same
  state object.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above;
`grep -n "is-disabled" src/plugins/forms/page/round-view.ts` prints nothing.
Commit:    one commit, "Forms review: rebuild the rows only when their inputs change; a notice's rail entry jumps to its card"

## Proof

## Live checks for task 15

- **expected** — drive: `forms.openRound`, open the review, `eval` a probe that keeps the `.review-rows li` nodes,
  `type` into the Round note box, `eval` again: the same nodes are in place. Reason: the skip lives in
  `round-view.ts`, which no unit test reaches.
- **low-confidence** — drive: in the review, change the binding of `forms.reviewJump` with `setting` (or a keymap
  edit the drive supports), then `query` the cursor row's key hint: it shows the new keys. Reason: the
  `forgetRows` call on a keymap change is wiring with no test, and a miss leaves a stale hint.
- **expected** — drive: open the layout preview round (`Space z l o`), which holds a notice, open the review, `click` the notice's
  `.rail-entry`: the forms view shows the notice's card, no box has focus, and `query` finds no
  `.rail-entry.is-disabled`. Reason: the self-test cannot click.
