# 14 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 13
Plan: [plan.md](plan.md)

`wigley:make` walks this in its live session after the test gate. Every runtime, visual and drag check
the other tasks deferred lives here. The change is local tooling at the High risk tier: it adds a new unattended
permissive launch path and real Slack and Jira writes. The live list holds only the checks below.

Run the drive loop from `wigley-ai-gui/.agents/skills/drive/SKILL.md` in the worktree the run lands.

## Fixture run (fake harness)

Start a run with `npm run drive -- start`, then seed it with task 09's self-test fixture (its drive action, or the
fixture's settings as 09 names them).

1. **Expected — Inbox renders every section.** `key Space k i`. Screenshot `inbox`. Check:
   - The nav shows Needs you, You promised, Waiting on others, My threads, Around Slack, Worth knowing and All, each
     with its count. The Needs you count shows hot.
   - Needs you cards carry a warning-colour edge (query the border colour against `--wg-status-warning`), a draft
     box and Send.
   - Waiting cards carry a nudge, Send, Snooze 1 day and Dismiss.
   - Every card has Start session and Add to Board.
   - No text wraps mid-word, which was a spike defect. Run `fit` at the minimum width.
2. **Expected — Board renders columns and moves.** `key Space k j`. Screenshot `board`. Check:
   - The columns run Backlog, Todo, In Progress, In QA, Done, Other.
   - A card head (key, priority) stays on one line.
   - A suggestion shows its reason, Accept and Not yet.
3. **Low-confidence — drag a local task.** Drag it from Todo to In Progress with `drag`, then screenshot `board-drag`. The
   card lands at once with no "Moving…" text, and a restart (`npm run drive -- restart`) keeps it there. No test
   covers drag wiring.
4. **Low-confidence — cross-mode chips.** Click a ticket chip on an Inbox card. The Board shows and flashes that card.
   Click a Board card's "N thread" chip. The Inbox shows filtered to that key.
5. **Expected — Dismiss and Restore.** Dismiss a card. The section count drops. Under All, Restore brings it back.
6. **Low-confidence — the Dock badge.** Read the app log or `query` for the alert count. It equals the number of open
   Needs you items, and it drops by one after a Dismiss.
7. **Expected — keys.** `W` in each view queues a sweep: the status line shows the job queued, and the fake
   harness's owned row opens. Ctrl+n opens the new-session prompt from each view.

## Real Claude run

Start this run with `npm run drive -- start --harness claude --user-config`. It spends tokens, so name the run in the
report. It is read-only against Slack and Jira.

8. **Low-confidence — a real sweep fills the Inbox and Board.** Press `W` in the Inbox.
   - The job row launches unattended in the harness's permissive mode. Confirm `--dangerously-skip-permissions` in the
     row's process command line through the system stats panel (`--system-stats live`), or in the app log line
     the harness writes at launch.
   - The row closes itself when the job is done. Cards then show real Slack items and Jira tickets.
   - The status line names the finished job, and its link opens the job's transcript.
   - Screenshot `inbox-real` and `board-real`.
9. **Low-confidence — work detection on real repos.** After the sweep, a ticket key that has a branch in a watched
   repo, or an open PR, shows a suggested move with its reason. If no such ticket exists, record that in the report.
   Don't create a branch to force one.

## Not run

- **Send, Move to a Jira column, Accept and nudge Send against the real Slack and Jira.** Each one writes to Slack or
  Jira, which happens only on the user's own press. The fixture run covers their wiring up to the queued job. They
  go in the wrap-up's `Not checked:` line.

## Dropped

The task tests already pin these, so the live run skips them:
- Queue ordering and restart rules (05's reducer table).
- Detection's column rules (07).
- Clearing and snooze expiry (08).
- Tool scope refusal (06).
- Git and gh parsing (01, 02).
- Claude's launch args for `'auto'` (03).
