# 08 — Final verification: the user's visible run

Status: not started
Type: Task
Wave: 6 · Depends on: 07
Plan: [plan.md](plan.md)

Files: none.

Consumes: the landed plan A (01–07); `npm run selftest` passing (06).

Produces: the user's results for each check below, recorded in the run log.

Decisions:
- A visible `npm start` takes the user's foreground and keyboard, so the agent runs none of it: the agent hands the
  user the steps below and records what the user reports (AGENTS.md § Running and testing). The agent's own live
  check is `npm run selftest`, already green at 06.
- Only checks `wigley:writing-tests` § What earns a live run admits: each is an expected path on screen, or a
  low-confidence path (wiring or layout no test sees). Claims a unit test or a self-test step already pins (key
  routing lines, the toast text, step wrapping, the hello parse, the fit at the minimum width) are left off.
- Not checkable in plan A: the round toast while Sessions mode is hidden, and an editor bind out of its scope, since
  plan A registers one mode and one editor scope family; plan B's final verification carries both.
- Setup for the harness checks: the relay that sends `harness` reaches a session only through the installed
  `wigley` plugin at the version task 03 set. Before step 2 the user pushes wigley-ai-marketplace (the agent asks for
  that push; `~/wigley-agents/AGENTS.md`, Git) and updates the plugin in Claude Code and Codex. Without that update,
  rows show no harness, which is the older-relay path.

Checks (the user runs them in order and reports each as pass or fail, with what showed):

1. **Sessions mode layout** — expected (layout no test sees). `npm start` in `~/Documents/dev/wigley-ai-gui`. With
   no agent session connected the window (at its default 900 px width) shows `No sessions`. Start two Claude Code sessions in two different
   project folders. Expect: two rows in a left sidebar about 16rem wide, each the project folder's name, none
   selected, and the area beside it reading `No session selected`; the status bar stays across the bottom.
2. **Harness labels** — low-confidence (the real hosts' environment: `CLAUDECODE` set by Claude Code, unset by Codex;
   no test runs a real host). Expect each Claude Code row to show `Claude` dimmed beside its name. Start a Codex
   session with the wigley plugin: its row reads `Codex session` with `Codex` beside it.
3. **A round selects its row and its Form tab** — expected. In the first session, have the agent send a review round.
   Expect: that row is selected, a tab strip shows one `Form` tab, the form fills the area, and the row's second
   line reads the round's heading and `0/<total>`, which counts up as items are answered.
4. **A background round marks its row** — expected. With the first row selected, have the second session send a
   round. Expect: the second row gets the accent dot and its second line; the first form stays shown. Click the
   second row: it is selected, its dot clears, its form shows.
5. **Notification click** — low-confidence (Electron notification wiring, untested). Put the app behind another
   window, have a session send a round, click the macOS notification. Expect: the app comes forward with that
   session's row selected and its form shown.
6. **Keys from the real keyboard** — low-confidence (the self-test synthesizes key events; macOS turns Option+Shift+o
   into `Ø`). On the page: `Option+Shift+o` / `Option+Shift+i` step between rows, wrapping; `Option+o` with one tab
   leaves the tab shown; `Space k s` hides the sidebar and the form widens, again shows it. In a notes box (`a`,
   then `jk`): `Space k s` toggles the sidebar the same way.
7. **Close a row and its return** — low-confidence (row return and Form tab re-adding are page wiring with no
   test). Submit the second session's round (`Space Space`, `Space Enter`). Expect its Form tab to stay, showing
   `No round open`, and the row's second line to clear. With that row selected press `Cmd+W`: the row goes and the
   selection moves to the row on its right, else its left. Have that session send another round: its row comes back
   at the end of the list with the dot, and selecting it shows a `Form` tab with the new round.
8. **Close asks while a round is open** — expected (the guard is tested; the prompt over the sidebar layout is not).
   With a round open in the selected row, press `Cmd+W`. Expect the `Cancel this round?` prompt; `n` keeps the row.
9. **Narrow window: the sidebar hides and overlays** — low-confidence (the `matchMedia` wiring and the overlay's
   drawing have no test; `tabs.ts` tests pin only the state rule). With the window at its default width and the
   sidebar beside the form, drag the window narrower than 680 px (its minimum is 420 px). Expect: the sidebar
   disappears and the form takes the whole width. Press `Space k s`: the sidebar opens over the form's left edge, with
   a shadow, the form underneath not reflowed; click another row — that session shows and the sidebar stays open.
   Press `Space k s` again: it closes. Open it once more, then widen the window past 680 px: the overlay ends and the
   sidebar sits beside the form again. Narrow it again: the sidebar is hidden, not open over the form.

Done when: the user reported each check; every failure is fixed in its code task and its check re-run, or carried
to the user as a finding; the run log lists each check with its result.
Commit: none (the plan folder lives outside both repos).

## Proof

