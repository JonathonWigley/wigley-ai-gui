# 05 — Claude adapter and session host start through ProcessRunner

Status: in progress
Type: Task
Wave: 5 · Depends on: 04
Plan: [plan.md](plan.md)

Lane H marks: this task is written against `main` as of 2026-11-09. Each step that Lane H's three items move is marked
**[Lane H]**. At Wave 5 start, apply the step to the landed home that the mark names: the harness construction (out of
`main.ts` into the Claude harness plugin, which takes `api.services.processes`), `claude.command` (into that plugin's
manifest), and `permissionTool` (out of the harness deps).

Files:
- modify `src/main/claude-code/claude-code-harness.ts` · test `src/main/claude-code/claude-code-harness.test.ts`
- create `src/main/claude-code/pending-pipe.ts` · test `src/main/claude-code/pending-pipe.test.ts`
- modify `src/main/session-host/session-host-client.ts` · test `src/main/session-host/session-host-client.test.ts`
- modify `src/main/main.ts`
- modify `src/contracts/settings.ts` (the `claude` comment) · `src/config/settings.ts` (default and `settingInfo`)
- modify docs `AGENTS.md` · `docs/features/agent-chat/design.md` · `docs/features/intent-alignment/master-plan.md` ·
  `docs/features/followups.md`

Consumes, from 04, word for word:
- `spawn(command: string, args: readonly string[], options?: ProcessSpawnOptions): ProcessHandle` and
  `resolveProgram(name: ProgramName): Promise<ProgramCandidate | null>` on `ProcessRunner` (`src/contracts/processes.ts`)
- `ProcessHandle`, `ProcessExit`, `ProcessSpawnOptions` (`src/contracts/processes.ts`)
- `ProgramCandidate`, `ProgramName` (`src/contracts/platform.ts`)
- `programNotFoundMessage(name: ProgramName): string` (`src/shared/program-lookup.ts`), whose `'claude'` text is
  `claude was not found on PATH or in ~/.local/bin; set claude.command`
- `FakeProcesses.spawns: FakeSpawn[]`, `FakeProcessHandle` (`written`, `kills`, `isEnded`, `stdout`, `stderr`,
  `exit`) (`src/shared/fake-processes.ts`)
- `defaultSettingsFor(): Settings` with `claude.command` `'~/.local/bin/claude'` (`src/config/settings.ts`)
- `DetachedStartOptions.setEnv` and the optional `logPath` on `startDetached` (`src/contracts/processes.ts`; the
  method and `FakeProcesses.detachedStarts` / `failDetachedStarts` are in the tree since d49a34e6d)

## Produces

`src/main/claude-code/claude-code-harness.ts` — `ClaudeCodeHarnessDeps` after the change (the `ClaudeSpawn` type and
the `node:child_process` type import are gone):

```ts
export interface ClaudeCodeHarnessDeps {
  // The `claude` program and its leading args, read once per launch; null when none was found.
  command(): Promise<ProgramCandidate | null>;
  permissionTool: string;          // [Lane H] leaves the deps (Permission behind the harness)
  env: NodeJS.ProcessEnv;
  log: Log;
  host: SessionHost;
  processes: Pick<ProcessRunner, 'spawn'>;
  files: Files;
  homeDir: string;
  paths: Paths;
  clock: Clock;
  randomUuid: RandomUuid;
}
```

`src/main/claude-code/pending-pipe.ts`:

```ts
export interface PendingPipe {
  readonly pipe: HostedProcess;     // the session's pipe from the first line
  attach(real: HostedProcess): void;
  // Why the pipe stopped before `attach`: the signal of the first `kill`, 'detach', or null.
  stoppedBy(): 'SIGTERM' | 'SIGKILL' | 'detach' | null;
}
export function createPendingPipe(id: string): PendingPipe;
```

`src/main/session-host/session-host-client.ts`: `SessionHostClientDeps.spawn: SessionHostSpawn` and
`SessionHostClientDeps.env` become one `processes: Pick<ProcessRunner, 'startDetached'>` (round of 2026-11-16: the
host starts through the one detached start). The `SessionHostSpawn` type and the `import type { SpawnOptions } from
'node:child_process'` are gone. `definedEnv` stays in `claude-code-harness.ts`, its only user.

## Decisions

Command lookup (plan.md § Decisions › Default claude command: "empty means look up — `claude` on PATH at each
launch, then the installer's own spot. A set command still wins"):

- `claude.command`'s default becomes `''` in `defaultSettingsFor`. The `settingInfo['claude.command']` description
  becomes
  `The claude program sessions run: a program name or a path; ~ is the home folder. Empty, the app looks for claude on PATH, then in ~/.local/bin. Applies to the next session.`
  The `claude` comment in `src/contracts/settings.ts` says the same: empty looks up `claude`, and `~` alone or a
  leading `~/` (or `~\` on Windows) is the home folder. Drop "since an app started from the Dock has no shell
  `PATH`". The login-shell PATH swap (AGENTS.md § Dev quirks) made that untrue.
- No `settings.json` edit: the user's file sets no `claude.command` (checked at plan time with
  `grep -n '"claude"' ~/.config/wigley-ai-gui/settings.json`, which prints nothing). Re-run that grep at Wave 5. When
  it prints a line, keep the user's value and name it in the report.
- `main.ts`'s `claudeHarness(...)` passes:
  `command: async () => { const setting = store.current().settings.claude.command; return setting === '' ? processes.resolveProgram('claude') : { command: paths.expandTilde(setting, homeDir), args: [] }; }`
  and `processes` (the composition root's own runner, not a plugin view). It drops `spawn`. `main.ts` drops
  `import { spawn } from 'node:child_process'`.
  **[Lane H]** AgentHarnessRegistry moves this construction into the Claude harness plugin's main start. There,
  `processes` is `api.services.processes`, and the setting is the plugin's own `command` setting through
  `api.settings()`. Harness settings with the harness moves `claude.command` into that manifest, so the default `''`
  and the description above land in the manifest's `settings` and `settingInfo`. `programNotFoundMessage('claude')`
  then names that setting's dotted path (task 04's mark).
- A set command still goes through the adapter's Windows PATHEXT and shim handling for the one-shots, because they
  run through `processes.spawn`. Session processes run in the session host process, whose own adapters stay as they
  are (plan.md § Out of scope). So a `.cmd`/`.bat` `claude.command` the user sets reaches the host's spawn
  unchanged. The lookup never yields one: task 04's Windows candidates name `claude.exe`. This is a known limit,
  written into the `claudeHarness` comment in one line.

When the lookup finds nothing (the user-visible error's facts: it names `claude`, PATH, `~/.local/bin` and the
setting to set):

- Session launch: the session ends with `error` = `programNotFoundMessage('claude')`, which is
  `claude was not found on PATH or in ~/.local/bin; set claude.command`. It reaches chat the way a failed spawn does
  today, through `withSpawnHint`'s `closed` with `{ code: null, signal: null, error }`. `host.spawn` is not called.
- One-shots (`accountStatus`, `planUsage`, `logOut`): the promise rejects with that text, and nothing spawns.
- `logIn`: `ended({ status: null, error: <that text> })`, once.
- A set command that is missing keeps today's texts. The session gets `spawnError`'s
  `claude was not found at <command>, or the project folder <cwd> does not exist; set claude.command`. The
  one-shots get `cliSpawnError`'s `claude was not found at <command>; set claude.command`. `cliSpawnError` takes the
  exit's `error` string and tests it with `includes('ENOENT')`, as `spawnError` does. The adapter's text is
  `Could not run <command>: spawn <command> ENOENT`.
- A `command()` that rejects is treated as not found, with `errorText(error)` as the message.

Session launch with an async command (agent's decision): `AgentHarness.start` is sync and returns the
`AgentProcess` at once, and `createClaudeSession` takes the pipe at once. So `startClaudeProcess` builds
`createPendingPipe(request.processId)` and hands `pending.pipe` to `createClaudeSession`. Then it runs
`void deps.command().then(…)`:
- When `pending.stoppedBy()` is not null, it spawns nothing. For a kill it calls `forwarder.events.closed({ code:
  null, signal: <that signal>, error: null })`. For `detach` it calls nothing.
- On null, it calls `forwarder.events.closed({ code: null, signal: null, error: programNotFoundMessage('claude') })`.
- Else `pending.attach(deps.host.spawn({ …today's request, command: program.command, args: [...program.args,
  ...launch.args] }, withSpawnHint(forwarder.events, program.command, launch.cwd)))`.

`createPendingPipe(id)` rules:
- Before `attach`: `pid` is `null`. `write` and `endInput` calls are queued in call order. The first `kill(signal)`
  or `detach()` is kept as `stoppedBy`, and later calls do nothing.
- `attach(real)` replays the queue on `real` in order. After that, every member delegates to `real`, and `pid`
  reads `real.pid`.
- `id` is the given id.

One-shots (`spawnCli`, `runCli`, `startLogIn`):
- `spawnCli` becomes async. It awaits `deps.command()`. On null it throws `programNotFoundMessage('claude')`. Else
  it returns `{ command: program.command, handle: deps.processes.spawn(program.command, [...program.args, ...args],
  { cwd: deps.homeDir, env: definedEnv(claudeEnv(deps.env, profileDir, deps.homeDir, deps.paths)) }) }`. The
  `stdin.on('error', log)` line goes, since the adapter swallows stdin errors (task 04).
- `runCli`: collects `onStdout` and `onStderr` text, calls `handle.end()`, and keeps its timeout. On timeout it calls
  `handle.kill('SIGKILL')` and rejects with `<commandLabel(args)> gave no answer in <s> s`, as today. `onExit` with
  `error` rejects with `cliSpawnError(error, command)`. Else it resolves `{ code: exit.code, stdout, stderr:
  stderr.trim() }`.
- `startLogIn` stays sync. It starts the status read and the spawn inside one async step. `sendCode(code)` writes
  `${code}\n` once a handle exists. Before that it does nothing, because the user pastes a code only after the
  link, which needs the running process. `cancel()` ends with `Sign-in cancelled` at once. When the handle exists,
  `cancel()` also calls `handle.kill()` (`SIGTERM`, as today). When the command resolves after a cancel, nothing
  spawns. `onExit` with `error` ends with `cliSpawnError(error, command)`. `onExit` without `error` runs today's
  `close` logic with `exit.code` and `exit.signal`.

Session host start (plan.md § Decisions › Session host start too, as the round of 2026-11-16 revised it):
- `startHost` calls `deps.processes.startDetached(deps.execPath, [deps.hostScript, deps.folder, deps.channel], {
  setEnv: { ELECTRON_RUN_AS_NODE: '1' } })`, with no `logPath`, so the host's output is dropped as today. The app's
  environment is what `deps.env` passed (`process.env`, `main.ts`), so `setEnv` over it starts the host in the same
  environment. Process group, `stdio: 'ignore'`, `windowsHide` and `unref` are the adapter's work (task 04).
- A resolve does nothing, since a host that later exits is found by the next connect. A rejection with `error`:
  when `started.ended`, it logs `host spawn error: <errorText(error)>`; otherwise it calls `failAttempt(started,
  errorText(error))`. The reason now carries the adapter's prefix (`Could not run <execPath>: …`). The `try`/`catch`
  goes, since a throw inside the adapter becomes the rejection.
- `main.ts` passes `processes` (the composition root's runner) in place of `spawn` and `env` to
  `createSessionHostClient`.

## Behaviour

- GIVEN `claude.command` is `''` and `claude` is on PATH WHEN a session starts THEN the host spawns the found path
  with the candidate's args before the launch args.
- GIVEN `claude.command` is `''` and no `claude` is on PATH or in `~/.local/bin` WHEN a session starts THEN it ends
  with `claude was not found on PATH or in ~/.local/bin; set claude.command`, and the host spawns nothing.
- GIVEN `claude.command` is `~/bin/claude` WHEN `accountStatus` runs THEN `processes.spawn` gets `<home>/bin/claude`.
- GIVEN no session host answers WHEN the client connects THEN `processes.startDetached` gets the exec path with
  `setEnv: { ELECTRON_RUN_AS_NODE: '1' }` and no `logPath`.

## Tests

- `src/main/claude-code/pending-pipe.test.ts` (new):
  - `attach_QueuedWritesAndEndInput_ReplayInOrder`: `write('a')`, `endInput()`, `write('b')` before attach. The real
    pipe's calls are `['write a', 'endInput', 'write b']`.
  - `pid_BeforeAttach_IsNull_AfterAttach_IsReals`: the pid is `null`, then `42`.
  - `stoppedBy_FirstStopWins`: `kill('SIGTERM')`, `kill('SIGKILL')` and `detach()` give `'SIGTERM'`. With no call,
    the value is `null`.
- `src/main/claude-code/claude-code-harness.test.ts`:
  - With a deferred `command()` promise: `start_KillBeforeCommandResolves_SpawnsNothing` (`processes.spawns` is
    `[]`, `ended` fires with the signal); `start_DetachBeforeCommandResolves_SpawnsNothing` (no spawn, no event);
    `start_WriteBeforeCommandResolves_ReplaysOnTheHostedProcess` (the writes reach the started process in order).
  - Every `createClaudeCodeHarness` deps literal (`started`, the two in `past sessions`, `authHarness`,
    `hostHarness`) swaps `spawn` for `processes`: a `FakeProcesses`, or `{ spawn: () => { throw … } }` where
    `hostHarness` throws today. It swaps `command: () => '/bin/claude'` for
    `command: async () => ({ command: '/bin/claude', args: [] })`.
  - `authChild` and its `ChildProcessWithoutNullStreams` cast go. The accounts tests drive
    `processes.spawns[i].handle`: `stdout(text)`, `stderr(text)`, and `exit({ code, signal: null, error: null })`.
    Stdin lines come from `handle.written`, and signals from `handle.kills`. Each test awaits `settle()` before it
    reads `spawns[i]`, since the spawn now follows an `await`. The spawned-options assertions read `FakeSpawn.cwd`
    and `.env`: `cwd: '/Users/u'` and `env: { HOME: '/Users/u', CLAUDE_CONFIG_DIR: '/Users/u/.claude-personal' }`.
  - `planUsage_Fails_$name` table: the `SpawnNotFound` row exits with
    `{ code: null, signal: null, error: 'Could not run /bin/claude: spawn /bin/claude ENOENT' }`, with reason
    `claude was not found at /bin/claude; set claude.command`. New row `CommandNotFound`: `command: async () =>
    null`, reason `claude was not found on PATH or in ~/.local/bin; set claude.command`, and `processes.spawns` is
    `[]`. `accountStatus_SpawnFails_RejectsWithCommandHint` gets the same exit change.
  - `logIn_CommandNotFound_EndsWithNotFoundText`: `ended` is heard once with
    `{ status: null, error: 'claude was not found on PATH or in ~/.local/bin; set claude.command' }`.
  - `logIn_CancelBeforeSpawn_SpawnsNothing`: `cancel()` in the same tick as `logIn`. `ended` has
    `error: 'Sign-in cancelled'`. After `settle()`, `processes.spawns` holds only the status read, or nothing,
    because the status read runs through `runCli`: the assertion is that no spawn has args `['auth', 'login']`.
  - Session start: `start_CommandNotFound_EndsWithNotFoundText`. With `command: async () => null`, the `ended`
    event's `error` is `claude was not found on PATH or in ~/.local/bin; set claude.command`, and `childHost`'s
    `spawn` is never called. `start_CandidateArgs_LeadTheLaunchArgs`: with
    `command: async () => ({ command: '/bin/claude', args: ['--x'] })`, the hosted request's `args[0]` is `'--x'`,
    followed by the launch args.
  - The session tests that emit on the fake child in the tick after `started()` (`spawnNotFound_EndsWithHint` at
    `:1467` today; find the rest by running the file) await `settle()` first, because `host.spawn` now runs after
    `deps.command()` resolves.
- `src/main/session-host/session-host-client.test.ts`: `clientRig` swaps its `SessionHostSpawn` for a
  `FakeProcesses` wrapped as `{ startDetached: (c, a, o) => { const started = fake.startDetached(c, a, o);
  spawned(); return started; } }`, so the `spawned` hook (now `() => void`) still starts the scripted host. The rig
  drops `env`, `unrefs` and the `SpawnCall` type; `spawnCalls` becomes `fake.detachedStarts`.
  - `create_SpawnEmitsError_FailsAtOnce`: `fake.failDetachedStarts(new Error('Could not run /app/binary: spawn x
    ENOENT'))` before `create`. The error heard is `the session host did not start: Could not run /app/binary: spawn
    x ENOENT` (break: a rejected start not reaching `failAttempt`).
  - `create_NoHost_SpawnsTheHostDetachedThenConnects`: `fake.detachedStarts` is `[{ command: '/app/binary', args:
    ['/build/session-host.js', rig.folder, channel], options: { setEnv: { ELECTRON_RUN_AS_NODE: '1' } } }]`; the
    `unrefs` assertion goes.
  - The other tests that read `rig.spawnCalls` (lengths and `[]`) keep their assertions over `fake.detachedStarts`.

Live checks: 07 — Final verification.

## Docs

- `AGENTS.md` source-tree `claude-code/` line: keep "the only place the app spawns `claude`". State that its
  one-shots (`claude auth`, `claude -p /usage`) start through `ProcessRunner.spawn`, and that an empty
  `claude.command` looks `claude` up on PATH, then in `~/.local/bin`.
- `AGENTS.md` source-tree `session-host/` line: "starts the host when none answers" gains: through
  `ProcessRunner.startDetached`.
- `AGENTS.md`, every other line naming how the app starts `claude` or the host: run
  `grep -n "spawn\|claude.command\|.local/bin" AGENTS.md` and fix each untrue line. At plan time, lines 63, 330,
  873 and 1213 hold `spawn`, and none of them is untrue after this task.
- `docs/features/agent-chat/design.md` line 111: "an app started from the Dock has no shell `PATH` or
  `CLAUDE_CONFIG_DIR`" is untrue for `PATH`. State that an empty `claude.command` looks `claude` up on the
  login-shell PATH, then in `~/.local/bin`, and keep the `CLAUDE_CONFIG_DIR` reason for the profiles setting.
- `docs/features/intent-alignment/master-plan.md` § Lane P: tick `- [ ] Per-platform program lookup and spawning
  [ready]` to `- [x]`.
- `docs/features/followups.md` § Platform and packaging: remove the `**Per-platform program lookup and
  spawning**` entry (5 lines, starting at `:353` on 2026-11-16). In its place, add one *needs a feature plan* entry,
  **Session host starts a claude shim on Windows**: the session host process's own spawn starts `claude` unwrapped,
  so a `claude.command` set to an npm `claude.cmd` cannot start a session, and the PATH lookup looks only for
  `claude.exe`; the fix puts the session host's adapters (`src/session-host/`) behind the same shim handling, then
  lets the Windows lookup find shims. Killing a shim's `cmd.exe` also leaves its child running, as `run` does today.

## Done when

Compiles (`npm run typecheck`); `npm run lint` passes. The test gate runs the tests above.
`grep -rn --exclude='*.test.ts' "node:child_process" src/main/main.ts src/main/claude-code src/main/session-host`
prints nothing (`claude-code-harness.test.ts` keeps its type import for `fakeChild()`).
`grep -rn "ClaudeSpawn\|SessionHostSpawn" src` prints nothing.

## Commit

One commit for the group: "Claude adapter and session host start through ProcessRunner.spawn; an empty
claude.command looks claude up on PATH, then ~/.local/bin; close Lane P's program lookup item".

## Proof
