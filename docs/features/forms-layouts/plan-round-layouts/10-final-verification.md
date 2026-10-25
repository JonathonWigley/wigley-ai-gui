# 10 — Final verification

Status: done
Type: Task
Wave: 8 · Depends on: 09
Plan: [plan.md](plan.md)

Files:     none, unless a check finds a defect (fixed in its own commit)
Consumes:  the landed code of 01–09
Produces:  a drive run that shows each check below, its captures read against `DESIGN.md`
Decisions: only checks no unit test or self-test step already pins (`wigley:writing-tests` § What earns a live run
           instead); each is tagged expected or low-confidence with its reason
Tests:     none new

Run `npm test`, `npm run lint` and `npm run selftest` first; then a drive run (`.agents/skills/drive/SKILL.md`):

1. **Expected — grouped finding card in `default`.** Open a round with a Defect finding: two `fix_now` choices,
   no deferral choices, `recommend_action` `fix_now`; and a second finding with a `follow_up` choice and an
   `action_reasons.leave_it` text, `recommend_action` `leave_it` and no `recommend`. The first card shows "Fix now"
   with choices 1 and 2, then `Follow-up (3)` and `Leave it (4)` as bare numbered headers, each `(3)` / `(4)` in its
   `span.choice-number`; the second shows the reason under Leave it.
   Capture both cards. Reason: the look is judged on screen.
2. **Low-confidence — five layouts in one round.** Write five small user layouts (each a different `finding` card
   only) to the drive home's forms layouts folder, then open one round of five copies of one finding, each naming a
   different layout. Each card draws in its own layout, the rail and review draw in `default`, and no layout's CSS
   restyles another's card. Capture each card. Reason: several layouts and stylesheets live at once for the first
   time; no test sees CSS scoping.
3. **Low-confidence — hot reload of one in-use layout.** With round 2 open, save one of the five layouts with a
   visible change. Only that card redraws in the new look, every answer stays, and the log shows a reload of that
   layout alone. Reason: per-layout revisions and watching every folder are new wiring.
4. **Low-confidence — rail and review from a user layout.** Set `forms.layout` in the drive home's `settings.json`
   to a layout that defines only `rail` and `review`. The rail and review take that look, the cards stay `default`,
   and selection, keys and the cancel dialog still work. Capture the rail and the review. Reason: the panes are
   layout-built for the first time.
5. **Low-confidence — the forms page events in a live round.** Open a round, answer one item, open the review and
   submit. The page log holds, in order, 07's `event roundShown`, `event answerChanged`, `event viewChanged` and
   `event roundFinished` lines (source `forms`) for that round. Reason: the event wiring in `start.ts` runs only in
   the live page; no production code path draws a test part, so card parts, review columns and `kit.command` /
   `kit.keysFor` are covered by 07's unit tests against a built fixture, not here.
6. **Expected — the preview key.** `Space z l o` opens the preview round in the `forms.layout` layout.

Checks for the user, in the wrap-up only: none known (the work adds no global shortcut, dead key, IME path, native
dialog or notification).

Done when: the test, lint and self-test commands pass and every check above shows its expected result in a read
capture, or each failure is fixed and the check re-run.
Commit:    none, or one commit per fix

## Proof

Commit none (verification only) · proof: drive run t10: checks 1, 2, 4, 5, 6 pass with read captures (.drive/t10/screenshots); check 3 passes look, answers and log, the whole round rebuilds; npm test 2822 passed; lint passes · concerns: a bare header draws its number twice ('Follow-up (3) 3': span.choice-number plus key hint); bare action headers sit ~8px right of the section header above, so header edges do not line up; hidden cards carry no data-status after a rebuild until shown; check 1's second finding needed a fix_now choice (the app requires at least one)
