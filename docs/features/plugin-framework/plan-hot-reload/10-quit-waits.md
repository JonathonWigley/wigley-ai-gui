# 10 — Quit waits for every stop

Status: not started
Type: Task
Wave: 6 · Depends on: 08
Plan: [plan.md](plan.md)

Files:
- create `src/main/quit-wait.ts` · test `src/main/quit-wait.test.ts`
- modify `src/main/main.ts` (`runQuitTasks` and its comment, and the call that starts the wait). Task 08 edits `main.ts` first, to wire the plugin switch. Write against `main.ts` as 08 leaves it, and find each member by name.

Consumes:
- `PluginHost.stopping(): readonly string[]` in `src/shared/plugin-host.ts` ← 02
- The main host as task 08 leaves it held in `main.ts` (today `let mainHost: PluginHost<MainStart<PluginManifest>> | null`) ← 08
- `startQuitWork`, `runQuitTasks`, `quitWork`, `runMode`, and the module-level `timers: Timers` in `src/main/main.ts` (the tree holds them).
- `Timers` in `src/contracts/ambient.ts`; `Log` in `src/contracts/log.ts`.

Produces:
- `src/main/quit-wait.ts`:
  ```ts
  // How long a quit runs before it logs the parts it is still waiting on.
  export const QUIT_WAIT_LOG_MS = 5000;
  // Logs `quit is waiting on <ids>` under source `quit`, once, when `work` has not settled after
  // QUIT_WAIT_LOG_MS and `stopping()` names a part. Clears its timer when `work` settles first.
  export function logSlowQuit(
    work: Promise<unknown>,
    stopping: () => readonly string[],
    timers: Timers,
    log: Log,
  ): void;
  ```
- The log line `[quit] quit is waiting on <id>, <id>`: source `quit`, message `quit is waiting on ` plus the ids `stopping()` returns, joined with `, `.

Decisions:
- **The live app holds the quit (user).** Quit waits for every quit task to settle, with no cap. `runQuitTasks` holds the live app's quit the way it holds a drive run's: it calls `event.preventDefault()`, and calls `app.exit(0)` once the quit work settles. Every run mode that reaches `runQuitTasks` now holds. The self-test does not reach it: its exit skips `will-quit`, as today.
- **A second quit during the hold (agent).** A drive run exits at once on a second `will-quit`, as today, since the drive CLI's SIGTERM must end the run. The live app keeps the hold: a second `will-quit` while `quitWork` is not null calls `event.preventDefault()` and returns. It starts no second quit work. Reason: the user rejected a cap because quitting past a hung stop cuts the save the wait is for, and a second Cmd+Q would do just that.
- **The quit step is a pure function (agent).** `quit-wait.ts` also exports `quitStep(runMode: RunMode, quitStarted: boolean): 'start' | 'exit' | 'hold'`: the first quit starts in every mode; a second quit in a drive run exits; a second quit in the live app holds. `runQuitTasks` acts on it, so the drive-versus-live split has a test.
- **The 5-second line (user). `runQuitTasks` calls `logSlowQuit(work, stoppingParts, timers, quitLog)` once, on the first `will-quit`, in every run mode that holds. At quit the page has gone, so the main host is the only host still stopping parts.
  - `runQuitTasks` is module-level, and `mainHost` is a local of `createWindow`. Add a module-level `let stoppingParts: () => readonly string[] = () => [];` beside `quitTasks`. `createWindow` sets it to `() => mainHost?.stopping() ?? []` where it declares `mainHost`. Before the window exists, it reads `[]`.
  - The line names only the parts in flight at that moment. `stopAll` stops one part at a time, so a hung stop shows as its one id.
  - When `stopping()` is empty at 5 s (a quit task other than a part's stop is slow), no line is logged.
  - The line is logged once: the timer is one-shot and is not set again.
- **The timer is the injected `Timers` (agent).** `logSlowQuit` takes `Timers` from `src/contracts/ambient.ts`. `main.ts` passes its module-level `timers`, the same object it hands the plugins' services and the session host. The test passes a fake. No `setTimeout` is called in `quit-wait.ts`.
- **Where the line goes (agent).** At `will-quit` every window has closed, so the page log drops the line. `quitLog` writes to stderr in every run mode, the live app included: `(source, message) => process.stderr.write(\`wigley-ai-gui ${source}: ${message}\n\`)`, the format `startMainParts`' host log uses outside the live app. So the drive CLI keeps the line in the run's `app.log`, and a dev app started from a terminal prints `wigley-ai-gui quit: quit is waiting on <ids>`. The `[quit] …` form is how the page log would show the same source and message.
- Rewrite the comment above `runQuitTasks`. Remove "The user's app quits without waiting, so a task still running when it exits is cut short." State the hold, the live second-quit rule and the 5-second line.

GIVEN a quit whose main part `chat` has not finished stopping WHEN 5 seconds pass THEN stderr gets `wigley-ai-gui quit: quit is waiting on chat` once, and the app quits once the stop settles
GIVEN a quit whose tasks settle in 1 second WHEN the quit runs THEN no `quit is waiting` line is written and the app quits
GIVEN the live app is holding its quit WHEN the user quits again THEN the app keeps waiting

- `quitStep_` `it.each`: (live, false) → `start`; (drive, false) → `start`; (drive, true) → `exit`; (live, true) → `hold`. Break: a second Cmd+Q cuts the save, or a drive run hangs on SIGTERM.

Tests (`src/main/quit-wait.test.ts`, with a fake `Timers` that records each `set` and `clear` and runs a set callback on demand; a deferred promise for `work`):
- `it.each` `logSlowQuit_TimerFires_LogsStoppingIdsOnce`. Rows:
  - `stopping` returns `['chat', 'docs']` → the log holds exactly `[['quit', 'quit is waiting on chat, docs']]`
  - `stopping` returns `['chat']` → `[['quit', 'quit is waiting on chat']]`
  - `stopping` returns `[]` → the log is empty
  Each row also asserts the one `set` call's `ms` is `QUIT_WAIT_LOG_MS` (by name, not `5000`).
- `logSlowQuit_WorkSettlesFirst_ClearsTheTimerAndLogsNothing`: resolve `work`, flush microtasks; the fake recorded one `clear` with the handle `set` returned; the log is empty.

Done when:
- `npm run typecheck` passes; the test gate runs `src/main/quit-wait.test.ts`.
- `grep -n "logSlowQuit" src/main/main.ts` prints the one call in `runQuitTasks`.
- The live quit is a user check. Task 13 lists it in the user's wrap-up: start the dev app from a terminal, quit it, and see it close only after the stops finish. A hung stop past 5 seconds prints `wigley-ai-gui quit: quit is waiting on <id>` there.

Commit: one commit for the group

## Proof
