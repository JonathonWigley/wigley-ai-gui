# 05 — Final verification

Status: in progress
Type: Task
Wave: 5 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     none modified
Consumes:  the landed code of 01, 02, 03
Produces:  the verification report
Decisions: the live checks below are the ones a unit test cannot settle: the real CLI's frames reaching the real
           adapter, and chat main's queue following the activity

## Gate

- `npm run typecheck`, `npm run lint`.
- The test picks of 01–03: `src/main/claude-code/stream-decoder.test.ts`, `turn-tracker.test.ts`,
  `claude-code-harness.test.ts`, `claude-controls.test.ts`, and `src/plugins/chat/main/chat-sessions.test.ts` (chat
  main reads the activity the harness emits; run it to confirm the on-change emission breaks none of its cases).
- `npm run selftest -- --plugin chat`.

## Live checks

A drive run against the real CLI, per `.agents/skills/drive/SKILL.md`, started with `--harness claude`. It spends
Claude tokens on the user's profile: name the run and its model in the report. Before step 1, set the session's
Model control to Haiku and its Effort control to Low through the composer's control pickers (their keys are in the
chat keymap), to keep the spend small. A picker that fails to set either is a task 03 finding.

**Observable.** Working versus idle is the composer's running indicator, `.chat-running` (a running dot and the
interrupt keys, hidden while not working): read its computed `visibility` with the drive's `query`, and capture a
screenshot at each change. The run's `app.log` backs each reading.

1. **expected** — Claude's own turn shows working. In a new session, send: `Start a background subagent that runs
   the shell command "sleep 20" and then replies "done". Do not wait for it; reply "started" now.` After Claude's
   reply the session shows idle; when the subagent ends, Claude runs its task-notification turn and the session shows
   working through it, then idle. Reason: the tracker's init-opens-a-turn rule against the real stream.
2. **low-confidence** — a message sent while Claude's own turn runs. During step 1's notification turn (or a second
   background run if the timing missed), send `Reply "two".` The message waits in the pending queue while the session
   shows working, is written when the turn ends, and its own turn ends idle. Reason: this is the exact sequence of the
   bug; chat main's queue and the harness's activity meet here and no test drives both with the real CLI.
3. **low-confidence** — interrupt recovers. While a turn runs (send `Count from 1 to 200, one number per line.`),
   press Ctrl+C: the session ends idle within 5 s and the next message sends. Reason: the interrupt now calls
   `interruptAnswered` and starts the grace timer; the real CLI's answer on a running turn is checked here.
4. **low-confidence** — a second Ctrl+C ends the process. Send the same count message, press Ctrl+C twice within 1 s:
   the `Interrupted again; ending the Claude process.` notice shows, the row rests, and the next message resumes the
   session (its earlier entries stay). Reason: the kill path runs only with the real process and chat main's `ended`
   handling together.

Steps 1 and 2 depend on Haiku starting a background subagent. Before judging them, confirm in the session's raw
entries or `app.log` that a result with `origin.kind` `task-notification` arrived. If none did, the check is void,
not failed: retry once, then report that the model did not start the background task.

Each check passes when the observable shows the activity as stated. Record the drive run's folder name.

**Covered by tests only.** The fold of a written message into Claude's own turn (the bug's exact race, a gap of
milliseconds between an idle emission and the next init) and the interrupt sent to an idle process cannot be timed
from a drive run: tasks 02 and 03 pin them (`activity_MessageFoldedIntoClaudesOwnTurn_EndsIdle`,
`interrupt_Answered_EndsIdleOnlyWhenNoTurnIsOpen`, `interrupt_UnansweredForTheGrace_ShowsIdleWithNotice`).

Done when: the gate passes and every live check passes, or a failed check is reported with its captures.
Commit:    none

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
