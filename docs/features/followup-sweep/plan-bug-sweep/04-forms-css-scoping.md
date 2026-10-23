# 04 — Scope the Form tab's generic classes in `forms.css`

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/page/forms.css` · test `scripts/style-rules.test.mts`
Consumes:  `cssViolations(css: string, allowsBackdropFilter: boolean): StyleViolation[]` in `scripts/style-rules.mts`
           (tree)
Produces:  no code symbol; every rule in `src/plugins/forms/page/forms.css` outside the kept list below starts its
           selector with `:where(.form-tab) `
Decisions: scope with `:where(.form-tab)`, which adds zero specificity, so a user layout's `layout.css` rule for
           `.choice`, `.answer` or `.field` still wins as before (Decided notice) · the status line stays unscoped:
           it is drawn in the status bar area, outside every Form tab · the cancel prompt draws in the overlay area
           and has no rule in `forms.css`, so nothing there changes · the `.answer-label` half of the follow-up is
           gone from the code and was removed from the docs ahead of this plan (commit `9dab181`)

## Behaviour

GIVEN a Form tab WHEN it shows a round, its rail, cards, review or idle line THEN every element draws exactly as
before: same rules, same specificity, same source order.
GIVEN an element outside a Form tab with a class such as `.field`, `.box`, `.choice`, `.context` or `.answer` WHEN it
draws THEN no `forms.css` rule matches it.
GIVEN a user layout whose `layout.css` styles `.choice` WHEN its round shows THEN that rule still overrides
`forms.css` as it did before.

## Approach

1. Prefix every selector in `forms.css` with `:where(.form-tab) ` (the pseudo-class, then a descendant space), each
   selector of a comma list on its own (`.choice-text code` and `.round-overview code` both), and the `.round-main`
   rule inside the `@media (max-width: 800px)` block too. Every rule from `.round` through `.review-actions` takes it:
   the round, rail, round head, items, context, answer, choices, finding actions, badges, verdict, toggles, fields,
   boxes, the review's note field and the review.
2. Keep as they are:
   - `.form-tab` and `.form-tab > .ui-empty`, already scoped to the tab;
   - `.status-line`, `.status-mode`, `.status-save` and `.status-save[data-state='unsaved']`, drawn in the status bar.
3. Change no declaration, no comment's meaning and no rule order. A file comment line above the first prefixed rule
   states the fact the selector cannot show: `:where()` scopes these rules to the Form tab and adds no specificity, so
   a layout's own `layout.css` overrides them.
4. `scripts/check-styles.mts` judges declarations only: its `DECLARATION` pattern in `scripts/style-rules.mts` cannot
   span a `{`, so a selector's `:where(` is never read as a declaration. The new test pins that, and `npm run lint`
   over the edited file proves it.

## Tests

`scripts/style-rules.test.mts`, in `describe('cssViolations')`, its underscore naming style:
- `cssViolations_WhereSelector_ReportsNothing` — `cssViolations(':where(.form-tab) .choice {\n  padding:
  var(--wg-space-1) 0;\n}\n', false)` equals `[]`.

Done when: `npm run lint` passes (`check-styles.mts` reports the files clean); the test gate runs the test above;
`grep -n "^\\." src/plugins/forms/page/forms.css` lists only the `.form-tab` and `.status-` rules.
Commit:    one commit, "forms.css: scope the Form tab's generic classes with :where(.form-tab), leaving the status line unscoped"

## Proof

e5cdd22 · diff read: stripping the :where(.form-tab) prefix and the new comment gives the old file byte for byte; only .form-tab and .status- rules start a line · concerns: none

## Live checks for task 15

- **expected** — drive: open the layout preview round (`Space z l o`, every card kind) and `screenshot` its cards,
  the rail and the review; each reads as before against `DESIGN.md` § Forms. Reason: CSS has no unit coverage, and
  a selector that stopped matching shows only on screen.
- **expected** — drive: `query` the computed style of `.status-line` (its `font-size` and `padding`) and of
  `.form-tab .choice`, `.form-tab .field`, `.form-tab .box` and `.form-tab .answer`: they match the token values the
  rules name. Reason: confirms both the scoped rules and the unscoped status line still apply.
- **low-confidence** — drive: copy the active layout (`Space z l c`) in the run's isolated home, add a `.choice` rule
  to its `layout.css` that sets `padding`, cycle to it, and `query` a `.choice`: the layout's value wins. Reason: the
  specificity claim is the reason for `:where()`, and no test crosses the user layout loader.
