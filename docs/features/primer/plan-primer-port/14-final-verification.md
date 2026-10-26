# 14 — Final verification

Status: done
Type: Task
Wave: 8 · Depends on: 13
Plan: [plan.md](plan.md)
Rules: [plan.md § Rules for every task](plan.md#rules-for-every-task)

Files:     none (verification only; a fix found here is a new group the lead plans)
Consumes:  every task
Produces:  the verification record in this task's Proof section
Decisions: the agent runs every check it can reach through the project's own tooling (`npm run selftest`,
           `npm run drive`). It launches no browser. Checks only the user's hands or eyes can settle go in the
           wrap-up reply with their steps, and nowhere else.

## Static and suite checks

In wigley-ai-gui:

- `npm run typecheck`
- `npm run lint` (layer check, style check, oxlint, oxfmt)
- `npm test` — the full Vitest suite, since tasks 02 and 03 move code every forms test reaches

In wigley-ai-marketplace, every command `AGENTS.md` § Done lists, from the repo root: `check_manifests.py` (with and
without `--against origin/main`), `check_pointers.py`, and the unittest suites it names, `forms` and `retro` among
them.

## Live checks (self-test and drive run)

`npm run selftest` runs every plugin's script, forms' and the primer's. Then a drive run (`npm run drive`) covers the
paths no test reaches. Each check below is tagged with why it is on the list.

1. **Expected — a primer shows and submits.** Drive `primer.openPrimer` with the fixture primer, open the Primer tab,
   set two needs (`y`, `n`), toggle one item (`x`), add one item (`a`), open the review (`<Leader><Leader>`), submit
   (`<D-Enter>`). Read `primer.answers`: outcome `submitted`, the two needs, the toggled item `include: false`, the
   added item `added: true`. Screenshot the rail, the card and the review.
2. **Low confidence — a round and a primer open in one session at once.** Drive a round (`forms.openRound`) and a
   primer for the same fixture session. Both tabs show. Close the session's row: the first tab's cancel prompt shows
   (the sessions page asks tab guards in tab order and stops at the first refusal). Confirm that cancel: the other
   tab's prompt shows. Dismiss it: the row stays, with the second form still open. Record which tab's guard ran
   first and whether the two prompts read well, for the user's review. Reason: two close guards and two presenters
   on one session have no test across both plugins. (A drive run uses silent alerts, so the badge count is a user
   check; task 01's unit test covers the sum.)
3. **Low confidence — forms is unchanged after the lift.** The forms self-test passes, and a drive run opens a round,
   types a note (autosave line in the log), submits, and the answers read back. Reason: tasks 02 and 03 move the code
   under every forms path.
4. **Low confidence — review blocks a bad slug.** Edit the slug to `Bad Slug` in the Feature card and submit from the
   review: the review shows the slug message and nothing is sent. Reason: validation lives in page code a unit test
   covers only as state.
5. **Expected — gallery shows ToggleMark.** Open the gallery (`<Leader>zg`) in a drive run and screenshot the toggle
   mark's states.

## Checks for the user (wrap-up only)

List these in the run's wrap-up reply, with their steps:

- A real agent session: run `/wigley:feature-primer` in Claude Code against the live app; the Primer tab opens; submit;
  the agent receives the payload and writes the feature folder.
- The native notification "Feature primer ready" shows and a click brings the window forward on the primer's session.
- The badge count with a round and a primer open, then each finished.
- A real keyboard pass over the Primer keys in `docs/features/primer/design.md` § Keys, including `<A-h>`/`<A-l>`.

Done when: every static and suite check passes, the self-test passes, each live check above is recorded with its
result and screenshot path in Proof, and the wrap-up lists the user checks.
Commit:    none

## Proof

Commit none (verification only) · proof: GUI: npm run typecheck 0, npm run lint 0, npm test 200 files / 3205 tests pass. Marketplace: check_manifests (plain and --against origin/main), check_pointers, claude plugin validate, and the scripts, docs-index, forms, plan, retro, unity-playtest, unity-ux-flow suites pass. npm run selftest: all passed (rerun after a peer edit reloaded the page mid-run in attempt 1; pre-reload pass was clean too). Drive run 20261026-182946-61e4 (.drive/20261026-182946-61e4/screenshots/): 1 primer submit PASS (c1-rail/card/review.png); 2 NOT RUN — forms.openRound and primer.openPrimer each connect their own session, so no drive action puts both in one session; primer cancel prompt alone reads well (c2-primer-prompt.png), moved to the user checks; 3 forms unchanged PASS (status chip Saved, answers read back); 4 bad slug PASS, submit refused, answers pending (c4-review.png); 5 gallery ToggleMark PASS (c5-gallery.png) · concerns: check 2 (two guards on one session) unverified live; forms log says 'finding 1 answered' for a note-only answer while the payload says untouched; the primer cancel dialog showed the review view behind it on a row whose review was never opened
