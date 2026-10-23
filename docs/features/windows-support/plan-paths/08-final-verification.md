# 08 — Final verification on Windows

Status: not started
Type: Task
Wave: 4 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     none (checks only; a check that fails goes back to the task that owns the code)
Consumes:  every group
Produces:  none
Decisions: the agent runs every check this machine can reach; macOS checks and real-keyboard checks go to the user's wrap-up (`~/wigley-agents/AGENTS.md` § Checks for the user)

## Agent checks (this Windows machine)

1. `npm run lint`, `npm run typecheck` and `npx vitest run` pass, with only the skips task 06 adds. Expected.
2. `npm run selftest` exits 0 and prints `[selftest] all passed`, the docs steps included. Expected: it is the
   observable landing of tasks 02 and 04 together (`A path starts with / or ~` gone). Low-confidence on the exit:
   the cleanup fix (task 06 item 4) has no unit test, so the run exiting on its own is its proof.
3. A drive run (`npm run drive`, loop in `.agents/skills/drive/SKILL.md`). Low-confidence: the renderer's adapter
   pick and the page-side docs and chat wiring are composition-root code no unit test reaches.
   - Docs mode (`Space k d`): the tree lists the fixture docs, opening one renders it, and the title or context
     line shows a Windows path as `~\…`. Read the screenshot.
   - Chat start prompt (`Space k n`): a recent folder under the run's temp home shows as `~\…`, and a started
     session's tab shows the folder's last segment, not its whole path. Read the screenshot.

## For the user (wrap-up only)

- On macOS: `npm test` and `npm run selftest` pass, since the agent ran both on Windows only; the POSIX adapter's
  cases and every test task 06 conditions run there.
- On Windows, in a visible `npm start`: Docs mode lists the machine's own docs (the real `docs_index.py` build, in
  UTF-8 mode) and opens `~\.claude\CLAUDE.md`.
- On Windows: Win+Enter submits a form's review and sends a chat message; Win+W closes a session once Widgets
  frees the key; Ctrl+Alt+Win+W from another app brings the window up.

GIVEN the landed plan WHEN the agent checks 1–3 run THEN each passes, or the failure is sent back to its task
Tests:     none of its own
Done when: checks 1–3 pass, and the user's list is in the run's wrap-up
Commit:    none

## Proof

