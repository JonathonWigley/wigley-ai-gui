# 11 — Backlog review pane keeps a click

Status: not started
Type: Task
Rung: standard · follows Practice's `focusin` loop over its panes in `src/plugins/practice/page/practice-view.ts` (near line 630)
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md` L912, "A click into the Backlog review pane is pulled back to the table".

Files:     modify `src/plugins/backlog/page/backlog-view.ts` · test `src/plugins/backlog/page/backlog-view.test.ts`

Preconditions (checked 2026-11-17 on `main` 9b671bd16, from the `wigley-ai-gui/` folder):

| Claim | Command | Expected |
|---|---|---|
| Backlog has no `focusin` handler | `grep -c focusin src/plugins/backlog/page/backlog-view.ts` | `0` |
| `focusMain` focuses the pane that held the keys last | `grep -n "focusMain: focusHost\|let lastHostFocus" src/plugins/backlog/page/backlog-view.ts` | two lines, near 369 and 1317 |
| `render` records `lastHostFocus` from the state's focus | `grep -n "lastHostFocus = state.focus" src/plugins/backlog/page/backlog-view.ts` | one line, near 785 |
| The model loop | `grep -n "pane.addEventListener('focusin'" src/plugins/practice/page/practice-view.ts src/plugins/docs/page/docs-view.ts` | one line in each |

Consumes:  nothing from another task
Produces:  no new export. Inside `createBacklogView`: a `focusin` listener on each of `tablePane` (`'table'`),
           `reviewPane` (`'review'`) and `stripPane` (`'strip'`), and a view-local flag that keeps `syncFocus` from
           moving the DOM focus while such a listener hands a pane the keys.

Decisions:
- A `focusin` on a pane whose focus is not the store's runs `setFocus(<that pane's focus>)`, as Practice does. That
  goes through the reducer (`focusOn`), so the review still refuses the keys with no row selected, sets the scope and
  targets, logs `<pane> focused`, tells the assistant pane `hostTookKeys` when it held them, and `render` records
  `lastHostFocus`. A deferred `focusMain` (the right-bar stop's turn ending) then focuses the clicked pane.
- A `focusin` on the pane that already holds the keys does nothing. Programmatic focus (`syncFocus`, the filter and
  rename boxes) lands on the pane that already holds the keys, so it never re-enters `setFocus`.
- The click's DOM focus stays where the click put it. `setFocus` renders with `always`, and `syncFocus` would call
  `.focus()` on the pane element, pulling the focus off a clicked element inside it. A view-local
  `let isFocusFromClick = false` is set true around the listener's `setFocus` call (`try`/`finally`); while it is
  true `syncFocus` still records `shownFocus` and logs, and skips only the `.focus()` call. Practice passes
  `movesFocus: false` for the same reason; Backlog's `render` has no such parameter, and the flag keeps the change
  inside `syncFocus`.
- **A refused click.** When the reducer refuses the pane (the review with no row selected), the store's focus stays
  where it was. After the listener's `setFocus`, when `store.get().focus` is not the clicked pane's focus, the flag is
  already false (the `finally`), and the listener calls `syncFocus` so the DOM focus goes back to the pane that holds
  the keys, as today: scope and DOM focus never part.
- No listener on the assistant's column: scoped-agents' pane takes the keys itself (`tookKeys`).

GIVEN the table holds the keys WHEN a click focuses an element inside the review pane THEN the scope is `review`, the
log reads `review focused`, and the clicked element keeps the DOM focus.

GIVEN the table holds the keys WHEN a click focuses an element inside the strip THEN the scope is `strip`.

GIVEN the review holds the keys WHEN a click focuses an element inside the table THEN the scope is `table`.

GIVEN a click in the review pane handed it the keys WHEN `focusMain` runs (a stop's turn ended) THEN the scope is
`review`, not the table.

Tests:     in `backlog-view.test.ts`, under `describe('backlog pane targets')`, with a local helper `focusIn(target)` as
           Practice's `start.test.ts` writes it (focus the target, then fire `focusin` with `{ target }` on it and each
           parent):
           - `it.each` `'a click inside a pane hands it the keys and keeps the click's focus: $pane'` with rows
             `{ pane: 'review', from: 'table', target: 'backlog-review-body' }`,
             `{ pane: 'strip', from: 'table', target: 'backlog-chunk' }`,
             `{ pane: 'table', from: 'review', target: 'backlog-rows' }`; for `from: 'review'` run `setup.move('right')`
             first; the target is `findAll(setup.sheet, target)[0]`. Assert `lastScope(setup) === pane`,
             `setup.logs` contains `` `${pane} focused` ``, and `fakeDocument.activeElement === target`.
           - `'focusMain after a click in the review gives the review the keys'`: `focusIn` the `backlog-review-body`
             element from the table, then `setup.view.focusMain()`; assert `lastScope(setup) === 'review'`.
           - `'a click into the review with no row selected leaves the keys and the focus on the table'`: no row
             selected, `focusIn` the `backlog-review-body` element; assert `lastScope(setup) === 'table'` and
             `fakeDocument.activeElement` is the table pane element.
Done when: compiles; `npm test` runs `src/plugins/backlog/page/backlog-view.test.ts` green.
Commit:    one commit: "Backlog: a click into a pane hands it the keys before focusMain runs (follow-up: a click
           into the Backlog review pane is pulled back to the table)".

## Proof

