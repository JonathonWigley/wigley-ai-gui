# 05 — Local backend

Status: done
Type: Task
Rung: deep · detached processes that outlive an app restart, found again through pid and exit-code files, and a run history saved in plugin data
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

All paths are relative to `wigley-ai-gui/`.

Files:
- modify `src/plugins/builds-local/manifest.ts` — the skeleton 02 created and registered
- modify `src/plugins/builds-local/main/start.ts` — the empty part 02 created and registered
- create `src/plugins/builds-local/main/local-wrapper.ts`
- create `src/plugins/builds-local/main/local-backend.ts`
- test `src/plugins/builds-local/main/local-wrapper.test.ts`
- test `src/plugins/builds-local/main/local-backend.test.ts`
- test `src/plugins/builds-local/main/start.test.ts`

Consumes:
- `BackendKind`, `BuildBackend`, `BackendEntry`, `GameEntry`, `BuildRecord`, `QueueRequest`,
  `BackendCapabilities`, `BackendServices`, `buildsMainKey`,
  `BuildsMainExports.addBackend(kind: BackendKind): Disposable` ← 02
  (`src/plugins/builds/contract.ts`)
- `Files.readEnd(path: string, maxBytes: number): Promise<string>` (`src/contracts/files.ts`) ← 01
- `BackendServices.paths`, `BackendServices.dataFolder` and the async `BackendKind.create` ← 02,
  as the contract changes under Decisions state
- `Git.currentBranch(folder)` and `Git.resolveCommit(root, ref)` (`src/contracts/git.ts`),
  `OsName` (`src/contracts/platform.ts`), `ProcessResult` (`src/contracts/processes.ts`): in the
  tree
- Test doubles in the tree: `FakeProcesses` (`src/shared/fake-processes.ts`), `createMemoryFiles`
  (`src/shared/memory-files.ts`), `posixPaths` and `windowsPaths` (`src/shared/paths/`),
  `fakePlatform` (`src/shared/platform.test-support.ts`), and a `Git` stub in the shape of
  `aheadGit` in `src/plugins/app-update/main/start.test.ts`, and `startMainPart`,
  `fakeDependency` and `deferred` (`src/shared/plugin-part-harness.test-support.ts`)

Produces:
- `export const buildsLocalManifest` in `src/plugins/builds-local/manifest.ts`
- `export const buildsLocalMainPart: MainPart<typeof buildsLocalManifest>` in
  `src/plugins/builds-local/main/start.ts` (task 02 registers it; this task fills it)
- `export const localBackendKind: BackendKind` in `src/plugins/builds-local/main/local-backend.ts`
- In `src/plugins/builds-local/main/local-wrapper.ts`:
  ```ts
  export interface LocalTarget { command: string; args: string[] }
  export interface ProgramLine { command: string; args: string[] }
  export function wrapperLine(os: OsName, files: { pid: string; exitCode: string }, target: LocalTarget): ProgramLine;
  export function aliveCheckLine(os: OsName, pid: number): ProgramLine;
  export function isAlive(os: OsName, pid: number, result: ProcessResult): boolean;
  export function killLine(os: OsName, pid: number): ProgramLine;
  ```

## Decisions

- **Import boundary** (plan.md § Boundary rules): `builds-local` imports
  `src/plugins/builds/contract.ts` and nothing else of `builds`. The tests build their
  `BackendEntry` and `GameEntry` values inline from the Test values. They import nothing of
  `builds` but `contract.ts`: its types, and the `buildsMainKey` value for `start.test.ts`. They
  do not import `builds/contract.test-support.ts`.
- **Config** (design.md § Configuration): `config` must be a JSON object; its keys are ignored.
- **Targets**: each kind's `target` must be an object with `command`, a non-empty string, and
  `args`, an array of strings. It is parsed into a `LocalTarget` in `create`.
- **Clone**: every game must name a `clone` (design.md § Configuration: "which a local game must
  name"). `GameEntry.clone` is already `~`-expanded by `builds`.
- **Names in paths**: a game id and a kind key become folder names. Each must match
  `/^[A-Za-z0-9._-]+$/`, and must not be `.` or `..`.
- **create** returns `{ problem }`, in this order, for: `config` not an object; a game id that is
  not a valid name (the problem names the game id); a kind key that is not a valid name (the
  problem names the game id and the kind); a game with `clone` null (the problem names the game
  id); a target that is not as above (the problem names the game id and the kind id); a target
  whose `command` or one of whose `args` holds a newline, `\n` or `\r` (the problem names the game
  id and the kind id). Else it returns the backend. Problem wording is copy; tests match
  the data parts only.
- **Capabilities**: `{ cancel: true, choosesBranch: false }` (design.md § The local backend).
- **Run id**: `<game id>/<kind>/<startedAt>`, `startedAt` from `services.clock.now()`. A valid
  name can hold `-` but not `/`, so the ids of `a-b` + `c` and `a` + `b-c` stay apart.
- **Run files**: each run has the folder `runs/<game id>/<kind>/<startedAt>/` in
  `services.dataFiles`, that is `runs/<run id>/`, with `log.txt`, `pid` and `exit-code`. Full
  paths for the wrapper and the log are
  `services.paths.join(services.dataFolder, 'runs', <game id>, <kind>, String(<startedAt>), <name>)`:
  one segment each, so the Windows join gets no `/`.
- **Run records** (design.md § Run records): `runs.json` in `services.dataFiles`, shape
  `{ "runs": LocalRun[] }`, with
  `LocalRun = { id: string; gameId: string; kind: string; branch: string; revision: string | null; startedAt: number; finishedAt: number | null; exitCode: number | null; cancelled: boolean; lastLine: string | null }`.
  The file is read at the first `list`, `queue` or `cancel` of the instance; a missing file
  reads as `{ "runs": [] }`. A file of this shape is a JSON object whose `runs` is an array. Each
  run is an object that holds each `LocalRun` field with its type: `id`, `gameId`, `kind` and
  `branch` strings; `revision` and `lastLine` a string or null; `startedAt` a number;
  `finishedAt` and `exitCode` a number or null; `cancelled` a boolean. A run may hold other keys;
  they are ignored. A file that is not valid JSON, or not of this shape, makes each call
  reject with `runs.json is not valid: <reason>` until it is fixed; it is never written over.
- **One chain**: every `list`, `queue` and `cancel` runs through one serial chain in the
  instance, each call waiting on the last. Every write runs inside that chain. A write happens
  only when a run was added or changed.
- **The file is the truth**: inside the chain, each write first reads `runs.json` again and
  merges by run id. A run that this call added or changed wins over the file's run of that id.
  Every other run of the file stays. The merged list is written, and it becomes the instance's
  list. A file that is not valid at that read rejects the call as above and is not written. This
  keeps the runs of an old instance, which `builds` disposed while its call was in flight, and of
  a new instance over the same `dataFiles`.
- **Kept runs**: on each write, keep the newest `KEPT_RUNS = 50` finished runs of each game and
  kind, by `startedAt`. For each run that drops out, delete its `log.txt`, `pid` and `exit-code`
  with `dataFiles.deleteFile`. Unfinished runs are always kept.
- **Queue** (design.md § The local backend › Queue), `queue(game, request)` runs in the chain:
  1. An unknown kind rejects with `<game id> has no kind <kind>`.
  2. Settle each unfinished run of the game, by the same rules `list` uses (List, below).
  3. A run of the same game and kind with no `finishedAt` rejects with a message that holds the
     kind's label and the game's label. A second `queue` of one kind, called while the first
     runs, waits in the chain and rejects here.
  4. `branch` is `git.currentBranch(clone)`: the branch name, or the short commit on a detached
     HEAD (`src/contracts/git.ts`). A null answer rejects the queue with
     `<clone> is not a git clone`. `revision` is `git.resolveCommit(clone, 'HEAD')`. A rejection
     rejects the queue. `request.branch` and `request.revision` are not used: the folder is built
     as it stands.
  5. `dataFiles.makeFolder('runs/<run id>')`.
  6. Add the run record, `finishedAt` null, to the instance's list.
  7. `processes.startDetached(line.command, line.args, { cwd: clone, logPath: <full log path> })`,
     where `line` is `wrapperLine(services.platform.os, { pid: <full pid path>, exitCode: <full exit-code path> }, target)`.
     A rejection removes the record from the list and rejects the queue. No record is written.
  8. Write the list and resolve `{ id: <run id> }`. When this write fails, log
     `Could not save runs.json: <reason>` through `services.log`, keep the record in the list and
     resolve `{ id: <run id> }`: the build runs from step 7 on. The next write counts that
     record as changed, so its merge keeps it.
- **Wrapper line, macOS and Linux** (pinned verbatim):
  `{ command: '/bin/sh', args: ['-c', POSIX_WRAPPER, 'builds-local', files.pid, files.exitCode, target.command, ...target.args] }`,
  where `POSIX_WRAPPER` is
  ```sh
  echo $$ > "$1"; exit_file="$2"; shift 2; "$@"; code=$?; echo "$code" > "$exit_file.tmp"; mv "$exit_file.tmp" "$exit_file"
  ```
  `$$` is the shell's pid. `startDetached` starts the shell as the leader of its own process
  group, so that pid is also the group id. The temp file and `mv` make the exit-code file appear
  whole. `builds-local` is the shell's `$0`, so the shell's command line holds `builds-local` for
  the alive check.
- **Wrapper line, Windows** (pinned verbatim; checked only by its unit test, plan.md § Out of
  scope): `{ command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', <script>] }`,
  where `<script>` is this one line, with each `<…>` a value quoted by `q`:
  ```powershell
  $ErrorActionPreference = 'Stop'; Set-Content -LiteralPath <pid> -Value $PID; try { & <command> <arg 1> <arg 2> …; $code = $LASTEXITCODE } catch { Write-Output $_; $code = 1 }; if ($null -eq $code) { $code = 0 }; Set-Content -LiteralPath <exit-code + '.tmp'> -Value $code; Move-Item -LiteralPath <exit-code + '.tmp'> -Destination <exit-code> -Force # builds-local
  ```
  `q(text)` is `'` + `text` + `'`, where each of these five characters in `text` is doubled: `'`,
  U+2018 `‘`, U+2019 `’`, U+201A `‚` and U+201B `‛`. PowerShell reads each of the five as a
  single quote. The args follow the command with one space each; with no args, `& <command>;`
  follows directly. The closing comment ` # builds-local` puts `builds-local` in the process
  command line for the alive check.
- **Alive check** (it checks the process identity, because a pid can belong to another program
  after a reboot): macOS and Linux run
  `{ command: 'ps', args: ['-o', 'command=', '-p', String(pid)] }`. Windows runs
  `{ command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Process -Filter "ProcessId=<pid>").CommandLine'] }`.
  Each runs through `processes.run` with `timeoutMs: 5_000`. `isAlive` returns true when
  `result.timedOut` is true, so the next list checks again. Else, on macOS and Linux, the pid is
  alive when the exit code is 0 and stdout holds `builds-local`. On Windows, it is alive when
  stdout holds `builds-local`. A pid that fails the check counts as gone. The `list` code treats a
  check run that rejects as alive, so the next list checks again.
- **Kill line**: macOS and Linux `{ command: 'kill', args: ['-TERM', '--', '-<pid>'] }` (the whole
  process group); Windows `{ command: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] }`.
  `timeoutMs: 5_000`.
- **Exit code**: the trimmed text of `exit-code` is an exit code when it matches `/^-?\d+$/`; its
  value is `Number` of that text. Any other text, an empty file and a missing file are no exit
  code.
- **List**, `list(game, limit)` runs in the chain: first settle each unfinished run of the game,
  then return its newest `limit` runs across kinds, by `startedAt` descending, as `BuildRecord`s.
  To settle an unfinished run:
  1. Read `exit-code`. When it holds an exit code, the run ends with that `exitCode`, and
     `finishedAt` is `dataFiles.modified('runs/<id>/exit-code')`.
  2. Else read `pid`. A pid is the trimmed text as a positive integer; any other text, or a missing
     file, is no pid. With no pid, the run stays running while
     `clock.now() - startedAt < PID_GRACE_MS = 10_000`; after that it ends with no exit code,
     `finishedAt` `clock.now()`.
  3. With a pid, run the alive check. Alive, or a check run that rejects: the run stays running.
     Gone: read `exit-code` once more (the run can end between the two reads); an exit code ends
     it as in step 1, else it ends with no exit code, `finishedAt` `clock.now()`.
  When a run ends, its `lastLine` is set from the log once, and it is not read again.
- **Last line**: read the end of `log.txt` with `services.dataFiles.readEnd(path, 4096)` (task 01),
  never the whole log. Remove each ANSI escape, `/\x1b\[[0-9;]*[A-Za-z]/g`. Split the text on
  `\r` and on `\n`, and trim the outer spaces of each piece. Take the last piece that is not
  empty; null with no such piece or no file. A progress line that redraws with `\r`, such as
  `10%\r20%\r30%`, gives its last state, `30%`. A line that `readEnd` cut at its start shows as it
  is.
- **Progress** (design.md § Progress): for a running run, let `elapsed = clock.now() - startedAt`
  and `duration` the `finishedAt - startedAt` of the newest run (by `finishedAt`) of the same game
  and kind with `exitCode` 0, `cancelled` false and `finishedAt - startedAt` above 0. A success
  whose duration is 0 or less is not a baseline: the next newest success is used.
  `percent = Math.min(99, Math.floor((elapsed * 100) / duration))`;
  `leftSeconds = Math.max(0, Math.ceil((duration - elapsed) / 1000))`. Both are null with no such
  run. A finished run has `percent` and `leftSeconds` null.
- **stepText**: a running run reads the end of `log.txt` on each list and shows its last line; a finished run
  shows its saved `lastLine`.
- **Result and status text** (design.md § Result): `cancelled` true → `cancelled`,
  `Cancelled`; `exitCode` 0 → `success`, status text null; another `exitCode` n → `failure`,
  `Exited with code <n>`; `exitCode` null → `failure`, `ended without an exit code` (that exact
  text, from design.md). A running run has `result` and `statusText` null.
- **Record fields** (`BuildRecord`): `id` the run id; `gameId`; `kind`; `number` null; `version`
  null; `branch`; `revision`; `state` `running` while `finishedAt` is null, else `finished`
  (never `queued`: a local build starts at once); `result`, `statusText`, `percent`,
  `leftSeconds`, `stepText` as above; `queuedAt` and `startedAt` both `startedAt`; `finishedAt`;
  `startEstimate` null; `webUrl` null; `links` `[]`; `jobs` `[]`; `triggeredBy` null.
- **Cancel** (design.md § Capabilities), `cancel(game, buildId)` runs in the chain, so it never
  overlaps a `list` settle: an unknown id rejects with `No local build <id>`; a finished run does
  nothing. Else read `exit-code`: an exit code ends the run as in List step 1, and nothing is
  killed. Else read `pid`: no pid rejects with `The build has not written its pid yet`. Else run
  the alive check:
  - A check run that rejects rejects the cancel. The run stays running.
  - A pid that fails the check counts as gone. Nothing is killed. The run settles as in List
    step 3, gone.
  - Alive: run `killLine`. A kill run that rejects, or whose result has `timedOut` true, rejects
    the cancel. The run stays running. A non-zero kill exit code is not read: a process that
    ended after the check is ended too. Then set `cancelled` true, `finishedAt` `clock.now()`,
    `exitCode` null, `lastLine` from the log, and write.
  An exit-code file that appears later does not change a cancelled run.
- **No timers**: the backend sets no timer; `builds`' poller calls `list`. `services.timers` is
  not used.
- **dispose** does nothing more than let a write in flight finish. Running builds keep running:
  they outlive the app (design.md § Queue).
- **Plugin**: `buildsLocalManifest` has id `builds-local`, label `Local builds`,
  `dependsOn: { main: ['builds'], page: [] }`, `reads: { main: [], page: [] }`, no commands,
  scopes, settings or theme tokens, and
  `demoSkip: 'Its builds show in the Builds steps, which draw sample data.'` (design.md § Plugins).
  It has no page part. `buildsLocalMainPart.start` calls
  `api.dependency(buildsMainKey).addBackend(localBackendKind)` and returns `{ commands: {} }`, in
  the shape of `src/plugins/workflow-small/main/start.ts`.
- **Paths**: every full path is built with `services.paths.join`; `dataFiles` paths are
  `/`-separated and relative (AGENTS.md § A path). No code names a user's path.

### Contract changes this task needs (reported to the lead)

- `BackendServices` gains `dataFolder: string`, the full path of the folder `dataFiles` is scoped
  to, and `paths: Paths`. The wrapper and `startDetached`'s `logPath` need full paths, as
  `MainApi.dataFolder` exists for ("for a program the plugin starts that writes there").
  `dataFiles` and `dataFolder` are one folder that belongs to this backend entry alone.
- `BackendKind.create` becomes async (`Promise<BuildBackend | { problem: string }>`), the same
  change task 04 needs; this task's `create` does no async work but returns a resolved promise.

## Behaviour

GIVEN a local game with a clone WHEN `queue` runs THEN the kind's command starts detached in the
clone through the wrapper line, and `runs.json` holds the run with the clone's branch and
revision.

GIVEN a running run whose `exit-code` file appears with `0` WHEN `list` runs THEN the run is a
finished success, and `finishedAt` is the file's modified time.

GIVEN a running run whose pid is gone and that has no `exit-code` file WHEN `list` runs THEN the
run is a failure with the status text `ended without an exit code`.

GIVEN a run started by an earlier instance WHEN a new instance over the same files lists THEN it
shows that run and settles it the same way (the build outlives an app restart).

GIVEN a running run WHEN `cancel` runs THEN the pid's process group is signalled and the run is
`cancelled`.

GIVEN a pid file whose pid now belongs to another program WHEN `list` or `cancel` runs THEN the
run counts as gone, and `cancel` kills nothing.

GIVEN two instances over one `dataFiles` WHEN each writes a run THEN `runs.json` holds both runs.

## Tests

Test values: game `demo`, label `Demo`, clone `/clones/demo`, `defaultBranch` `main`, kinds
`ok` → `{label: 'OK', target: {command: './build.sh', args: ['--env', 'dev']}}` and `bad` →
`{label: 'Bad', target: {command: './fail.sh', args: []}}`. Entry id `home`, config `{}`.
Services: `FakeProcesses`; `createMemoryFiles(clock)` as `dataFiles`, so each write stamps
`modified` with the clock; `dataFolder` `/data`; `posixPaths`; `fakePlatform('macos')`; a clock
whose `now()` the test sets; a `Git` stub whose `currentBranch` answers `feature/x` and whose
`resolveCommit` answers `2993a9e4b92724916453c6e2a3257c4838ce0777`. No test spawns a real
program: `FakeProcesses` rejects every run no test scripted. A later `script` of the same
command and args replaces the earlier one.

The alive check of pid `4321` on macOS is the run `ps -o command= -p 4321`. Its scripted answers
have these names in the tables below:

| name | answer |
|---|---|
| alive | code 0, stdout `/bin/sh -c sh-script builds-local /data/runs/demo/ok/1000000/pid /data/runs/demo/ok/1000000/exit-code ./build.sh --env dev\n` |
| another program | code 0, stdout `/usr/bin/vim notes.txt\n` |
| gone | code 1, stdout `` |
| timed out | code -1, `timedOut` true |
| rejects | the run rejects `Could not run ps: ENOENT` |

`local-wrapper.test.ts`:
- `describe('wrapperLine')`, `it.each` `'$os'`, files `{pid: <P>, exitCode: <X>}`:

  | os | pid / exitCode | target | expected |
  |---|---|---|---|
  | `macos` | `/data/runs/r1/pid`, `/data/runs/r1/exit-code` | `./build.sh --env dev` | `{command: '/bin/sh', args: ['-c', POSIX_WRAPPER, 'builds-local', '/data/runs/r1/pid', '/data/runs/r1/exit-code', './build.sh', '--env', 'dev']}` |
  | `linux` | the same | the same | the same |
  | `windows` | `C:\data\runs\r1\pid`, `C:\data\runs\r1\exit-code` | `build.cmd --env it's` | `{command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', "$ErrorActionPreference = 'Stop'; Set-Content -LiteralPath 'C:\data\runs\r1\pid' -Value $PID; try { & 'build.cmd' '--env' 'it''s'; $code = $LASTEXITCODE } catch { Write-Output $_; $code = 1 }; if ($null -eq $code) { $code = 0 }; Set-Content -LiteralPath 'C:\data\runs\r1\exit-code.tmp' -Value $code; Move-Item -LiteralPath 'C:\data\runs\r1\exit-code.tmp' -Destination 'C:\data\runs\r1\exit-code' -Force # builds-local"]}` |
  | `windows` | the same | `build.cmd` (no args) | the script holds `& 'build.cmd'; $code = $LASTEXITCODE` |
  | `windows` | the same | `build.cmd --name it’s` (U+2019) | the script holds `& 'build.cmd' '--name' 'it’’s'; $code = $LASTEXITCODE` |

  The test writes `POSIX_WRAPPER` as the literal string from Decisions, not an import, so a
  changed script turns the row red.
- `describe('aliveCheckLine and isAlive')`, `it.each`:

  | os | line | result | alive |
  |---|---|---|---|
  | `macos` | `ps -o command= -p 4321` | alive (as Test values) | true |
  | `macos` | the same | another program | false |
  | `macos` | the same | gone | false |
  | `macos` | the same | timed out | true |
  | `linux` | `ps -o command= -p 4321` | alive | true |
  | `linux` | the same | another program | false |
  | `linux` | the same | timed out | true |
  | `windows` | `powershell.exe -NoProfile -NonInteractive -Command (Get-CimInstance Win32_Process -Filter "ProcessId=4321").CommandLine` (args as Decisions) | code 0, stdout `powershell.exe -NoProfile -Command ps-script # builds-local\r\n` | true |
  | `windows` | the same | code 0, stdout `C:\Windows\notepad.exe\r\n` | false |
  | `windows` | the same | code 0, stdout `` | false |
  | `windows` | the same | code -1, `timedOut` true | true |

- `describe('killLine')`, `it.each`: `macos` → `{command: 'kill', args: ['-TERM', '--', '-4321']}`;
  `windows` → `{command: 'taskkill', args: ['/PID', '4321', '/T', '/F']}`.

`local-backend.test.ts`:
- `describe('localBackendKind.create')`, `it.each` `'gives a problem for $name'`:

  | name | entry change | the problem contains |
  |---|---|---|
  | a config that is not an object | `config: []` | `config` |
  | a game with no clone | game `demo` `clone: null` | `demo` |
  | a target with no command | kind `ok` target `{args: []}` | `demo` and `ok` |
  | an empty command | kind `ok` target `{command: '', args: []}` | `demo` and `ok` |
  | args that are not strings | kind `bad` target `{command: './fail.sh', args: [1]}` | `demo` and `bad` |
  | a target that is a string | kind `bad` target `'./fail.sh'` | `demo` and `bad` |
  | a game id with a slash | game id `a/b` | `a/b` |
  | a game id of `..` | game id `..` | `..` |
  | a game id with a colon | game id `c:demo` | `c:demo` |
  | a kind key that climbs | kind key `../x` | `demo` and `../x` |
  | a kind key of `.` | kind key `.` | `demo` and `.` |
  | a newline in an arg | kind `ok` target `{command: './build.sh', args: ['--env\ndev']}` | `demo` and `ok` |
  | a newline in the command | kind `ok` target `{command: './build.sh\r', args: []}` | `demo` and `ok` |

  A game id `my-game.v2` with kind key `dev_1` gives a backend, not a problem.

- `it('creates a backend that cancels and builds the folder as it stands')` — `capabilities`
  equal `{cancel: true, choosesBranch: false}`.
- `describe('queue')`, `it('starts the target detached through the wrapper and records the run')`
  — clock `1_000_000`; `queue(game, {kind: 'ok', branch: 'ignored', revision: null})` resolves
  `{id: 'demo/ok/1000000'}`; the folder `runs/demo/ok/1000000` exists in `dataFiles`;
  `detachedStarts` equals
  `[{command: '/bin/sh', args: ['-c', POSIX_WRAPPER, 'builds-local', '/data/runs/demo/ok/1000000/pid', '/data/runs/demo/ok/1000000/exit-code', './build.sh', '--env', 'dev'], options: {cwd: '/clones/demo', logPath: '/data/runs/demo/ok/1000000/log.txt'}}]`;
  `runs.json` parses to `{runs: [{id: 'demo/ok/1000000', gameId: 'demo', kind: 'ok', branch: 'feature/x', revision: '2993a9e4b92724916453c6e2a3257c4838ce0777', startedAt: 1000000, finishedAt: null, exitCode: null, cancelled: false, lastLine: null}]}`.
- `it.each` `'queue $name'`:

  | name | setup | expected |
  |---|---|---|
  | rejects a second run of a running kind | one `ok` run queued at `1_000_000`, `pid` `4321\n`, alive check alive, clock `1_300_000` | rejects; message contains `OK` and `Demo`; no new detached start |
  | allows another kind beside a running one | one `ok` run queued at `1_000_000`, `pid` `4321\n`, alive check alive, clock `1_300_000`, queue `bad` | resolves `{id: 'demo/bad/1300000'}` |
  | starts after a dead pid | one `ok` run queued at `1_000_000`, `pid` `4321\n`, alive check gone, clock `1_300_000` | the old run is `finished`, `failure`, `ended without an exit code`, `finishedAt` `1_300_000`; resolves `{id: 'demo/ok/1300000'}`; two detached starts in all |
  | records nothing when the start fails | `failDetachedStarts(new Error('Could not run /bin/sh: EACCES'))` | rejects with that message; `runs.json` absent; after `failDetachedStarts(null)`, a second queue of `ok` resolves `{id: 'demo/ok/1000000'}` |
  | records the short commit on a detached head | `currentBranch` answers `2993a9e` | the run's `branch` is `2993a9e` |
  | rejects outside a git clone | `currentBranch` answers null | rejects; message contains `/clones/demo`; no detached start; `runs.json` absent |
  | rejects an unknown kind | kind `qa` | message contains `qa` |

- `it('starts one build for two queue calls of one kind at once')` — clock `1_000_000`; two
  `queue(game, {kind: 'ok', branch: 'ignored', revision: null})` calls start before either
  settles. The first resolves `{id: 'demo/ok/1000000'}`. The second rejects with a message that
  contains `OK` and `Demo`. `detachedStarts` has one entry, and `runs.json` holds one run.

- `describe('list settles a running run')`, `it.each` `'$name'`. Each row queues `ok` at clock
  `1_000_000`, writes the files named under `runs/demo/ok/1000000/`, scripts the alive check
  `ps -o command= -p 4321` as named (Test values), sets the clock to `now`, then lists:

  | name | `exit-code` | `pid` | alive check | now | state | result | statusText | finishedAt |
  |---|---|---|---|---|---|---|---|---|
  | an exit code of 0 | `0\n` written at clock `1_200_000` | `4321\n` | not run | `1_300_000` | finished | success | null | `1_200_000` |
  | a non-zero exit code | `2\n` written at `1_200_000` | `4321\n` | not run | `1_300_000` | finished | failure | `Exited with code 2` | `1_200_000` |
  | a negative Windows exit code | `-1073741510\r\n` written at `1_200_000` | `4321\n` | not run | `1_300_000` | finished | failure | `Exited with code -1073741510` | `1_200_000` |
  | an exit file that is not a number | `2abc\n` | `4321\n` | gone | `1_300_000` | finished | failure | `ended without an exit code` | `1_300_000` |
  | a live pid | absent | `4321\n` | alive | `1_300_000` | running | null | null | null |
  | an exit file not yet whole | `` (empty) | `4321\n` | alive | `1_300_000` | running | null | null | null |
  | a gone pid, no exit code | absent | `4321\n` | gone | `1_300_000` | finished | failure | `ended without an exit code` | `1_300_000` |
  | a pid of another program | absent | `4321\n` | another program | `1_300_000` | finished | failure | `ended without an exit code` | `1_300_000` |
  | no pid yet, inside the grace | absent | absent | not run | `1_000_000 + PID_GRACE_MS - 1` | running | null | null | null |
  | no pid past the grace | absent | absent | not run | `1_000_000 + PID_GRACE_MS` | finished | failure | `ended without an exit code` | `1_000_000 + PID_GRACE_MS` |
  | an alive check that rejects | absent | `4321\n` | rejects | `1_300_000` | running | null | null | null |
  | an alive check that times out | absent | `4321\n` | timed out | `1_300_000` | running | null | null | null |

  A finished row's `runs.json` holds the same `finishedAt` and `exitCode`.
- `it('reads the exit code again when the pid is gone')` — the alive check answers gone, and the
  test writes `exit-code` `3` inside that run's scripted promise before it settles: the run ends
  with `Exited with code 3`.
- `it('leaves runs.json unwritten when a list has nothing to settle')` — `runs.json` holds one
  finished `ok` run, written at clock `1_000_000`. The clock moves to `1_300_000`, and
  `list(game, 20)` runs: `dataFiles.modified('runs.json')` stays `1_000_000`.
- `describe('progress')`, `it.each` `'$name'`: earlier runs of `demo`/`ok` are written to
  `runs.json` before the instance's first call; a running `ok` run started at `2_000_000`:

  | name | earlier runs (startedAt → finishedAt, exitCode) | now | percent | leftSeconds |
  |---|---|---|---|---|
  | half of the last success | `1_000_000 → 1_600_000`, 0 | `2_300_000` | 50 | 300 |
  | just under the end | `1_000_000 → 1_600_000`, 0 | `2_599_000` | 99 | 1 |
  | past the last success | `1_000_000 → 1_600_000`, 0 | `2_900_000` | 99 | 0 |
  | the newest success counts | `100_000 → 700_000`, 0 and `1_000_000 → 1_400_000`, 0 | `2_200_000` | 50 | 200 |
  | a success of no duration does not count | `1_000_000 → 1_000_000`, 0 | `2_300_000` | null | null |
  | a success of no duration leaves the older one | `100_000 → 700_000`, 0 and `1_000_000 → 990_000`, 0 | `2_300_000` | 50 | 300 |
  | a failure does not count | `1_000_000 → 1_600_000`, 1 | `2_300_000` | null | null |
  | another kind does not count | a `bad` run `1_000_000 → 1_600_000`, 0 | `2_300_000` | null | null |
  | no earlier run | none | `2_300_000` | null | null |

- `it.each` `'shows $name as the step'` — a running run's `runs/demo/ok/1000000/log.txt` holds the
  log, the alive check answers alive, and `list` gives the `stepText`:

  | name | log | stepText |
  |---|---|---|
  | the last non-empty line | `building\r\nstep two  \n\n   \n` | `step two` |
  | the last state of a redrawn line | `10%\r20%\r30%` | `30%` |
  | a line without its colour escapes | `\x1b[32mdone\x1b[0m\n` | `done` |
  | no line | `\n  \n` | null |

- `it('saves the last line once the run ends')` — the log is `building\r\nstep two  \n\n   \n`.
  After the `exit-code` `0` appears, `runs.json`'s `lastLine` is `step two`, and a later list
  reads the log no more (the test deletes `log.txt` and `stepText` stays `step two`).
- `it('lists the newest runs across kinds, cut to the limit')` — finished runs `ok` at
  `1_000_000`, `bad` at `2_000_000`, `ok` at `3_000_000`; `list(game, 2)` gives ids
  `['demo/ok/3000000', 'demo/bad/2000000']`, every record with `number` null, `queuedAt` equal to
  `startedAt`, `links` `[]`, `jobs` `[]`, `webUrl` null.
- `it('keeps a run an earlier instance started')` — one instance queues `ok`; a new backend from
  `create` over the same `dataFiles` lists it as running; after `exit-code` `0` appears it lists it
  as success.
- `it('keeps the runs of two instances over one runs.json')` — instance A lists at clock
  `1_000_000` and reads the empty `runs.json`. Instance B, from `create` over the same
  `dataFiles`, lists and reads the same file. Instance B queues `ok` at clock `1_100_000`. Then
  instance A queues `bad` at clock `1_200_000`. `runs.json` holds both ids, `demo/ok/1100000` and
  `demo/bad/1200000`, and a list on instance A gives both.
- `it('drops the oldest finished runs past KEPT_RUNS with their files')` — `KEPT_RUNS + 1`
  finished `ok` runs in `runs.json`, each with its three files; after one write (a queue of `bad`),
  `runs.json` holds the newest `KEPT_RUNS` `ok` runs and the `bad` run, and the oldest run's
  `log.txt`, `pid` and `exit-code` are gone.
- `it.each` `'rejects every call over a runs.json that is $name, and keeps it'`:

  | name | `runs.json` text |
  |---|---|
  | not JSON | `{runs: 3` |
  | a runs value that is not an array | `{"runs": "x"}` |
  | a run with no id | `{"runs": [{"gameId": "demo", "kind": "ok", "branch": "main", "revision": null, "startedAt": 1000000, "finishedAt": null, "exitCode": null, "cancelled": false, "lastLine": null}]}` |

  For each, `list`, `queue` and `cancel` each reject with a message that starts
  `runs.json is not valid`, and the file text is unchanged.
- `it('reads a run with an extra key')` — `runs.json` holds the run of the last row above with
  `"id": "demo/ok/1000000"` and `"note": "x"` added, and its `finishedAt` `1200000` and `exitCode`
  `0`. `list(game, 20)` gives one record, `demo/ok/1000000`, `result` `success`.
- `describe('cancel')`, `it.each` `'$os signals the group and marks the run cancelled'` — rows
  `macos` (alive check scripted alive, scripted `kill -TERM -- -4321` code 0) and `windows`
  (`windowsPaths`, `fakePlatform('windows')`, `dataFolder` `C:\data`, clone `C:\clones\demo`, the
  Windows alive check of `4321` scripted code 0, stdout `powershell.exe -NoProfile -Command ps-script # builds-local\r\n`,
  scripted `taskkill /PID 4321 /T /F` code 0): with `pid` `4321`, clock `1_500_000`,
  `cancel(game, id)` runs the alive check, then that one kill line; the record has `result`
  `cancelled`, `statusText` `Cancelled`, `finishedAt` `1_500_000`. A later `exit-code` `143` and a
  later list leave it `cancelled`.
- `it.each` `'cancel $name'` (macOS, `pid` `4321\n`, clock `1_500_000`):

  | name | setup | expected |
  |---|---|---|
  | does nothing for a finished run | `exit-code` `0` already settled | resolves; no run recorded |
  | finishes a run that already exited | `exit-code` `0` present, not yet listed | resolves; no kill run; result `success` |
  | rejects with no pid yet | no `pid` file | rejects with `The build has not written its pid yet` |
  | rejects an unknown id | id `nope` | rejects; message contains `nope` |
  | kills nothing for a pid of another program | alive check another program | resolves; no `kill` run; the run is `finished`, `failure`, `ended without an exit code`, `finishedAt` `1_500_000` |
  | rejects when the alive check rejects | alive check rejects | rejects; no `kill` run; the run is `running` |
  | rejects when the kill rejects | alive check alive; `kill -TERM -- -4321` rejects `Could not run kill: ENOENT` | rejects; the run is `running` |
  | rejects when the kill times out | alive check alive; `kill -TERM -- -4321` code -1, `timedOut` true | rejects; the run is `running` |
  | ends the run on a non-zero kill exit | alive check alive; `kill -TERM -- -4321` code 1, stderr `kill: 4321: No such process` | resolves; the run is `cancelled` |

- `it('waits for a list settle before it cancels')` — the run's `pid` is `4321\n`. The alive check
  is scripted as a `deferred()` promise. `list(game, 20)` starts, and then `cancel(game, 'demo/ok/1000000')`
  starts while that promise is pending. The test re-scripts the alive check as alive, scripts
  `kill -TERM -- -4321` code 0, and resolves the deferred promise with the alive answer. Both
  calls settle. The run is `cancelled`, `statusText` `Cancelled`, and `kill -TERM -- -4321` ran
  once, after the list's alive check.

`start.test.ts`, `describe('buildsLocalMainPart')`:
- `it('adds the local backend kind to builds')` — `startMainPart(buildsLocalMainPart, {dependencies: [fakeDependency(buildsMainKey, () => ({addBackend}))]})`,
  where `addBackend` records each kind it gets and returns a `Disposable`. It records one kind,
  and that kind's `kind` is `'local'`.

Approach: none. Every behaviour-changing choice is pinned above, the Windows wrapper verbatim.

Done when: `npm run typecheck` passes; `npm run lint` passes; the test gate runs the three test
files above. Live checks defer to task 10 "Final verification" (its checks 2, 3, 7 and 8 drive a
local backend).

Commit: one commit for the group, `CHANGELOG.md` left to task 08.

## Proof

Commit b414c162a · proof: diff read: localBackendKind, LocalTarget, ProgramLine, wrapperLine, aliveCheckLine, isAlive, killLine present; wave typecheck and lint pass · concerns: no-control-regex disable on the ANSI regex copied from claude-auth.ts unconfirmed as needed; one test overrides processes.run on its FakeProcesses instance
