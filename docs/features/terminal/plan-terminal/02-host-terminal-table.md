# 02 — Host terminal table and protocol 5

Status: in progress
Type: Task
Rung: deep · crosses the host's lifecycle: exit rule, drain, stopAll, leftover ending and the held-message order
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/contracts/pty.ts` · create `src/contracts/terminals.ts` · create `src/session-host/terminal-table.ts` ·
           create `src/shared/keep-tail.ts` ·
           modify `src/contracts/session-host-protocol.ts` · modify `src/session-host/host-server.ts` ·
           modify `src/session-host/host-children.ts` · modify `src/session-host/session-host.ts` ·
           modify `src/session-host/os-processes.ts` (the comment above `OsProcesses` only) ·
           modify `src/session-host/session-host-test-doubles.ts` ·
           modify `docs/features/session-host/design.md` (line 25 only) · modify `docs/features/scheduled-tasks/design.md` (lines 54 and 56 only) ·
           test `src/session-host/terminal-table.test.ts` (create) · test `src/shared/keep-tail.test.ts` (create) ·
           test `src/session-host/host-server.test.ts` · test `src/session-host/host-children.test.ts`
Consumes:  nothing
Produces:
- `src/contracts/pty.ts`: `PtyOptions`, `PtyExit`, `Pty`, `PtySpawn`, word for word as plan.md § File Structure gives them.
- `src/contracts/terminals.ts`: `TerminalSpawn`, `TerminalExit`, `TerminalEvents`, `TerminalProcess`, `TerminalInfo`,
  `TerminalAttach`, `TERMINAL_REPLAY_LIMIT`, `TerminalHost`, word for word as plan.md gives them.
- `src/shared/keep-tail.ts`:
  ```ts
  // The last `limit` UTF-16 code units of `text`, less a leading low surrogate, so no character is cut in half.
  export function keepTail(text: string, limit: number): string;
  ```
  The host table (this task), the fake terminal host (06) and terminal main (08) cut with it.
- `src/contracts/session-host-protocol.ts`: `export const SESSION_HOST_PROTOCOL = 5;` and, in the versioned part:
  ```ts
  export interface TermSpawnMessage { type: 'termSpawn'; request: TerminalSpawn }
  export interface TermWriteMessage { type: 'termWrite'; id: string; data: string }
  export interface TermResizeMessage { type: 'termResize'; id: string; cols: number; rows: number }
  export interface TermKillMessage { type: 'termKill'; id: string }
  export interface TermAttachMessage { type: 'termAttach'; requestId: number; id: string }
  export interface TermAttachReply {
    type: 'termAttach'; requestId: number; id: string;
    terminal: { replay: string; running: boolean } | null;
  }
  export interface TermDetachMessage { type: 'termDetach'; id: string }
  export interface TermListMessage { type: 'termList'; requestId: number }
  export interface TermListReply { type: 'termList'; requestId: number; terminals: TerminalInfo[] }
  export interface TermDataEvent { type: 'termData'; id: string; data: string }
  export interface TermClosedEvent { type: 'termClosed'; id: string; exit: TerminalExit }
  ```
  `ClientMessage` gains the seven app-to-host messages; `HostMessage` gains `TermAttachReply`, `TermListReply`,
  `TermDataEvent` and `TermClosedEvent`.
- `src/session-host/terminal-table.ts`:
  ```ts
  export interface TerminalSubscriber {
    data(id: string, chunk: string): void;
    closed(id: string, exit: TerminalExit): void;
  }
  export interface TerminalTableDeps {
    spawn: PtySpawn;
    env: NodeJS.ProcessEnv;          // the host's own; each shell inherits it (Decisions)
    clock: Clock;
    timers: Timers;                  // the SIGKILL after HOST_END_GRACE_MS (Decisions › Kill)
    diagnostics: DiagnosticLog;
    recordPid(pid: number): RecordedPty; // HostChildren.recordPid
    terminalClosed(id: string): void;   // after a shell has left the table
  }
  export interface TerminalTable {
    spawn(request: TerminalSpawn, subscriber: TerminalSubscriber): void;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    kill(id: string): void;
    attach(id: string, subscriber: TerminalSubscriber): { replay: string; running: boolean } | null;
    detach(id: string, subscriber: TerminalSubscriber): void;
    dropSubscriber(subscriber: TerminalSubscriber): void;
    list(): TerminalInfo[];
    endAll(): void;                  // the drain: kills every shell now, refuses every later spawn
    stopAll(done: () => void): void;
  }
  export function createTerminalTable(deps: TerminalTableDeps): TerminalTable;
  ```
- `src/session-host/host-children.ts`:
  ```ts
  // A shell's pid in the children record, from `recordPid` until disposed.
  export interface RecordedPty extends Disposable {
    // Sends the pid SIGKILL through `deps.processes.signal`. A throw is reported, not passed on. Does nothing once disposed.
    kill(): void;
  }
  ```
  `HostChildren` gains `recordPid(pid: number): RecordedPty;` — records a process the host started outside `spawn` (a
  shell's pty) until disposed.
- `src/session-host/host-server.ts`: `SessionHostDeps` (now :75-85) gains `ptySpawn: PtySpawn;`.
- `src/session-host/session-host-test-doubles.ts`:
  ```ts
  export function fakePty(pid = 5151): {
    pty: Pty;
    written: string[];                         // each write's data, in order
    resizes: { cols: number; rows: number }[];
    kills(): number;                           // how many times kill ran
    emitData(chunk: string): void;
    exit(exit?: PtyExit): void;                // default { exitCode: 0, signal: null }
  };
  export type FakePty = ReturnType<typeof fakePty>;
  ```
  `kill()` only counts; the test calls `exit` to end the shell, as `fakeChild` leaves `close` to the test.

Decisions:
- **Own table.** Shells live in `terminal-table.ts`, never in `process-table.ts`, which stays untouched (plan.md §
  Files by area). No keep window, idle rule or pipe log applies to a shell.
- **Environment.** Each shell's `PtyOptions.env` is the host's `deps.env` with every undefined value and
  `ELECTRON_RUN_AS_NODE` dropped, then `TERM=xterm-256color` and `COLORTERM=truecolor` set over it (plan.md §
  Decisions › Environment). `TerminalSpawn` carries no env.
- **Replay ring.** On each `Pty.onData` chunk, the table sets the shell's replay to
  `keepTail(replay + chunk, TERMINAL_REPLAY_LIMIT)`. `TERMINAL_REPLAY_LIMIT` comes from `src/contracts/terminals.ts`.
  The table has no cut rule of its own: `keepTail` owns it, and its own test pins the surrogate case.
- **keepTail.** `keepTail(text, limit)` returns `text` when `text.length <= limit`. Else it takes
  `text.slice(text.length - limit)`; when the first code unit of that is a low surrogate (0xDC00–0xDFFF), it drops
  that code unit too. It counts UTF-16 code units, not UTF-8 bytes, so it needs no encoding.
- **One subscriber per shell.** `spawn` subscribes the spawner. `attach` replaces the subscriber, as the process
  table's `subscribe` does; the replaced one gets no more events. `detach` clears it only when it is the given
  subscriber. `dropSubscriber` clears it from every shell it holds, as a closed connection leaves. Output with no
  subscriber still goes into the ring, and a later `attach`'s replay holds it.
- **Attach.** `attach` returns null for an id the table does not hold, and subscribes nothing. For a held shell it
  subscribes and returns `{ replay, running }`; `running` is false once `kill`, `endAll` or `stopAll` has run on it, so
  an app that attaches to an ending shell still hears its `termClosed`.
- **Exit.** On `Pty.onExit` the table clears the shell's SIGKILL timer, removes the shell, calls the subscriber's
  `closed`, disposes its `RecordedPty`, runs any `stopAll` waiters once the table is empty, then calls
  `deps.terminalClosed(id)`. An exited shell is gone: `list` and `attach` no longer see it.
- **Exit shape.** A `PtyExit` with `signal: null` becomes `{ code: exitCode, signal: null, error: null }`. A `PtyExit`
  with a signal becomes `{ code: null, signal, error: null }`: node-pty reports `exitCode` 0 for a shell a signal ended
  (task 04), and that 0 is not the shell's code. So a kill that ends the shell by SIGHUP gives
  `{ code: null, signal: 1, error: null }`, and the SIGKILL step gives `{ code: null, signal: 9, error: null }`. A shell
  that catches SIGHUP and exits with its own code gives that code and `signal: null`.
- **Refusals.** `spawn` calls the subscriber's `closed` with `code` and `signal` null and this `error`, touching no
  other shell: after `endAll`, `the session host is draining`; an id the table holds, `a terminal with id <id> already
  exists`; a request whose `command` or `cwd` is not a string, whose `args` is not a string array, or whose `cols` or
  `rows` is not a positive integer, `terminal <id> has no well-formed spawn`; a `PtySpawn` that throws, the thrown
  error's message.
- **Kill.** `kill(id)`, `endAll` and `stopAll` call `Pty.kill()` once per shell, mark it ending, and set a timer of
  `HOST_END_GRACE_MS` (`src/contracts/session-host-protocol.ts:67`). When the timer fires, the table calls the shell's
  `RecordedPty.kill()`, which sends SIGKILL. This is the process table's escalation (`endProcess`, now
  `process-table.ts:442-458`; `stopAll`, now :764-776), with the pty's SIGHUP in place of SIGTERM. So a shell that
  ignores SIGHUP (`trap '' HUP`, `nohup`) still exits, and `stopAll` and `drain` do not hang on it. A second `kill`
  of an ending shell does nothing. The pid is still the shell's when the timer fires: node-pty reaps the pid only
  when it reports the exit, and the exit clears the timer.
- `write`, `resize` and `kill` do nothing for an id the table does not hold, as the process table's do.
- **Children record.** `HostChildren.recordPid(pid)` records `pid` the way `spawn` records a child: once the OS has
  reported it (`recordChild`, now :108-124), with the same start time and command. `recordChild` takes a liveness check
  in place of `running.has(child)`, so both paths share it. Host children keep the pids from `recordPid` in their own
  `Set<number>`, apart from `running`. Disposing the handle drops the pid from that set and from the record, and saves
  the record, as a child's `close` does (now :251-256).
- **killAll.** `killAll` (now :270-274) also sends `SIGTERM` through `deps.processes.signal` to each pid in the
  `recordPid` set, and to no other pid: an ordinary child still gets only `child.kill('SIGTERM')`. A throw is
  reported and the loop goes on. This SIGTERM is no promise that a shell ends: an interactive zsh or bash ignores
  SIGTERM. `killAll` leaves the record, so the next host's `endLeftovers` sends SIGTERM, then SIGKILL after
  `HOST_END_GRACE_MS` (now :211-228), to each shell that still runs.
- **os-processes.ts.** Its comment above `OsProcesses` (now :14-15) says `host-children` signals only a pid it has just
  compared with its record. Change it to also name `RecordedPty.kill`, which signals a pid the table still holds.
- **Host server** (`createConnections`, now :220-416):
  - It creates the terminal table beside the process table with `spawn: deps.ptySpawn`, `env`, `clock`, `timers`,
    `diagnostics`, `recordPid: deps.children.recordPid`, and `terminalClosed: () => checkExitRule()`.
  - `CLIENT_MESSAGE_TYPES` (now :36-53) gains the seven app-to-host types. `NON_CLIENT_MESSAGE_TYPES` stays as it is,
    so every terminal message marks a client.
  - `SERVED_WHILE_ENDING_LEFTOVERS` (now :65-73) gains `termList` and `termAttach`: the client's reply limit is shorter
    than the hold, and the table is empty then. `termSpawn`, `termWrite`, `termResize`, `termKill` and `termDetach`
    wait in order with the rest.
  - `handleMessage` dispatch: `termSpawn` → `terminals.spawn(request, termSubscriber)`; `termWrite`, `termResize`,
    `termKill` → the table's same-named call; `termAttach` → push `{ type: 'termAttach', requestId, id, terminal:
    terminals.attach(id, termSubscriber) }`; `termDetach` → `terminals.detach(id, termSubscriber)`; `termList` → push
    `{ type: 'termList', requestId, terminals: terminals.list() }`.
  - `connected` builds one `TerminalSubscriber` per connection beside the `ProcessSubscriber` (now :376-380):
    `data` pushes `termData`, `closed` pushes `termClosed`. `disconnected` also calls
    `terminals.dropSubscriber` on it.
  - `checkExitRule` (now :254-264): `holdsNothing` also needs `terminals.list().length === 0`, so a running shell
    keeps the host up while no app is connected.
  - `drain`: also calls `terminals.endAll()`, before `checkExitRule`.
  - `stopAll`: replies once both `table.stopAll` and `terminals.stopAll` have called back.
  - `startSessionHost` passes `deps.ptySpawn` into `createConnections`.
- **session-host.ts** passes `ptySpawn` to `startSessionHost`. In this task it is a `PtySpawn` that throws
  `this host build has no pty adapter`, so every `termSpawn` is refused with that error until task 04 replaces it with
  the node-pty adapter.
- **Protocol 5.** No test row changes: every row in `session-host-protocol.test.ts` and
  `session-host-channel.test.ts` uses a literal protocol or `SESSION_HOST_PROTOCOL`. No source file hard-codes a `-v4`
  name: the host and the client build every name from `SESSION_HOST_PROTOCOL`. Two docs do:
  `docs/features/session-host/design.md:25` (`pending-v4.json` and `runs-v4.json`) and
  `docs/features/scheduled-tasks/design.md:54,56`. Write them as `pending-v<protocol>.json` and `runs-v<protocol>.json`.
  Keep `design.md:233`'s "since protocol 4": it dates the queue messages.

Pinned values: `SESSION_HOST_PROTOCOL = 5` · `TERMINAL_REPLAY_LIMIT = 256 * 1024` · SIGKILL after
`HOST_END_GRACE_MS` (3000) · env `TERM=xterm-256color`,
`COLORTERM=truecolor`, `ELECTRON_RUN_AS_NODE` dropped · errors `the session host is draining`,
`a terminal with id <id> already exists`, `terminal <id> has no well-formed spawn`, `this host build has no pty adapter`.

GIVEN a host env holding `ELECTRON_RUN_AS_NODE` and `TERM=dumb` WHEN a shell spawns THEN its env lacks the first and
has `TERM=xterm-256color` and `COLORTERM=truecolor`
GIVEN a text longer than `limit` WHEN `keepTail` cuts it THEN it returns the last `limit` code units, less a leading
low surrogate
GIVEN a shell's output past `TERMINAL_REPLAY_LIMIT` WHEN an app attaches THEN the replay is that output cut with
`keepTail`
GIVEN a killed shell that ignores SIGHUP WHEN `HOST_END_GRACE_MS` passes THEN the table sends it SIGKILL
GIVEN a pty exit with a signal WHEN the table reports it THEN the exit's `code` is null
GIVEN a dropped subscriber WHEN the shell writes output THEN nobody gets it and a later attach's replay holds it
GIVEN a dying host with a shell and a child WHEN `killAll` runs THEN only the shell's pid gets an OS SIGTERM
GIVEN a running shell and no connected app WHEN the first-client wait ends THEN the host stays up
GIVEN a running shell WHEN `drain` arrives THEN the shell is killed at once and the host exits once it has exited
GIVEN a running shell and a hosted process WHEN `stopAll` arrives THEN the reply comes once both have closed
GIVEN a new host ending leftovers WHEN `termList` and `termSpawn` arrive THEN `termList` is answered and `termSpawn`
waits

Tests:
- create `src/shared/keep-tail.test.ts`, `describe('keepTail')`, `it.each` `'keepTail_$case'` — rows: under the limit,
  `'ab'` at 4 → `'ab'`; `'abcdef'` at 4 → `'cdef'`; a cut on a low surrogate, `'a\u{1F600}bc'` at 3 → `'bc'`.
- create `src/session-host/terminal-table.test.ts`, `describe('createTerminalTable')`, each built on `fakePty`,
  `manualTime` and a recording `TerminalSubscriber`; `recordPid` returns a handle that records `kill` and `dispose`
  calls:
  - `it('spawns the pty with the request and the shell environment')` — host env
    `{ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', TERM: 'dumb', GONE: undefined }`, request command `/bin/zsh`,
    args `['-l']`, cwd `/work`, cols 100, rows 30 → spawn called with `/bin/zsh`, `['-l']`,
    `{ cwd: '/work', cols: 100, rows: 30, env: { PATH: '/bin', TERM: 'xterm-256color', COLORTERM: 'truecolor' } }`;
    `recordPid` called with `5151`.
  - `it('cuts the replay with keepTail at TERMINAL_REPLAY_LIMIT')` — `emitData('a\u{1F600}')`, then
    `emitData('x'.repeat(TERMINAL_REPLAY_LIMIT - 1))`, so the cut lands between the halves of the pair → the attach's
    replay is `'x'.repeat(TERMINAL_REPLAY_LIMIT - 1)`. A plain `slice` gives a lone low surrogate in front, and no cut
    gives the `a` in front, so both fail.
  - `it('sends output only to the live subscriber')` — spawn with A, `emitData('1')`, attach B → reply replay `'1'`,
    running true; `emitData('2')` → A data `['1']`, B data `['2']`; `detach` with A → B still gets `'3'`; `detach`
    with B, `emitData('4')` → nobody; a later attach's replay is `'1234'`.
  - `it('dropSubscriber_ThenOutput_KeepsItForTheNextAttach')` — two shells `a` and `b`, both spawned with A;
    `dropSubscriber(A)`; `emitData('x')` on each → A data `[]`; attach `a` with B → replay `'x'`, running true.
  - `it.each` `'removes an exited shell and tells its subscriber once: $name'` — rows: `exitCode 2, signal null` →
    closed `[{ code: 2, signal: null, error: null }]`; `exitCode 0, signal 1` → closed
    `[{ code: null, signal: 1, error: null }]`. Each row also asserts: `list()` is `[]`; `attach` returns null;
    `terminalClosed` called with the id; the `RecordedPty` disposed.
  - `it.each` `'refuses a spawn: $name'` — rows: after `endAll` → `the session host is draining`; a held id →
    `a terminal with id a already exists`; `cols: 0` → `terminal a has no well-formed spawn`; `args: 'x'` → the same;
    a `PtySpawn` that throws `Error('no such file')` → `no such file`. Each row asserts the closed exit
    `{ code: null, signal: null, error }` and that no other held shell was killed.
  - `it('writes, resizes and kills the held shell only')` — `write('a', 'ls')`, `resize('a', 90, 20)`,
    `write('b', 'x')` for an unknown id → `written` `['ls']`, `resizes` `[{ cols: 90, rows: 20 }]`; `kill('a')` →
    `kills()` 1 and `list()` shows `running: false`; attach then returns `{ replay: '', running: false }`.
  - `it('ends every shell at once on endAll')` — two shells → each `kills()` 1, and `list()` shows each
    `running: false`.
  - `it.each` `'stopAll calls done once the table is empty: $name'` — rows: empty table → done at once; two shells →
    each killed, `list()` shows each `running: false`, done not called until the second `exit`.
  - `it.each` `'kill escalates to SIGKILL after HOST_END_GRACE_MS: $name'` — rows `kill`, `endAll` and `stopAll`, each
    on one shell: `advanceTo(HOST_END_GRACE_MS - 1)` → the `RecordedPty` has no `kill`; `advanceTo(HOST_END_GRACE_MS)`
    → one `kill`; a second `kill('a')` before then adds no `Pty.kill()` and no second timer. A shell that exits before
    `HOST_END_GRACE_MS` → no `RecordedPty.kill` after `advanceTo(HOST_END_GRACE_MS)`.
- `src/session-host/host-server.test.ts`: `host()` (now :87-117) gains a `ptySpawn` that pushes a `fakePty` into a
  `ptys` array. Add:
  - `it('termSpawn_ThenOutputAndExit_PushesToTheSubscribedConnectionOnly')` — owner sends `termSpawn`; a second
    connection sends nothing; `emitData('hi')`, `exit()` → owner received `termData` `hi` then `termClosed`; the
    other received neither.
  - `it('termAttach_SecondConnection_RepliesTheReplayAndTakesTheOutput')` — reply
    `{ type: 'termAttach', requestId, id: 'a', terminal: { replay: 'before', running: true } }`; later output reaches
    only the second connection; an unknown id replies `terminal: null`.
  - `it('termList_RepliesEachShell')` — two shells → `terminals` holds ids `a`, `b`, each `running: true`.
  - a row in `exitRule_Cases_ExitsOnlyWithNoProcessAndNoClient`: `a running shell and no client` — spawn a shell,
    destroy the connection → `exits` stays `[]`; `exit()` the pty → `exits` `[0]`.
  - `it('drain_Shell_KillsAtOnceThenExits')` — `drain` → `kills()` 1 at once; `exits` `[]` until `exit()`, then `[0]`.
  - a row in `stopAll_Cases_RepliesOnceEveryProcessClosed`: `a shell and a process` — no reply until both the fake
    child closes and the pty exits.
  - `it('start_EndingLeftovers_AnswersTermListAndHoldsTermSpawn')` — with `leftoversEndedByTest`: `termList`
    answers `terminals: []`; `termSpawn` makes no pty until `finish()`.
- `src/session-host/host-children.test.ts`, `describe('the children record')`:
  - `it('recordPid_ToDispose_RecordHoldsThePidOnlyUntilDisposed')` — `fakeMachine` reporting pid 77 → the record
    lists `{ pid: 77, ...REPORT }`; `dispose()` → the own file is gone.
  - `it('recordPid_Kill_SendsSIGKILLUntilDisposed')` — `fakeMachine` holding 77 with an `afterSignal` that keeps it;
    `kill()` → `signals` `['77 SIGKILL']`; `dispose()`, then `kill()` → `signals` unchanged.
  - in `killAll_RunningChildren_SendsEachSIGTERMAndKeepsTheRecord` (now :244), add `recordPid` of a third pid that
    `realProcesses` can signal: a `/bin/sh` started outside `children.spawn`, by the test's `spawnChild`, running
    `ENDS_ON_SIGTERM` and pushed to `madeChildren`, so the guard lets it through. The last `signals` assertion
    becomes `['SIGTERM']`, where it is `[]` now: one OS signal, for the shell only, since the two spawned children
    still end through their handles. All three exit by SIGTERM; the record stays.

Done when: `npm run typecheck` passes; the tests above exist; the test gate runs them.
Commit: one commit — "Session host protocol 5: a terminal table runs each shell in a pty outside the process table,
with a 256 KB replay, its own messages, and the exit rule, drain, stopAll and children record counting shells".

## Proof
