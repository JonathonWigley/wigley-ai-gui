# 05 — Final verification

Status: not started
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
Model control to Haiku and its Effort control to Low, to keep the spend small.

1. **expected** — Claude's own turn shows working. In a new session, send: `Start a background subagent that runs
   the shell command "sleep 20" and then replies "done". Do not wait for it; reply "started" now.` After Claude's
   reply the session shows idle; when the subagent ends, Claude runs its task-notification turn and the session shows
   working through it, then idle. Reason: the tracker's init-opens-a-turn rule against the real stream.
2. **low-confidence** — a message sent while Claude's own turn runs. During step 1's notification turn (or a second
   background run if the timing missed), send `Reply "two".` The message waits in the pending queue while the session
   shows working, is written when the turn ends, and its own turn ends idle. Reason: this is the exact sequence of the
   bug; chat main's queue and the harness's activity meet here and no test drives both with the real CLI.
3. **low-confidence** — interrupt recovers. While a turn runs, press interrupt: the session ends idle and the next
   message sends. Reason: the interrupt now calls `interruptAnswered`; the real CLI's answer shape on a running turn
   is checked here.

Each check passes when the drive's screen captures show the activity as stated. Record the drive run's folder name.

Done when: the gate passes and every live check passes, or a failed check is reported with its captures.
Commit:    none

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
