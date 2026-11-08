# 06 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     none (captures go under the drive run's folder)
Consumes:  the landed feature in both worktrees
Produces:  the live checks below, each passed or reported with its capture
Decisions: the live checks follow `wigley:writing-tests` § What earns a live run instead; the tests in 01–04 own
           every rule, so this task checks only the screen and the wiring

## Gates

- Marketplace worktree: every command in its `AGENTS.md` § Done.
- GUI worktree: `npm run lint`, and `npm test` over the test files 02, 03 and 04 name.
- GUI self-test, filtered: `npm run selftest -- --plugin sessions --plugin session-log --plugin session-stash`
  (the sidebar drawing and the close reasons changed; `AGENTS.md` § Running and testing forbids a whole run unasked).

## Live checks (drive run, fake harness; the `drive` skill's loop)

1. **Expected — a close queues a retro row.** `chat.start`, send `hi` (press `i` first), close the row with the
   sessions close key. GIVEN that close WHEN the page redraws THEN a Retro section shows below Recent, holding one
   row titled as the closed row, drawn muted with a dashed accent edge. Screenshot the side bar.
2. **Expected — the row closes itself.** GIVEN the retro row from check 1 WHEN its turn ends (the fake harness
   answers) and 5 s pass THEN the row and the Retro section are gone, and `app.log` holds the auto-retro close line.
3. **Expected — the queued count.** Start and send to three rows, close them one after another. THEN one retro row
   runs and the Retro header reads `2 queued`; it counts down as each run closes. Screenshot the header.
4. **Low-confidence — a restart keeps a retro row a retro row.** With a retro row open, `restart`. THEN the row is
   still in the Retro section; close it with the close key; THEN no new retro row appears.
5. **Low-confidence — the session keys walk the Retro section.** With a retro row open, step through sessions with
   `Option+Shift+o` / `Option+Shift+i`. THEN the retro row is reached after the Recent rows.
6. **Low-confidence — a cleared row hands every host id.** `chat.start`, send, `/clear`, send, close. THEN the retro
   row's first message is `/wigley:retro auto <old id> <new id>`, oldest first (read its Chat tab with `query`).

Read every screenshot against `DESIGN.md`. A failed check is fixed through `wigley:make`'s fix loop, then re-run.

## Left to the user (wrap-up only)

- A real run: after `npm run install-app`, close a real session in the installed app. Expect a Retro row that runs
  `/wigley:retro auto …`, asks nothing, closes itself, and leaves a commit from `git -C ~/wigley-agents log -1 --
  learning`. Then run `/wigley:retro` in any session: it reports that run and sends the ripe round.

Done when: every gate passes and every live check passes, each with its capture path in the Proof.
Commit:    none
