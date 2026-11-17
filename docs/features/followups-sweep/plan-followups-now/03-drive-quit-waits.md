# 03 — Drive quit waits on the host's end

Status: not started
Type: Task
Rung: hard · changes when the drive CLI deletes run folders, waiting on another process's end
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md`, "Drive quit should wait on the host's actual end".

Files:
- modify `scripts/drive.mts`
- modify `scripts/drive-runs.mts`
- test `scripts/drive-runs.test.mts`
- modify `.agents/skills/drive/SKILL.md` (step 5, ≈lines 71–73)

Preconditions (run from `wigley-ai-gui/`):

| Claim | Command | Expected |
|---|---|---|
| A plain quit checks the host once, before `stop` | `grep -n 'hostMayBeRunning' scripts/drive.mts` | the import and one call inside `quit` (≈423) |
| `removeQuitEntries` runs right after `stop` with no host check | `sed -n 429,432p scripts/drive.mts` | `await stop(…)` then `removeQuitEntries(runId)` |
| `idleRunIds` skips only a live app | `grep -n 'isLive' scripts/drive-runs.mts` | the `RunFolder` field and the filter |
| `runFolderOf` is synchronous | `grep -n '^function runFolderOf' scripts/drive.mts` | one line |
| The skill states the old sweep | `grep -n 'whose app is not running, a kept run' .agents/skills/drive/SKILL.md` | one line |

Lane H edits `.agents/skills/drive/SKILL.md` in step 5's first lines (≈65–69, "Claude sessions" → "agent sessions");
this task's lines (≈71–73) sit below them. Merge on the newer tip and keep both.

Consumes: `hostMayBeRunning(runDir)` and `quitRefusal(runId, run)` in `scripts/drive-runs.mts` (tree).

Produces:
- `RunFolder.hostMayBeRunning: boolean` in `scripts/drive-runs.mts`
- `HOST_END_TIMEOUT_MS = 15_000` in `scripts/drive.mts`
- `async function waitForHostEnd(runDir: string): Promise<boolean>` in `scripts/drive.mts`

Decisions:
- **The bounded wait.** A plain `quit` (no `--keep-sessions`), after `stop` resolves and before `removeQuitEntries`,
  calls `waitForHostEnd(runDir)`: it polls `hostMayBeRunning(runDir)` every `POLL_MS` until it answers false, true
  when it did within `HOST_END_TIMEOUT_MS`, false otherwise (the shape of `waitForExit`). The host exits once it holds
  no process and no client (`src/session-host/host-server.ts`, `checkExitRule`), which takes seconds after the app's
  plain quit ends its sessions; 15 s covers that with room.
- **Then refuse.** When the wait answers false, `quit` throws `quitRefusal(runId, { liveAppPids: [],
  hostMayBeRunning: true })`: by then no app is left, so that text is true as written ("has no app and its session
  host still runs, so quit deleted nothing; to end it, … start --run <id>, then … quit --run <id>"). The folders stay.
  This covers a plain quit during a kept quit's hold and a quit `stop` ended by SIGTERM, the two cases the follow-up
  names. The refusal before `stop` stays as it is.
- **The idle sweep skips a live host.** `RunFolder` gains `hostMayBeRunning`, `idleRunIds` keeps a run only when
  `!run.isLive && !run.hostMayBeRunning` (besides its other conditions), and `removeIdleRuns` becomes async: it builds
  each run's folder with `hostMayBeRunning: await hostMayBeRunning(runDir)` (only for a run idle past `RUN_IDLE_MS`
  and not live, so a sweep connects to no fresh run's host), and its caller awaits it. `kept` (a home and
  `start.json`) is not the signal: it also holds for a crashed run, so only the host check counts.
- **The pure rule is tested; the wait is a live check.** `idleRunIds` takes the new field in its table; `quit`'s wait
  runs against real processes and is in the final verification's live checks.

GIVEN a run idle past `RUN_IDLE_MS` with no live app whose session host still answers
WHEN a `start` sweeps idle runs
THEN its folder is not deleted

GIVEN a plain `quit` whose app exits but whose host still answers 15 s later
WHEN `quit` runs
THEN it throws the `quitRefusal` text naming `start --run <id>` and the run's `home/` and `user-data/` remain

Tests: `drive-runs.test.mts`, `idleRunIds` table: the base run gains `hostMayBeRunning: false`, and a row is added,
`['idle but its session host may still run', false, { hostMayBeRunning: true }, 'other']`.

Done when: compiles (`npm run typecheck` covers `scripts/`); `npm test` runs `drive-runs.test.mts` and it passes;
`.agents/skills/drive/SKILL.md` step 5 says a plain `quit` waits up to 15 s after its app exits for the session host
to end, and refuses, deleting nothing, if it still answers; and that every `start` deletes each other run folder
untouched for over a day whose app and session host are not running.

Commit: one commit, "drive: quit waits on the session host's end and the idle sweep skips a live host (drive quit follow-up)".

## Proof
