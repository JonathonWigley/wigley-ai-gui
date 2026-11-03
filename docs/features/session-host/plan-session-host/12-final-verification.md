# 12 — Final verification

Status: not started
Type: Task
Wave: 6 · Depends on: 11
Plan: [plan.md](plan.md)

Files:     none (a check that finds a bug goes back to the task that owns the code)
Consumes:  every earlier task
Produces:  a report of each check below: passed, or the failure with its evidence
Decisions: live checks cover only what no test pins (`wigley:writing-tests` § What earns a live run instead);
           each check below is tagged expected or low-confidence with its reason

Setup:

- Run on macOS. Leave the user's stable app and its sessions alone.
- The app under test is the dev app (`npm start`), which the agent starts itself. A drive run (`npm run drive`)
  may replace it for checks 1, 2, 5, 6 and 7, when its home holds a signed-in Claude profile. In a drive run, "quit
  and relaunch" is `npm run drive -- restart`: a restart keeps the run's hosted processes (task 08), and only the
  run's final `npm run drive -- quit` stops them. Checks 3 and 4 use the dev app: in check 3 the relay restarts the
  dev or stable app, never a drive run; check 4 needs the app closed for over a minute, and a drive run has no
  command that quits it and keeps the run.
- Each check uses a real Claude session started in the Chat tab, with a cheap prompt. A long turn comes from a
  prompt such as: "Run `sleep 90` in Bash, then reply DONE." (`sleep` here is the agent's Claude session's tool
  call, not a shell call of the verifier.)
- Find the host with `ps -ax | grep session-host`. Its folder (pipe logs in `logs/`, and `host-v<N>.json`) is
  `~/Library/Application Support/wigley-ai-gui-dev/session-host/` for the dev app, and
  `.drive/<run>/user-data/session-host/` for a drive run.

Checks:

1. **Quit mid-turn, relaunch, re-attach** — expected (the feature's main path; replay is unit-tested, the wiring
   to the host, chat restore and the page are not). Start the long turn. Quit the app while `sleep` runs. Check that
   the `claude` process and the host still run. Relaunch. Then:
   - the row shows working, then DONE arrives;
   - no entry shows twice;
   - entry times are the original times, not the relaunch time;
   - no turn-finished alert fires for work that finished while the app was closed.
2. **Queued message across a restart** — low-confidence (new save and send path across two processes). During a
   long turn, queue a second message. Quit and relaunch. The pending row shows again, and it is sent once the turn
   ends.
3. **Permission prompt across a restart** — low-confidence (the relay change and chat's restore wait meet only
   live). In a row in `default` permission mode, ask for a Bash command that prompts. While the prompt shows, quit
   and relaunch within 30 s. The prompt shows again; Allow runs the tool and the turn finishes.
4. **Idle window** — expected (the host's timer is unit-tested; the setting's path to the host is not). Set
   `chat.keepIdleMinutes` to 1. Let a turn finish, quit, wait past one minute. The `claude` process is gone and
   the host has exited. Relaunch: the row rests; a new message resumes the session.
5. **Stop all** — expected (key and page-to-main wiring). With two rows working, press `<Leader>:`. Both processes
   end, both rows rest, and the next message in each resumes it.
6. **Older host drains** — low-confidence (two protocol versions meet only live). Start a long turn. Quit. Raise
   `SESSION_HOST_PROTOCOL` by one in the working tree and relaunch the dev app. The row shows the
   finishing-in-another-app-version notice and refuses a send. Once DONE lands in the transcript and the old process
   ends, a send resumes the session. Revert the protocol edit; commit nothing from this check.
7. **Host dies while the app runs** — low-confidence (failure path). With a turn running, kill the host process.
   The row rests with the exit notice; the next message resumes it.

8. **Drive teardown** — expected (the quit-task order and the `keepSessions` flag are proven only live). In a drive
   run, start the long turn. Run `npm run drive -- restart`: the `claude` process survives and the row re-attaches.
   Run `npm run drive -- quit`: the `claude` process and the host are gone.

The `install-app` checks (macOS and Windows) and the Windows install checks from tasks 03 and 04 touch the user's
stable app or need a Windows machine. They are not run here; the run's wrap-up lists them for the user.

Done when: each check above passed, or its failure is reported with evidence and routed to its task.
Commit:    none, unless a fix lands through its owning task.

## Proof

