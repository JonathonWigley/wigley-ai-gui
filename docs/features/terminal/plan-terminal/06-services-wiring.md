# 06 — Services wiring

Status: done
Type: Task
Rung: hard · adds `services.terminals` on both sides, the fake shell host and the fake emulator that 08, 09 and 10
consume, and a drive-run option through main, the drive CLI and its doc
Wave: 3 · Depends on: 02, 03, 05
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/plugin.ts`
- modify `src/contracts/platform.ts`
- modify `src/shared/platform.ts` · test `src/shared/platform.test.ts`
- modify `src/shared/program-lookup.ts`
- modify `src/shared/fake-processes.ts`
- modify `src/shared/plugin-service-views.ts`
- create `src/shared/fake-terminal-host.ts` · test `src/shared/fake-terminal-host.test.ts`
- create `src/shared/fake-terminal-emulator.ts`
- modify `src/shared/plugin-part-harness.test-support.ts`
- modify `src/main/run-mode.ts` · test `src/main/run-mode.test.ts`
- modify `src/main/main.ts`
- test `src/main/selftest-config.test.ts` (one literal gains a field)
- test `src/main/processes/node-processes.test.ts` (one literal gains a field)
- modify `src/renderer/renderer.ts`
- modify `src/renderer/plugins/page-api.ts` · test `src/renderer/plugins/page-api.test.ts`
- modify `scripts/drive-args.mts` · test `scripts/drive-args.test.mts`
- modify `scripts/drive-runs.mts` · test `scripts/drive-runs.test.mts`
- modify `scripts/drive.mts`
- modify `.agents/skills/drive/SKILL.md`

Consumes:
- `TerminalHost`, `TerminalSpawn`, `TerminalEvents`, `TerminalProcess`, `TerminalExit`, `TerminalInfo`,
  `TerminalAttach` and `TERMINAL_REPLAY_LIMIT` in `src/contracts/terminals.ts` ← 02
- `keepTail(text: string, limit: number): string` in `src/shared/keep-tail.ts` ← 02
- `SessionHostClient extends SessionHost { readonly terminals: TerminalHost }`, the return type of
  `createSessionHostClient` ← 03
- `TerminalEmulator`, `TerminalScreen`, `TerminalScreenOptions`, `TerminalPalette`, `TerminalSize` in
  `src/contracts/terminal-emulator.ts` ← 05
- `createXtermEmulator(): TerminalEmulator` in `src/renderer/xterm/xterm-emulator.ts` ← 05

Produces:
- `src/contracts/plugin.ts`: `MainServices.terminals: TerminalHost` (after `sessionHost`, now `:1224`) and
  `PageServices.terminals: TerminalEmulator` (after `visualFrames`, now `:779`), each with a comment:
  main `// The session's shells: the session host's terminal table, or a fake shell in the self-test and a drive run.`;
  page `// Makes terminal screens; stopping the plugin disposes every screen it made and has not disposed.`
- `src/contracts/platform.ts`: `PlatformPrograms.shell: readonly ProgramCandidate[]` after `unity`, so `ProgramName`
  gains `'shell'`.
- `src/shared/plugin-service-views.ts`:
  `export function trackedTerminals(terminals: TerminalEmulator, registrations: Registrations): TerminalEmulator`
- `src/shared/fake-terminal-host.ts`:
  ```ts
  export interface FakeTerminalRecord {
    request: TerminalSpawn | null;   // null for a shell added with addRunning
    id: string;
    startedAt: number;
    events: TerminalEvents | null;   // the subscriber now; null after its detach
    output: string;                  // the replay: all output, cut with keepTail at TERMINAL_REPLAY_LIMIT
    writes: string[];
    resizes: { cols: number; rows: number }[];
    kills: number;
    detaches: number;
    ending: boolean;                 // true from a kill until the close; list() then shows running: false
    closed: TerminalExit | null;
  }
  export interface FakeTerminalHost extends TerminalHost {
    readonly terminals: readonly FakeTerminalRecord[];
    addRunning(shell: { id: string; startedAt: number; output: string }): FakeTerminalRecord;
    output(id: string, chunk: string): void;
    close(id: string, exit: TerminalExit): void;
  }
  export function createFakeTerminalHost(clock: Clock): FakeTerminalHost;
  ```
- `src/shared/fake-terminal-emulator.ts`:
  ```ts
  export interface FakeTerminalScreenRecord {
    readonly options: TerminalScreenOptions;
    readonly screen: TerminalScreen;
    written: string[];
    palettes: { palette: TerminalPalette; fontFamily: string; fontSize: number }[];
    fits: number;
    focuses: number;
    resets: number;
    disposed: boolean;
    size: TerminalSize;
    type(data: string): void;        // runs the screen's onInput listeners with `data`
    resizeTo(size: TerminalSize): void; // sets `size`, then runs the onResize listeners
  }
  export interface FakeTerminalEmulator extends TerminalEmulator {
    readonly screens: readonly FakeTerminalScreenRecord[];
  }
  export function createFakeTerminalEmulator(): FakeTerminalEmulator;
  ```
- `src/main/run-mode.ts`: `export type DriveTerminalsName = 'fake' | 'live';` and the `drive` arm of
  `RunEnvironment` gains `terminals: DriveTerminalsName`.
- `scripts/drive-args.mts`: `export type DriveTerminals = 'fake' | 'live';`; the `start` arm of `DriveInvocation`
  gains `terminals: DriveTerminals`.
- `scripts/drive-runs.mts`: `StartOptions` gains `terminals: DriveTerminals`.

Decisions:
- **Which host each run gets.** A live run gets `sessionHost.terminals`. The self-test always gets
  `createFakeTerminalHost(clock)`. A drive run gets the fake by default, and `sessionHost.terminals` when started with
  `npm run drive -- start --terminals live`; `restart` keeps the choice, as it keeps `--system-stats`.
- **Where main picks it.** The choice rides in `ModeServices`, beside `systemStats`, so one switch per run mode holds
  it:
  - `ModeServicesContext` (`src/main/main.ts:293`) gains `liveTerminals: TerminalHost`.
  - `ModeServices.forWindow`'s `Pick<MainServices, …>` gains `'terminals'`.
  - `liveServices()` returns `terminals: context.liveTerminals`.
  - `offscreenRunServices` gains a fifth parameter `terminals: (live: TerminalHost) => TerminalHost` and returns
    `terminals: terminals(context.liveTerminals)`. Its comment gains "and shells run on the host `terminals` picks".
  - `modeServicesOf`: the `selfTest` arm passes `() => createFakeTerminalHost(clock)`; the `drive` arm passes
    `(live) => driveTerminals(environment.terminals, live)`.
  - New `function driveTerminals(name: DriveTerminalsName, live: TerminalHost): TerminalHost` after
    `driveSystemStats` (now `:428`): `name === 'fake' ? createFakeTerminalHost(clock) : live`, with the comment
    `// A drive run's shells, as WIGLEY_DRIVE_TERMINALS named them: the fake shell, or real shells in the session host.`
  - `createWindow` (now `:1110`) gains a last parameter `terminalHost: TerminalHost`; its `modeServices.forWindow`
    call (now `:1258`) passes `liveTerminals: terminalHost`. The `...windowServices` spread (now `:1353`) already carries
    every `forWindow` field into the `startMainParts` services object (now `:1290`), so `terminals` reaches
    `MainServices` with no other line.
  - The start (now `:1706`) calls `createWindow(inputs, catalog, store, userConfig, applied, sessionHost,
    sessionHost.terminals)`. `const sessionHost` (now `:1696`) holds 03's `SessionHostClient`, so `.terminals` is
    typed there; `createWindow`'s `sessionHost: SessionHost` parameter stays as it is.
- **Run mode.** `runEnvironmentOf` reads `env.WIGLEY_DRIVE_TERMINALS ?? 'fake'` after the system stats, and throws
  on any other value than `fake` or `live`, naming the variable, as the system-stats read does
  (`src/main/run-mode.ts:49-54`). Its comment names `WIGLEY_DRIVE_TERMINALS` beside the other two.
- **Drive CLI.** `--terminals` follows `--system-stats` everywhere `scripts/drive-args.mts` names it: the
  `TERMINALS` list, `VALUE_FLAGS`, `COMMAND_FLAGS.start`, the `start` line of `CLI_FORMS`, the `Flags.terminals`
  field (default `null`), `namesFlags`, a `terminalsOf` reader, and the parse comment.
  `setValueFlag`'s last `else` now sets `systemStats` for any value flag; it gains an explicit
  `else if (flag === '--system-stats')` branch and sets `terminals` in the last `else`.
  `scripts/drive-runs.mts` `startPlanOf` carries `terminals` with `systemStats` in both arms. `scripts/drive.mts`:
  `spawnApp` passes `WIGLEY_DRIVE_TERMINALS: options.terminals`; `keptStartOptions` and `restart` read and pass
  `terminals` with the other recorded options. A `start.json` written before this change has no `terminals`; the
  env value is then unset and the app reads `fake`.
- **Drive doc.** `.agents/skills/drive/SKILL.md` § Real Claude gains, after the `--system-stats live` paragraph
  (now `:184`): "`start --terminals live` runs each session's shell as a real shell in the run's session host in
  place of the fake shell, which echoes and answers `ran: <line>`; `restart` keeps it. Use it for a check on a real
  shell." The start-failure sentence (now `:92-94`) gains "a `WIGLEY_DRIVE_TERMINALS` other than `fake` or `live`".
- **Main services are not wrapped per plugin.** `src/main/plugins/main-api.ts` passes `terminals` through in its
  `...deps.services` spread (now `:129`), as it passes `sessionHost`. Terminal main (task 08) owns its shells and detaches them in its own stop.
- **Page services.** `renderer.ts` builds `terminals: createXtermEmulator()` in the `services: PageApiServices`
  object (now `:448`), after `visualFrames`. `page-api.ts` sets `terminals: trackedTerminals(deps.services.terminals,
  registrations)` in `services` beside `markdown` (now `:280`), and its `createPageApi` comment drops nothing and
  gains "a screen it makes through `services.terminals` is disposed at its stop".
- **`trackedTerminals`** follows `trackedEditor` (`src/shared/plugin-service-views.ts:165`): the live screens are one
  store entry (`registrations.track(createRegistrations())`); each created screen is tracked in it; the screen's own
  `dispose` is replaced by one that disposes its entry, which runs the original `dispose` once. A screen made after
  the store's `dispose` is disposed at once. Its comment follows `trackedEditor`'s.
- **Part harness.** Main services gain `terminals: notFaked<TerminalHost>('terminals')` before `...replaced` (beside
  `sessionHost`, now `src/shared/plugin-part-harness.test-support.ts:1088`). Page services gain, after
  `...replaced` (beside `markdown`, now `:1732`), `terminals: trackedTerminals(replaced.terminals ??
  notFaked<TerminalEmulator>('terminals'), context.registrations)`, so a test that passes
  `createFakeTerminalEmulator()` sees the part's stop dispose its screens.
- **Fake terminal host behaviour** (the scripted shell the self-test and a default drive run use). The fake matches
  the real host as the main process sees it: 02's terminal table through 03's client. So a test that passes on the
  fake passes on the real host. The fake never throws from a `TerminalHost` or `TerminalProcess` call, and it never
  calls an event during such a call.
  - A record is open while `closed === null`. A record that is open is the id's record. A closed record stays in
    `terminals`, so a test can read its counts, but no call finds it by its id.
  - `spawn(request, events)` when an open record holds `request.id` (running or ending, attached or detached): it adds
    no record and changes no record. It returns an ended handle, whose calls do nothing. In a microtask it calls
    `events.closed({ code: null, signal: null, error: 'a terminal with id <id> already exists' })`. This is 03's
    refusal of a live entry, and 02's refusal of a held id.
  - `spawn` of any other id adds a record with `request`, `startedAt: clock.now()`, `output: ''` and `events`, and
    returns a handle bound to that record. In a microtask it writes the prompt `$ ` (`queueMicrotask`). The prompt
    microtask writes nothing once the record has closed.
  - The fake writes a chunk in this order: `output = keepTail(output + chunk, TERMINAL_REPLAY_LIMIT)`, then
    `events?.data(chunk)`.
  - A handle is active until its own `detach()` and while its record is open. A call on a handle that is not
    active does nothing and changes no count, as 03's client sends nothing then. A handle whose events another
    `attach` replaced stays active: 03 sends its calls, and the host takes them.
  - `write(data)` on an active handle pushes `data` to `writes`. Then, when no close is pending (from an `exit` line
    or a kill), it reads `data` one character at a time, with the record's typed line (a private string, empty at
    spawn):
    `\r` adds `\r\n` to the reply; when the line is `exit` it writes the reply, then closes in a microtask with
    `{ code: 0, signal: null, error: null }` and reads no more; else it adds `ran: <line>\r\n$ ` and empties the line.
    `\x7f` drops the line's last character and adds `\b \b` when the line is not empty. On an empty line `\x7f`
    adds nothing. Any other character joins the line and the reply. It writes the reply as one chunk,
    synchronously, when the reply is not empty. The real shell echoes after the write returns, through the link;
    the fake echoes inside `write`, because no caller of the fake reads an echo inside its own `write`.
  - The `exit` close is a microtask, because the real host always delivers `closed` later, through the link. 08's
    tests end a shell through `close(id, exit)`, so none of them needs a close inside `write`. The record keeps
    `ending` false until that close, as the real table marks a shell ending only on a kill.
  - `resize(cols, rows)` on an active handle pushes `{ cols, rows }` to `resizes`.
  - `kill()` on an active handle adds 1 to `kills`. When `ending` is false, it sets `ending` true and closes in a
    microtask with `{ code: null, signal: 1, error: null }` (SIGHUP, the exit shape 02 and 04 give a kill). A second
    kill of an ending record only adds 1 to `kills`, as the real table does nothing for it.
  - `detach()` on an active handle adds 1 to `detaches`, ends this handle, and sets `events` to null when the
    record's `events` are still this handle's.
  - A close sets `closed` once and calls `events?.closed(exit)`; a later close does nothing. So a pending `exit` or
    kill close does nothing after `close(id, exit)`.
  - `attach(id, events)` resolves null when no open record holds the id. Otherwise it sets `events` and resolves
    `{ process, replay: output }`, `process` being a new handle bound to the record. An ending record attaches too,
    as 02's table attaches an ending shell.
  - `list()` resolves `{ id, startedAt, running: !ending }` for each open record, in add order (spawn and
    `addRunning` in call order). It reads the records when it is called, so a close that is still pending does
    not change its result.
  - The test controls stand for the host's side, so they act at once and they throw on a wrong id:
    `addRunning` adds an open record with `request: null`, `events: null`, the given `startedAt`, and the given
    `output` cut with `keepTail` at `TERMINAL_REPLAY_LIMIT`. It throws
    `a terminal with id <id> already exists` when an open record holds the id. `output(id, chunk)` writes a chunk as
    the shell would, at once. `close(id, exit)` closes the record at once, as the host's `termClosed` push arrives
    outside any call of the main process. `output` and `close` throw `no terminal <id>` when no open record holds the
    id, a closed record's id included, as the real host forgets an exited shell.
- **Fake terminal emulator behaviour.** `create` makes a `div` with class `terminal-screen` through
  `document.createElement` (a test installs the fake DOM, as `src/shared/page/fake-visual-frames.ts` needs), and a
  record with `size` `{ cols: 80, rows: 24 }`. `write` pushes to `written`; `fit`, `focus`, `reset` add 1 to their
  counts; `setPalette` pushes to `palettes`; `size()` returns `size`. `dispose` sets `disposed`, removes the element
  and drops the listeners, once.
- **Shell program list** (`src/shared/platform.ts`), per plan.md § Decisions:
  - POSIX: `POSIX_PROGRAMS` stops being one constant, since `shell` reads the environment. A function
    `posixPrograms(env: NodeJS.ProcessEnv): PlatformPrograms` returns the three lists it holds now plus `shell`;
    `createMacPlatform` and `createLinuxPlatform` pass `posixPrograms(inputs.env)`.
    `shell` is `[{ command: env.SHELL, args: ['-l'] }, { command: '/bin/zsh', args: ['-l'] }]` when `env.SHELL` is
    set, not empty and not `/bin/zsh`; else `[{ command: '/bin/zsh', args: ['-l'] }]`. `/bin/zsh` stays as the
    second candidate so a `$SHELL` path that no longer exists still finds a shell.
  - Windows: `WINDOWS_PROGRAMS.shell` is `[{ command: 'pwsh', args: ['-NoLogo'] }, { command: 'powershell.exe',
    args: ['-NoLogo'] }]`.
  - `resolveProgram` needs no change: main's `programSetting` (`src/main/main.ts:488`) answers `''` for every name
    but `python`, so `shell` is always looked up from the candidates.
- **Not-found message.** `NOT_FOUND_MESSAGES.shell` in `src/shared/program-lookup.ts:33`.
- **Fake processes.** `FakeProcesses`' default program map (`src/shared/fake-processes.ts:96`) gains
  `['shell', { command: '/bin/zsh', args: ['-l'] }]`, so a part test that resolves `shell` finds one without
  scripting it.

Pinned values:
- Run option: env `WIGLEY_DRIVE_TERMINALS`, values `fake` (default) and `live`; CLI flag `--terminals`.
- run-mode error: `` `WIGLEY_DRIVE_TERMINALS is ${JSON.stringify(terminals)}; set it to fake or live` ``.
- drive-args error: `` `--terminals is fake or live, not ${terminals}` ``.
- `CLI_FORMS` start line:
  `'start [--packaged] [--harness fake|claude] [--system-stats fake|live] [--terminals fake|live] [--user-config]'`.
- Not-found message: `'no shell was found: checked $SHELL and /bin/zsh, or pwsh and powershell.exe on Windows'`.
- Fake shell: prompt `$ `; reply `ran: <line>\r\n$ ` after `\r\n`; line `exit` closes with
  `{ code: 0, signal: null, error: null }`; kill closes with `{ code: null, signal: 1, error: null }`; both close in a
  microtask; replay cut `keepTail(…, TERMINAL_REPLAY_LIMIT)`; spawn refusal `a terminal with id <id> already exists`
  (a `closed` event, never a throw); test-control error `no terminal <id>`.
- Screen class `terminal-screen`; fake start size `{ cols: 80, rows: 24 }`.

GIVEN a live run WHEN a main plugin reads `services.terminals` THEN it is the session host client's TerminalHost
(no unit test reaches `modeServicesOf` or `createWindow` in `main.ts`; task 12 check 8 proves it live: a
`--terminals live` drive run gets `context.liveTerminals`, the value `liveServices()` returns too)
GIVEN the self-test WHEN a main plugin reads `services.terminals` THEN it is a fake terminal host (task 12 check 13
proves it live: the terminal plugin's self-test steps pass on the fake shell)
GIVEN `npm run drive -- start --terminals live` and then `restart` WHEN the app starts each time THEN its
environment holds `WIGLEY_DRIVE_TERMINALS=live`
GIVEN a fake shell that printed `$ ` WHEN `ls\r` is written THEN the events hear `ls` and then
`\r\nran: ls\r\n$ `
GIVEN a fake shell WHEN `exit\r` is written THEN, after the call returns, the events hear `closed` with
`{ code: 0, signal: null, error: null }` and `list()` no longer holds it
GIVEN a fake shell WHEN it is killed THEN `list()` shows it `running: false` until the events hear `closed` with
`{ code: null, signal: 1, error: null }` after the call returns
GIVEN a fake shell that runs WHEN its id is spawned again THEN nothing throws and the new events hear `closed` with
`a terminal with id <id> already exists` after the call returns
GIVEN a page plugin that made two screens and disposed one WHEN the plugin stops THEN the other screen is disposed,
and the first is not disposed again

Tests:
- `src/shared/fake-terminal-host.test.ts` (new), one test per behaviour. The clock is `{ now: () => now }` over a
  `let now` the test sets. "After a microtask" is `await Promise.resolve()`:
  - `spawn writes the prompt after the call returns` — no `data` during `spawn`; after a microtask the events heard
    `['$ ']`.
  - `writes no prompt to a shell closed before the prompt` — `spawn`, then `close('s1', …)` in the same step; after a
    microtask the events heard no `data`.
  - `answers each line it is typed`, `it.each` rows (writes → data chunks after the prompt):
    `['ls\r']` → `['ls\r\nran: ls\r\n$ ']`; `['l', 's', '\r']` → `['l', 's', '\r\nran: ls\r\n$ ']`;
    `['lx\x7fs\r']` → `['lx\b \bs\r\nran: ls\r\n$ ']`; `['\x7fls\r']` → `['ls\r\nran: ls\r\n$ ']` (`\x7f` on an
    empty line adds nothing); `['\r']` → `['\r\nran: \r\n$ ']`.
  - `closes with code 0 after an exit line` — after `exit\r`, `closed` heard nothing during the call, `list()` resolved
    in the same step still holds the id with `running: true`; after a microtask `closed` heard
    `[{ code: 0, signal: null, error: null }]` and `list()` resolves `[]`.
  - `kill closes with signal 1 after the call returns` — `kill()`: `kills` is 1, `closed` heard nothing during the
    call, and `list()` resolves `[{ id: 's1', startedAt, running: false }]`; a second `kill()` makes `kills` 2; after a
    microtask `closed` heard `[{ code: null, signal: 1, error: null }]` once, and `list()` resolves `[]`.
  - `it.each` `refuses a spawn on an id it holds: $name` — rows: a running shell; an ending shell (after `kill()`,
    before the microtask); a detached shell. The second `spawn('s1', …)` throws nothing; its events heard nothing
    during the call, and after a microtask `closed` heard
    `[{ code: null, signal: null, error: 'a terminal with id s1 already exists' }]`; `terminals` holds one record; a
    `write('x')` on the returned handle adds nothing to that record's `writes`.
  - `spawns again on the id of a closed shell` — after `exit\r` and a microtask, `spawn('s1', …)` adds a second record
    with `closed` null; `list()` holds `s1` once.
  - `it.each` `does nothing through a handle that is not active: $name` — rows: the record closed by `close('s1', …)`;
    the handle detached (`detach()`). Then `write('x')`, `resize(90, 20)`, `kill()` and `detach()` on that handle leave
    `writes`, `resizes`, `kills` and `detaches` as they were, and no `closed` comes after a microtask.
  - `records each resize` — `resize(90, 20)`, then `resize(100, 30)` → `resizes`
    `[{ cols: 90, rows: 20 }, { cols: 100, rows: 30 }]`.
  - `lists open shells in add order with their start time` — `now = 5`, spawn `a`; `addRunning({ id: 'b',
    startedAt: 3, output: '' })`; `now = 9`, spawn `c`; `close('c', …)` → `list()` resolves
    `[{ id: 'a', startedAt: 5, running: true }, { id: 'b', startedAt: 3, running: true }]`.
  - `attach replays the output and moves the events` — after spawn, prompt and `ls\r`, `attach` resolves `replay`
    `'$ ls\r\nran: ls\r\n$ '`; a later `output(id, 'x')` reaches the attach events only; a `write('pwd\r')` on the
    spawn's handle still adds to `writes`.
  - `it.each` `attach resolves null for an id with no open shell: $name` — rows: unknown id; a shell closed by
    `exit\r` and a microtask.
  - `keeps the last TERMINAL_REPLAY_LIMIT code units as the replay` — after `addRunning` with an `output` of
    `'a'.repeat(TERMINAL_REPLAY_LIMIT)`, `output(id, 'bc')` leaves `output` of length `TERMINAL_REPLAY_LIMIT` ending
    `'bc'` and starting `'a'`. The surrogate rule is `keepTail`'s, tested in `src/shared/keep-tail.test.ts` (02).
  - `detach stops the events and keeps the shell` — after `detach`, `output(id, 'x')` reaches no events;
    `detaches` is 1; `list()` still holds the id.
  - `it.each` `test controls throw on a wrong id: $name` — rows: `output('zz', 'x')` → `no terminal zz`;
    `close('zz', …)` → `no terminal zz`; `output('s1', 'x')` after `close('s1', …)` → `no terminal s1`;
    `close('s1', …)` twice → `no terminal s1` on the second; `addRunning` of a running `s1` →
    `a terminal with id s1 already exists`.
- `src/shared/platform.test.ts`: the `gives $os its program candidates in lookup order` rows gain `shell`:
  POSIX `[{ command: '/bin/zsh', args: ['-l'] }]` (the inputs set no `SHELL`); Windows
  `[{ command: 'pwsh', args: ['-NoLogo'] }, { command: 'powershell.exe', args: ['-NoLogo'] }]`. New test
  `gives $os a shell from SHELL, then /bin/zsh`, `it.each` over `macos` and `linux` × rows:
  `SHELL` `/opt/homebrew/bin/fish` → `[{ '/opt/homebrew/bin/fish', ['-l'] }, { '/bin/zsh', ['-l'] }]`;
  `SHELL` `/bin/zsh` → `[{ '/bin/zsh', ['-l'] }]`; `SHELL` `''` → `[{ '/bin/zsh', ['-l'] }]`.
- `src/main/run-mode.test.ts`: the two `toEqual` drive objects gain `terminals: 'fake'`; new test
  `a drive run over the terminals WIGLEY_DRIVE_TERMINALS names` (`live` → `toMatchObject({ mode: 'drive',
  terminals: 'live' })`); new test `throws on a WIGLEY_DRIVE_TERMINALS it does not know` (`real` → throws
  `/WIGLEY_DRIVE_TERMINALS.*real/`).
- `scripts/drive-args.test.mts`: the `start` invocation object (now `:37-45`) gains `terminals: 'fake'`; new test
  `GIVEN argv ['start', '--terminals', 'live'] WHEN parsed THEN it is start with live terminals`; the `namesFlags`
  rows (now `:60`) gain `{ argv: ['start', '--terminals', 'fake'], namesFlags: true }`; new test
  `GIVEN argv ['start', '--terminals', 'real'] WHEN parsed THEN it throws naming fake and live`.
- `scripts/drive-runs.test.mts`: `RECORDED` gains `terminals: 'live'`; `DEFAULTS` and `NAMED` gain
  `terminals: 'fake'`; the existing `startPlanOf` rows then check that `terminals` is kept and replaced with the
  others.
- `src/main/selftest-config.test.ts:624`: the `drive` literal gains `terminals: 'fake'` (type only).
- `src/main/processes/node-processes.test.ts:429`: the `programs` literal `{ python, claude: [], unity: [] }` gains
  `shell: []` (type only: `PlatformPrograms` now requires `shell`).
- `src/renderer/plugins/page-api.test.ts`: new test beside the editor one (now `:1344`),
  `disposes the screens the plugin made and has not disposed when its registrations are disposed` — with a counting
  emulator, two `create` calls and one `dispose` on the first, `registrations.dispose()` leaves the dispose counts
  `[1, 1]`; a `create` after that is disposed at once (`[1, 1, 1]`).

Done when: `npm run typecheck` passes; `node scripts/check-layers.mts` passes; the tests above exist.
Commit:    one commit: "Hand plugins services.terminals: the session host's shells in main (a fake shell in the
           self-test and by default in a drive run, real with drive --terminals live) and xterm screens in the page,
           with the platform shell program list"

## Proof

Commit 02eb873f · proof: diff read: MainServices.terminals, PageServices.terminals, PlatformPrograms.shell, trackedTerminals, fake terminal host and fake emulator present; typecheck, oxlint, layers, boundary, styles clean; oxfmt applied to two files (8d tooling commit) · concerns: AGENTS.md does not name services.terminals or the two fakes yet (task 10)
