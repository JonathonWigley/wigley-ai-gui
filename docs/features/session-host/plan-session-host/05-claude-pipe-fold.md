# 05 — Claude adapter pipe fold

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     create `src/main/claude-code/session-fold.ts` · test `src/main/claude-code/session-fold.test.ts` ·
           modify `src/main/claude-code/claude-code-harness.ts` · test `src/main/claude-code/claude-code-harness.test.ts`
Consumes:  `PipeLine`, `HostedSpawn`, `HostedExit`, `HostedProcess`, `HostedProcessEvents` in
           `src/contracts/session-host.ts` ← 01. Tree members: `createStreamDecoder`, `StreamDecoder`, `DecodedLine`,
           `AgentEventDraft` (`stream-decoder.ts`); `createTurnTracker`, `TurnTracker`, `ControlCommand`,
           `TERMINAL_STATES` (`turn-tracker.ts`); `foldReply`, `foldTurn`, `foldContextUsage`, `contextUsageOf`,
           `usageEvent`, `withSavedReplies`, `EMPTY_SESSION_USAGE`, `SessionUsageState` (`session-usage.ts`);
           `AgentDefinitions` (`agent-definitions.ts`); `CLAUDE_CONTROLS`, `controlValue`, `controlMessage`,
           `userMessage` (`claude-controls.ts`); `typedSkill`, `TypedSkill` (`src/shared/typed-skill.ts`);
           `EntryDraft` (`src/shared/entry-stamp.ts`).
Produces:  in `src/main/claude-code/session-fold.ts`:
           `export const INTERRUPT_GRACE_MS = 5000;` (moved from `claude-code-harness.ts`)
           `export const APP_COMMAND_UUID_PREFIX = '00000000-';`
           `export function appCommandUuid(uuid: string): string;`
           `export interface HeldMessage { draft: EntryDraft; skill: TypedSkill | null; }` (moved)
           `export type PendingRequest = { kind: 'mode'; value: string } | { kind: 'interrupt' } | { kind: 'contextUsage' };` (moved)
           `export interface SessionFoldState` (fields below)
           `export type FoldEffect` (members below)
           `export interface FoldStep { state: SessionFoldState; effects: FoldEffect[]; }`
           `export function createSessionFoldState(request: AgentStart): SessionFoldState;`
           `export function foldPipeLine(state: SessionFoldState, line: PipeLine): FoldStep;`
           `export function advanceFold(state: SessionFoldState, at: number): FoldStep;`
           `export function foldUsageInput(state: SessionFoldState, change: (usage: SessionUsageState) => SessionUsageState, at: number): FoldStep;`
           `export function replayPipeLog(state: SessionFoldState, log: readonly PipeLine[], now: number): FoldEffect[];`
           in `src/main/claude-code/claude-code-harness.ts`: `function spawnDirect(deps: ClaudeCodeHarnessDeps, request: HostedSpawn, events: HostedProcessEvents): HostedProcess;`
           (module-private; task 08 moves it into the harness test)

Read first: `AGENTS.md` (repo root) § Architecture, `docs/features/session-host/design.md` § Re-attach,
`docs/features/agent-chat/design.md` § Agent harness seam. Load `wigley:writing-code` and
`wigley:codebase-design` before the first edit.

## Interfaces

```ts
export interface SessionFoldState {
  readonly decoder: StreamDecoder;      // its isKeptOut reads pendingRequests; its definitionOf reads definitions
  readonly tracker: TurnTracker;
  definitions: AgentDefinitions;        // empty until the harness sets the loaded ones
  controls: SessionControl[];
  activity: ProcessActivity;
  sendCount: number;                    // user entry ids `user-<n>`
  requestCount: number;                 // the highest `wigley-<n>` request id an `in` line carried
  noticeCount: number;                  // harness notice ids `control-notice-<n>`
  pendingRequests: Map<string, PendingRequest>;
  heldMessages: Map<string, HeldMessage>; // by message uuid, in write order
  firstAt: Map<string, number>;         // each entry id's first `at`
  usage: SessionUsageState;
  lastUsageEvent: UsageAgentEvent | null;
  lastStderr: string | null;
  graceDeadline: number | null;         // the interrupt grace's end, epoch ms; null when none is pending
}

export type FoldEffect =
  | { kind: 'entry'; entry: ChatEntry }
  | { kind: 'agentEvent'; event: AgentEvent }          // usage events included
  | { kind: 'controls'; controls: SessionControl[] }
  | { kind: 'activity'; activity: ProcessActivity }
  | { kind: 'commands'; commands: string[] }
  | { kind: 'planUsage'; update: PlanRowUpdate }
  | { kind: 'messageDropped'; entryId: string }
  | { kind: 'requestContextUsage' }
  | { kind: 'refuseHostRequest'; requestId: string; subtype: string }
  | { kind: 'log'; text: string };                     // logged under source 'claude'
```

## Decisions

### The fold

- **Deterministic, not immutable.** `SessionFoldState` is mutable and one process owns it. `foldPipeLine`,
  `advanceFold` and `foldUsageInput` update it in place and return it in `FoldStep.state`. They read no clock, make
  no random value, and do no I/O. The same seed and the same lines give equal state and equal effects. Reason: the
  decoder and the tracker are stateful closures; a rewrite to immutable values is out of scope.
- **The fold reads `dir`, `at` and `text`. It reads no `seq`.** Live `in` lines the harness folds carry `seq: 0`.
- **Every time comes from a line.** An entry's `at` is `firstAt.get(id) ?? line.at` (the `createEntryStamp` rule,
  with the line's time for the clock). An agent event's `at`, a usage event's `at`, `foldReply`'s time and a plan
  update's `at` are `line.at`. The harness no longer calls `createEntryStamp` or `deps.clock` for a session process,
  except for its `in` lines' `at` and the start's `sessionStarted`.
- **`in` lines.** The fold parses the text as JSON. A line that does not parse, and a type not listed, changes
  nothing.
  | Line | State change | Effects |
  |---|---|---|
  | `type: 'user'` with a string `uuid` that starts with `APP_COMMAND_UUID_PREFIX` | a text `/effort <v>` or `/model <v>` (the `CONTROL_COMMAND` rule): `tracker.written(uuid, { id, value })` | none |
  | `type: 'user'` with any other string `uuid` (a send) | `sendCount += 1`; draft `{ kind: 'user', id: 'user-<sendCount>', text, images, raw: [the parsed line] }`; skill `typedSkill(text)` when the text is not a control command, else null; held under the uuid outside fallback mode; `tracker.written(uuid, command or null)` | in fallback mode: the user entry, `userMessage`, then `skillStarted` when a skill (today's `emitUserMessage`) |
  | `type: 'control_request'` with `request_id` `wigley-<n>` | `requestCount = max(requestCount, n)`; `get_context_usage` → pending `contextUsage`; `interrupt` → pending `interrupt`, `graceDeadline = line.at + INTERRUPT_GRACE_MS`; `set_permission_mode` → pending `{ kind: 'mode', value: request.mode }` | `interrupt` only: notice `Interrupted`, tone `info`, raw `[the parsed line]` |
  | `type: 'control_response'` | none | none |
  The send's `text` and `images` come back from the content `userMessage` built: a string content is the text with no
  images; an array gives each `image` block's `source` as `{ mediaType: media_type, data }` in order, and the text
  of its `text` block, `''` when it has none. Each `in` line ends with the activity sync below.
- **`out` lines** run today's `handleLine` body, in today's order, as effects: the held message release, the
  fallback release, the entries (a control command's own `result` entry left out), the fallback log and notice, the
  agent events, the controls, the commands, the plan update and the usage, the control response, the host request
  (`refuseHostRequest` effect), the grace clear on `turnEnded`, the `requestContextUsage` effect on `turnEnded`, and
  the activity sync. A `get_context_usage` failure is a `log` effect (`get_context_usage failed: <error>`).
- **`err` lines** set `lastStderr = text` and give a `log` effect with the text.
- **Activity sync**, after every line: when `tracker.activity()` differs from `state.activity`, set it and add an
  `activity` effect. When the result is `idle`, set `graceDeadline = null`.
- **Usage events** keep today's rule: `usageEvent(usage, at)`, left out when it equals `lastUsageEvent` in every field
  but `at`.
- **App commands carry a marked uuid.** `appCommandUuid(uuid)` returns `APP_COMMAND_UUID_PREFIX` followed by the text
  after the first `-` in `uuid` (`uuid-1` → `00000000-1`; a v4 uuid stays a valid v4 uuid). `setControl` for `effort`
  and `model` writes its `controlMessage` under `appCommandUuid(deps.randomUuid())`. Reason: `controlMessage('effort',
  'high', id)` and a typed `/effort high` send are the same line apart from the uuid. Live, a pick makes no user entry
  and a typed one does; replay must tell them apart from the line alone. This is the one change on the wire: the
  pick's uuid has a fixed first group. A random v4 uuid starts with `00000000-` once in 2^32 sends; such a send would
  fold as a pick in a replay only.

### Time: the interrupt grace

- **The grace is a deadline in the state, not a timer in the fold.** `advanceFold(state, at)`: when
  `graceDeadline !== null` and `at >= graceDeadline`, set `graceDeadline = null`; when `activity === 'working'`, call
  `tracker.abandon()`, add the notice `Claude did not stop within 5 s; showing the session idle.` (tone `info`, raw
  `[null]`, `at` = the deadline), the `log` effect `interrupt unanswered after 5 s; dropping turn state`, and the
  activity sync. Else it changes nothing.
- `foldPipeLine` first runs `advanceFold(state, line.at)` and puts its effects before the line's own. So a line that
  arrives after the deadline finds the grace already ended, live and in a replay.
- **Live**, after every fold the harness keeps at most one `setTimeout` matched to `graceDeadline`: it arms one for
  `graceDeadline - deps.clock.now()` (at least 0) when the deadline changed, and clears it when the deadline is null.
  The timer's callback runs `advanceFold(state, <the deadline it was armed for>)` when `graceDeadline` still equals
  that deadline. Reason: the expiry then stamps the deadline, as a replay does; and the tests' fixed clock (`1000`)
  with fake timers still ends the grace. Behaviour change: the grace notice's `at` is the deadline, not the time the
  timer ran (within the timer's lag).
- **Across a replay boundary** `replayPipeLog` ends with `advanceFold(state, now)`. A grace whose deadline passed
  while no app was attached ends in the replay: its notice is stamped at the deadline and the final activity is
  `idle`. A grace still pending keeps `graceDeadline`; task 08 arms the live timer for the rest.
- **The end grace** (`END_GRACE_MS`, the SIGTERM and SIGKILL after `end`) is not fold state. It belongs to the one
  `AgentProcess` that called `end`. A re-attached process starts with no end pending.

### Replay

`replayPipeLog(state, log, now)` folds each line in log order, runs `advanceFold(state, now)`, and returns the
effects a replay emits, in this order:

1. `agentEvent` `{ type: 'sessionStarted', at }`, `at` = the first log line's `at`, or `now` for an empty log.
2. The folds' effects in order, except: every `controls`, `activity`, `commands`, `planUsage`, `messageDropped`,
   `requestContextUsage`, `refuseHostRequest` and `log` effect is dropped; each entry id is emitted once, at its first
   effect's place, carrying its last version (its `at` is the first one by the stamp rule). Every `agentEvent`
   stays, usage events included, so the agents roster folds the whole session.
3. `controls` with the final `state.controls`.
4. `commands` with the last `commands` effect's list, when the log gave one.
5. `activity` with the final `state.activity`.

Reasons: a replay writes nothing (the log already holds what the live run wrote); a plan update from a past turn is
stale; a dropped message names an entry id no `send` of this app returned; one emission per entry keeps a long
session's streaming deltas out of chat. The harness emits these effects before `attach` resolves (task 08), so chat
marks them `replayed` (plan.md § File Structure).

### The harness

- **A session process talks to a `HostedProcess`.** `startClaudeProcess` gets its pipe from `spawnDirect(deps,
  { id: request.sessionId, command, args: launch.args, cwd: launch.cwd, env, idleRule: { key: 'type', value:
  'result' } }, pipeEvents)`, where `env` is `launch.env` without its undefined values. `spawnDirect` calls
  `deps.spawn` as today and adapts the child:
  - each stdout and stderr line (readline) → `events.line({ seq, dir: 'out' | 'err', at: deps.clock.now(), text })`,
    `seq` counting from 1 over both streams;
  - `write(text)` → `child.stdin.write(text + '\n')`; `endInput()` → `child.stdin.end()`; `kill(signal)` →
    `child.kill(signal)`;
  - `child.stdin` `error` → `deps.log('claude', errorText(error))`, as today;
  - `close(code, signal)` → `events.closed({ code, signal, error })` once, `error` being the text of an `error` event
    that came first, else null;
  - `error` with `child.pid === undefined` → `events.closed({ code: null, signal: null, error: error.message })` at
    once;
  - `detach()` → from then on, `events` gets no `line` and no `closed`, and `write`, `endInput` and `kill` do
    nothing; the child keeps running (task 01's `HostedProcess.detach`). Nothing in 05 calls it.
  Reason: task 08 swaps `spawnDirect` for `deps.host.spawn` and changes nothing else.
- **Every live timer can be stopped at once.** The grace timer and the end grace timers are all pushed into the one
  `timers` list, and one function `stopTimers()` clears every timer in it and sets the grace timer handle to null.
  `markClosed` calls it. Task 08's `AgentProcess.detach` calls it too. Reason: a detached process object must leave no
  timer that later writes to the pipe or emits.
- **Every write goes through the fold first.** One helper writes a message: `text = JSON.stringify(message)`, fold
  `{ seq: 0, dir: 'in', at: deps.clock.now(), text }`, `pipe.write(text)`, then run the step's effects. `send`,
  `interrupt`, `setControl`, the start's context request and the effects below all use it. A new request id is
  `wigley-${state.requestCount + 1}`: the fold of its line raises `requestCount`. `send` returns
  `user-${state.sendCount}` after the fold.
- **Every read goes through the fold.** `pipeEvents.line` folds the line and runs its effects.
- **Running effects, live.** `entry`, `agentEvent`, `controls`, `activity`, `commands`, `planUsage` and
  `messageDropped` emit through `queueMicrotask`, as today. `requestContextUsage` writes a `get_context_usage`
  request when `!isEndCalled && !hasClosed` (today's `isRunning`). `refuseHostRequest` writes today's error
  `control_response`. `log` calls `deps.log('claude', text)`. After `close`, an `activity` effect is dropped (today's
  `syncActivity` guard), and after `ended` a usage `agentEvent` is dropped (today's `emitUsage` guard).
- **Kept in the harness, outside the fold:** `isEndCalled`, `hasClosed`, `hasEmittedEnded`, `endPromise`,
  `closeWaiters`, the end grace timers, the grace timer handle, and the pipe. `closed` keeps today's rule: an `idle`
  activity when `state.activity` is `working`, then `ended` (error text from `exit.error` through `spawnError`, else
  `exitError(code, signal, state.lastStderr)` unless clean), then `markClosed` (which also clears
  `state.heldMessages`). `spawnError` takes the error text and tests it for `ENOENT`.
- **Side inputs that are not lines.** The `settings.json` read and the resumed session's saved replies run as
  today and apply through `foldUsageInput(state, change, deps.clock.now())`. The agent definitions load sets
  `state.definitions`.
- **The second interrupt** stays a call effect, not a fold: the notice `Interrupted again; ending the Claude
  process.` gets the id `control-notice-kill` (outside `noticeCount`, so the notice ids that follow it in a replay
  match the live ones), then `kill()`. It is the one live entry a replay cannot rebuild; the process ends right after.
- **Guards read the state:** `interrupt` reads `state.activity` and `state.graceDeadline !== null` (today's
  `graceTimer !== null`); `setControl` reads `state.activity`.
- **Known limits of replay-equals-live**, written in `session-fold.ts`'s header comment:
  - the second-interrupt notice above;
  - the agent definitions: a live line read before the definitions load decodes without them, and a replay
    (task 08) loads them first;
  - order: the live fold order is the order the harness wrote and read; the log's is the order the host saw. An `in`
    and an `out` line that cross in transit can swap. Only fallback mode's turn end (it closes every open uuid) reads
    that order.

### Peer plan: auto-compact task 02

That task adds `compact()`, compaction tracking, a compaction grace timer and a compaction entry to this harness. The
two fit if both land:

- When 02 lands first, 05 moves its per-process state into `SessionFoldState`: the armed uuids with their triggers
  and `started` marks, the kept compaction, the compaction entry count, the after-size draft, and the compaction
  grace as a second deadline that `advanceFold` ends the same way. Its `deps.clock.now()` stamps and its `now − start`
  durations use the line's `at` (the grace's end uses its deadline). `compact()` writes its `/compact` under
  `appCommandUuid(...)`, and the fold arms an app-marked `/compact` with trigger `app` and a sent one with `manual`.
  02's test that asserts `userMessage({ text: '/compact', images: [] }, 'uuid-1')` changes to `'00000000-1'`.
  `INTERRUPT_GRACE_MS` is imported from `session-fold.ts`.
- When 05 lands first, 02's implementer adds that state and those rules to the fold, not to the harness closure.
- Either way, a conflict between a pinned decision here and landed code is reported as a concern (plan.md §
  Preconditions).

## GIVEN / WHEN / THEN

- GIVEN a live session WHEN its `in` and `out` lines, recorded with their times, are replayed THEN the replay's
  entries, agent events, controls and activity equal the live run's final ones.
- GIVEN a send line in lifecycle mode WHEN it is folded THEN `sendCount` is 1, the message is held, and no effect is
  given.
- GIVEN an app-marked `/effort high` line WHEN it is folded THEN no user entry is made and the tracker holds the
  uuid with the command `{ id: 'effort', value: 'high' }`.
- GIVEN an interrupt line at 1000 while working WHEN a line at 7000 is folded THEN the grace notice, stamped 6000,
  and `activity` `idle` come before that line's own effects.
- GIVEN a log that ends with an unanswered interrupt at 1000 WHEN it is replayed with `now` 60000 THEN the replay
  holds the grace notice at 6000 and ends with `activity` `idle`.
- GIVEN the same log WHEN it is replayed with `now` 3000 THEN no grace notice comes and `graceDeadline` is 6000.
- GIVEN a live process WHEN any existing harness test runs THEN it passes unchanged, except the one row named in
  Tests.

## Tests

`src/main/claude-code/session-fold.test.ts` (style of `turn-tracker.test.ts`; lines built with `userMessage`,
`controlMessage` and the fixtures in `claude-code-harness.test.ts`, copied or exported as the implementer prefers):

- `foldPipeLine_InLines_RebuildStdinState ($case)`, one `in` line on a fresh state from a request with
  `controls: {}`:
  | case | line | state after | effects |
  |---|---|---|---|
  | send | `userMessage({ text: 'hi', images: [] }, 'u1')` | `sendCount` 1, `heldMessages` keys `['u1']`, tracker `working` | none |
  | send with an image | content `[image block, text block 'see']` | held draft `text: 'see'`, `images: [{ mediaType: 'image/png', data: 'AAA' }]` | none |
  | app pick | `controlMessage('effort', 'high', '00000000-1')` | `sendCount` 0, no held message, tracker `working` | none |
  | typed command | `userMessage({ text: '/effort high', images: [] }, 'u2')` | `sendCount` 1, held draft text `/effort high`, skill null | none |
  | context request | `contextUsageRequest('wigley-4')` | `requestCount` 4, pending `wigley-4` `contextUsage` | none |
  | interrupt | interrupt request `wigley-2` at 1000 | pending `interrupt`, `graceDeadline` 6000, `noticeCount` 1 | entry `{ kind: 'notice', id: 'control-notice-1', at: 1000, text: 'Interrupted', tone: 'info' }` |
  | mode | `controlMessage('mode', 'plan', 'wigley-3')` | pending `{ kind: 'mode', value: 'plan' }` | none |
  | refusal | a `control_response` error line | unchanged | none |
  | not JSON | `oops` | unchanged | none |
- `foldPipeLine_FallbackSend_EmitsTheUserMessage`: `plainInit` (`out`), then a send `in` → effects entry `user-1`,
  then `agentEvent` `userMessage`.
- `foldPipeLine_StampsWithTheLineTime`: an `out` text delta at 7000, then the same entry's next delta at 9000 → both
  entry effects carry `at: 7000`; the agent events of the first line carry `at: 7000`.
- `foldPipeLine_LineAfterDeadline_EndsTheGraceFirst`: send, `lifecycleInit`, interrupt at 1000, then an `out` line at
  7000 → the effects open with the notice `Claude did not stop within 5 s; showing the session idle.` at 6000.
- `advanceFold_Grace ($case)`:
  | case | setup | `at` | effects | `graceDeadline` after |
  |---|---|---|---|---|
  | before the deadline | working, interrupt at 1000 | 5999 | none | 6000 |
  | at the deadline | the same | 6000 | notice at 6000, `log`, `activity` `idle` | null |
  | idle at the deadline | interrupt answered (`interruptReply(null)`) | 6000 | none | null |
- `replayPipeLog_Emissions_CollapsedAndFiltered`: a log with three deltas of one assistant entry, a
  `rate_limit_event` line, a `result` (so a `requestContextUsage` effect), and a host request line → the returned
  effects open with `sessionStarted` at the first line's `at`; that entry id comes once, with the last delta's text
  and the first delta's `at`; no `planUsage`, `requestContextUsage`, `refuseHostRequest` or `log` effect; the last
  three effects are `controls`, `commands`, `activity` `idle`.
- `replayPipeLog_GraceAcrossTheBoundary ($case)`: log = send, `lifecycleInit`, `lifecycle('u1', 'started')`,
  interrupt at 1000:
  | case | `now` | grace notice | final `activity` | `graceDeadline` |
  |---|---|---|---|---|
  | expired while away | 60000 | at 6000 | `idle` | null |
  | still pending | 3000 | none | `working` | 6000 |
- `replayPipeLog_EmptyLog_StartsAtNow`: `now` 4000 → `sessionStarted` at 4000, `controls`, `activity` `idle`.

`src/main/claude-code/claude-code-harness.test.ts`:

- `replayPipeLog_RecordedLiveSession_EqualsTheLiveRun` — the central test. A recorder wraps the fake child's
  `stdin.write` and the test's `writeLine` so each line joins one `PipeLine` list in call order, `at` the test
  clock's time; the test settles after every step. Script, the clock moving 1000 per step: start; the context reply
  `wigley-1`; send `hi`; `lifecycleInit`, `lifecycle('uuid-1', 'started')`, `REPLY_LINE`, `successResult('ok',
  ['uuid-1'])`; `setControl('mode', 'plan')` and its success response; `setControl('effort', 'high')` and its
  `Set effort level to high` result; send `two`, `lifecycleInit`, `lifecycle('uuid-3', 'started')`; `interrupt()`; a
  stderr line `warn`; advance the fake timers 5000. Then `replayPipeLog(createSessionFoldState(request), recorded,
  <the clock>)`. Assert: the replay's entries, by id in first-appearance order with their last versions, equal the
  live run's; its `agentEvent`s equal the live `agentEvents` and usage events in order; its final `controls` and
  `activity` equal the live run's last ones (mode `plan`, effort `high`, `idle`); the replayed state's `sendCount`
  is 2, `requestCount` equals the highest `wigley-<n>` the child read, `lastStderr` is `warn`, `graceDeadline` is
  null; the entry ids include `user-1`, `user-2`, `control-notice-1` and `control-notice-2`.
- Changed row: `setControl_Effort_SetsValueOnCommandResult` expects `controlMessage('effort', 'high', '00000000-1')`
  in `written`.
- `end_ThenClose_ClearsEveryTimer`: with fake timers, `interrupt()` while working, then `end()`, then `close` →
  `vi.getTimerCount()` is 0 (the grace timer and the end grace timers are cleared by `stopTimers`).
- Every other case in `describe('createClaudeCodeHarness', …)` passes unchanged. With `stream-decoder.test.ts`,
  `turn-tracker.test.ts` and `session-usage.test.ts` (unchanged files), they pin the live behaviour this task keeps.

## Done when

- The Produces signatures are in their files. `claude-code-harness.ts` holds no `createEntryStamp` call and no
  `INTERRUPT_GRACE_MS` definition. `grep -n "deps.spawn" src/main/claude-code/claude-code-harness.ts` finds
  `spawnDirect` and `spawnCli` only.
- `npm test`, `npm run typecheck` and `npm run lint` pass.
- Runtime checks wait for task 12 "Final verification".

## Commit

One commit for the group, by pathspec, the four files above. Example message: `Fold each Claude session's state over
its pipe lines; replay a pipe log with the same fold`. The message names the wire change: an effort or model pick's
uuid now starts `00000000-`.

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
