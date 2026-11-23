# 04 — TeamCity backend

Status: done
Type: Task
Rung: deep · bounded concurrency over async CLI calls, a persisted cache and per-instance state
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

All paths are relative to `wigley-ai-gui/`.

Files:
- modify `src/plugins/builds-teamcity/manifest.ts` — the skeleton 02 created and registered
- modify `src/plugins/builds-teamcity/main/start.ts` — the empty part 02 created and registered
- create `src/plugins/builds-teamcity/main/teamcity-cli.ts`
- create `src/plugins/builds-teamcity/main/teamcity-parse.ts`
- create `src/plugins/builds-teamcity/main/teamcity-backend.ts`
- test `src/plugins/builds-teamcity/main/teamcity-cli.test.ts`
- test `src/plugins/builds-teamcity/main/teamcity-parse.test.ts`
- test `src/plugins/builds-teamcity/main/teamcity-backend.test.ts`
- test `src/plugins/builds-teamcity/main/start.test.ts`
- create the fixtures under `src/plugins/builds-teamcity/main/fixtures/`: `run-list-dev.json`,
  `run-list-release.json`, `build-queue.json`, `chain-running.json`, `chain-finished.json`,
  `chain-failed.json`, `run-start.json`, `deploy-ios.log`, `deploy-android.log`

Consumes:
- `BackendKind`, `BuildBackend`, `BackendEntry`, `GameEntry`, `BuildRecord`, `BuildJob`,
  `BuildLink`, `BuildState`, `BuildResult`, `QueueRequest`, `BackendCapabilities`,
  `BackendServices`, `buildsMainKey`, `BuildsMainExports.addBackend(kind: BackendKind): Disposable`
  ← 02 (`src/plugins/builds/contract.ts`)
- `BackendServices.paths` and the async `BackendKind.create` ← 02, as the contract changes under
  Decisions state
- `FakeProcesses` (`src/shared/fake-processes.ts`), `createMemoryFiles`
  (`src/shared/memory-files.ts`), `posixPaths` (`src/shared/paths/posix-paths.ts`), `fakePlatform`
  (`src/shared/platform.test-support.ts`), `isJsonObject` (`src/shared/json.ts`), `errorText`
  (`src/shared/error-text.ts`), `startMainPart`, `fakeDependency` and `deferred`
  (`src/shared/plugin-part-harness.test-support.ts`): in the tree

Produces:
- `export const buildsTeamcityManifest` in `src/plugins/builds-teamcity/manifest.ts`
- `export const buildsTeamcityMainPart: MainPart<typeof buildsTeamcityManifest>` in
  `src/plugins/builds-teamcity/main/start.ts` (task 02 registers it; this task fills it)
- `export const teamcityBackendKind: BackendKind` in
  `src/plugins/builds-teamcity/main/teamcity-backend.ts`
- In `src/plugins/builds-teamcity/main/teamcity-cli.ts`:
  ```ts
  export interface TeamcityCli { processes: ProcessRunner; command: string }
  export function runTeamcity(cli: TeamcityCli, args: readonly string[], timeoutMs: number): Promise<string>;
  ```
- In `src/plugins/builds-teamcity/main/teamcity-parse.ts`:
  ```ts
  export function parseTeamcityDate(text: unknown): number | null;
  export function parseBuildNumber(text: unknown): { number: string | null; version: string | null };
  export interface ListedBuild {           // one build of `run list` or of the build queue
    id: string; buildTypeId: string; number: string | null; version: string | null;
    branchName: string | null; state: BuildState; status: string | null; statusText: string | null;
    queuedAt: number; startedAt: number | null; finishedAt: number | null;
    startEstimate: number | null; waitReason: string | null; webUrl: string | null;
    triggeredBy: string | null;
  }
  export function parseRunList(json: unknown): ListedBuild[];
  export function parseBuildQueue(json: unknown): ListedBuild[];
  export interface ChainDetail {
    revision: string | null; percent: number | null; leftSeconds: number | null;
    stepText: string | null; jobs: BuildJob[];
    logJobIds: string[];                   // jobs whose logs hold install links, in dependency order
  }
  export function parseChainDetail(json: unknown, buildJob: RegExp | null): ChainDetail | null;
  export function readFirebaseLinks(log: string): BuildLink[];
  ```

## Decisions

- **One CLI function** (design.md § The TeamCity backend; plan.md § Boundary rules):
  `runTeamcity` in `teamcity-cli.ts` is the only code that runs the CLI. It runs
  `cli.command` with `[...args, '--no-input']` through `processes.run`, with `timeoutMs`. It
  resolves with stdout when the exit code is 0. It rejects with
  `teamcity <first two args> timed out` when `timedOut` is true. It rejects with
  `teamcity <first two args> exited <code>: <last non-empty stderr line>` for another non-zero code
  (`teamcity <first two args> exited <code>` when stderr is empty). A run that rejects passes its
  error through. `<first two args>` is `args.slice(0, 2).join(' ')`. `--no-input` stops every
  prompt; `teamcity --version --no-input` was checked on 1.7.0 and exits 0.
- **Timeouts**: `--version` 10 000 ms; `run list` and `api` 30 000 ms; `run log` and `run start`
  60 000 ms.
- **Config** (design.md § Configuration, with one added field — see Contract and design changes):
  `config` must be a JSON object. `command` is optional, a string; empty or absent means
  `teamcity`; else it is `services.paths.expandTilde(command, services.homeDir)`.
  `buildJobPattern` is optional, a string; empty or absent means no pattern. A non-empty value
  must compile as `new RegExp(value)`. Other keys are ignored.
- **Targets**: each kind's `target` of each game must be a non-empty string, a build
  configuration id.
- **create** returns `{ problem }`, in this order, for: `config` not an object; `command` not a
  string; `buildJobPattern` not a string or not a valid regex; a target that is not a non-empty
  string (the problem names the game id and the kind id); the CLI check failing. The CLI check is
  `runTeamcity(cli, ['--version'], 10_000)`; a rejection gives a problem that holds the command and
  the rejection text. Else it returns the backend. Problem wording is copy; tests match the data
  parts only.
- **Capabilities**: `{ cancel: false, choosesBranch: true }`. The backend has no `cancel` member
  (design.md § The TeamCity backend: the account cannot cancel runs).
- **List** (design.md § The TeamCity backend › List), for `list(game, limit)`:
  1. For each kind of the game, run
     `['run', 'list', '--job', <target>, '--limit', String(limit), '--json=id,number,status,state,webUrl,branchName,buildTypeId,statusText,queuedDate,startDate,finishDate,waitReason,triggered.user.name']`
     and parse it with `parseRunList`.
  2. Run once
     `['api', '/app/rest/buildQueue?locator=count:1000&fields=build(id,buildTypeId,state,branchName,queuedDate,webUrl,waitReason,startEstimate,triggered(user(name)))']`
     and parse it with `parseBuildQueue`. Keep only the builds whose `buildTypeId` is a target of
     this game.
  3. Merge by id. When one id is in both, the queue's build wins.
  4. Sort newest first: by `queuedAt` descending, then by numeric id descending. Cut to `limit`.
  5. Read details only for the builds kept (below). Then map each build to a `BuildRecord`.
  A failed `run list` or queue call rejects `list` with its error.
- **Detail** (design.md § Revision, § Progress): a running build, and a finished build not in the
  cache, read
  `['api', '/app/rest/builds/id:<id>?fields=id,state,status,statusText,running-info(percentageComplete,leftSeconds,currentStageText),snapshot-dependencies(build(id,buildTypeId,state,status,statusText,percentageComplete,buildType(name),running-info(percentageComplete,leftSeconds,currentStageText),revisions(revision(version))))']`.
  A queued build reads no detail. A detail call that rejects, or a detail that
  `parseChainDetail` returns null for, leaves that build with `revision` null, `jobs` `[]`,
  `links` `[]` and no cache entry, and logs `Could not read build <id>: <reason>` through
  `services.log`.
- **Failed details**: the instance remembers each failed detail read in memory, by build id, with
  the time `services.clock.now()` gave. For `DETAIL_RETRY_MS = 10 * 60 * 1000` after that time, a
  list reads no detail for that id and logs nothing for it. Its record shows as the failure above:
  `revision` null, `jobs` `[]`, `links` `[]`. The first list at or after that time reads the
  detail again. `dispose` clears this memory.
- **Detail shape**: `parseChainDetail` returns null only when `json` is not an object. A detail
  object with no `snapshot-dependencies`, or with no `build` array in it, gives `jobs` `[]`,
  `revision` null, `percent` null, `leftSeconds` null, `stepText` null and `logJobIds` `[]`.
  Such a finished build reads no log, gets `links` `[]`, and is cached like any other.
- **Calls in flight**: during one `list`, detail and log calls run at most
  `MAX_CALLS_IN_FLIGHT = 4` at once. The `run list` calls and the queue call run before them.
- **Build jobs** (design.md § Revision, § Progress): a snapshot dependency is a Build job when
  `buildJobPattern` is set and its `buildTypeId` matches it. With no pattern, a Build job is a
  dependency whose `revisions.revision` list is not empty.
- **Revision**: the most common `revisions.revision[0].version` among the Build jobs; on a tie,
  the one whose first Build job comes first in the dependency order. Null with no Build job that
  has a revision. This is the "first Build job" rule of design.md made safe when the dependency
  order puts a job of another VCS root first (the recorded chains do).
- **Job fields** (`BuildJob`, one per snapshot dependency, in dependency order):
  - `id` `String(build.id)`; `label` `buildType.name`, else `buildTypeId`
  - `state`: TeamCity's `queued`, `running` or `finished`
  - `result`: null unless finished; finished `SUCCESS` → `success`, `UNKNOWN` → `cancelled`,
    any other status → `failure`
  - `percent`: queued 0; finished 100; running `running-info.percentageComplete`, else
    `percentageComplete`, else null
  - `leftSeconds`: queued null; finished 0; running `running-info.leftSeconds`, raised to 0 when
    negative, else null
  - `stepText`: running `running-info.currentStageText`, else null. Finished with result
    `failure`: the job's own `statusText`, else null. Any other job: null.
- **Chain progress**: `percent` is `Math.round` of the mean of the Build jobs' percents, leaving
  out each null; null when none has one. `leftSeconds` is the largest Build job `leftSeconds`,
  leaving out each null; null when none has one. `stepText` is the `stepText` of the first running
  Build job; null when none runs.
- **Record fields** (`BuildRecord`):
  - `id` `String(id)`; `gameId` the game's id; `kind` the kind id whose target is `buildTypeId`
  - `number` and `version` from `parseBuildNumber`; both null for a queued build
  - `branch`: `branchName`, unless it is absent or `<default>`; then the branch this backend
    instance queued the build on, else `game.defaultBranch`. (`run start` answers
    `"branchName": "<default>"` while TeamCity checks for changes; see `run-start.json`.)
  - `revision`: the detail's revision; for a queued build, the revision this instance queued it
    with, else null
  - `state` the listed state; `result` as the job rule above, from the chain's own `status`
  - `statusText`: `statusText`, else `waitReason`, else null
  - `percent`, `leftSeconds`, `stepText`: the detail's for a running build; null for queued and
    finished builds
  - `queuedAt`, `startedAt`, `finishedAt`, `startEstimate`: `parseTeamcityDate` of `queuedDate`,
    `startDate`, `finishDate`, `startEstimate`
  - `webUrl` `webUrl` else null; `links` (below); `jobs` the detail's, else `[]`;
    `triggeredBy` `triggered.user.name`, else null
- **Dates** (design.md § Dates): `parseTeamcityDate` reads `YYYYMMDDTHHMMSS±HHMM` and returns
  epoch milliseconds of that instant: the UTC fields minus the offset. Any other text, and a
  non-string, gives null.
- **Build number**: `parseBuildNumber` of `<a>.<b>…<n>` (digits and dots, at least two parts,
  the last all digits) gives `number` the last part and `version` the rest; text that starts with
  a digit and has no dot gives `number` the whole text and `version` null; anything else (a
  leading `.`, a non-string) gives both null.
- **Parsers drop bad rows**: `parseRunList` reads `json.build[]`, `parseBuildQueue` reads
  `json.build[]`. A row with no numeric `id`, no string `buildTypeId`, a `state` other than
  `queued`, `running` or `finished`, or no parsable `queuedDate` is left out. A `json` that is not
  an object with a `build` array gives `[]`. Build queue rows take `state` `queued` when the row
  has none.
- **Links** (design.md § Links): once a chain is finished, read the log of each snapshot
  dependency that has an empty `revisions.revision` list and the result `success`:
  `['run', 'log', <job id>, '--raw']`. These jobs are the detail's `logJobIds`.
  `parseChainDetail` gives `logJobIds` `[]` unless the detail's own top-level `state` is
  `finished`. `readFirebaseLinks` finds each match of
  `/https:\/\/appdistribution\.firebase\.google\.com\/[^\s"'<>]+/g`, once per URL, in log order.
  A URL holding `:ios:` gets the label `iOS`, one holding `:android:` the label `Android`, any
  other `Install`. The build's `links` are the logs' links in dependency order, each URL once.
  Logs are read only for a build that finished at most `LINK_WINDOW_MS = 3 * 24 * 60 * 60 * 1000`
  before `services.clock.now()`; an older build gets `links: []` and is cached so. A log call that
  rejects leaves the build out of the cache, so the next list reads it again. When one log call
  rejects and another resolves, the record holds the links of the logs that were read, in
  dependency order. The build is not cached, so the next list reads its detail and logs again.
- **Cache** (design.md § Links: "a log is read only once per build"): a finished build with a
  detail and every log read is cached by id, in memory and in `services.dataFiles` at
  `teamcity-finished.json`, shape `{ "games": { "<game id>": BuildRecord[] } }`. The file is read
  once, at the first `list` of the instance; a missing or malformed file reads as empty. After
  each `list`, a game's cached records are cut to the ids that list returned, and the file is
  written only when the game's cached set changed. A cached build reads no detail and no log
  again; its record is the cached one.
- **Queue** (design.md § Queue): `queue(game, { kind, branch, revision })` runs
  `['run', 'start', <target of kind>, '--branch', branch, '--revision', revision, '--no-push', '--json']`,
  with the `--revision` pair left out when `revision` is null. It reads the answer's numeric `id`
  and resolves `{ id: String(id) }`; an answer with no numeric `id` rejects with
  `teamcity run start gave no build id`. An unknown kind rejects with
  `<game id> has no kind <kind>`. The instance remembers `{ branch, revision }` by the new id for
  the branch and revision rules above.
- **Plugin**: `buildsTeamcityManifest` has id `builds-teamcity`, label `TeamCity builds`,
  `dependsOn: { main: ['builds'], page: [] }`, `reads: { main: [], page: [] }`, no commands, scopes,
  settings or theme tokens, and `demoSkip: 'Its builds show in the Builds steps, which draw sample data.'`
  (design.md § Plugins: main part only, plus a demo skip). It has no page part.
  `buildsTeamcityMainPart.start` calls `api.dependency(buildsMainKey).addBackend(teamcityBackendKind)`
  and returns `{ commands: {} }`, in the shape of `src/plugins/workflow-small/main/start.ts`.
- **dispose** drops the in-memory cache, the queued-branch memory and the failed-detail memory. It
  runs nothing.
- **Boundary**: no code under `src/` names a server, project id, branch or path of the user's
  (plan.md § Boundary rules). The fixtures may: they are recorded from the real server.

### Contract and design changes this task needs (reported to the lead)

- `BackendKind.create` becomes
  `create(entry: BackendEntry, services: BackendServices): Promise<BuildBackend | { problem: string }>`:
  "the CLI is missing" needs a program run, which is async.
- `BackendServices` gains `paths: Paths` (to expand `~` in `command`, and for task 05's full
  paths).
- The TeamCity `config` gains the optional `buildJobPattern` (a regex string over a snapshot
  dependency's `buildTypeId`). design.md § Configuration names only `command`. Without a pattern,
  a chain's percent means over every dependency with a VCS revision (an app-version job counts).

## Behaviour

GIVEN a game with kinds `dev` and `release` WHEN `list(game, 20)` runs over the recorded fixtures
THEN it returns `821400`, `821339`, `821200`, `821150`, `821100` in that order, with the fields in
the expected records below.

GIVEN a finished build read once WHEN `list` runs again, in the same instance or in a new
instance over the same `dataFiles` THEN no detail call and no log call runs for that build.

GIVEN a running chain whose first dependency is of another VCS root WHEN its detail is parsed
THEN its revision is the revision most Build jobs share.

GIVEN a build queued by this instance on `feature/x` WHEN the build queue lists it with
`branchName` `<default>` THEN its record shows branch `feature/x` and the queued revision.

GIVEN a config whose CLI does not run WHEN `create` runs THEN it returns a problem that names the
command.

## Fixtures

Each file is JSON as the CLI writes it (shape recorded from `teamcity` 1.7.0 on 2026-11-20 and
2026-11-23), cut to the fields the calls above ask for. The user's name in `triggered` is replaced
by `Build User`. Full shas used:

- `A` = `2993a9e4b92724916453c6e2a3257c4838ce0777` (the game's repo)
- `E` = `db45365f93e1b2c3d4e5f60718293a4b5c6d7e8f` (another VCS root)
- `F` = `5e1f4c2a9b8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f` (the game's repo, an older commit)

| File | Holds |
|---|---|
| `run-list-dev.json` | `{"count": 2, "href": "", "build": [...]}` with two builds of `buildTypeId` `vggt_BashBest_Dev_BuildChain`, each with `triggered.user.name` `Build User`: `821339` — `number` `0.12.0.331`, `state` `running`, `status` `SUCCESS`, `branchName` `protos/physics-fun`, `statusText` `Build chain is running (3 finished, 2 in queue, 2 running)`, `queuedDate` `20261123T191020+0000`, `startDate` `20261123T191022+0000`, `webUrl` `https://peoplefun.teamcity.com/build/821339`; `821200` — `number` `0.12.0.330`, `state` `finished`, `status` `SUCCESS`, `branchName` `protos/physics-fun`, `statusText` `Build chain finished (success: 7)`, `queuedDate` `20261123T180000+0000`, `startDate` `20261123T180002+0000`, `finishDate` `20261123T183412+0000`, `webUrl` `https://peoplefun.teamcity.com/build/821200` |
| `run-list-release.json` | Two builds of `vggt_BashBest_Release_BuildChain`, `triggered.user.name` `Build User`: `821150` — `number` `0.12.0.329`, `finished`, `FAILURE`, `branchName` `protos/physics-fun`, `statusText` `Build chain finished (success: 5, failed: 1, canceled: 1)`, `queuedDate` `20261123T170000+0000`, `startDate` `20261123T170003+0000`, `finishDate` `20261123T172510+0000`, `webUrl` `https://peoplefun.teamcity.com/build/821150`; `821100` — `number` `0.11.0.320`, `finished`, `UNKNOWN`, `branchName` `releases/physics-fun/0.11.x`, `statusText` `Canceled`, `queuedDate` `20261122T120000+0000`, `startDate` `20261122T120002+0000`, `finishDate` `20261122T121000+0000`, `webUrl` `https://peoplefun.teamcity.com/build/821100` |
| `build-queue.json` | `{"count": 2, "build": [...]}`: `821400` — `buildTypeId` `vggt_BashBest_Release_BuildChain`, `state` `queued`, `branchName` `<default>`, `queuedDate` `20261123T192000+0000`, `webUrl` `https://peoplefun.teamcity.com/build/821400`, `waitReason` `Waiting for a compatible agent`, `startEstimate` `20261123T202305+0000`, `triggered.user.name` `Build User`; `999001` — `buildTypeId` `Other_Project_Build`, `state` `queued`, `queuedDate` `20261123T192100+0000` |
| `chain-running.json` | Detail of `821339`: `state` `running`, `status` `SUCCESS`, and `snapshot-dependencies.build` in this order: `821331` `vggt_BashBest_EmbeddedShellScriptArtifacts_Versioning` finished SUCCESS, name `Embedded Shell Script Artifacts`, revisions `[E]`; `821332` `vggt_BashBest_BuildParameters_Dev` finished SUCCESS, name `Build Parameters Dev`, revisions `[]`; `821333` `vggt_BashBest_AppVersion_BashBest` finished SUCCESS, name `App Version`, revisions `[A]`; `821337` `vggt_BashBest_BuildIOS_Dev` running SUCCESS, name `Build iOS Dev`, `percentageComplete` 40, `running-info` `{percentageComplete: 40, leftSeconds: 900, currentStageText: "Step 3/8: Build player"}`, revisions `[A]`; `821335` `vggt_BashBest_BuildAndroid_Dev` running SUCCESS, name `Build Android Dev`, `running-info` `{percentageComplete: 60, leftSeconds: -5, currentStageText: "Step 5/8: Gradle"}`, revisions `[A]`; `821338` `vggt_BashBest_DeployIOS_Dev` queued, name `Deploy iOS Dev`, revisions `[]`; `821336` `vggt_BashBest_DeployAndroid_Dev` queued, name `Deploy Android Dev`, revisions `[]` |
| `chain-finished.json` | Detail of `821200`, every dependency finished SUCCESS, in this order: `821191` Embedded `[E]`; `821193` `vggt_BashBest_BuildParameters_Dev` `[]`; `821194` AppVersion `[F]`; `821197` `vggt_BashBest_BuildIOS_Dev` `[F]`; `821195` `vggt_BashBest_BuildAndroid_Dev` `[F]`; `821198` `vggt_BashBest_DeployIOS_Dev` `[]`; `821196` `vggt_BashBest_DeployAndroid_Dev` `[]` (names as in `chain-running.json`) |
| `chain-failed.json` | Detail of `821150`, every dependency finished, in this order: `821141` Embedded SUCCESS `[E]`; `821143` `vggt_BashBest_BuildParameters_Release` SUCCESS `[]`; `821144` AppVersion SUCCESS `[A]`; `821148` `vggt_BashBest_BuildIOS_Release` FAILURE, name `Build iOS Release`, `statusText` `Exit code 65 (Step: Build Xcode project)`, `[A]`; `821145` `vggt_BashBest_BuildAndroid_Release` SUCCESS `[A]`; `821149` `vggt_BashBest_DeployIOS_Release` UNKNOWN, name `Deploy iOS Release`, `statusText` `Canceled`, `[]`; `821146` `vggt_BashBest_DeployAndroid_Release` SUCCESS `[]` |
| `run-start.json` | The recorded `run start --json` answer: `{"id": 821339, "buildTypeId": "vggt_BashBest_Dev_BuildChain", "state": "queued", "branchName": "<default>", "defaultBranch": true, "href": "/app/rest/buildQueue/id:821339", "webUrl": "https://peoplefun.teamcity.com/build/821339", "queuedDate": "20261123T191020+0000", "waitReason": "Checking for changes is in progress"}` |
| `deploy-ios.log` | Ten log lines; line 4 holds `https://appdistribution.firebase.google.com/testerapps/1:1017210896283:ios:26dc2b5eea26c5c6eceb3e/releases/3433pjvova820?utm_source=firebase-tools`, line 5 `https://console.firebase.google.com/project/pf-bash-best-prod/appdistribution/app/ios:com.thrivegames.bashbest/releases/3433pjvova820?utm_source=firebase-tools`, line 9 the first URL again |
| `deploy-android.log` | Six log lines; line 3 holds `https://appdistribution.firebase.google.com/testerapps/1:1017210896283:android:a3badb8c5a545b7beceb3e/releases/029e6kfravka0?utm_source=firebase-tools`, line 4 the matching `console.firebase.google.com` URL |

Tests load the JSON with `import x from './fixtures/<file>.json'` (`resolveJsonModule` is on) and
the logs with `import x from './fixtures/<file>.log?raw'` (`src/declarations.d.ts` declares
`*?raw`).

## Tests

Test values: game `tiki-smash`, label `Tiki Smash`, clone null, `defaultBranch`
`protos/physics-fun`, kinds `dev` → `vggt_BashBest_Dev_BuildChain` and `release` →
`vggt_BashBest_Release_BuildChain`, no sets. Backend entry id `work`, config `{"command": ""}`.
Services: `FakeProcesses` (it rejects every run no test scripted, so no test reaches the real
CLI), `createMemoryFiles()` as `dataFiles` unless a test names `createMemoryFiles(clock)`, a
clock whose `now()` the test sets, `1795462200000` (`20261123T193000+0000`) unless a test says
otherwise, `posixPaths`, `homeDir` `/home/u`, `fakePlatform('macos')`, a `log`
that records lines. The CLI check `teamcity --version --no-input` answers exit 0.

`teamcity-cli.test.ts`, `describe('runTeamcity')`:
- `it('runs the command with --no-input appended and resolves stdout')` — `runTeamcity({processes, command: '/opt/tc'}, ['run', 'list'], 30_000)` records one run `{command: '/opt/tc', args: ['run', 'list', '--no-input'], timeoutMs: 30_000}` and resolves `'out'`.
- `it.each` `'rejects on $name'`:

  | name | result | rejects with |
  |---|---|---|
  | a non-zero exit | code 1, stderr `warn\nError: not authorized\n` | `teamcity run list exited 1: Error: not authorized` |
  | a non-zero exit, no stderr | code 2, stderr `` | `teamcity run list exited 2` |
  | a timeout | code -1, `timedOut` true | `teamcity run list timed out` |
  | a run that cannot start | the run rejects `Could not run /opt/tc: ENOENT` | `Could not run /opt/tc: ENOENT` |

`teamcity-parse.test.ts`:
- `describe('parseTeamcityDate')`, `it.each` `'$text → $expected'`:

  | text | expected |
  |---|---|
  | `20261123T191020+0000` | `1795461020000` |
  | `20261123T141020-0500` | `1795461020000` |
  | `20261123T201020+0100` | `1795461020000` |
  | `2026-11-23` | `null` |
  | `` | `null` |
  | `undefined` | `null` |

- `describe('parseBuildNumber')`, `it.each`:

  | text | number | version |
  |---|---|---|
  | `0.12.0.331` | `331` | `0.12.0` |
  | `1234` | `1234` | `null` |
  | `.1` | `null` | `null` |
  | `undefined` | `null` | `null` |

- `describe('parseRunList')`, `it('reads every build of the recorded list')` — over
  `run-list-dev.json` it returns two builds; the first equals `{id: '821339', buildTypeId: 'vggt_BashBest_Dev_BuildChain', number: '331', version: '0.12.0', branchName: 'protos/physics-fun', state: 'running', status: 'SUCCESS', statusText: 'Build chain is running (3 finished, 2 in queue, 2 running)', queuedAt: 1795461020000, startedAt: 1795461022000, finishedAt: null, startEstimate: null, waitReason: null, webUrl: 'https://peoplefun.teamcity.com/build/821339', triggeredBy: 'Build User'}`; the second has `finishedAt` `1795458852000`.
- `it.each` `'parseRunList leaves out a row with $name'` over a built `{build: [row]}` whose row is
  the first fixture row with one field changed: `id` `"x"`; `buildTypeId` absent; `state`
  `deleted`; `queuedDate` absent. Each gives `[]`. A row `parseRunList('not json')` gives `[]`.
- `describe('parseBuildQueue')`, `it('reads the queue with its estimate and wait reason')` — over
  `build-queue.json` it returns `821400` with `startEstimate` `1795465385000`, `waitReason`
  `Waiting for a compatible agent`, `branchName` `<default>`, `state` `queued`, and `999001`.
- `describe('parseChainDetail')`, `it.each` `'$fixture with pattern $pattern'`:

  | fixture | pattern | revision | percent | leftSeconds | stepText | logJobIds |
  |---|---|---|---|---|---|---|
  | `chain-running.json` | none | `A` | `75` | `900` | `Step 3/8: Build player` | `[]` |
  | `chain-running.json` | `/_Build(IOS\|Android)_/` | `A` | `50` | `900` | `Step 3/8: Build player` | `[]` |
  | `chain-finished.json` | none | `F` | `100` | `0` | `null` | `['821193', '821198', '821196']` |
  | `chain-failed.json` | none | `A` | `100` | `0` | `null` | `['821143', '821146']` |

  (`logJobIds` lists the jobs with no revision and result `success`, so `821149`, cancelled, is
  left out. `chain-running.json` gives `[]` because its top-level `state` is `running`, although
  its job `821332` has no revision and result `success`. The chain-level `percent` and `leftSeconds` of a finished build are set to null by
  the backend, not by this parser.)
- `it('maps each job of the running chain')` — over `chain-running.json` the `jobs` equal, in
  order:

  | id | label | state | result | percent | leftSeconds | stepText |
  |---|---|---|---|---|---|---|
  | `821331` | `Embedded Shell Script Artifacts` | finished | success | 100 | 0 | null |
  | `821332` | `Build Parameters Dev` | finished | success | 100 | 0 | null |
  | `821333` | `App Version` | finished | success | 100 | 0 | null |
  | `821337` | `Build iOS Dev` | running | null | 40 | 900 | `Step 3/8: Build player` |
  | `821335` | `Build Android Dev` | running | null | 60 | 0 | `Step 5/8: Gradle` |
  | `821338` | `Deploy iOS Dev` | queued | null | 0 | null | null |
  | `821336` | `Deploy Android Dev` | queued | null | 0 | null | null |

- `it('maps a failed and a cancelled job')` — over `chain-failed.json` the jobs have, in order:

  | id | result | stepText |
  |---|---|---|
  | `821141` | success | null |
  | `821143` | success | null |
  | `821144` | success | null |
  | `821148` | failure | `Exit code 65 (Step: Build Xcode project)` |
  | `821145` | success | null |
  | `821149` | cancelled | null |
  | `821146` | success | null |

- `it('takes the revision of the first Build job on a tie')`, `it.each`, pattern none, over a
  built detail `{state: 'running', 'snapshot-dependencies': {build: [job 1, job 2]}}`. Each job
  is `{id, buildTypeId: 'X_Build<id>', state: 'finished', status: 'SUCCESS', buildType: {name: 'Build <id>'}, revisions: {revision: [{version: <sha>}]}}`:

  | job 1 sha | job 2 sha | revision |
  |---|---|---|
  | `F` | `A` | `F` |
  | `A` | `F` | `A` |

- `it.each` `'parseChainDetail of $name'`:

  | name | json | result |
  |---|---|---|
  | a text | `'not json'` | `null` |
  | a detail with no snapshot dependencies | `{id: 1, state: 'finished'}` | `{revision: null, percent: null, leftSeconds: null, stepText: null, jobs: [], logJobIds: []}` |
  | a dependencies object with no build array | `{id: 1, state: 'finished', 'snapshot-dependencies': {count: 0}}` | `{revision: null, percent: null, leftSeconds: null, stepText: null, jobs: [], logJobIds: []}` |
- `describe('readFirebaseLinks')`, `it.each`:

  | log | links |
  |---|---|
  | `deploy-ios.log` | `[{label: 'iOS', url: <the testerapps ios URL>}]` |
  | `deploy-android.log` | `[{label: 'Android', url: <the testerapps android URL>}]` |
  | `see https://appdistribution.firebase.google.com/testerapps/1:9:web:ab/releases/x` | `[{label: 'Install', url: 'https://appdistribution.firebase.google.com/testerapps/1:9:web:ab/releases/x'}]` |
  | `no links here` | `[]` |

`teamcity-backend.test.ts`:
- `describe('teamcityBackendKind.create')`, `it.each` `'gives a problem for $name'`:

  | name | entry change | the problem contains |
  |---|---|---|
  | a config that is not an object | `config: "teamcity"` | `config` |
  | a command that is not a string | `config: {command: 3}` | `command` |
  | a bad build job pattern | `config: {buildJobPattern: "("}` | `buildJobPattern` |
  | an empty target | kind `dev` target `""` | `tiki-smash` and `dev` |
  | a target that is not a string | kind `release` target `{}` | `tiki-smash` and `release` |
  | a CLI that does not run | `config: {command: "~/bin/tc"}`, the run of `/home/u/bin/tc --version --no-input` rejects `Could not run /home/u/bin/tc: ENOENT` | `/home/u/bin/tc` |

- `it('creates a backend that chooses branches and cannot cancel')` — the valid entry gives a
  backend whose `capabilities` equal `{cancel: false, choosesBranch: true}` and whose `cancel` is
  `undefined`.
- `describe('list')`, `it('merges the kinds and the queue newest first')` — scripted: both run
  lists with `--limit 20`, `build-queue.json`, details `821339` → `chain-running.json`, `821200` →
  `chain-finished.json`, `821150` → `chain-failed.json`, `821100` → rejects `HTTP 404`; logs
  `821198` → `deploy-ios.log`, `821196` and `821146` → `deploy-android.log`, `821193` and `821143`
  → `` (empty). `list(game, 20)` gives ids `['821400', '821339', '821200', '821150', '821100']`
  and these records:
  - `821400`: `kind` `release`, `number` null, `version` null, `branch` `protos/physics-fun`,
    `revision` null, `state` `queued`, `result` null, `statusText` `Waiting for a compatible agent`,
    `queuedAt` `1795461600000`, `startEstimate` `1795465385000`, `jobs` `[]`, `links` `[]`,
    `triggeredBy` `Build User`, `webUrl` `https://peoplefun.teamcity.com/build/821400`
  - `821339`: `kind` `dev`, `number` `331`, `version` `0.12.0`, `branch` `protos/physics-fun`,
    `revision` `A`, `state` `running`, `result` null, `percent` 75, `leftSeconds` 900,
    `stepText` `Step 3/8: Build player`, `startedAt` `1795461022000`, seven jobs
  - `821200`: `result` `success`, `percent` null, `leftSeconds` null, `stepText` null,
    `revision` `F`, `finishedAt` `1795458852000`, `links`
    `[{label: 'iOS', url: <ios URL>}, {label: 'Android', url: <android URL>}]`
  - `821150`: `kind` `release`, `result` `failure`, `revision` `A`, `links`
    `[{label: 'Android', url: <android URL>}]`
  - `821100`: `result` `cancelled`, `number` `320`, `version` `0.11.0`, `branch`
    `releases/physics-fun/0.11.x`, `revision` null, `jobs` `[]`, `links` `[]`; the log holds one
    line that contains `821100` and `HTTP 404`
- `it('cuts to the limit before it reads details')` — with `--limit 3` scripts, `list(game, 3)`
  gives `['821400', '821339', '821200']`, and no run has `821150` or `821100` in its args.
- `it('reads a cached finished build only once, across instances')` — after the first list
  above, a second `list(game, 20)` on the same backend runs, by args sorted, exactly: the two run
  lists, the queue call, detail `821339`. It runs no detail call for `821100`, because that read
  failed inside `DETAIL_RETRY_MS`, and `821100` still has `revision` null, `jobs` `[]` and
  `links` `[]`. A new backend from `create` over the
  same `dataFiles` lists the same five records and runs no detail and no log call for `821200` or
  `821150`. `teamcity-finished.json` holds `games['tiki-smash']` with ids `821200` and `821150`.
- `it('reads a failed detail again after DETAIL_RETRY_MS')` — after the first list above, the clock
  moves to `1795462200000 + DETAIL_RETRY_MS - 1` (`1795462799999`): a list runs no detail call for
  `821100`. The clock moves to `1795462200000 + DETAIL_RETRY_MS` (`1795462800000`): a list runs
  detail `821100` once more, and the log holds a second line that contains `821100`.
- `it('lets the queue build win over a run-list row of the same id')` — scripted: the dev run list
  `{build: [{id: 821500, buildTypeId: 'vggt_BashBest_Dev_BuildChain', number: '0.12.0.332', state: 'running', status: 'SUCCESS', branchName: 'protos/physics-fun', queuedDate: '20261123T192500+0000', startDate: '20261123T192502+0000'}]}`,
  the release run list `{build: []}`, and the queue
  `{build: [{id: 821500, buildTypeId: 'vggt_BashBest_Dev_BuildChain', state: 'queued', branchName: 'protos/physics-fun', queuedDate: '20261123T192500+0000', waitReason: 'Waiting for a compatible agent'}]}`.
  `list(game, 20)` gives one record `821500` with `state` `queued`, `number` null, `startedAt`
  null and `statusText` `Waiting for a compatible agent`. No detail call runs.
- `it('breaks a queuedAt tie by numeric id, highest first')` — scripted: both run lists
  `{build: []}`, and the queue
  `{build: [{id: 99999, buildTypeId: 'vggt_BashBest_Dev_BuildChain', state: 'queued', queuedDate: '20261123T192000+0000'}, {id: 100000, buildTypeId: 'vggt_BashBest_Dev_BuildChain', state: 'queued', queuedDate: '20261123T192000+0000'}]}`.
  `list(game, 20)` gives ids `['100000', '99999']`.
- `it('cuts the cached records to the ids a list returned, and writes the file only on a change')`
  — `dataFiles` is `createMemoryFiles(clock)`, so each write stamps `modified` with the clock. The
  first list above runs at `1795462200000`. The clock moves to `1795462201000`, and a second
  `list(game, 20)` over the same answers runs: `dataFiles.modified('teamcity-finished.json')`
  stays `1795462200000`, and the file text is unchanged. The clock moves to `1795462202000`, and a
  third list runs with the release run list scripted to hold only the `821100` row: `modified`
  is `1795462202000`, and the file's `games['tiki-smash']` holds the one id `821200`.
- `it('lists over a cache file that is not JSON')` — `teamcity-finished.json` holds `not json`
  before the first call. `list(game, 20)` resolves with the five ids of the first list above, and
  runs detail `821200` and detail `821150`.
- `it('keeps the links of the logs read when one log call rejects')` — scripted as the first list
  above, except log `821196` rejects `HTTP 500`. `821200` has `links`
  `[{label: 'iOS', url: <ios URL>}]`. `teamcity-finished.json` holds `games['tiki-smash']` with
  the id `821150` and not `821200`. A second list runs detail `821200` and log `821196` again.
- `it('reads no logs for a build past the link window')` — clock `now()` `1795737600000`
  (`20261127T000000+0000`): `821200` has `links` `[]`, and no `run log` call runs for its jobs.
- `it('never has more than MAX_CALLS_IN_FLIGHT detail and log calls running')` — a built run list
  of `MAX_CALLS_IN_FLIGHT + 2` finished builds, each detail scripted as a deferred promise; while
  none is settled, the count of runs started with `api /app/rest/builds/id:` is
  `MAX_CALLS_IN_FLIGHT`; after each settles, the next one starts; the list then resolves.
- `describe('queue')`, `it('starts the chain pinned, without a push, and gives its id')` —
  scripted `run start` → `run-start.json`; `queue(game, {kind: 'dev', branch: 'feature/x',
  revision: A})` records the run args
  `['run', 'start', 'vggt_BashBest_Dev_BuildChain', '--branch', 'feature/x', '--revision', A, '--no-push', '--json', '--no-input']`
  and resolves `{id: '821339'}`.
- `it('shows the queued branch and revision while TeamCity reports <default>')` — after that
  queue, with empty run lists and a built queue answer
  `{build: [{id: 821339, buildTypeId: 'vggt_BashBest_Dev_BuildChain', state: 'queued', branchName: '<default>', queuedDate: '20261123T191020+0000', waitReason: 'Checking for changes is in progress'}]}`,
  `list(game, 20)` gives one record with `branch` `feature/x`, `revision` A and `statusText`
  `Checking for changes is in progress`.
- `it.each` `'queue rejects $name'`: kind `qa` → message contains `qa`; a `run start` answer
  `{}` → `teamcity run start gave no build id`. A `revision` null row records args with no
  `--revision`.

`start.test.ts`, `describe('buildsTeamcityMainPart')`:
- `it('adds the teamcity backend kind to builds')` — `startMainPart(buildsTeamcityMainPart, {dependencies: [fakeDependency(buildsMainKey, () => ({addBackend}))]})`,
  where `addBackend` records each kind it gets and returns a `Disposable`. It records one kind,
  and that kind's `kind` is `'teamcity'`.

Approach: none. Every behaviour-changing choice is pinned above.

Done when: `npm run typecheck` passes; `npm run lint` passes; the test gate runs the four test
files above. Live checks defer to task 10 "Final verification" (its Dropped list names these
tests; no drive run reaches the real server).

Commit: one commit for the group, `CHANGELOG.md` left to task 08.

## Proof

Commit 151702206 · proof: diff read: teamcityBackendKind, TeamcityCli, runTeamcity, parse* and readFirebaseLinks present; wave typecheck and lint pass · concerns: fixtures are written from the task table, not recorded; run list triggered.user.name nesting unconfirmed; concurrency test uses vi.waitFor on real timers; start.ts relies on builds' consumer.track for the addBackend Disposable
