# 07 — Final verification

Status: in progress
Type: Task
Wave: 5 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     none (a drive run; captures stay under `.drive/`)
Consumes:  the landed code of 01–05
Produces:  the live checks below, each with its captures read
Decisions: a relaunch is checked with the drive run's `restart`, which keeps the run's temp home and so its plugin
           data (`.agents/skills/drive/SKILL.md`)

Run under the `drive` skill (`.agents/skills/drive/SKILL.md`) over the fake harness unless a check says otherwise.
Each check names its kind:

1. **Expected — rows survive a restart.** Start one new chat session and resume one of the fake's
   `FAKE_PAST_SESSIONS` (whose history the fake serves), in different folders; send a message in each; select the
   first; `restart`. Both rows are back in the same order, the first selected, each idle in the sidebar, and no
   `process started` log line after the restart. Showing each Chat tab reads its history once: the resumed one draws
   its earlier entries; the new one shows `Earlier conversation not read: …`, since the fake keeps no transcript for
   a session it started.
2. **Expected — first send resumes in place.** In a restored row, send a message: the log shows
   `session <rowId> process started (resume true)`, the reply draws in the same row, and the controls fill in.
3. **Low-confidence — a turn cut off by the restart.** Hold a turn running (the fake's held reply), `restart`: the
   restored row ends with the quit notice. No test covers the save-stop after `killAll` in a real quit.
4. **Expected — close removes for good.** Close a resting row (no confirmation), `restart`: it does not come back;
   the start prompt's saved-session list for its folder still lists it, unarchived.
5. **Low-confidence — an exit rests.** Send `fake: end` in a row: the row stays, a notice gives the exit, the
   status is empty, and the next message gets a reply in the same row (the `chat.ended` scope removal touches
   key wiring a unit test cannot see).
6. **Low-confidence — real Claude.** One `start --harness claude` run: start a session, send one message,
   `restart`, send again; the reply follows the earlier conversation, showing `--resume` took the transcript.

Checks for the user's hands, for the wrap-up only: quit the installed app with `install-app` while a session is
mid-turn, relaunch, and confirm the rows and the quit notice in the visible app.

Done when: every check above passes with its captures read; a failure is fixed under its owning task and the check
           re-run
Commit:    none

## Proof
