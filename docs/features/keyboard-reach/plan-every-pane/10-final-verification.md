# 10 — Final verification

Status: not started
Type: Task
Wave: 10 · Depends on: 09
Plan: [plan.md](plan.md)

Files:     none, unless a check fails: then the fix lands in the task's own files, with a regression test or
           self-test step, and the check re-runs
Consumes:  the landed branch
Produces:  a pass/fail line per check below in the report, with the screenshot or log line that settles it
Decisions: the touched plugins' self-test scripts run here; the whole self-test (the only run with the end-of-run
           placement check) runs only on the user's ask (AGENTS.md § Running and testing), so the plan's hand-off
           asks for it and checks 1–2 wait on that run · visual checks are settled from drive-run or self-test
           screenshots the agent reads, not left to the user · a check only a real keyboard settles goes to the
           wrap-up (`~/wigley-agents/AGENTS.md` § Checks for the user)

## Gate

1. `npm run typecheck`, `npm run lint`, `npm test`.
2. `npm run selftest -- --plugin <list>`, the list being every plugin a task touched
   (`git diff --stat <review base>..HEAD -- src/plugins`) that hands a script (`ls src/plugins/*/main/selftest-script.ts`):
   at plan time sessions, docs, backlog, settings, unity-pool, chat, agent-strip, primer, forms, notes. Gallery and
   keys hand none; their steps live in the forms and docs scripts. Naming a plugin with no script fails the run.

## Checks

Each is from the task that names it; "low" marks a check its drafter was unsure of, which gets a drive run or a
screenshot read rather than trust in the self-test alone.

Whole-run only (on the user's ask):
1. The placement check passes with the new scopes in the `<C-n>` list (`sessions.sidebar`, `docs.aside`,
   `chat.hub`, and `backlog.homes` if added) — 03, 04, 06.
2. No `[keys] unplaced x chat.removeShownImage in chat.image` — 07.

Core and right bar (01, 02):
3. Alt+l twice from a Chat tab with the hub shown (once with it hidden) enters the unity-pool panel: the ring on the holder, the chat box without its caret.
4. j/k/G move the panel ring; Enter on another session's holder shows it and hands the keys to its tab.
5. Alt+h from the panel returns to the last pane in Sessions, Docs, Backlog, Settings and Gallery, with DOM focus
   there.
6. low: a click into main while the panel holds the keys removes the ring (focusout).
7. low: the panel hiding while it holds the keys (the session leaves the pool, or a mode change) hands focus to main.
8. low: the ring and padding on the inline holder span look right in the default layout.
9. low: in a narrow window with the right bar over main, the panel is reachable and scrolls its cursor into view.
10. low: Sessions with nothing shown — Alt+h out of the panel leaves the `idle` keys working.

Sessions (03):
11. Alt+h from the leftmost pane: the ring on the selected card and its prompt `s favorite / r rename / d close` (or
    the five-key variant on a favorite).
12. low: the prompt line in a narrow side bar, and its hidden space on the selected card outside the list.
13. low: with two real Chat panes, Alt+h/l lands in the new pane in normal mode (Task 06's landing), and `i` then
    types there.
14. low: in a narrow window, Alt+l from the overlay list closes the overlay and the keys reach the pane (01's
    `sideBarOpened`).
15. low: a click into a chat pane while the list holds the keys gives the pane its scope back.
16. low: `d` on a running session's row shows the close confirm, and the list keeps the keys after Cancel.
17. The cursor ring draws over the on-screen ring and the status edge.

Docs (04):
18. The column's cursor ring shows only while the column has focus.
19. j/k scroll the column's cursor row into view in a long list.
20. low: the column losing sight (window narrowing, the whole-file editor opening) moves focus to the doc.
21. low: `[page] no pane right` in the docs fixture holds (no right-bar stop shows there).
22. low: `G` in target.md's column lands on `Fixture guide`.

Settings and Backlog, consistency (05, 08):
23. The `/ filter` hint ends every picker title line.
24. The Backlog homes header shows its R/C hints.
25. The cursor ring on the primer review block.
26. low: the key help self-test lines in the offscreen window (help taller than its dialog; `… up a line to the top`).
27. low: in a narrow overlay, Settings `l` keeps the overlay open.
28. low: the area resets after a click into the Settings sections.

Chat panes (06):
29. The ring on the hub's cursor head, one cursor only; the transcript's left bar hides while the hub has the keys.
30. Alt+Shift+h/l resizes the hub and shows the handle's prompt briefly.
31. low: the handle's prompt isn't clipped and doesn't overlap the hairline.
32. low: Alt+l with the hub hidden, or the tab under 640 px, falls through to the outer pane or the right bar.
33. low: Alt+h from the right bar into a Chat tab lands on the transcript.
34. low: Alt+k in insert or visual mode leaves the box in normal mode.
35. low: the `k j` step's section above Session exists in the fixture.

42. Alt+Shift+l from a Chat tab's transcript still resizes the side bar (one chat pane) or the pane tree's divider.
43. A click into the box while the hub holds the keys gives the box its keys back (send, `<Leader>c…` work).

Chat items (07):
36. low: the `attachments-viewer` screenshot shows the `x remove` hint on the counter's line inside the frame.
37. low: the `block-expanded` screenshot shows the opened `:::details` body inside the block, with the cursor bar
    round the whole block.
38. low: the `attachments` group reaches `chat-images` with its pinned keys, and two-sessions navigation still passes.
39. low: `Esc k`/`j` in `permission cursor` lands on the newest card, and `<D-Enter>` submits an empty reason.
40. After both new cards are answered, the `permission card` group's `y` still shows the form.
41. Agent-strip `<C-j>` on an open box logs `did not scroll` with the fake's one tool.

Real-keyboard only (to the wrap-up, not run here): Alt+hjkl and the cursor keys on a physical keyboard across every
mode, especially the macOS Option layer (Alt+letters producing characters in a box).

Done when: the gate passes and every check 3–43 has a pass line with its evidence, or a fix landed and the check
re-ran; checks 1–2 and the real-keyboard pass are named in the report for the hand-off.
Commit:    a fix only, per failing check, with its test

## Proof
