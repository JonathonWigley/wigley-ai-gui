# 03 — TeamCity jobs and log saves

Status: not started
Type: Task
Rung: hard · new parse rule (the transitive reduction) and a changed cache record; neither is async or lifecycle
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/builds-teamcity/main/teamcity-parse.ts`
- modify `src/plugins/builds-teamcity/main/teamcity-backend.ts`
- test `src/plugins/builds-teamcity/main/teamcity-parse.test.ts`
- test `src/plugins/builds-teamcity/main/teamcity-backend.test.ts`
- modify `src/plugins/builds-teamcity/main/fixtures/chain-running.json`
- modify `src/plugins/builds-teamcity/main/fixtures/chain-finished.json`
- modify `src/plugins/builds-teamcity/main/fixtures/chain-failed.json`

Consumes:  `BuildJob.webUrl`, `startedAt`, `finishedAt`, `dependsOn`, `BackendCapabilities.saveLog`,
`BuildBackend.saveLog?(game: GameEntry, buildId: string, jobId: string | null, path: string): Promise<void>` ← 02 ·
`BackendServices.files` (exists)

Produces:
- `const SAVE_LOG_TIMEOUT_MS = 300_000;` in `teamcity-backend.ts`
- `saveLog(game, buildId, jobId, path)` on the backend `createTeamcityBackend` returns, and
  `capabilities: { cancel: false, choosesBranch: true, saveLog: true }`

Decisions:
- **Detail fields.** `DETAIL_FIELDS` becomes, verbatim:
  `id,state,snapshot-dependencies(build(id,buildTypeId,state,status,statusText,percentageComplete,webUrl,startDate,finishDate,buildType(name),running-info(percentageComplete,leftSeconds,currentStageText),revisions(revision(version)),snapshot-dependencies(build(id))))`.
  It stays one `teamcity api` GET per build (plan.md Preconditions).
- **Job fields** (`buildJobOf` in `teamcity-parse.ts`), for every state: `webUrl` is `stringOrNull(row.webUrl)`;
  `startedAt` is `parseTeamcityDate(row.startDate)`; `finishedAt` is `parseTeamcityDate(row.finishDate)`. A queued
  job has no dates, so both read null.
- **`dependsOn`** is computed in `parseChainDetail` once every dependency row is read, since it needs the whole
  chain. The rule:
  1. `own(j)` = the numeric `id`s of `j`'s row's `snapshot-dependencies.build[]` that are ids of jobs in this chain,
     without `j` itself. A row with no such list has `own(j) = []`.
  2. `reach(j)` = every id reachable from `j` through `own`, `j` excluded. Compute it with a visited set, so a cycle
     in bad data ends. This holds whether TeamCity gives each job its transitive set (it does today, plan.md
     Preconditions) or only its direct set.
  3. `dependsOn(j)` = the ids `m` in `own(j)` such that no other member `k` of `own(j)` has `m` in `reach(k)`.
  4. Order `dependsOn(j)` by the order of `jobs`, and give ids as strings, as `BuildJob.id` is.

  ```ts
  // own: id → its in-chain prerequisite ids; reach(k) per the rule above
  const direct = own.get(j).filter((m) => !own.get(j).some((k) => k !== m && reach(k).has(m)));
  ```
- **Log saves.** `saveLog(game, buildId, jobId, path)` runs
  `runTeamcity(cli, ['api', `/downloadBuildLog.html?buildId=${jobId ?? buildId}`], SAVE_LOG_TIMEOUT_MS)` and writes
  the answer to `path` with `services.files.write(path, text)`. `jobId` null saves the chain's own log. It goes
  through no call limit (`createLimit` limits a list's calls only). A failed run rejects with `runTeamcity`'s own
  error and writes nothing. `saveLog` makes no `dispose` check of its own: `trackCalls` (task 02) refuses calls on a
  disposed instance.
- **Timeout.** `SAVE_LOG_TIMEOUT_MS` is 300 000 ms (5 minutes): the Build Android - Dev log was 22 698 452 bytes
  (plan.md Preconditions), and the CLI streams it whole to stdout.
- **The cache.** `isJob` in `teamcity-backend.ts` checks the new fields: add `'webUrl'` to `JOB_NULLABLE_STRINGS`,
  `'startedAt'` and `'finishedAt'` to `JOB_NULLABLE_NUMBERS`, and require `isStringArray(value.dependsOn)` (from
  `src/shared/json.ts`, which `local-backend.ts` already imports). A record cached before this change fails the check
  and is left out, so its next list reads its detail and logs again once. Write no migration.
- **Fixtures.** The three `chain-*.json` files are hand-edited to the shape the new `DETAIL_FIELDS` asks for. Add to
  each dependency row: `webUrl` (`https://peoplefun.teamcity.com/build/<id>`, the form `run-list-dev.json` holds),
  `startDate` and `finishDate` in TeamCity's form (`20261123T191020+0000`; a queued row has neither, a running row
  has only `startDate`), and `snapshot-dependencies: { build: [{ id }, …] }` with the transitive set below. The dates
  are test data, not recorded; give each job a start after its prerequisites' finish. Keep every existing field.
  The transitive sets, by the role of each row's `buildTypeId` (the same in all three chains):

  | Row | Its snapshot-dependencies | Its `dependsOn` |
  |---|---|---|
  | `…_Versioning` | none | `[]` |
  | `…_BuildParameters_<Env>` | Versioning | Versioning |
  | `…_AppVersion_BashBest` | Versioning, BuildParameters | BuildParameters |
  | `…_BuildIOS_<Env>` | Versioning, BuildParameters, AppVersion | AppVersion |
  | `…_BuildAndroid_<Env>` | Versioning, BuildParameters, AppVersion | AppVersion |
  | `…_DeployIOS_<Env>` | Versioning, BuildParameters, AppVersion, BuildIOS | BuildIOS |
  | `…_DeployAndroid_<Env>` | Versioning, BuildParameters, AppVersion, BuildAndroid | BuildAndroid |

  In `chain-running.json` the ids are 821331 (Versioning), 821332, 821333, 821337 (BuildIOS), 821335 (BuildAndroid),
  821338 (DeployIOS), 821336 (DeployAndroid).

GIVEN `chain-running.json` WHEN `parseChainDetail` runs THEN job 821338 has `dependsOn: ['821337']`, job 821333 has
`dependsOn: ['821332']`, and job 821331 has `dependsOn: []`.
GIVEN a running dependency with a `startDate` and no `finishDate` WHEN it is parsed THEN `startedAt` is that date in
epoch ms and `finishedAt` is null.
GIVEN `saveLog(game, '821436', '821432', '/dl/x.log')` WHEN the CLI answers `LOG` THEN the CLI ran
`api /downloadBuildLog.html?buildId=821432 --no-input` and `/dl/x.log` holds `LOG`.
GIVEN `jobId` null WHEN `saveLog` runs THEN the CLI ran with `buildId=821436`.
GIVEN the CLI exits 1 WHEN `saveLog` runs THEN it rejects naming `teamcity api /downloadBuildLog.html?buildId=…`
and `/dl/x.log` does not exist.
GIVEN a cache file whose jobs lack `dependsOn` WHEN a list runs THEN that build's detail is read again.

Tests:
- `teamcity-parse.test.ts`, `'maps each job of the running chain'` (line 203): its expected jobs gain `webUrl`,
  `startedAt`, `finishedAt` and `dependsOn`, the last from the table above. It asserts the whole job list, so one
  test pins the reduction and the new fields over the recorded shape.
- `teamcity-parse.test.ts`, a new table `'dependsOn keeps only direct prerequisites: $case'` over rows built with
  `buildJobRow` plus a `snapshot-dependencies` list, with literal expected `dependsOn` per job:
  - `transitive sets`: A none; B {A}; C {A, B} → A `[]`, B `['A']`, C `['B']` (use numeric ids, e.g. 1, 2, 3)
  - `direct sets only`: A none; B {A}; C {B} → the same result
  - `diamond`: A none; B {A}; C {A}; D {A, B, C} → D `['B', 'C']` in job order
  - `an id outside the chain`: B {A, 99} with no row 99 → B `['A']`
  - `a cycle`: A {B}; B {A} → the parse ends; each keeps the other (`A ['B']`, `B ['A']`)
- `teamcity-parse.test.ts`, `'maps a failed and a cancelled job'` (line 271): the expected jobs gain the new fields.
- `teamcity-backend.test.ts`: `detailArgs` (line 85) writes the detail path as a literal; change it to the new
  `DETAIL_FIELDS` text. `'creates a backend that chooses branches and cannot cancel'` (line 258) asserts `saveLog: true`.
- `teamcity-backend.test.ts`, a new `describe('saveLog')` with one table `'saves the log of $case'`:
  `{ case: 'a job', jobId: '821432', expectedId: '821432' }`, `{ case: 'the chain', jobId: null, expectedId: '821436' }`;
  each asserts the CLI args and the text at the path in `services.files` (expose `services.files` from `setup`).
  Plus `'rejects and writes nothing when the CLI fails'`: the answer is the `ProcessResult` `{ code: 1, stdout: '', stderr: 'no access', timedOut: false }`;
  `saveLog` rejects with `teamcity api /downloadBuildLog.html?buildId=821432 exited 1: no access`, and `stat` of the
  path is null.
- `teamcity-backend.test.ts`, `'reads a cached finished build only once, across instances'` (line 360) or the cache
  table beside it: add a row whose stored record's job lacks `dependsOn`, and assert the detail is read again.

Done when: compiles; the test gate runs `teamcity-parse.test.ts` and `teamcity-backend.test.ts`.
Commit:    one commit for the group

## Proof

