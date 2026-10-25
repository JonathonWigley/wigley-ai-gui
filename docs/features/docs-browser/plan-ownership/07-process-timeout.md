# 07 — Process timeout

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui

Files:     modify `src/contracts/processes.ts` · `src/main/processes/node-processes.ts` · `src/shared/fake-processes.ts`
           test `src/main/processes/node-processes.test.ts` · create `src/shared/fake-processes.test.ts`
           test (a `ProcessResult` literal gains `timedOut: false`, nothing else): `src/main/drive/frame-recorder.test.ts`
           (line 44) · `src/plugins/docs/main/index-sources.test.ts` (the `exited` helper) ·
           `src/plugins/docs/main/start.test.ts` (the scripted result in `sessionSource_RegisteredWhileConnected`)
Consumes:  `ProcessRunner`, `ProcessResult` in `src/contracts/processes.ts` (exist)
Produces:  `timedOut: boolean;` (member of `ProcessResult`) in `src/contracts/processes.ts`
           `options?: { cwd?: string; timeoutMs?: number },` (the `run` parameter) in `src/contracts/processes.ts`
           `timeoutMs: number | undefined;` (member of `FakeRun`) in `src/shared/fake-processes.ts`
Decisions: - `run` options gain `timeoutMs?: number`; `ProcessResult` gains `timedOut: boolean`, false for every run that
             ends on its own (pinned by lead).
           - Past `timeoutMs` the node adapter kills the child with `child.kill('SIGKILL')` and resolves at once with
             `{ code: -1, stdout, stderr, timedOut: true }`, `stdout` and `stderr` the UTF-8 of the chunks received so
             far (pinned by lead). It resolves at the kill, not on `close`: a grandchild that holds the pipes (`ssh`
             under `git fetch`) would keep `close` from firing. After the kill it destroys `child.stdout` and
             `child.stderr`, and a later `close` or `error` changes nothing (Decided).
           - A run with no `timeoutMs` sets no timer and behaves as today. A run that ends or fails to start clears
             its timer (Decided).
           - A grandchild is not killed: the adapter does no process-group kill, which only POSIX has (`AGENTS.md`
             § Intent: no `process.platform` check). Noted for task 14's live fetch check (Decided).
           - The fake records each run's `timeoutMs` (`undefined` when not given) in `FakeRun`, so a test can check
             the cap a caller passed. A test scripts a timed-out result as a plain `ProcessResult` with
             `timedOut: true` through `script`; the fake adds no timer (pinned by lead: "the fake can script a
             timed-out result").
           - The contract comments say: `code` is -1 when a signal ended the program or the timeout killed it;
             `timedOut` is true only when `timeoutMs` passed and the program was killed; `run` resolves, not
             rejects, on a timeout.
GIVEN a program that exits 3 WHEN run THEN `{ code: 3, stdout: 'out', stderr: 'err', timedOut: false }`
GIVEN a program that writes `partial` then waits 60 s WHEN run with `timeoutMs: 500` THEN it resolves within 5 s to
      `{ code: -1, stdout: 'partial', stderr: '', timedOut: true }`
GIVEN a program that exits 0 at once WHEN run with `timeoutMs: 10000` THEN `code` 0 and `timedOut` false
GIVEN a fake run with `timeoutMs: 15000` WHEN the test reads `runs` THEN that run's `timeoutMs` is 15000
Tests:     `run_ExitThree_ReturnsCodeAndOutput` — the expected value gains `timedOut: false`
           `run_PastTimeout_KillsAndResolvesTimedOut` — script `process.stdout.write("partial"); setTimeout(() => {}, 60000)`,
             `timeoutMs: 500` → equals `{ code: -1, stdout: 'partial', stderr: '', timedOut: true }`, and the run took
             under 5000 ms (vitest timeout 10000 on this test)
           `run_EndsBeforeTimeout_NotTimedOut` — script `process.exit(0)`, `timeoutMs: 10000` → `code` 0, `timedOut` false
           in `fake-processes.test.ts`:
           `run_TimeoutMs_Recorded` — `run('git', ['fetch'], { timeoutMs: 15000 })` after a script for it →
             `runs` equals `[{ command: 'git', args: ['fetch'], cwd: undefined, timeoutMs: 15000 }]`
           `run_ScriptedTimedOut_ResolvesIt` — script `{ code: -1, stdout: '', stderr: '', timedOut: true }` → the run
             resolves to it
           `run_NothingScripted_Rejects` — rejects `FakeProcesses: no result scripted for git status`
Done when: `npm run typecheck`, `npm test` and `npm run lint` pass
Commit:    one commit for the group, in wigley-ai-gui, committed by path only (peer sessions have uncommitted edits)

## Lead rulings (cold plan reader)

- The timeout test's child writes `partial` and then waits on stdin for ever. The cap is 3000 ms. Assert `timedOut: true`, `code: -1` and that stdout holds `partial`. No start-up race decides the result.

## Proof

Commit gui d4ad2fae · proof: diff read: timeoutMs and timedOut present in contracts/processes.ts, adapter and fake; tsc clean · concerns: none
