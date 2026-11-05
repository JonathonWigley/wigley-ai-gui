# 03 — Final verification

Status: in progress
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     none
Consumes:  the landed work of 01 and 02
Produces:  nothing

Run through the project's own drive tooling (`AGENTS.md`). Launch no browser.

Checks:

- Expected: the layout preview draws `Sent`, `Received` and `Not received` under user bubbles, and `Received` appears on the last user entry only. Capture a screenshot.
- Low-confidence: replay real pipe logs from `~/Library/Application Support/wigley-ai-gui/session-host/logs/` through `replayPipeLog`, read-only. Every message with a `requesting` line that names it ends as `received`, a `/wigley:*` skill message included. `/compact` ends as `null`. This checks the fold against real lines, where the fold's tests use built lines. Run it with `npm test --` on a temporary test file, `src/main/claude-code/delivery-log-check.test.ts`. Delete that file after the run and do not commit it.

The agent cannot reach a real API failure from here. List this for the user in the wrap-up, and record it nowhere else:

- Send a message, and interrupt it at once. The bubble shows `Not received` when no response began, and `Received` when one did. The timing of an interrupt this early is not measured in `claude-stream.md`, so a bubble left on `Sent` after the turn ends is a bug to report.

Done when: each check above has a result in the Proof section.
Commit:    no code. Fix anything the checks find, in its own commit.

## Proof

