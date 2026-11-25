# 08 — Terminal plugin main

Status: not started
Type: Task
Rung: deep · crosses the session host's lifecycle: shells adopted after an app restart, killed on a row's close, detached on a part stop
Wave: 4 · Depends on: 06
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/terminal/manifest.ts`
- create `src/plugins/terminal/contract.ts`
- create `src/plugins/terminal/exit-reason.ts` · test `src/plugins/terminal/exit-reason.test.ts`
- create `src/plugins/terminal/layouts/layout.d.ts`
- create `src/plugins/terminal/main/start.ts` · test `src/plugins/terminal/main/start.test.ts`
- create `src/plugins/terminal/main/shells.ts`
- create `src/plugins/terminal/main/plain-text.ts` · test `src/plugins/terminal/main/plain-text.test.ts`
- create `src/plugins/terminal/main/session-note.ts`
- modify `src/plugins/manifests.ts`
- modify `src/plugins/main.ts`

Consumes:
- `MainServices.terminals: TerminalHost` ← 06
- `PlatformPrograms.shell` (so `ProgramName` holds `'shell'`) ← 06; read through the existing
  `ProcessRunner.resolveProgram(name)` (`src/contracts/processes.ts:91`)
- `TerminalSpawn`, `TerminalEvents`, `TerminalExit`, `TerminalProcess`, `TerminalInfo`, `TerminalAttach`,
  `TerminalHost` and `TERMINAL_REPLAY_LIMIT` in `src/contracts/terminals.ts` ← 02
- `keepTail(text: string, limit: number): string` in `src/shared/keep-tail.ts` ← 02
- `createFakeTerminalHost(clock)` and `FakeTerminalRecord` in `src/shared/fake-terminal-host.ts` ← 06 (tests only)
- In the tree: `chatMainKey` and `ChatMainExports.addInstructions` / `restored` (`src/plugins/chat/contract.ts:812`,
  `:774`); `sessionsMainKey`, `sessionsRowsSlot` (`src/plugins/sessions/contract.ts:760`), `SessionsMainEvents`
  `closed` and `ended` (`:436-440`); `QualifiedEvents`, `MainChannel`, `ChannelShape` (`src/contracts/plugin.ts`);
  `MainServices.randomUuid` (`src/contracts/plugin.ts:1210`, type `RandomUuid` in `src/contracts/ambient.ts:11`);
  `KeyedSlotKey`, `KeyedSlotWriter` (`src/contracts/state.ts:33`, `:62`); `Timers` (`src/contracts/ambient.ts:16`);
  `definePlugin` (`src/shared/define-plugin.ts`).

Produces:
- `src/plugins/terminal/contract.ts`, word for word from plan.md § File Structure: `TerminalOpened`,
  `TerminalChannel`, and
  `export const terminalOutputSlot: KeyedSlotKey<string, 'main', 'terminal'> = { id: 'terminal.output', process: 'main', kind: 'keyed' };`
  `TerminalOpened` and each of the three messages carry `shell: string`, the id of the shell they belong to (see
  Decisions › Shell ids).
- `src/plugins/terminal/manifest.ts`: `export const terminalManifest = definePlugin({ … })` with the values under
  Pinned values. Beyond plan.md it adds the page command `restart` (arg `'string'`) and the `layout` setting (see
  Decisions › Additions to plan.md).
- `src/plugins/terminal/exit-reason.ts`: `export function exitReason(exit: TerminalExit): string`
- `src/plugins/terminal/layouts/layout.d.ts`: the terminal layout contract task 09 draws with:
  ```ts
  import type { BaseKit } from '../../../shared/page/layout-host/kit';
  export interface DrawerHeaderInput {
    sessionId: string;
    folder: string;                          // the shell's folder as `paths.tilde` shows it
    state: 'starting' | 'running' | 'exited';
    exitReason: string | null;               // `exitReason(exit)` while exited, else null
  }
  export interface TerminalPart { element: HTMLElement }
  export interface Layout {
    drawerHeader?(parent: HTMLElement, input: DrawerHeaderInput, kit: BaseKit): TerminalPart;
  }
  export interface CompleteLayout extends Required<Layout> {}
  ```
  Its file comment follows `src/plugins/agent-skills/layouts/layout.d.ts:1-9`: the app draws one `drawerHeader` above
  each session's terminal screen; the app keeps the screen, the keys, the focus and the drawer's frame and height.
- `src/plugins/terminal/main/plain-text.ts`:
  ```ts
  export interface PlainText { write(chunk: string): void; text(): string; reset(): void }
  export function createPlainText(lineLimit: number): PlainText;
  ```
- `src/plugins/terminal/main/shells.ts`:
  ```ts
  export interface ShellsDeps {
    terminals: TerminalHost;
    resolveShell(): Promise<ProgramCandidate | null>;
    folderOf(sessionId: string): string;     // the row's projectDir, else services.homeDir
    labelOf(sessionId: string): string;      // the row's label, else the session id
    hasRow(sessionId: string): boolean;
    newShellId(): string;                    // services.randomUuid
    send: MainChannel<TerminalChannel>['send'];
    output: KeyedSlotWriter<string>;
    timers: Timers;
    log(message: string): void;
  }
  export interface Shells {
    open(sessionId: string, cols: number, rows: number): Promise<TerminalOpened>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    restart(sessionId: string, cols: number, rows: number): Promise<TerminalOpened>;
    type(sessionId: string, text: string): Promise<void>;
    kill(sessionId: string): void;
    adopt(): Promise<void>;
    detachAll(): void;
    killAll(): void;
  }
  export function createShells(deps: ShellsDeps): Shells;
  ```
  Task 10 consumes `Shells.type` and `Shells.kill` for the demo step's main half.
- `src/plugins/terminal/main/session-note.ts`: `export const TERMINAL_SESSION_NOTE: string` (text under Pinned values).
- `src/plugins/terminal/main/start.ts`: `export const terminalMainPart: MainPart<typeof terminalManifest>`.
- `src/plugins/manifests.ts`: `terminalManifest` in `builtInManifests`, right after `markdownBlocksManifest`, so it
  sits before `schedulingManifest` (the list's comment at `:98-99` puts every `addInstructions` caller before it).
- `src/plugins/main.ts`: `terminalMainPart` in `mainParts`, right after `visualMainPart`.

Decisions:
- **Part wiring (`start.ts`).** `type TerminalApi = MainApi<typeof terminalManifest, TerminalChannel,
  Record<never, never>, QualifiedEvents<'sessions', SessionsMainEvents>>`. `start` does, in order:
  1. `api.layouts.register({ layoutTypes })`, `layoutTypes` imported from `../layouts/layout.d.ts?raw`, as
     `src/plugins/agent-skills/main/start.ts:8,20` does.
  2. `api.dependency(chatMainKey).addInstructions(TERMINAL_SESSION_NOTE)`, as `src/plugins/visual/main/start.ts:18`.
  3. `rows = api.state.read(sessionsRowsSlot)`; `output = api.state.publish(terminalOutputSlot)`.
  4. `shells = createShells({ … })` with `resolveShell: () => services.processes.resolveProgram('shell')`,
     `folderOf: (id) => rows.get(id)?.projectDir ?? services.homeDir`, `labelOf: (id) => rows.get(id)?.label ?? id`,
     `hasRow: (id) => rows.get(id) !== undefined`, `newShellId: services.randomUuid`,
     `send: (m, d) => api.channel.send(m, d)`, `log: services.log`.
  5. `api.channel.handle` for `open`, `write`, `resize`, `restart`, each calling the same-named `Shells` method.
  6. `api.events.on('sessions.closed', ({ sessionId }) => shells.kill(sessionId))`. `sessions.ended` gets no
     listener: the agent's process ended, the shell stays.
  7. Returns `commands.type`, `ready` and `dispose` (below).
- **`terminal.type` handler.** `({ arg, callerSessionId })`:
  1. `callerSessionId === undefined` → throw `new Error('terminal.type needs a calling session')`.
  2. `arg` holds `\n` or `\r` → throw `new Error('terminal.type takes one line: the text holds a line break')`.
  3. `await shells.type(callerSessionId, arg)`.
  The caller check runs first. The command is not risky. It acts on the caller, so it declares no `targets`, as
  `builds.offer` (`src/plugins/builds/manifest.ts:37-47`, handler `src/plugins/builds/main/start.ts:803-811`).
- **How an agent knows its session id.** `callerSessionId` is the app's row id: agent-commands contributes its tools
  per `AgentSession`, whose `id` is "the app's own id for the session" (`src/plugins/sessions/contract.ts:192-196`),
  and passes it as `callerSessionId` (`src/plugins/agent-commands/main/tools.ts:269-270`). The agent's process gets
  the same id as `WIGLEY_SESSION_ROW` (`src/shared/session-env.ts:22`; set at
  `src/plugins/claude-code/main/claude-launch.ts:166` from `rowId: session.sessionId`,
  `src/plugins/chat/main/chat-sessions.ts:978`). The session note tells the agent to read `terminal.output` with that
  value as `key`.
- **`ready()`.** `void chat.restored().then(() => (isStopped ? undefined : shells.adopt()))`. Rows the restore reopens
  exist only after `chat.restored()` settles, as `src/plugins/builds/main/start.ts:822` waits for it.
- **`dispose(stop)`.** Sets `isStopped` first. `restart` and `quit` → `shells.detachAll()`: the shells keep running in
  the host, and the next start adopts them. `end` (a switch-off or removal) → `shells.killAll()`.
- **The shell table (`shells.ts`).** One entry per session id: `{ shell, process, buffer, seq, folder, exit, plain }`.
  `process` is null once the shell exited. Each entry subscribes with its own `TerminalEvents` object. An event is
  current only when its events object belongs to the id's entry now. The table drops every other event. So the late
  `data` and `closed` of a killed, detached or replaced shell change nothing, whenever the host sends them.
- **Shell ids.** Each entry gets `shell = newShellId()` when it is made, by a spawn or by an adoption. `TerminalOpened`
  and every `data`, `exited` and `typed` message carry the entry's `shell`. A `seq` counts within one shell only. So
  the page can tell a new shell from an old one: after a restart, a replace by `type`, or a restart of this main part
  alone (the page part does not restart with it, and adoption starts `seq` again at 0 or 1).
- **Adoption gate.** `createShells` holds `adopted: Promise<void>`, resolved when `adopt()` settles. A failed adopt
  (`list()` or an `attach` rejects) logs `adoption failed: <error text>` and resolves too. `open`, `restart` and
  `type` await `adopted` first. So a page `open` or an agent `type` before adoption never spawns a second shell on an
  id the host runs. The host refuses such a spawn without a throw: the spawn's `closed` comes later with
  `error: 'a terminal with id <id> already exists'` (03 and the fake host, 06).
- **`adopt()`.** `terminals.list()`, then for each `TerminalInfo`, whatever its `running`:
  - `hasRow(id)` → `attach(id, eventsOf(id))`; on a non-null result, an entry with a new `shell`,
    `buffer = keepTail(replay, TERMINAL_REPLAY_LIMIT)`, `seq = replay === '' ? 0 : 1`, `folder = folderOf(id)`,
    `exit = null`, the replay written to its `plain`, and an output write scheduled. A null result adopts nothing. A
    shell that is ending (`running` false) is adopted too: its `closed` then reaches the entry, and the entry holds
    the id until the host lets the id go, so no spawn meets the host's refusal.
  - no row → `attach(id, ignored)`, then `kill()` on the result, and `output.delete(id)`.
  - Then logs `adopted <n> shells, ended <m>` when the list held any shell (`n` adopted, `m` killed).
- **One start per session.** `createShells` holds `starts: Map<string, Start>`, the in-flight start of each id
  (`Start` holds its promise and a `cancelled` flag). `spawnFor(id, cols, rows)` puts its `Start` in `starts` before
  it awaits `resolveShell()`, and removes it when it settles. A call of `open`, `restart` or `type` that finds its id
  in `starts` awaits that promise, then reads the table again. It rethrows the start's error. Each call reads
  `starts` and the table, and calls `spawnFor`, in one synchronous step after its last `await`. So two calls in the
  resolve window (a page `open` and an agent `type`, or two `restart`s) make one shell.
- **Cancelled start.** `kill(id)` sets `cancelled` on the id's `Start`. `killAll()` and `detachAll()` set it on every
  `Start`. When `resolveShell()` settles for a cancelled `Start`, `spawnFor` spawns nothing and throws
  `new Error('terminal: the shell start for <id> was cancelled')`. So a row closed, or a part stopped, during the
  resolve gets no shell.
- **Spawn.** `spawnFor` then checks the program: null → throw `new Error('terminal found no shell program to start')`.
  Then `terminals.spawn({ id, command: program.command, args: program.args, cwd: folderOf(id), cols, rows },
  eventsOf(id))`, a fresh entry (a new `shell`, `buffer ''`, `seq 0`, `exit null`, a fresh `plain`) and the log
  `shell started for <label> in <folder>`. A `cols` or `rows` below 1 (a hidden drawer measures 0) spawns at 80×24.
- **`open(id, cols, rows)`.** No entry → spawn at `cols`×`rows`. A running entry → `resize(id, cols, rows)` (below).
  An exited entry → nothing: the page shows its exit and restarts on Enter. Returns
  `{ shell, buffer, seq, folder, exit }`.
- **`write(id, data)`** writes to a running entry's process; else does nothing.
  **`resize(id, cols, rows)`** resizes a running entry's process when both are at least 1; else does nothing.
- **`restart(id, cols, rows)`.** Replaces an exited shell only. A missing or exited entry → spawn at `cols`×`rows`
  (an exited entry has no process to kill). A running entry → as `open`: a resize, and its `TerminalOpened`. So
  restart never kills a shell and then spawns on its id: the real host holds a killed shell's id until the pty
  exits, and refuses a spawn on it until then.
- **`type(id, text)`.** A missing or exited entry → spawn at 80×24 (an exited entry is replaced as `restart` does).
  Then `process.write(text)` with no `\r`, then `send('typed', { sessionId: id, shell, text })`.
- **Data.** For each current chunk: `seq += 1`; `buffer = keepTail(buffer + chunk, TERMINAL_REPLAY_LIMIT)`;
  `send('data', { sessionId, shell, chunk, seq })`; `plain.write(chunk)`; schedule the output write.
- **Closed.** For the current process: `exit` set, `process` null, `send('exited', { sessionId, shell, exit })`, log
  `shell exited for <label>: <exitReason(exit)>`. The entry and its output key stay.
- **`kill(id)`.** Cancels the id's `Start`. Drops the entry before it calls `process.kill()`, so the `closed` the host
  sends later finds no entry and is dropped. It clears the entry's pending output timer, runs `output.delete(id)` and
  logs `shell killed for <label>`. An unknown id does nothing beyond the cancel.
  **`killAll()`** runs `kill` on every entry and cancels every `Start`. **`detachAll()`** cancels every `Start`, calls
  `detach()` on every running process, clears every pending timer and empties the table.
- **Replay cut.** The main buffer is the replay of the same shell, so it uses the host's rule and limit:
  `keepTail` from `src/shared/keep-tail.ts` at `TERMINAL_REPLAY_LIMIT`. A plugin's main part may import
  `src/shared/`, as chat's main part does. This task keeps no copy of the rule and no limit of its own.
- **Output slot.** A coalesced write, not a resetting debounce, so steady output still reaches the slot: the first
  chunk after a write arms one `timers.set(…, OUTPUT_WRITE_MS)`; chunks while it is armed join it; the timer writes
  `output.set(id, plain.text())`. A new entry's spawn writes the fresh (empty) text at its next write.
- **Plain text (`plain-text.ts`).** A cursor over the current line and a list of finished lines, fed chunk by chunk.
  Escape sequences may split across chunks: an unfinished one waits for the next chunk.
  - CSI: `ESC [` then parameter and intermediate bytes, ended by a final byte `0x40`–`0x7E`. Erase in line (final
    `K`) changes the current line; every other CSI is dropped, cursor moves and `ESC [ J` included.
  - Erase in line: parameter empty or `0` clears from the cursor to the line's end; `1` writes spaces from column 0
    through the cursor; `2` clears the whole line. The cursor stays. zsh and bash redraw a line with `\r` and
    `ESC [ K`, so without this rule the slot keeps text the screen erased.
  - OSC: `ESC ]` up to BEL (`0x07`) or ST (`ESC \`): dropped.
  - Any other escape: `ESC`, intermediate bytes `0x20`–`0x2F`, then one final byte `0x30`–`0x7E`: dropped.
  - `\r` moves the cursor to column 0; later characters overwrite from there; the rest of the line stays.
  - `\n` finishes the line and starts an empty one at column 0.
  - `\b` moves the cursor one column left, not past 0; it deletes nothing.
  - `\t` is written as one character. Every other C0 control (`0x00`–`0x1F`) and DEL (`0x7F`) is dropped.
  - A character written past the line's end pads the gap with spaces.
  - `text()`: the finished lines plus the current line, each with trailing spaces trimmed, the current line left out
    when it is empty, the last `lineLimit` of them joined with `\n`. Only `lineLimit` finished lines are kept.
- **`exitReason(exit)`.** `exit.error` when not null; else `code <code>` when `code` is not null; else
  `signal <signal>` when `signal` is not null; else `unknown`.
- **Additions to plan.md.** (1) The page command `restart` (arg `'string'`, the session id): the drawer header's
  restart control is a layout button, and `kit.button` runs a command by id (`src/shared/page/layout-host/kit.d.ts:171-179`),
  as `visual.expand` (`src/plugins/visual/manifest.ts`) takes its id argument. (2) The `layout` setting with its
  control, since every surface draws through a layout (AGENTS.md § Intent) and `api.layouts.show` reads the user's
  layout name from a setting. The README coverage test then needs `terminal.layout` in README's Settings table (10).

Pinned values:
- Manifest:
  ```ts
  id: 'terminal',
  label: 'Terminal',
  description: "A shell for each session, in a drawer under the session's tabs.",
  dependsOn: { main: ['chat', 'sessions'], page: ['sessions'] },
  reads: { main: [], page: [] },
  commands: {
    type: { label: "type a command line into the calling session's terminal", group: 'terminal', runsIn: 'main', arg: 'string' },
    toggle: { label: "open or close the session's terminal", group: 'terminal', runsIn: 'page' },
    back: { label: 'leave the terminal for the session', group: 'terminal', runsIn: 'page' },
    restart: { label: "start a new shell in the session's exited terminal", group: 'terminal', runsIn: 'page', arg: 'string' },
  },
  scopes: { terminal: 'Terminal' },
  settings: { layout: 'default' },
  settingControls: { layout: 'layout' },
  settingInfo: { layout: { label: 'Layout', description: "The terminal layout the drawer's header draws in: a folder name in terminal's layouts folder, or default." } },
  themeTokens: {},
  ```
- Buffer limit `TERMINAL_REPLAY_LIMIT` (02) · `PLAIN_LINE_LIMIT = 200` · `OUTPUT_WRITE_MS = 250` · start size of a
  typed shell, and of a spawn asked for below 1, `80`×`24`.
- Errors: `terminal.type needs a calling session` · `terminal.type takes one line: the text holds a line break` ·
  `terminal found no shell program to start` · `terminal: the shell start for <id> was cancelled`.
- Main log lines (each logged through `services.log`, shown as `[terminal] …`): `shell started for <label> in <folder>`
  · `shell exited for <label>: <reason>` · `shell killed for <label>` · `adopted <n> shells, ended <m>` ·
  `adoption failed: <error text>`. Task 09 pins the page's lines; task 10's self-test reads the page's.
- `TERMINAL_SESSION_NOTE`:
  > This app gives each session its own terminal: a shell in a drawer under the session's tabs. When the user must
  > run a command you cannot run yourself, such as a sign-in (`gcloud auth login`), type it there: run_command
  > `terminal.type` with the command line as its string argument. It types the text at the prompt without Enter,
  > opens the drawer and marks your session as needing the user; nothing runs until the user presses Enter. Then ask
  > the user to press Enter in the terminal. read_state slot `terminal.output`, key your app session id (the value of
  > the environment variable `WIGLEY_SESSION_ROW`), holds the last 200 lines of the shell's output as plain text.
  > Before you type into the terminal, load the `auri:terminal` skill and follow it.

GIVEN no calling session WHEN `terminal.type` runs THEN it throws `terminal.type needs a calling session`.
GIVEN text holding `\n` or `\r` WHEN `terminal.type` runs THEN it throws the line-break text and spawns nothing.
GIVEN a session with no shell WHEN `terminal.type` runs with `gcloud auth login` THEN a shell spawns at 80×24 in the
row's folder, the text is written with no Enter, and `typed` is sent with the shell's id.
GIVEN a running shell WHEN two chunks arrive THEN `data` goes out with seq 1 and 2 and `open` returns both in its
buffer with seq 2.
GIVEN an exited shell WHEN `restart` or `terminal.type` runs THEN a new shell spawns with a new shell id and seq 0,
and the old shell is not killed.
GIVEN a running shell WHEN `restart` runs THEN no shell spawns and the running shell is resized.
GIVEN an `open` and a `terminal.type` for one session WHILE the shell program resolves THEN one shell spawns.
GIVEN `sessions.closed` WHILE the shell program resolves THEN no shell spawns and the waiting `open` rejects.
GIVEN `open` with a size below 1 THEN the shell spawns at 80×24; GIVEN a running shell, a resize below 1 and a write
to an exited shell change nothing.
GIVEN `sessions.closed` for a session with a shell THEN the shell is killed and its `terminal.output` key is deleted;
`sessions.ended` leaves it running.
GIVEN the host lists shells at start WHEN chat's restore settles THEN shells with a row are adopted with their replay
and a new shell id, shells with no row are killed, and an `open` sent before then waits and spawns nothing.
GIVEN the host's `list()` rejects THEN `adoption failed: <error text>` is logged and a waiting `open` spawns.
GIVEN output arrives WHEN 250 ms pass THEN `terminal.output` holds the plain text once.
GIVEN shell output that erases a line with `ESC [ K` THEN the plain text does not hold the erased text.

Tests:
- `plain-text.test.ts` — `it.each` `'plainText_$case'`, each row writing chunks in order and asserting `text()`:
  | case | chunks | text |
  | CSI colour | `['a\x1b[31mred\x1b[0m']` | `'ared'` |
  | OSC to BEL | `['x\x1b]0;title\x07y']` | `'xy'` |
  | OSC to ST | `['x\x1b]8;;http://e\x1b\\y']` | `'xy'` |
  | charset escape | `['\x1b(Bz']` | `'z'` |
  | CSI split across chunks | `['a\x1b[', '1mb']` | `'ab'` |
  | carriage return overwrite | `['50%\r100%']` | `'100%'` |
  | overwrite keeps the rest | `['abc\rX']` | `'Xbc'` |
  | backspace | `['ab\bc']` | `'ac'` |
  | erase echo | `['ab\b \b']` | `'a'` |
  | erase to the end after a return | `['ab\r\x1b[K']` | `''` |
  | erase to the end mid line | `['abcd\b\b\x1b[0K']` | `'ab'` |
  | erase to the cursor | `['abc\b\x1b[1Kd']` | `'  d'` |
  | erase the whole line | `['abc\x1b[2K']` | `''` |
  | cursor move dropped | `['ab\x1b[2Dc']` | `'abc'` |
  | CRLF and trailing newline | `['one\r\ntwo\n']` | `'one\ntwo'` |
  | BEL dropped | `['a\x07b']` | `'ab'` |
  and `plainText_PastTheLimit_KeepsTheLast200Lines` — 205 lines `l0\n`…`l204\n` into `createPlainText(200)`: `text()`
  splits into 200 lines, the first `l5`, the last `l204`; and `plainText_Reset_Empties` — `text()` is `''` after
  `reset()`.
- `exit-reason.test.ts` — `it.each` `'exitReason_$case'`: error `'spawn failed'` with code 1 → `'spawn failed'`;
  code 0 → `'code 0'`; signal 1 → `'signal 1'`; all null → `'unknown'`.
- `main/start.test.ts`, on `startMainPart` with `services: { terminals: createFakeTerminalHost(clock) }`, a fake
  `chatMainKey` dependency recording `addInstructions` and answering `restored()`, a fake `sessionsMainKey`, and rows
  seeded in `sessionsRowsSlot` through the harness's `state` (row `s1`: label `alpha`, projectDir `/work/alpha`). The
  default fake processes resolve `shell` to `/bin/zsh -l` (06). The harness's `randomUuid` gives
  `00000000-0000-4000-8000-000000000001`, then `…002`, so the tests name a shell id by its last digit (`id 1`):
  - `stop_LeavesNoLiveRegistration`, `stopThenStart_StartsAgain` — as `src/plugins/agent-skills/main/start.test.ts`.
  - `start_HandsChatTheSessionNote` — the recorded instructions equal `[TERMINAL_SESSION_NOTE]`.
  - `it.each` `'type_Refused_$case'` — no caller → `terminal.type needs a calling session`; `'a\nb'` and `'a\rb'` →
    the line-break text; no record is spawned in each.
  - `type_NoShell_SpawnsWritesAndSendsTyped` — the record's request is `{ id: 's1', command: '/bin/zsh',
    args: ['-l'], cwd: '/work/alpha', cols: 80, rows: 24 }`, `writes` is `['gcloud auth login']`, and `sent` holds
    `{ message: 'typed', data: { sessionId: 's1', shell: <id 1>, text: 'gcloud auth login' } }`.
  - `it.each` `'spawn_Folder_$case'` — row with projectDir → `/work/alpha`; row with projectDir null → the harness's
    `homeDir`; no row → `homeDir`.
  - `it.each` `'open_SizeBelowOne_SpawnsAt80x24_$case'` — `open('s1', 0, 30)` and `open('s1', 100, 0)`: the request's
    `cols` 80 and `rows` 24.
  - `type_NoShellProgram_Throws` — `processes.scriptProgram('shell', null)`: `terminal found no shell program to start`.
  - `open_Twice_SpawnsOnceAndResizes` — `open('s1', 100, 30)` twice: one record, its `resizes` `[{ cols: 100, rows: 30 }]`.
  - `it.each` `'ignored_$case'` — a running shell, `open('s1', 0, 24)` again → `resizes` `[]`; an exited shell
    (`close('s1', …)`), `write('s1', 'x')` → `writes` `[]`.
  - The two resolve-window tests replace `resolveProgram` on the harness's `FakeProcesses` instance with a function
    that returns a promise the test resolves by hand (to `/bin/zsh -l`). Each runs after `ready()` and adoption, and
    flushes microtasks (`await Promise.resolve()`) until `resolveProgram` was called:
    - `openAndType_WhileResolving_SpawnOnce` — `open('s1', 100, 30)` and `terminal.type` `'ls'`, then the resolve:
      one record, its request at 100×30, `writes` `['ls']`.
    - `closed_WhileResolving_SpawnsNothing` — `open('s1', 100, 30)`, then `emit('sessions.closed',
      { sessionId: 's1' })`, then the resolve: the open rejects `terminal: the shell start for s1 was cancelled`, and
      no record exists.
  - `data_SendsSeqAndOpenReturnsTheBuffer` — after the fake's `$ ` prompt and `output('s1', 'x')`: `data` messages
    carry `shell` id 1 and seq 1 and 2; a later `open` returns `{ shell: <id 1>, buffer: '$ x', seq: 2,
    folder: '/work/alpha', exit: null }`.
  - `closed_SendsExitedAndOpenReportsIt` — `close('s1', { code: 0, signal: null, error: null })`: `exited` sent with
    `shell` id 1 and that exit; `open` returns it in `exit` and spawns nothing.
  - `it.each` `'replaceExited_$case'` — after `close('s1', …)`: `restart('s1', 90, 20)` → a second record at 90×20,
    the reply's `shell` id 2 and seq 0 (before the new prompt's microtask); `terminal.type` `'ls'` → a second record
    at 80×24 with `writes` `['ls']` and `typed` with `shell` id 2. In each, the first record's `kills` is 0, and no
    `exited` is sent after the replace.
  - `restart_Running_ResizesAndSpawnsNothing` — a running shell, `restart('s1', 90, 20)`: one record, `resizes`
    `[{ cols: 90, rows: 20 }]`, `kills` 0, the reply's `shell` id 1.
  - `it.each` `'sessionsEvent_$case'` — `sessions.closed` → `kills` 1, `terminal.output` has no `s1` key, and no
    `exited` is sent once the fake's close arrives (await a microtask); `sessions.ended` → `kills` 0.
  - `it.each` `'ready_Adopts_$case'` — host shells added with `addRunning` before the start:
    running with a row → attached (`events` not null), `open` returns its output as `buffer` with seq 1, a new
    `shell` and spawns nothing; running with no row → `kills` 1; and
    `ready_OpenBeforeAdoption_WaitsAndSpawnsNothing` — `open('s1', …)` before `ready()` resolves after adoption with
    the adopted buffer and no new record.
  - `ready_ListRejects_LogsAndOpenSpawns` — `services.terminals` is `{ spawn: (r, e) => host.spawn(r, e),
    attach: (i, e) => host.attach(i, e), list: () => Promise.reject(new Error('host gone')) }` over the fake `host`:
    the log holds `adoption failed: host gone`, and an `open('s1', 100, 30)` sent before `ready()` resolves with one
    new record.
  - `outputSlot_CoalescesWithin250Ms` — `output('s1', 'a\r\n')`, `advance(100)`, `output('s1', 'b')`: `s1` unset at
    `advance(149)`; at `advance(1)` it is `'$ a\nb'`.
  - `it.each` `'dispose_$stop'` — `restart` and `quit` → `detaches` 1, `kills` 0; `end` → `kills` 1 and the `s1`
    key deleted.

Done when: `npm run typecheck` passes; the tests above exist; the test gate runs them.
Commit:    one commit: "terminal: main part — shells per session over the session host, terminal.type, the output slot and the session note"

## Proof
