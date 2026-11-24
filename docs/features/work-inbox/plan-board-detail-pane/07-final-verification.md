# 07 — Final verification

Status: not started
Type: Task
Wave: 6 · Depends on: 06 (runs after the test gate, on the landed tree)
Plan: [plan.md](plan.md)

Files:     none (verification only; a fix it finds goes back to the task that owns the file)

`wigley:make` walks this task once, in its live session, after its test gate. Run every command from
`wigley-ai-gui/` in the worktree, with Node from `.nvmrc` (`source ~/.nvm/nvm.sh && nvm use && …`).

Checks (each tagged with its confidence):

1. `npm run typecheck`, `npm run lint` and `npm test` pass. Expected.
2. `npm run selftest -- --plugin work --plugin demo` passes. The work plugin's script covers Inbox mode and Board mode,
   with the pane steps 05 adds. The demo script walks every demo step, the two pane steps included. Expected.
3. Drive run of the dev app on the work self-test's seed (the `drive` skill, `wigley-ai-gui/.agents/skills/drive/SKILL.md`):
   - Board: the cursor on a Jira card, `Enter` opens the pane on the right with the card's fields, description,
     comments, linked threads and comment box; `j` moves the cursor and the pane follows; `Ctrl+Shift+j` scrolls the
     pane half a page; `Enter` closes it. Screenshot open and closed. Expected.
   - Board: a local task's pane shows its source thread's messages and a reply box. Screenshot. Expected.
   - Board: type a comment with `i`, press `Cmd+Enter`; the pane shows `Posting…` under the box. Low confidence: the
     drive run launches no worker, so the job never ends; the check reads only the queued state.
   - Inbox: `Enter` opens the pane on the cursor thread with the summary, root message, replies, the "N of M replies"
     line and the reply box; the cards slim to title, meta and latest line; closing the pane brings the summary back on
     each card. Screenshot both. Expected.
   - Both views: reload the page with the pane open; the pane is still open at the same width. Expected.
   - Both views: narrow the window under 640px; the split stacks as `DESIGN.md` says. Screenshot. Expected.
4. Check each screenshot against `DESIGN.md`'s Inbox and Board bullets and the look the user signed off after 03.

Not walked here (the wrap-up names them in one `Not checked:` line):

- A real sweep through the user's Jira and Slack connectors that fills detail and skips unchanged records: only the
  installed app's live run launches workers.
- A real Comment job posting to Jira.

Done when: every Expected check passes, and each low-confidence check's result is in the Run log.

## Proof

