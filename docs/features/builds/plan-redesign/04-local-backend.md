# 04 — Local log saves

Status: not started
Type: Task
Rung: standard · follows `cancel`'s run lookup in `local-backend.ts`; adds no seam, and the copy is one awaited call
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/builds-local/main/local-backend.ts`
- test `src/plugins/builds-local/main/local-backend.test.ts`

Consumes:  `Files.copy(from: string, to: string): Promise<void>` ← 01 · `BackendCapabilities.saveLog`,
`BuildBackend.saveLog?(game: GameEntry, buildId: string, jobId: string | null, path: string): Promise<void>` ← 02

Produces:  `saveLog(game, buildId, jobId, path)` on the backend `createLocalBackend` returns, and
`capabilities: { cancel: true, choosesBranch: false, saveLog: true }`

Decisions:
- **Lookup.** `saveLog` reads the runs with `readRuns(dataFiles)` and finds the run whose `id` is `buildId` and whose
  `gameId` is `game.id`. It does not run through `chain`: a copy of a long log must not hold up a list, and a read of
  `runs.json` changes no state. No run rejects `No local build <buildId>`, the text `cancel` uses.
- **Jobs.** A local build lists no jobs. A `jobId` that is not null rejects `A local build has no jobs`. The lookup
  runs first: an unknown build with a job id rejects `No local build <buildId>`.
- **Copy.** `services.files.copy(fullPath(run, LOG_FILE), path)`. `fullPath` gives the full path under
  `services.dataFolder`, which the unscoped `services.files` takes; `path` is outside the data folder, so the scoped
  `dataFiles` cannot copy it.
- **Missing log.** A copy that rejects with `isMissingFile` rejects
  `The build <buildId> wrote no log at <full log path>`. Every other failure rejects with the copy's own error.
- A running build's log is copied as it stands at the call. The lookup reads no run state, so a finished run's log
  copies the same way; the test rows use the running run `startFirstRun` leaves.

GIVEN a run with a log WHEN `saveLog(game, id, null, '/dl/x.log')` runs THEN `/dl/x.log` holds the log's
text.
GIVEN a run with no log file WHEN `saveLog` runs THEN it rejects with a message that holds the log's full path.
GIVEN no run with that id WHEN `saveLog` runs THEN it rejects `No local build <id>`.
GIVEN `jobId` `'x'` WHEN `saveLog` runs THEN it rejects `A local build has no jobs`.

Tests:
- `local-backend.test.ts`, `'creates a backend that cancels and builds the folder as it stands'` (line 284): the
  expected capabilities gain `saveLog: true`.
- `local-backend.test.ts`, a new `describe('saveLog')` with one table `'$case'`. `setup()`'s `services.files` and
  `dataFiles` are two memory instances, so a row that needs the log writes it through `services.files.write` at the
  run's full path (`/data/runs/<game id>/<kind>/<startedAt>/log.txt` on macOS). Start each row with `startFirstRun`.
  Rows, each with a literal expected outcome:
  - `copies the run's log`: log text `line 1\nline 2\n` → `/dl/x.log` reads `line 1\nline 2\n`
  - `names the missing log`: no log written → rejects with a message containing
    `/data/runs/<game id>/<kind>/1000000/log.txt` (fill the ids from `testGame` and `QUEUE_OK`)
  - `refuses an unknown build`: build id `demo/dev/1` → rejects `No local build demo/dev/1`
  - `refuses a job`: job id `'x'` on the started run → rejects `A local build has no jobs`
  - `looks the build up before the job`: build id `demo/dev/1`, job id `'x'` → rejects `No local build demo/dev/1`
  - `rethrows the copy's own error`: `services.files.copy` replaced by a spy that rejects `new Error('disk full')` →
    rejects `disk full`, and the message does not contain `wrote no log`
  The rows run on macOS only: the Windows path join is already covered by the queue tests.

Done when: compiles; the test gate runs `local-backend.test.ts`.
Commit:    one commit for the group

## Proof

