# 04 — Program lookup and spawn behind ProcessRunner

Status: not started
Type: Task
Wave: 4 · Depends on: 03 and the Lane H gate (plan.md § Cross-lane gate)
Plan: [plan.md](plan.md)

Lane H marks: this task is written against the tree at `8cd4caaf`. Each step that Lane H's three items move is marked
**[Lane H]**. At Wave 4 start, apply the step to the landed home that the mark names.

Files:
- modify `src/contracts/platform.ts` · `src/shared/platform.ts` · test `src/shared/platform.test.ts`
- modify `src/contracts/processes.ts`
- create `src/shared/program-lookup.ts` · test `src/shared/program-lookup.test.ts`
- modify `src/main/processes/node-processes.ts` · test `src/main/processes/node-processes.test.ts`
- modify `src/main/processes/limited-processes.ts` · test `src/main/processes/limited-processes.test.ts`
- modify `src/shared/fake-processes.ts` · test `src/shared/fake-processes.test.ts`
- modify `src/shared/plugin-service-views.ts` · test `src/main/plugins/main-api.test.ts`
- modify `src/contracts/settings.ts` · `src/config/settings.ts` · test `src/config/settings.test.ts` ·
  `src/plugins/manifests.test.ts`
- modify `src/main/main.ts`
- modify `src/plugins/docs/main/index-sources.ts` · test `src/plugins/docs/main/index-sources.test.ts`
- modify `src/plugins/unity-pool/manifest.ts` · `src/plugins/unity-pool/main/pool-cli.ts` ·
  `src/plugins/unity-pool/main/start.ts` · test `src/plugins/unity-pool/main/pool-cli.test.ts`
- modify (compile only) `src/plugins/practice/main/judge.test.ts` (its `scriptedRunner` literal) and each full
  `Settings` literal the compiler flags: `src/main/selftest-config.test.ts:155`,
  `src/main/config/config-store.test.ts:33`, `src/main/config/user-config.test.ts:27`,
  `src/main/config/user-settings.test.ts:11`
- modify docs `AGENTS.md` · `docs/features/unity-pool/design.md`

Every `ProcessRunner` implementer in the tree, checked at `8cd4caaf` with `grep -rn "ProcessRunner"`:
`createNodeProcesses` (node adapter), `limitRuns`, `abortableProcesses`, `FakeProcesses`, and the test literals in
`limited-processes.test.ts` (two) and `judge.test.ts` (one). Each one gains `spawn` and `resolveProgram`. Every
other `ProcessRunner` user only calls `run` and does not change: `process-git.ts`, `system-stats/*`,
`drive-run.ts`, `frame-recorder.ts`, backlog's and practice's self-test scripts, `practice/main/judge.ts`,
`contracts/plugin.ts` (`MainServices.processes`).

Consumes: `PlatformKeys` and `Platform.keys` ← 01 (same file, `src/contracts/platform.ts`; this task keeps them).
`Files.stat`, `Paths.expandTilde`, `Paths.join` (in the tree).

## Produces

`src/contracts/platform.ts` — replaces `PlatformPrograms`, word for word as plan.md § File Structure gives:

```ts
export interface ProgramCandidate {
  readonly command: string;
  readonly args: readonly string[];
}
export interface PlatformPrograms {
  readonly python: readonly ProgramCandidate[];
  readonly claude: readonly ProgramCandidate[];
}
export type ProgramName = keyof PlatformPrograms;
```

`src/contracts/processes.ts` — adds:

```ts
// How one `ProcessRunner.spawn` starts its program.
export interface ProcessSpawnOptions {
  cwd?: string;
  // The child's whole environment, in place of the app's. Unset, the child gets the app's environment.
  env?: Readonly<Record<string, string>>;
  // The program starts in its own process group with stdin, stdout and stderr ignored, the app does not wait on
  // it, and it outlives the app.
  detached?: boolean;
}
// How a spawned program ended: its exit code, or the signal that ended it; `error` is set only when it did not start.
export interface ProcessExit {
  code: number | null;
  signal: string | null;
  error: string | null;
}
// One running program.
export interface ProcessHandle {
  write(text: string): void;
  end(): void;
  onStdout(listener: (text: string) => void): Disposable;
  onStderr(listener: (text: string) => void): Disposable;
  onExit(listener: (exit: ProcessExit) => void): Disposable;
  kill(signal?: 'SIGTERM' | 'SIGKILL'): void;
}
// ProcessRunner gains:
spawn(command: string, args: readonly string[], options?: ProcessSpawnOptions): ProcessHandle;
resolveProgram(name: ProgramName): Promise<ProgramCandidate | null>;
```

`Disposable` comes from `./disposable`; `ProgramName` and `ProgramCandidate` from `./platform`.

`src/shared/program-lookup.ts` (new, pure, imports only contracts):

```ts
export interface ProgramSearch {
  os: OsName;
  path: string | undefined;     // the PATH value
  pathExt: string | undefined;  // the PATHEXT value; read on Windows only
  homeDir: string;
  paths: Pick<Paths, 'expandTilde' | 'join'>;
}
export interface ProgramLaunch {
  file: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}
export function envVariable(env: Readonly<Record<string, string | undefined>>, name: string, os: OsName): string | undefined;
export function findProgram(command: string, search: ProgramSearch, files: Pick<Files, 'stat'>): Promise<string | null>;
export function findCandidate(candidates: readonly ProgramCandidate[], search: ProgramSearch, files: Pick<Files, 'stat'>): Promise<ProgramCandidate | null>;
export function shimLaunch(target: string, args: readonly string[], os: OsName, comSpec: string): ProgramLaunch;
export function programNotFoundMessage(name: ProgramName): string;
```

`src/main/processes/node-processes.ts`:

```ts
export interface NodeProcessesDeps {
  files: Pick<Files, 'stat'>;
  paths: Pick<Paths, 'expandTilde' | 'join'>;
  os: OsName;
  homeDir: string;
  programs: PlatformPrograms;
  // The core setting that names `name`'s program, '' when unset or when `name` has no core setting.
  programSetting(name: ProgramName): string;
}
export function createNodeProcesses(deps: NodeProcessesDeps): ProcessRunner;
```

`src/shared/fake-processes.ts`:

```ts
export interface FakeSpawn {
  command: string;
  args: string[];
  cwd: string | undefined;
  env: Readonly<Record<string, string>> | undefined;
  detached: boolean;
  handle: FakeProcessHandle;
}
export class FakeProcessHandle implements ProcessHandle {
  readonly written: string[];   // each `write` text, in order
  readonly kills: string[];     // each `kill` signal, 'SIGTERM' when none was given
  isEnded: boolean;             // true once `end` ran
  stdout(text: string): void;   // calls every stdout listener with `text`
  stderr(text: string): void;
  exit(exit: ProcessExit): void; // calls every exit listener once; a later exit does nothing
}
// FakeProcesses gains:
readonly spawns: FakeSpawn[];
scriptProgram(name: ProgramName, candidate: ProgramCandidate | null): void;
```

Settings: `Settings.programs: { python: string }` in `src/contracts/settings.ts`; `defaultSettingsFor(): Settings`
(no parameter) in `src/config/settings.ts`.

## Decisions

Platform record (plan.md § Decisions › Python, › Default claude command):

- `src/shared/platform.ts` builds `programs` per OS. Windows: `python` = `py` with `['-3']`, then `python` with
  `[]`, then `python3` with `[]`; `claude` = `claude.exe` with `[]`, then `~/.local/bin/claude.exe` with `[]`.
  macOS and Linux: `python` = `python3`, then `python`, each with `[]`; `claude` = `claude`, then
  `~/.local/bin/claude`. The record holds the `~` unexpanded. Windows names `claude.exe` with its extension, so the
  lookup appends no PATHEXT and never picks an npm `claude.cmd` shim: sessions start in the session host process,
  whose own spawn starts no shim (plan.md § Out of scope), and today's default is the installer's `.exe`. A user
  with only a shim sets `claude.command` (task 05's follow-up covers shims in the host).
  `DEFAULT_PROGRAMS` goes; each `create<Os>Platform` passes its own programs to `platformRecord`.
- `defaultSettingsFor` loses its `programs` parameter, since `PlatformPrograms` no longer holds a setting default.
  `claude.command` keeps today's default as a literal: `'~/.local/bin/claude'` (task 05 makes it `''`). The
  `programs` comment in `src/contracts/platform.ts` that says "The default of the `claude.command` setting" goes.
  **[Lane H]** Harness settings with the harness moves `claude.command` into the Claude harness plugin's manifest.
  Then the literal lives in that manifest's `settings`, and `defaultSettingsFor` only loses its parameter.

Core setting `programs.python` (plan.md § Decisions › Python):

- `Settings` gains `programs: { python: string }`, default `{ python: '' }` in `defaultSettingsFor`. Its comment in
  `src/contracts/settings.ts`: the Python the docs index and unity-pool run; empty, the app looks up the OS's
  candidates.
- `settingInfo['programs.python']`: label `Python command`; description
  `The Python the docs index and unity-pool run: a program name or a path; ~ is the home folder. Empty, the app looks on PATH for py -3, python, then python3 on Windows, and python3, then python elsewhere. Applies to the next run.`
- No `settings.json` edit: the user's file holds no `pythonCommand` and no `programs` (Preconditions). The report
  states this.
- Unity-pool's `pythonCommand` setting and its `settingInfo` entry go from `src/plugins/unity-pool/manifest.ts`.
  Its `scriptPath` description changes "run with the Python command" to "run with the core programs.python Python".

Where the override is read (agent's decision, shown as a Decided notice):

- The node adapter takes `programSetting(name)` from the composition root. `main.ts` passes
  `(name) => name === 'python' ? (currentSettings?.().programs.python ?? '') : ''`. `currentSettings` is a new
  module-level `let currentSettings: (() => Settings) | null = null;`. `whenReady` sets it to
  `() => store.current().settings` on the line after `loadConfig` returns. Reason: `processes` is built at module
  load, before the ConfigStore exists. A `resolveProgram` before that line reads `''`. `layoutService` uses the same
  late-bound pattern.
- `main.ts` builds `processes` as `createNodeProcesses({ files, paths, os: platform.os, homeDir: os.homedir(),
  programs: platform.programs, programSetting })`. Move the `processes` line below the `paths` line, since it now
  takes `paths`. `homeDir` is `os.homedir()` and not the run's home, because programs are installed under the
  user's real home and a self-test or drive run's temp home holds none.

`resolveProgram(name)` (node adapter):

1. `setting = deps.programSetting(name)`. When `setting !== ''`, resolve to
   `{ command: paths.expandTilde(setting, homeDir), args: [] }` with no lookup. A set command wins even when no file
   is there; the run then fails with the adapter's `Could not run <command>: …` text, which names the user's
   setting.
2. Else return `findCandidate(deps.programs[name], search, files)`. `search` is built at each call from the live
   `process.env`, since main swaps in the login-shell PATH after the adapter is built (AGENTS.md § Dev quirks).
3. `findCandidate` tries each candidate in order. The first one whose `findProgram(candidate.command, …)` is not
   null wins, as `{ command: <found path>, args: candidate.args }`. None found: `null`.

`findProgram(command, search, files)` (agent's decision on the open rules; a pure function, so both OSes are tested
on any machine):

- A command is a path when it starts with `~/`, or holds `/`, or, on Windows, starts with `~\` or holds `\` or `:`.
  `~` is expanded with `paths.expandTilde(command, homeDir)`. A path is searched in its own folder only. Any other
  command is a bare name, searched in each PATH folder in order.
- PATH splits on `;` on Windows and on `:` elsewhere. Empty entries are skipped, so the current folder is never
  searched. On Windows a PATH entry wrapped in `"` has the quotes stripped.
- On Windows, PATHEXT splits on `;` with empty entries skipped. Unset or empty, it is `.COM;.EXE;.BAT;.CMD`. A name
  whose extension is in PATHEXT (compared without case) is tried as it is and only so. Any other name is tried
  with each PATHEXT extension appended, in PATHEXT order. Folder order wins over extension order: every extension
  in the first folder is tried before the second folder.
- Off Windows, the name is tried as it is. No extension is appended.
- A `files.stat` that throws (`EACCES`, `EPERM`, `EINVAL` on an odd PATH entry: `statPath` rethrows all but
  `ENOENT`/`ENOTDIR`) is a miss for that try only; the search goes on, and `findProgram` never rejects. Test: one
  Windows table row whose first folder's `stat` throws finds the file in the second.
- A try succeeds when `files.stat(file)` is not null and `isFolder` is false. `Files` has no mode bits, so the
  execute bit is not checked. The result is the file path, joined with `paths.join`.

`envVariable(env, name, os)`: on Windows, the value of the first key equal to `name` without case (`Path` answers
`PATH`), since a copied environment record loses Windows' case-insensitive names. Elsewhere, `env[name]`.

Lookup and shims in `run` and `spawn` (plan.md § Decided by the agent: "PATHEXT and shim handling apply to every
`run` and `spawn` of a bare name, git's included"):

- On Windows only: before starting, the adapter runs `findProgram(command, search, files)`. `search` reads `PATH`
  and `PATHEXT` with `envVariable` from the child's environment: `options.env` when given, else the app's
  environment after `unsetEnv` and `setEnv`. A found path is the target, else `command` as given (so Node's
  `ENOENT` text stays). Then `shimLaunch(target, args, 'windows', comSpec)` gives what Node spawns, with
  `comSpec = envVariable(process.env, 'ComSpec', 'windows') ?? 'cmd.exe'`, as Node's own `shell` option picks it.
- Off Windows: no lookup. `command` and `args` pass to Node unchanged, since Node's own PATH search
  (`execvp`) already finds the name. This keeps git's runs on macOS free of extra `stat` calls.
- Cache (agent's decision): the Windows lookup in `run` and `spawn` keeps each found path, keyed by `command`, PATH
  and PATHEXT, for the adapter's life. A miss is not kept. An entry is dropped when a start of its path fails, so
  the next run looks again. `resolveProgram` does not read or write the cache, so a newly installed Python is found.
- `run` keeps every behaviour its contract comment gives. Its `timeoutMs` counts from the child's start, after the
  lookup. A `signal` that aborts during the lookup rejects with `Stopped <command>` and starts nothing.

`shimLaunch(target, args, os, comSpec)` — the quoting is open in a way that changes behaviour, so it is pinned.
Sources: Node's docs, child_process § "Spawning .bat and .cmd files on Windows" (a `.bat`/`.cmd` cannot run without
`cmd.exe`; spawn `cmd.exe` with the file as an argument) and the `windowsVerbatimArguments` option ("No quoting or
escaping of arguments is done on Windows"). Node's `shell` option on Windows spawns `cmd.exe /d /s /c "<line>"`
with `windowsVerbatimArguments: true`. The argument escaping is cross-spawn's `lib/util/escape.js` (MIT; read, not
installed), which follows https://qntm.org/cmd. `cmd /?` documents `/S`: cmd strips the first and the last quote
and keeps the rest as typed.

- Off Windows, or when `target` does not end in `.cmd` or `.bat` (compared without case):
  `{ file: target, args: [...args], windowsVerbatimArguments: false }`.
- Else `{ file: comSpec, args: ['/d', '/s', '/c', line], windowsVerbatimArguments: true }`, where
  `line = '"' + [escapeCommand(target), ...args.map(escapeArgument)].join(' ') + '"'`.
- `META = /([()\][%!^"`<>&|;, *?])/g`.
- `escapeCommand(text)`: `text.replace(META, '^$1')`.
- `escapeArgument(arg)`, in this order:
  1. each run of backslashes before a `"` is doubled, and the `"` becomes `\"`: `arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')`;
  2. a run of backslashes at the end is doubled: `.replace(/(?=(\\+?)?)\1$/, '$1$1')`;
  3. the whole is wrapped in `"`;
  4. every META character gets a leading `^`, the wrapping quotes included.
- No second (double) escape. cross-spawn adds one only for `node_modules\.bin\*.cmd` shims, and this app runs none.
- An argument holding `\r` or `\n` cannot pass through `cmd.exe`. `shimLaunch` throws
  `an argument holds a line break, which cmd.exe cannot pass`. `run` rejects with `Could not run <command>: <that>`.
  `spawn`'s handle exits with that text as `error`.

`spawn(command, args, options)` (node adapter; plan.md § Decisions › Spawn handle):

- With pipes (no `detached`): stdio `['pipe', 'pipe', 'pipe']`, `windowsHide: true`, `cwd`, and `env` when given.
  stdout and stderr are decoded as UTF-8 with `setEncoding('utf8')`, so a character split across chunks arrives
  whole. Each chunk goes to every listener added so far. Output that arrives while a stream has no listener is
  dropped, so a caller adds its listeners in the same tick as `spawn`.
- `write(text)` writes `text` as UTF-8 to stdin, with no newline added. `write` after `end`, after the exit, or
  after `kill` does nothing. A stdin stream error (`EPIPE` after the child died) is swallowed: the exit reports
  the outcome.
- `onExit` hears one `ProcessExit`, once. It is the first of: Node's `close` (`{ code, signal, error: null }`), or
  Node's `error` before the child started (`{ code: null, signal: null, error: 'Could not run <command>: <reason>' }`
  — the same text and missing-`cwd` rule as `run`'s `startFailureMessage`). A synchronous throw from Node's `spawn`
  (such as `EINVAL`) gives the same start-failure exit on a microtask: `spawn` itself never throws. A listener added after the exit hears
  that exit on a microtask. Disposing a listener stops only that listener.
- `kill(signal = 'SIGTERM')` sends the signal while the child runs, and does nothing after the exit. A grandchild
  (cmd.exe's child under a shim) is not killed, the same as `run` today.
- `detached: true`: `detached: true`, `stdio: 'ignore'`, `windowsHide: true`, then `child.unref()`. `write` and
  `end` do nothing, and the stdout and stderr listeners never fire. `onExit` still hears a start failure, or the
  exit while the app runs.
- On Windows the child starts after the async lookup. `write` and `end` calls made before the start are queued and
  applied in order once stdin exists. A `kill` before the start starts nothing, and the exit reports
  `{ code: null, signal: <the signal>, error: null }`. Off Windows the child starts inside the `spawn` call.

`limitRuns` (agent's decision): `spawn` and `resolveProgram` forward to the inner runner at once. They do not count
toward `maxRunning`, because a handle has no end the limiter can wait on. The function comment says so.

`abortableProcesses` (per-plugin view; AGENTS.md § An ambient service: a stopped plugin's processes are aborted):

- It keeps each handle from `spawn` until that handle's exit. Disposing the view calls `kill('SIGKILL')` on every
  kept handle that is not detached. A detached handle is meant to outlive the app, so it outlives the plugin too.
- A `spawn` after dispose starts nothing. It returns a handle whose exit, on a microtask, is
  `{ code: null, signal: null, error: 'Stopped <command>' }`, as `run` rejects with `Stopped <command>` then.
- `resolveProgram` forwards unchanged. The function comment names handles beside runs.
- **[Lane H]** AgentHarnessRegistry moves the harness construction into a harness plugin that takes
  `api.services.processes`. That plugin's one-shots then go through this view, so a stopped harness plugin kills
  them. Nothing to change here for that.

`FakeProcesses` (tests' double):

- `spawn` records a `FakeSpawn` with a new `FakeProcessHandle` and returns that handle. It needs no script. The
  test drives the handle from `spawns[i].handle`. `detached` records `options?.detached ?? false`.
- `resolveProgram(name)` answers what `scriptProgram` set for `name`. Unscripted, `python` answers
  `{ command: 'python3', args: [] }` and `claude` answers `{ command: 'claude', args: [] }`, so every existing test
  that scripts `'python3'` keeps passing unchanged. The class comment states both defaults.

Callers of `resolveProgram('python')` (plan.md § Decisions › Python):

- `programNotFoundMessage('python')` is `Python was not found on PATH; set programs.python`.
  `programNotFoundMessage('claude')` is `claude was not found on PATH or in ~/.local/bin; set claude.command` (task 05
  uses it). **[Lane H]** Once `claude.command` moves into the Claude harness plugin's manifest, the claude text names
  that setting's landed dotted path.
- Both `resolveProgram` calls below sit inside the caller's existing `try`, so an unexpected rejection becomes
  `cli-failed` (unity-pool) or the shown message (docs), as a failed run does today.
- Docs, `runScript` in `index-sources.ts`: after `locateScript` finds the script, it calls
  `deps.processes.resolveProgram('python')`. On null, it logs `docs_index.py <command> not run: <message>`, runs
  nothing, and returns the message to show. On a candidate, it runs `candidate.command` with
  `[...candidate.args, '-X', 'utf8', script, command, ...args]`. The function comment drops "python3" and names
  the resolved Python. `ScriptOutcome`'s `isScriptMissing` is renamed `isUnrunnable`: true when no
  `docs_index.py` or no Python was found. `sessionIndex` reads it, so no `context` fallback runs, and the not-found
  line is logged once.
- Unity-pool, `runPoolCommand` in `pool-cli.ts`: `CliDeps.pythonCommand` goes. After `findScript` succeeds, it
  calls `deps.processes.resolveProgram('python')`. On null, it returns
  `{ ok: false, error: 'no-python', message: programNotFoundMessage('python') }` and runs nothing. `start.ts`
  already logs every result as `<action> <pool> <clone>: <error>: <message>`, which gives the logged line. On a
  candidate, it runs `candidate.command` with `[...candidate.args, ...poolCommandArgs(script, action, pool, clone)]`,
  with the same `timeoutMs` and `unsetEnv`. The `-X utf8` args stay after the candidate's own args.
  `start.ts`'s `cliDeps` stops reading `pythonCommand`. The comments on `runPoolCommand`, `CliDeps` and
  `contract.ts:107` (`no-cli` and `cli-failed`) add `no-python`.

## Behaviour

- GIVEN Windows, PATH `C:\npm;C:\Users\u\.local\bin`, and both `C:\npm\claude.cmd` and
  `C:\Users\u\.local\bin\claude.exe` present WHEN `findProgram('claude', …)` runs THEN it returns
  `C:\npm\claude.cmd` (the general rule; no candidate names a bare `claude` on Windows).
- GIVEN the same Windows PATH and files WHEN `resolveProgram('claude')` runs THEN it returns
  `{ command: 'C:\Users\u\.local\bin\claude.exe', args: [] }`: the `claude.exe` candidate skips the shim.
- GIVEN `programs.python` is `''` and only `python` is on PATH on Windows WHEN `resolveProgram('python')` runs THEN
  it returns `{ command: <that path>, args: [] }`. With `py` found, it returns `{ command: <py path>, args: ['-3'] }`.
- GIVEN `programs.python` is `~/py/python` WHEN `resolveProgram('python')` runs THEN it returns
  `{ command: '<home>/py/python', args: [] }` without a lookup.
- GIVEN a `.cmd` target on Windows WHEN `run` or `spawn` starts it THEN Node spawns `<ComSpec>` with
  `['/d', '/s', '/c', <line>]` and `windowsVerbatimArguments: true`.
- GIVEN no Python on PATH WHEN docs indexes THEN the view shows `Python was not found on PATH; set programs.python`,
  the log has one `not run` line, and no run starts.
- GIVEN a plugin with a running spawned handle WHEN the plugin stops THEN the handle gets `SIGKILL`.

## Tests

- The node adapter's Windows branch is tested on every OS: `NodeProcessesDeps` also gains `start` (Node's `spawn` by
  default), so `src/main/processes/node-processes.test.ts` runs `os: 'windows'` with a `stat`
  double and a fake child. One table pins, per row: the file and args Node is handed and the verbatim flag (`.exe`
  direct; `.cmd` through `<ComSpec> /d /s /c <line>`, verbatim true); the lookup reading PATH from `options.env`
  when given; a second run of the same command asking no `stat` (cache) and a failed start dropping the entry; an
  abort during the lookup rejecting `Stopped <command>` with nothing started; `write`/`end` before the start
  reaching the child in order; `kill` before the start exiting with that signal and nothing started.
- `src/shared/program-lookup.test.ts` (new). Each `findProgram` row builds a `stat` double over a list of present
  files and present folders (Windows rows compare paths without case), and uses `windowsPaths` or `posixPaths`.
  - `findProgram` Windows table (`it.each`, os `windows`, homeDir `C:\Users\u`, PATHEXT `.COM;.EXE;.BAT;.CMD` unless
    the row says otherwise):
    | command | PATH | present | expected |
    |---|---|---|---|
    | `git` | `C:\Git\cmd;C:\Tools` | `C:\Git\cmd\git.exe` | `C:\Git\cmd\git.exe` |
    | `claude` | `C:\npm;C:\Users\u\.local\bin` | `C:\npm\claude.cmd`, `C:\Users\u\.local\bin\claude.exe` | `C:\npm\claude.cmd` |
    | `x` | `C:\T` | `C:\T\x.cmd`, `C:\T\x.exe` | `C:\T\x.exe` |
    | `py.exe` | `C:\Windows` | `C:\Windows\py.exe` | `C:\Windows\py.exe` (no `py.exe.EXE` stat asked) |
    | `X.CMD`, PATHEXT `.exe;.cmd` | `C:\T` | `C:\T\X.CMD` | `C:\T\X.CMD` |
    | `python` | `;"C:\Program Files\Python";;` | `C:\Program Files\Python\python.exe` | `C:\Program Files\Python\python.exe` |
    | `tool`, PATHEXT unset | `C:\T` | `C:\T\tool.bat` | `C:\T\tool.bat` |
    | `~\.local\bin\claude` | `C:\Other` | `C:\Users\u\.local\bin\claude.exe` | `C:\Users\u\.local\bin\claude.exe` |
    | `C:\T\tool.cmd` | `C:\Other` | `C:\T\tool.cmd` | `C:\T\tool.cmd` |
    | `python` | `C:\T` | folder `C:\T\python.exe` | `null` |
    | `python3` | `C:\T` | nothing | `null` |
  - `findProgram` POSIX table (os `macos`, homeDir `/Users/u`):
    | command | PATH | present | expected |
    |---|---|---|---|
    | `python3` | `/usr/local/bin:/usr/bin` | `/usr/bin/python3` | `/usr/bin/python3` |
    | `python3` | `/usr/local/bin:/usr/bin` | `/usr/local/bin/python3`, `/usr/bin/python3` | `/usr/local/bin/python3` |
    | `python3` | `:/usr/bin:` | `/usr/bin/python3` | `/usr/bin/python3` (no stat of a bare `python3`) |
    | `python3` | `/usr/bin` | `/usr/bin/python3.exe` | `null` |
    | `~/.local/bin/claude` | `/usr/bin` | `/Users/u/.local/bin/claude` | `/Users/u/.local/bin/claude` |
    | `/opt/x` | `/usr/bin` | nothing | `null` |
    | `claude` | `/usr/bin` | folder `/usr/bin/claude` | `null` |
  - `findCandidate`: candidates `py ['-3']`, `python []`, `python3 []` on Windows. With only `python.exe` present it
    returns `{ command: 'C:\T\python.exe', args: [] }`. With `py.exe` and `python.exe` present it returns
    `{ command: 'C:\T\py.exe', args: ['-3'] }`. With none present it returns `null`.
  - `envVariable` table: `({ Path: 'A' }, 'PATH', 'windows')` → `'A'`; `({ Path: 'A' }, 'PATH', 'macos')` →
    `undefined`; `({ PATH: 'B' }, 'PATH', 'linux')` → `'B'`.
  - `shimLaunch` table (comSpec `C:\Windows\system32\cmd.exe`). The values below are runtime text, not JS
    literals:
    | os | target | args | expected |
    |---|---|---|---|
    | macos | `/x/tool.cmd` | `a` | file `/x/tool.cmd`, args `a`, verbatim false |
    | windows | `C:\Git\cmd\git.exe` | `status` | file `C:\Git\cmd\git.exe`, args `status`, verbatim false |
    | windows | `C:\npm\claude.cmd` | `auth`, `status`, `--json` | file comSpec, args `/d`, `/s`, `/c`, `"C:\npm\claude.cmd ^"auth^" ^"status^" ^"--json^""`, verbatim true |
    | windows | `C:\Program Files\x\t.BAT` | `a b` | last arg `"C:\Program^ Files\x\t.BAT ^"a^ b^""` |
    | windows | `C:\t.cmd` | `50%&x` | last arg `"C:\t.cmd ^"50^%^&x^""` |
    | windows | `C:\t.cmd` | `say "hi"` | last arg `"C:\t.cmd ^"say^ \^"hi\^"^""` |
    | windows | `C:\t.cmd` | `a\"b` | last arg `"C:\t.cmd ^"a\\\^"b^""` |
    | windows | `C:\t.cmd` | `C:\dir\` | last arg `"C:\t.cmd ^"C:\dir\\^""` |
    | windows | `C:\t.cmd` | (empty string) | last arg `"C:\t.cmd ^"^""` |
  - `shimLaunch_LineBreakArgument_Throws`: args `['a\nb']` on a `.cmd` throws a message containing `line break`.
- `src/main/processes/node-processes.test.ts` (real children via `process.execPath -e`; the adapter is built with
  `createNodeFiles`'s `stat` or a `stat` double, `posixPaths`, `os` from `osPlatform(process.platform)`,
  `programSetting: () => ''`):
  - `spawn_WriteThenEnd_EchoesStdinAndExitsZero`: the child copies stdin to stdout. `write('hé\n')` then `end()`.
    The collected stdout is `hé\n`, and the exit is `{ code: 0, signal: null, error: null }`.
  - `spawn_Stderr_ReachesOnlyStderrListeners`: the child writes `err` to stderr. The stderr text is `err` and the
    stdout text is `''`.
  - `spawn_Kill_ExitsWithTheSignal`: a child that waits 60 s, then `kill('SIGKILL')`. The exit `signal` is
    `'SIGKILL'`, and the test ends in under 5000 ms.
  - `spawn_MissingProgram_ExitErrorNamesIt`: `spawn('wigley-no-such-program', [])`. The exit `error` starts
    `Could not run wigley-no-such-program`.
  - `spawn_ListenerAddedAfterExit_HearsTheExit`: after the exit, a new `onExit` listener hears the same exit.
  - `spawn_Env_IsTheWholeEnvironment`: `process.env.SPAWN_ENV_TEST_APP = '1'`; spawn with
    `env: { SPAWN_ENV_TEST_ONLY: '1' }`. The child sees `[true, false]` for `[ONLY, APP]`.
  - `spawn_Detached_RunsWithoutPipes`: a detached child writes `ran` to a temp file. `vi.waitFor` sees the file
    hold `ran`.
  - `resolveProgram` table: `programSetting` gives `'~/py'` with homeDir `/h`, which gives
    `{ command: '/h/py', args: [] }` (posixPaths). `programSetting` `''` with `programs.python` =
    `[{ command: 'wigley-no-such-python', args: [] }]` gives `null`. `programs.python` =
    `[{ command: process.execPath, args: ['-v'] }]` gives `{ command: process.execPath, args: ['-v'] }`.
- `src/main/processes/limited-processes.test.ts`: `spawn_PastTheLimit_StartsAtOnce`. With 2 runs held and
  `maxRunning` 2, `limited.spawn('d', [])` reaches the inner runner at once. `resolveProgram('python')` returns the
  inner answer. Both `setUp` literals gain the two members.
- `src/main/plugins/main-api.test.ts`: in the test "stops the plugin's running programs when its registrations are
  disposed", add a spawned handle through `api.services.processes.spawn`. After dispose, its
  `FakeProcessHandle.kills` is `['SIGKILL']`. A new row: a `spawn` after dispose exits with
  `{ code: null, signal: null, error: 'Stopped python3' }`, and `processes.spawns` stays empty.
- `src/shared/fake-processes.test.ts`: `resolveProgram_Unscripted_AnswersTheDefaults` gives
  `python` → `{ command: 'python3', args: [] }` and `claude` → `{ command: 'claude', args: [] }`;
  `scriptProgram('python', null)` → `null`.
- `src/plugins/docs/main/index-sources.test.ts`: add a row to the `session source` `it.each`, or a new
  `rebuild_PythonFromResolveProgram_LeadsWithItsArgs`. With `scriptProgram('python', { command: 'py', args: ['-3'] })`
  and `script('py', ['-3', ...BUILD], exited(0))`, the run's command is `py` and its args are `['-3', ...BUILD]`.
  `rebuild_NoPython_NotFoundMessageAndNoRun`: with `scriptProgram('python', null)`, the message is
  `Python was not found on PATH; set programs.python`, `processes.runs` is `[]`, and `logged` holds one line that
  contains `not run`. The session-source version (`load_NoPython_NoContextFallback`) runs no `context` and logs once.
- `src/plugins/unity-pool/main/pool-cli.test.ts`: the `it.each(['python3', 'py'])` row test becomes a table over
  scripted candidates `{ command: 'python3', args: [] }` and `{ command: 'py', args: ['-3'] }`. Its expected run is
  `command` = the candidate's command and `args` = `[...candidate.args, ...poolCommandArgs('/h/x', 'release', 'p', 4)]`.
  The `deps` helper drops `pythonCommand`. New `runPoolCommand_NoPython_NoPythonAndRunsNothing`: the result is
  `{ ok: false, error: 'no-python', message: 'Python was not found on PATH; set programs.python' }` and
  `processes.runs` is `[]`. `runPoolCommand_ScriptMissing_RunsNothing` keeps `no-cli` ahead of the Python lookup.
- `src/shared/platform.test.ts`: `platformFor_Programs_CandidateOrderPerOs` is a table over the three OSes. It
  asserts the full `programs` record of each OS, as in Decisions. This is a real claim, because the order decides
  which Python runs.
- `src/config/settings.test.ts`: delete `defaultSettingsFor_Programs_SetsClaudeCommand`: its parameter is gone, and
  the literal is a design value. `defaultSettingsFor_PluginsDisabled_HoldsDocsSessionTab` calls
  `defaultSettingsFor()`. `src/plugins/manifests.test.ts` lines 22 and 30 call `defaultSettingsFor()`.

Live checks: 07 — Final verification.

## Docs

- `AGENTS.md` source-tree `processes/` line: state that it runs a program to its end (as today) or spawns one as a
  handle (stdin, stdout and stderr text, exit, kill; `detached` with no pipes); that `resolveProgram` finds a
  program from the core `programs.python` setting or the Platform record's per-OS candidates; that on Windows a bare
  name is looked up over PATH × PATHEXT and a `.cmd`/`.bat` starts through `cmd.exe /d /s /c`
  (`src/shared/program-lookup.ts`); and that `limitRuns` caps runs, not spawns.
- `AGENTS.md` § An ambient service: "aborts its running processes" becomes aborts its running processes and kills
  its spawned ones (the detached ones excepted).
- `AGENTS.md` § A setting and the user config folder bullet: no edit. Neither names unity-pool's `pythonCommand`.
  Check with `grep -n pythonCommand AGENTS.md` (expected: no output).
- `docs/features/docs-browser/design.md` line 103 ("`python3 -X utf8` runs it"): the Python
  `resolveProgram('python')` gives runs it with `-X utf8`.
- `docs/features/unity-pool/design.md` line 114: the Python is the one `resolveProgram('python')` gives (the core
  `programs.python` setting, else `py -3`, `python`, `python3` on Windows and `python3`, `python` elsewhere), and a
  missing Python answers `no-python`.
- No edit to `docs/features/intent-alignment/master-plan.md` or `docs/features/followups.md`. Task 05 ticks the box
  and removes the entry for the whole item.

## Done when

Compiles (`npm run typecheck`); `npm run lint` passes (the layer check). The test gate runs the tests above. `grep -rn "pythonCommand"
src` prints nothing. `grep -n "spawn\b" src/main/processes/node-processes.ts` shows the only `node:child_process`
import among this task's files.

## Commit

One commit for the group: "Processes: spawn handles, resolveProgram with per-OS candidates and a core
programs.python setting, PATHEXT lookup and cmd.exe shims on Windows; docs and unity-pool resolve their Python".

## Proof
