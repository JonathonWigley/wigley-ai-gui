# 06 — Final verification

Status: done
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
- GUI worktree: `npm run typecheck`, `npm run lint`, and `npm test` over the test files 02, 03 and 04 name.
- GUI self-test, filtered: `npm run selftest -- --plugin chat --plugin sessions --plugin session-log --plugin session-stash`
  (chat's close path, restore and permissions, the sidebar drawing and the close reasons changed; `AGENTS.md` § Running and testing forbids a whole run unasked).

## Live checks (drive run, fake harness; the `drive` skill's loop)

Checks 1 and 2 run on the default settle. Before checks 3 to 6, run `setting auto-retro.settleSeconds 600`, so a
retro row stays open while the check drives it; set it back to 5 after check 6.

1. **Expected — a close queues a retro row.** `chat.start`, send `hi` (press `i` first), close the row with the
   sessions close key. GIVEN that close WHEN the page redraws THEN a Retro section shows below Recent, holding one
   row titled as the closed row, drawn muted with a dashed accent edge. Screenshot the side bar.
2. **Expected — the row closes itself.** GIVEN the retro row from check 1 WHEN its turn ends (the fake harness
   answers) and 5 s pass THEN the row and the Retro section are gone, and `app.log` holds the auto-retro close line.
3. **Expected — the queued count.** Start and send to three rows; once all three have sent, close them in one burst.
   THEN one retro row runs and the Retro header reads `2 queued`; close that retro row with the close key, and the
   header reads `1 queued`. Screenshot the header.
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

## Proof

Commit none (verification only) · proof: gates: marketplace Done commands pass; GUI typecheck 0, lint pass, 84 files/2172 tests; filtered selftest all passed; drive run .drive/20261108-135944-29e8 checks 1-6 PASS plus click opens Chat tab — screenshots c1-sidebar, c2-after, c3-header-2queued(-sidebar), c3-header-1queued, c4-after-restart, c4-after-close, c5-step, c6-retro-chat, c-click-retro; lead read c3 and click shots against DESIGN.md; report /tmp/claude-auto-retro/reports/06-drive.md · concerns: closing rows fast with the close key: after a close the selection lands on the new retro row, so the next press closes the retro run; a settleSeconds change does not re-arm a row already settling; the auto-retro close line is in the page log, not app.log as 06 worded it; 'muted' label measured rgb(166,173,200), no token named in design.md
