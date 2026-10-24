# 01 — Forms scroll and box keys

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/manifest.ts` · modify `src/plugins/keymap.ts` ·
           modify `src/plugins/forms/page/round-view.ts` · modify `src/plugins/forms/page/forms-view.ts` ·
           modify `src/plugins/forms/page/forms-commands.ts` · modify `src/plugins/forms/page/start.ts` ·
           modify `src/plugins/forms/page/boxes.ts` · test `src/plugins/forms/page/forms-commands.test.ts` ·
           modify `src/plugins/forms/main/selftest-script.ts`
Consumes:  `scrollHalfPage(scroller, direction): HalfPageScroll` and
           `halfPageText(what, direction, scroll): string` in `src/shared/half-page.ts` (existing) ·
           `HalfPageScroll` in `src/contracts/editor.ts` (existing)
Produces:  `halfPageDown` / `halfPageUp` commands in `formsManifest.commands` (`manifest.ts`)
           `scrollHalfPage(direction: 1 | -1): HalfPageScroll` on `RoundView` (`round-view.ts`)
           `scrollHalfPage(direction: 1 | -1): HalfPageScroll | null` on `FormsView` (`forms-view.ts`)
           `scrollForm(direction: 1 | -1): HalfPageScroll | null` on `FormsCommandDeps` (`forms-commands.ts`)
Decisions: plain j/k unchanged (round 1) · scroll in every vim mode, no key-engine change (round 1) ·
           forms only (round 1) · half a page (Decided) · a box's Ctrl+j/k scroll the form's main
           column, not the box text (Decided) · Ctrl+n/p in both scopes (Decided)

## Items

1. **Manifest.** Add `halfPageDown` and `halfPageUp` to forms' `commands`, `runsIn: 'page'`, with the
   labels chat uses: `'scroll half a page down'` and `'scroll half a page up'`. Group: a new
   `'view'` group, placed after the `boxes` commands.
2. **Keymap**, Forms section of `defaultKeymap.binds`:
   - `<C-j>` / `<C-k>` in `forms.forms` change from `forms.nextBox` / `forms.prevBox` to
     `forms.halfPageDown` / `forms.halfPageUp`.
   - Add the same two binds in `forms.review`.
   - Add `<C-n>` → `forms.nextBox` and `<C-p>` → `forms.prevBox` in `forms.forms` and in
     `forms.review`.
   - No `where`: a chord fires on the page and inside a box in every vim mode, as now.
3. **RoundView.scrollHalfPage** scrolls `parts.main` (the current build's main column, so a
   layout rebuild keeps working) with `scrollHalfPage` and returns its result.
4. **FormsView.scrollHalfPage** finds the active round (`activeRound(store.get())`) and calls its
   round view's `scrollHalfPage`; it returns `null` when there is no active round or no view for
   it. Add it to the `FormsView` interface and its comment.
5. **Commands.** `FormsCommandDeps` gains `scrollForm`. The handlers:
   - `halfPageDown` → `scrollForm(1)`, `halfPageUp` → `scrollForm(-1)`.
   - With a result, log `log('forms', halfPageText('the form', direction, scroll))`, so the log reads
     `scrolled the form down half a page`, `… to the bottom`, or `the form did not scroll down`.
   - With `null`, log `log('forms', 'no round to scroll')`.
   - They don't move focus or dispatch an action: a box keeps focus and its vim mode.
6. **Wiring.** `start.ts` passes `scrollForm: (direction) => view.scrollHalfPage(direction)`.
7. **Comment.** `boxes.ts`: `in Ctrl+j order` becomes `in Ctrl+n order`.

GIVEN a round shown and its form scrolled to the top WHEN `halfPageDown` runs THEN `scrollForm`
receives `1` and the log reads `scrolled the form down half a page`
GIVEN no active round WHEN `halfPageUp` runs THEN the log reads `no round to scroll`
GIVEN a box focused WHEN `halfPageDown` runs THEN nothing is focused or left
GIVEN the form at its top WHEN `halfPageUp` runs and the scroll moves it to the top THEN the log
reads `scrolled the form up half a page to the top`
GIVEN the form that cannot scroll WHEN `halfPageUp` runs THEN the log reads `the form did not scroll up`

Tests (in `forms-commands.test.ts`, `setup()` gaining a `scrollForm` fake that records each
direction and returns a `HalfPageScroll` the test sets):
- `scrolls the form half a page down` — fake returns `{ moved: true, atEnd: false }`; recorded
  directions `[1]`; log holds `scrolled the form down half a page`.
- `logs the top when scrolling up reaches it` — fake returns `{ moved: true, atEnd: true }` for
  `halfPageUp`; log holds `scrolled the form up half a page to the top`.
- `logs a scroll that did not move` — fake returns `{ moved: false, atEnd: true }` for
  `halfPageUp`; log holds `the form did not scroll up`.
- `logs no round to scroll` — fake returns `null`; log holds `no round to scroll`.
- `keeps the box focused while scrolling` — run `halfPageDown` with `{ editor: editorOf(notes1) }`;
  `focused` stays empty and no leave is recorded.

Self-test (`selftest-script.ts`), in the forms key steps:
- Every step that presses `<C-j>` / `<C-k>` to move between boxes (today's steps after
  `keys: ['A', ...LONG_WORD, '<C-k>']`, the which-key close by `<C-j>`, and
  `['Escape', 'd', '<C-j>']` / `['<C-k>']`) presses `<C-n>` / `<C-p>` instead, with the same
  `expect` lines; update each `why` to name Ctrl+n / Ctrl+p.
- The new steps expect the command line, which doesn't depend on how tall the fixture is; the
  scroll amount and its log text are pinned by the unit tests and checked live in 03. Add them
  to `QUESTION_BOXES_STEPS` (`selftest-script.ts`, the group holding the box steps), after the
  `['Escape', 'd', '<C-j>']` / `['<C-k>']` pair, now `<C-n>` / `<C-p>`, and its following
  `['w', 'Escape']` step:
  - On the form page: `<C-j>` expecting `[page] <C-j> ran forms.halfPageDown`, then `<C-k>`
    expecting `[page] <C-k> ran forms.halfPageUp`.
  - In a box in INSERT: `a` expecting `[forms] focused notes on question 1`, then `<C-j>` expecting
    `[page] <C-j> ran forms.halfPageDown`, then `Escape`, `Escape` expecting `[forms] left the box`,
    which proves the box kept focus through the scroll.
- Add `<C-k>` in the review expecting `[page] <C-k> ran forms.halfPageUp`, in the step group that
  already opens the review.
- The gallery steps keep `<C-j>` / `<C-k>` unchanged.

Done when: `npm run lint` and the type check pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

