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
   - A card head (key, priority) stays on one line: run `fit` on the head of the fixture card 09 gives a priority
     and the longest title, at the minimum width. Its priority draws as a neutral Tag.
   - A suggestion shows its reason, Accept and Not yet.
3. **Low-confidence — drag a local task.** Drag it from Todo to In Progress with `drag`, then screenshot `board-drag`. The
   card lands at once with no "Moving…" text, and a restart (`npm run drive -- restart`) keeps it there. No test
   covers drag wiring.
4. **Low-confidence — cross-mode chips.** Click a ticket chip on an Inbox card. The Board shows and flashes that card.
   Click a Board card's "N thread" chip. The Inbox shows filtered to that key.
5. **Expected — Dismiss and Restore.** Dismiss a card. The section count drops. Under All, Restore brings it back.
6. **Low-confidence — the Dock badge.** Read the app log or `query` for the alert count. It equals the number of open
   Needs you items, and it drops by one after a Dismiss.
7. **Expected — keys.** `W` in each view queues a sweep: the app log shows `[work] sweep queued`, and the status
   line shows the new job as `Sweep queued` or `Sweep running · started <ago>`, whichever state the queue holds at the
   screenshot. Whether the fake harness then runs it, and its owned row opens, follows 09's rule for a seeded run
   (whether the runner starts in one). Check the outcome 09's doc states, and once a sweep is `done`, check that Show
   transcript draws and opens its row. Ctrl+n opens the new-session prompt from each view.
8. **Expected — a refusal toasts.** Press Add to Board on an Inbox card already on the Board (the fixture's
   `fixture-around`, which holds `WRK-3`). A toast reads `Already on the board as WRK-3`, and the app log holds
   `work.addToBoard failed: Already on the board as WRK-3`.

## Real Claude run

Start this run with `npm run drive -- start --harness claude --user-config`. It spends tokens, so name the run in the
report. It is read-only against Slack and Jira.

9. **Low-confidence — a real sweep fills the Inbox and Board.** Press `W` in the Inbox.
   - The job row launches unattended in the harness's permissive mode. Confirm `--dangerously-skip-permissions` in the
     row's process command line through the system stats panel (`--system-stats live`), or in the app log line
     the harness writes at launch.
   - The row closes itself when the job is done. Cards then show real Slack items and Jira tickets.
   - The status line names the finished job, and its link opens the job's transcript.
   - Screenshot `inbox-real` and `board-real`.
10. **Low-confidence — work detection on real repos.** After the sweep, a ticket key that has a branch in a watched
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
