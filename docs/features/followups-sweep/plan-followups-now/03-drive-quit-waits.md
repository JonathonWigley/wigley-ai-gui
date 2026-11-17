# 03 — Drive quit waits on the host's end

Status: not started
Type: Task
Rung: deep · crosses the app and session-host processes through a bounded wait and folder deletion; the host-exit claim is marked low-confidence in task 19
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
- `export function isIdleRun(run: Pick<RunFolder, 'lastUsedMs'>, nowMs: number): boolean` in `scripts/drive-runs.mts`
- `export async function waitForHostEnd(runDir: string, deps: HostEndDeps): Promise<boolean>` and
  `export interface HostEndDeps { probe(runDir: string): Promise<boolean>; pollMs: number; timeoutMs: number;
  now(): number; wait(ms: number): Promise<void> }` in `scripts/drive-runs.mts`
- `HOST_END_TIMEOUT_MS = 15_000` in `scripts/drive.mts`

Decisions:
- **The bounded wait.** A plain `quit` (no `--keep-sessions`), after `stop` resolves and before `removeQuitEntries`,
  calls `waitForHostEnd(runDir, { probe: hostMayBeRunning, pollMs: POLL_MS, timeoutMs: HOST_END_TIMEOUT_MS, now:
  Date.now, wait })`. It lives in `drive-runs.mts` with its clock, sleep and probe passed in, so a test pins the
  deadline. Its body has the shape of `waitForExit`: `deadline = now() + timeoutMs`; while `await probe(runDir)`
  answers true, return false once `now() > deadline`, else `await wait(pollMs)`; return true when the probe answers
  false. The host exits once it holds
  no process and no client (`src/session-host/host-server.ts`, `checkExitRule`), which takes seconds after the app's
  plain quit ends its sessions; 15 s covers that with room.
- **Then refuse.** When the wait answers false, `quit` throws `quitRefusal(runId, { liveAppPids: [],
  hostMayBeRunning: true })`: by then no app is left, so that text is true as written ("has no app and its session
  host still runs, so quit deleted nothing; to end it, … start --run <id>, then … quit --run <id>"). The folders stay.
  This covers a plain quit during a kept quit's hold and a quit `stop` ended by SIGTERM, the two cases the follow-up
  names. The refusal before `stop` stays as it is.
- **The idle sweep skips a live host.** `RunFolder` gains `hostMayBeRunning`, and `idleRunIds` keeps a run only when
  `!run.isLive && !run.hostMayBeRunning` (besides its other conditions). The idle test moves into `isIdleRun`
  (`nowMs - run.lastUsedMs > RUN_IDLE_MS`), which `idleRunIds` calls, so the rule has one copy. `runFolderOf` stays
  synchronous and returns `Omit<RunFolder, 'hostMayBeRunning'>`. `removeIdleRuns` becomes async and its caller in
  `start` awaits it: it takes `nowMs = Date.now()` once, and for each folder in turn sets `hostMayBeRunning:
  !folder.isLive && isIdleRun(folder, nowMs) && (await hostMayBeRunning(runDirOf(folder.id)))`, so a sweep connects
  to no fresh or live run's host; it passes the same `nowMs` to `idleRunIds`. `kept` (a home and `start.json`) is not
  the signal: it also holds for a crashed run, so only the host check counts.
- **The rules are tested; the real host's end is a live check.** `idleRunIds` takes the new field in its table, and
  `waitForHostEnd` runs against a fake probe and clock. The wait against a real host is in the final verification's
  live checks.

GIVEN a run idle past `RUN_IDLE_MS` with no live app whose session host still answers
WHEN a `start` sweeps idle runs
THEN its folder is not deleted

GIVEN a plain `quit` whose app exits but whose host still answers 15 s later
WHEN `quit` runs
THEN it throws the `quitRefusal` text naming `start --run <id>` and the run's `home/` and `user-data/` remain

GIVEN a host whose probe answers true twice, then false
WHEN `waitForHostEnd` runs
THEN it answers true after two waits

GIVEN a host whose probe always answers true
WHEN `waitForHostEnd` runs with `timeoutMs` 1000 and `pollMs` 250
THEN it answers false once the fake clock passes the deadline, with no real sleep

Tests (in `drive-runs.test.mts`):
- `idleRunIds` table: the base run gains `hostMayBeRunning: false`, and a row is added,
  `['idle but its session host may still run', false, { hostMayBeRunning: true }, 'other']`.
- a new `describe('waitForHostEnd')` with an `it.each` table, titled
  `'GIVEN a host whose probe answers %s THEN the wait answers %s'`. Each row's deps: a clock at 0, `now` reading it,
  `wait(ms)` adding `ms` to it and resolving, `pollMs: 250`, `timeoutMs: 1000`, and `probe` answering the row's list
  in turn (the last answer repeating), counting its calls. Rows:
  - `'true, true, then false'`, answers `[true, true, false]` → `true`, 3 probes, clock 500
  - `'true until the deadline'`, answers `[true]` → `false`, 6 probes, clock 1250

Done when: compiles (`npm run typecheck` covers `scripts/`); `npm test` runs `drive-runs.test.mts` and it passes;
`.agents/skills/drive/SKILL.md` step 5 says a plain `quit` waits up to 15 s after its app exits for the session host
to end, and refuses, deleting nothing, if it still answers; and that every `start` deletes each other run folder
untouched for over a day whose app and session host are not running.

Commit: one commit, "drive: quit waits on the session host's end and the idle sweep skips a live host (drive quit follow-up)".

## Proof
