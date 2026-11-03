# 02 — Compaction contract and Claude adapter

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/stream-decoder.ts` ·
           modify `src/main/claude-code/claude-code-harness.ts` · modify `src/main/claude-code/turn-tracker.ts` ·
           modify `src/main/claude-code/transcripts.ts` · modify `src/plugins/agents/roster.ts` ·
           test `src/main/claude-code/stream-decoder.test.ts` · test `src/main/claude-code/claude-code-harness.test.ts` ·
           test `src/main/claude-code/turn-tracker.test.ts` · test `src/main/claude-code/transcripts.test.ts` ·
           test `src/plugins/agents/roster.test.ts`
Consumes:  claude-stream.md § Compaction ← 01: the subsections `Automatic compaction`, `Interrupt during /compact`,
           `A message during /compact`, `/compact with nothing to compact`, `Saved transcript lines`, and the
           "what task 02 does" table in [01](01-probe-claude-compaction.md). Existing members: `replyUsageOf` and
           `ReplyUsage.contextTokens` (`session-usage.ts`), `DecodedLine.replyUsage`, `userMessage`
           (`claude-controls.ts`), `INTERRUPT_GRACE_MS` (`claude-code-harness.ts`).
Produces:  in `src/contracts/agent.ts`, verbatim from plan.md § File Structure:
           `export type CompactionTrigger = 'app' | 'manual' | 'harness';`
           `AgentEvent` members `{ type: 'compactionStarted'; at: number; trigger: CompactionTrigger }` and
           `{ type: 'compactionEnded'; at: number; trigger: CompactionTrigger; outcome: 'done' | 'failed' | 'interrupted'; beforeTokens: number | null; durationMs: number | null }`;
           the member `{ type: 'compacted'; … }` removed
           `ChatEntry` member `{ kind: 'compaction'; id: string; at: number; trigger: CompactionTrigger; beforeTokens: number | null; afterTokens: number | null; durationMs: number | null; raw: unknown[] }`
           `AgentProcess` member `compact(): void;`
           in `src/main/claude-code/stream-decoder.ts`:
           `export type CompactionLine = { phase: 'started'; userMessageUuid: string | null } | { phase: 'done'; beforeTokens: number | null; durationMs: number | null; boundary: unknown } | { phase: 'failed' };`
           `DecodedLine` gains `compaction: CompactionLine | null;`
           in `src/main/claude-code/turn-tracker.ts`: `ControlCommand.id` becomes `'effort' | 'model' | 'compact'`
           in `src/main/claude-code/claude-code-harness.ts`: `compact()` on the process `startClaudeProcess` returns
           in `src/main/claude-code/transcripts.ts`: `transcriptEntries` returns `compaction` entries
Decisions: see below.

Read first: `AGENTS.md` (repo root), `docs/features/auto-compact/design.md`, and claude-stream.md § Compaction,
§ Interrupt, § Queued messages and § Message lifecycle (after task 01 changed § Compaction). Load
`wigley:writing-code` before the first edit.

## Decisions

### Contract (`src/contracts/agent.ts`)

- Use plan.md's shapes verbatim. Add a doc comment to each new member:
  - `CompactionTrigger`: `app` — the app called `AgentProcess.compact()`; `manual` — the user sent `/compact`;
    `harness` — the harness compacted on its own.
  - `compactionStarted`: a compaction started. Exactly one `compactionEnded` with the same trigger follows: on the
    harness's end line, on a failed compaction, on an interrupt (within the interrupt grace), and before
    `sessionEnded` when the process ends during it.
  - `compactionEnded`: `beforeTokens` is the context size when the compaction ran, null when the harness does not
    report it or the outcome is not `done`. `durationMs` is how long it ran, null when unknown.
  - the `compaction` entry: one per finished compaction (outcome `done`). `afterTokens` is null until the next main
    reply after the compaction; the adapter then sends the entry again with the same id and `afterTokens` set.
    A saved transcript's compaction reads back with trigger `manual` or `harness`, never `app`.
- Change the `AgentProcess` comment: "`send`, `interrupt`, `setControl` and `compact` throw after `end`." Add on
  `compact()`: it starts a compaction with trigger `app`; it makes no user entry; it throws while the process is not
  idle.
- Remove the `compacted` member and its comment. No producer or reader other than the files of this task uses it
  (grep at plan time: `agent.ts:263`, `stream-decoder.ts:586`, `roster.ts:128`, and two tests).

### Decoder (`stream-decoder.ts`)

- **The decoder reports what a line says. The harness owns the compaction's state and emits its events and its
  entry.** Reason: the trigger comes from what the harness wrote (the app's `compact()` or a typed `/compact`), and
  two of the four ends (the interrupt grace and the process end) come from the harness, not from a line. One owner
  keeps "one end per start" in one place. So the decoder emits no `compactionStarted` or `compactionEnded` draft,
  and `AgentEventDraft` needs no change.
- `DecodedLine.compaction`, null on every other line (`emptyLine` sets null):
  - `system/status` with `status: "compacting"` → `{ phase: 'started', userMessageUuid }`. `userMessageUuid` is the
    line's `user_message_uuid` when it is a string, else null. Every `compacting` status reports `started`; the
    harness ignores the repeats. The line still joins the turn's events entry, as today.
  - `system/compact_boundary` → `{ phase: 'done', beforeTokens, durationMs, boundary }`. `beforeTokens` is
    `numberOrNull(compact_metadata.pre_tokens)`, `durationMs` is `numberOrNull(compact_metadata.duration_ms)`,
    `boundary` is the line's event. The boundary gets no raw entry of its own any more: the harness's `compaction`
    entry holds it in `raw`.
  - `system/status` with `compact_result: "failed"` → `{ phase: 'failed' }`. The line joins the events entry. When
    the line has a non-empty string `compact_error`, the decoder also adds a notice entry
    `Compaction failed: <compact_error>`, tone `error`. (The binary's schema gives `compact_result` the values
    `success` and `failed`, and an optional `compact_error`.)
  - `system/status` with `compact_result: "success"` → null. The boundary carries the end.
  - A compaction line with a string `parent_tool_use_id` is a subagent's: `compaction` is null, and the line keeps
    today's entry.
- **The "Compacted" notice: drop it.** The divider now shows the compaction. A `<local-command-stdout>` user line
  that arrives after a `compact_boundary` and before the next `result` joins the turn's events entry instead of a
  notice. Use decoder state (a flag set at the boundary and cleared at the result), not the text `Compacted`. A
  local command output outside that window is a notice, as today.
- Update the decoder's comments: the `DecodedLine` comment names `compaction`; the comment at today's
  `compact_boundary` branch (lines 583–584) moves to the harness's after-size rule.

### Harness (`claude-code-harness.ts`)

- **`compact()`.** Call `requireRunning()` first (it throws `Claude Code process has ended`). Then, when
  `activity !== 'idle'`, throw `new Error('Claude is working; compact when the turn ends')`. Then write
  `userMessage({ text: '/compact', images: [] }, uuid)` with `uuid = deps.randomUuid()`, call
  `tracker.written(uuid, { id: 'compact', value: '' })`, arm the uuid with trigger `app`, and call `syncActivity()`.
  Make no user entry, no held message, no `userMessage` or `skillStarted` event. The method returns nothing.
- **The app's compact result.** The tracker returns the `compact` command at the command's turn end, so today's
  `isCommandResult` rule suppresses its `result` entry, as for `/effort` and `/model`. Skip the control update for
  `compact`: set a control only when `command.id !== 'compact'`.
- **A typed `/compact`.** In `send`, a text that matches `COMPACT_COMMAND = /^\/compact(\s|$)/` arms the uuid with
  trigger `manual`. Everything else in `send` stays: the user entry, `userMessage`, `skillStarted` with
  `skill: 'compact'`, and the `result` entry.
- **Arming.** Keep the armed uuids in write order, each with its trigger and whether its `started` lifecycle frame
  came. A `started` frame marks its uuid. A terminal lifecycle frame removes its uuid (see "Command ends with no
  compaction"). A compaction that takes an armed uuid removes it.
- **The trigger of a new compaction.** On a line with `compaction.phase === 'started'` (or `'done'` with no open
  compaction) the trigger is the first that applies:
  1. the armed uuid that equals `userMessageUuid`
  2. the armed uuid whose `started` frame came last
  3. when `tracker.mode() === 'fallback'`, the oldest armed uuid
  4. else `harness`
  The trigger rides on `compactionStarted`, `compactionEnded` and the entry. The boundary's `compact_metadata.trigger`
  does not change it. Reason: the app's compact is a `/compact` to Claude, so its metadata says `manual`.
- **The open compaction.** Keep at most one: its trigger, its start time (`deps.clock.now()` at its start), the uuid
  it took (null for `harness`), whether an interrupt was written since it started, and whether its end was sent.
  Start a new one only when none is kept. Drop the kept one on its closing line (the boundary, a `failed` line, or
  the end of the turn it waits on), even when its end was sent already.
- **The end, exactly once per start.** Send `compactionEnded` at the first of these, then never again for that
  compaction:
  | Cause | `outcome` | `beforeTokens` | `durationMs` |
  |---|---|---|---|
  | a `done` line | `done` | the line's `beforeTokens` | the line's `durationMs`, else now − start |
  | a `failed` line | `interrupted` when an interrupt was written since the start, else `failed` | null | now − start |
  | the command's turn ends with no boundary: a `result` whose `turnOpener` is the kept uuid, or a terminal lifecycle frame for it; for a `harness` compaction, any `result` that is not `turnUnrequested`; in fallback mode, any `result` | as the row above | null | now − start |
  | the compaction grace ends (below) | `interrupted` | null | now − start |
  | the process closes, in `emitEnded`, just before `sessionEnded` | `failed` | null | now − start |
- **A boundary with no start.** A `done` line with no kept compaction sends `compactionStarted` (trigger by the rule
  above), then the entry, then `compactionEnded` `done`, all at the line's time.
- **The compaction entry.** A `done` line sends `{ kind: 'compaction', id: 'compaction-<n>', trigger, beforeTokens,
  afterTokens: null, durationMs, raw: [boundary] }` through `emitEntry`, `n` counting from 1 per process. It sends the
  entry also when the compaction's end was sent already (the grace ended it): the compaction happened, and history
  shows it. It sends no entry for a `failed` or `interrupted` compaction.
- **The after-size.** Keep the last compaction entry's draft until its after-size is set. On the next decoded line
  with `replyUsage !== null` (a main model reply), send the same draft again with
  `afterTokens: replyUsage.contextTokens`, then forget it. This is the context size session-usage folds
  (`replyUsageOf`: input + cache read + cache creation + output). `createEntryStamp` keeps the entry's first `at`. A
  newer compaction entry replaces the kept draft; the older one keeps `afterTokens: null`. Reason: `post_tokens`
  leaves out the system prompt and tools (claude-stream.md § Compaction; design.md § Decisions).
- **Interrupt during a compaction.** When `interrupt()` writes the control request while a compaction is kept and
  its end is not sent, mark "interrupt written" and start a compaction grace timer of `INTERRUPT_GRACE_MS`. Push it
  into `timers`, so `markClosed` clears it. Keep it apart from `graceTimer`: `syncActivity` clears `graceTimer` on
  idle, and the interrupt reply can show idle while `/compact` still runs (the reply closes every open uuid when no
  turn is open: `turn-tracker.ts` `interruptAnswered`). When the timer fires and the end is not sent, send
  `compactionEnded` `interrupted`. Any earlier end clears the timer.
- **Interrupt, by task 01's reading of probe B.** The rules above cover both readings. Do not branch on the reading
  in code:
  - The interrupt stops `/compact`, and a `failed` status, the command's `result` or its terminal lifecycle frame
    follows: the compaction ends `interrupted` on that line, before the grace.
  - The interrupt does not stop `/compact`: the grace ends it `interrupted` at 5 s. The boundary that comes later
    sends the entry and its after-size, and no second `compactionEnded`.
  - The boundary comes within the grace: the compaction ends `done`. The user wanted the reply now, but the
    compaction finished, so `done` is the truth.
  Write in the harness's comment which reading probe B measured.
- **Command ends with no compaction.** When an armed uuid gets a terminal lifecycle frame while it is still armed
  (no compaction took it), send `compactionStarted` and then `compactionEnded` `failed` with `beforeTokens: null` and
  `durationMs: null`, with the uuid's trigger. In fallback mode, do the same for the oldest armed uuid on a `result`.
  Reason: chat holds a message until `compactionEnded` (task 05). A `/compact` that Claude refuses (probe E) must
  still release it.
- **Order.** Send the compaction events with the line's other agent events, after the line's entries, as
  `handleLine` does today. Stamp them with `deps.clock.now()` through `emitAgentEvent`.
- **Activity.** No change. The open uuid of `/compact` shows `working` from the write. A `harness` compaction runs
  inside a turn that shows `working` already.

### Turn tracker (`turn-tracker.ts`)

- `ControlCommand.id` becomes `'effort' | 'model' | 'compact'`. A `compact` command carries `value: ''`. No other
  change: the tracker returns a command the same way for every id.

### History (`transcripts.ts`)

- A saved `system` line with `subtype: "compact_boundary"` (not a sidechain line) becomes
  `{ kind: 'compaction', id: 'history:<uuid>', at, trigger, beforeTokens, afterTokens, durationMs, raw: [line] }`.
  The id takes `line-<n>` when the line has no `uuid`, as `systemEntries` does. Read the metadata key and field
  names that 01 records in `Saved transcript lines`. The binary's transcript schema uses `compactMetadata` with
  `trigger`, `preTokens` and `durationMs` (camelCase); the live stream uses `compact_metadata` with snake_case.
- `trigger`: `manual` → `manual`; any other value (the binary writes `auto`) → `harness`. The app's own compact reads
  back as `manual`, since the transcript cannot tell it from a typed `/compact`.
- `beforeTokens`: `preTokens` when a number, else null. `durationMs`: `durationMs` when a number, else null.
- `afterTokens`: the context of the first main reply after the boundary, by the rule `mainReplies` uses (an
  `assistant` line, not a sidechain, model not `SYNTHETIC_MODEL`, with `message.usage`), as
  `replyUsageOf(usage).contextTokens`. Null when no such reply follows before the next boundary or the file's end.
- When 01 records a `local_command` system line that the compaction writes (`Compacted`), it reads as nothing when a
  boundary came before it with no user or assistant entry between them. When 01 records none, make no change here.
- The summary `user` line (`isCompactSummary`) stays a raw entry (today's rule).
- Update the comment of `transcriptEntries` to name the compaction entry.

### Roster (`roster.ts`)

- Replace `case 'compacted':` with `case 'compactionStarted':` and `case 'compactionEnded':` in the no-op group. The
  roster shows no compaction (plan.md, out of scope).

### Consumers (compile breaks that later tasks fix)

`npm test` runs Vitest, which does not type-check, so the test gate passes after this task. `npm run typecheck`
(`tsc --noEmit`) fails until these tasks land. This is acceptable: the series lands together.

- `src/shared/fake-agent-harness.ts`: its process has no `compact()` → task 03.
- `src/plugins/chat/page/read-chat-layout.ts`: `KIND_SET: Record<ChatEntryKind, true>` lacks `compaction`, and
  `VariantFitsInput`, `CHAT_KINDS_ARE_LAYOUT_KINDS` fail until `layout.d.ts` `EntryKind` gains `compaction` → task 06.
- `src/plugins/chat/page/entry-list.ts` and `chat-layouts.ts`, where they index `layout.entries` by a
  `ChatEntryKind` → task 06.

After this task, run `npm run typecheck`. List every error file in the commit's proof. Report any error outside the
files above as a concern: it is a consumer this plan missed.

## GIVEN / WHEN / THEN

- GIVEN an idle process WHEN `compact()` runs THEN it writes `/compact` under a new uuid, emits no user entry, and
  the session shows `working`.
- GIVEN a running turn WHEN `compact()` runs THEN it throws `Claude is working; compact when the turn ends`.
- GIVEN an ended process WHEN `compact()` runs THEN it throws `Claude Code process has ended`.
- GIVEN `compact()`, a typed `/compact`, or neither WHEN a `compacting` status and a boundary arrive THEN
  `compactionStarted` and `compactionEnded` carry trigger `app`, `manual` or `harness`.
- GIVEN an open compaction WHEN more `compacting` statuses arrive THEN no second `compactionStarted` is sent.
- GIVEN an open compaction WHEN a failed status, the command's turn end, the grace, or the process close comes THEN
  exactly one `compactionEnded` is sent, with the outcome in the end table.
- GIVEN a compaction entry WHEN the next main reply arrives THEN the entry is sent again with the same id and
  `afterTokens` equal to that reply's context tokens.
- GIVEN the app's compact WHEN its `result` arrives THEN no `result` entry is sent; a typed `/compact` keeps its
  `result` entry.
- GIVEN a saved transcript with a boundary WHEN history is read THEN a `compaction` entry appears with trigger
  `manual` or `harness` and the after-size of the next main reply.

## Tests

Line fixtures for the harness tests (add them beside `lifecycleInit` in `claude-code-harness.test.ts`):
`compactingStatus = { type: 'system', subtype: 'status', status: 'compacting' }`;
`compactBoundary = { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 37559, post_tokens: 9023, duration_ms: 8303 } }`;
`compactFailed = { type: 'system', subtype: 'status', status: null, compact_result: 'failed', compact_error: 'Not enough messages to compact.' }`.
In `startedQuiet`, `randomUuid` gives `uuid-1` first, and the start's context request is `wigley-1`, so an interrupt
is `wigley-2`.

`src/main/claude-code/stream-decoder.test.ts`:
- Remove the rows `compaction` and `compaction without before size` from `decode_AgentEvents_$case`: the decoder
  emits no compaction agent event now.
- Add `decode_CompactionLines_ReportCompaction ($case)`, a table over one line each, asserting `compaction` and the
  entries' kinds:
  | case | line | `compaction` | entries |
  |---|---|---|---|
  | compacting status | status `compacting` | `{ phase: 'started', userMessageUuid: null }` | one `raw` `turn-events-1` |
  | compacting status with uuid | the same plus `user_message_uuid: 'u1'` | `{ phase: 'started', userMessageUuid: 'u1' }` | one `raw` |
  | boundary | `compactBoundary({ pre_tokens: 37559, post_tokens: 9023, duration_ms: 8303 })` | `{ phase: 'done', beforeTokens: 37559, durationMs: 8303, boundary: <the event> }` | none |
  | boundary without sizes | `compactBoundary({})` | `{ phase: 'done', beforeTokens: null, durationMs: null, … }` | none |
  | success status | `status: null, compact_result: 'success'` | null | one `raw` |
  | failed status | `status: null, compact_result: 'failed', compact_error: 'Not enough messages to compact.'` | `{ phase: 'failed' }` | `raw`, then notice `Compaction failed: Not enough messages to compact.` tone `error` |
  | failed status without error | `status: null, compact_result: 'failed'` | `{ phase: 'failed' }` | one `raw` |
  | a subagent's boundary | `compactBoundary({ pre_tokens: 1 })` with `parent_tool_use_id: 'a1'` | null | today's raw entry |
- Add `decode_LocalOutputAfterBoundary_GathersInsteadOfNotice ($case)`:
  | case | lines | last line's entries |
  |---|---|---|
  | after a boundary | boundary, then the user replay `<local-command-stdout>Compacted </local-command-stdout>` (`isReplay: true`) | one `raw` (gathered), no notice |
  | after the boundary turn's result | boundary, a `result`, then the same replay | notice `Compacted`, tone `info` |
- `decode_LocalCommandOutput_AddsNotice` stays as it is.

`src/main/claude-code/turn-tracker.test.ts`:
- Add a row to `read_TurnEnds_ReturnsTheCommandOfTheTurnItAnswers`: `lifecycle, opener with a compact command`,
  writes `[['c', { id: 'compact', value: '' }]]`, end `result('c', ['c'])` → `{ id: 'compact', value: '' }`.

`src/main/claude-code/claude-code-harness.test.ts`:
- `compact_WritesTheCommandWithNoUserEntry`: after `compact()` and `lifecycle('uuid-1', 'started')`, `written` ends
  with `userMessage({ text: '/compact', images: [] }, 'uuid-1')`; no `entry` of kind `user`; no `userMessage` or
  `skillStarted` event; the last activity is `working`.
- `compact_WhileATurnRuns_Throws`: after `send({ text: 'hi', images: [] })`, `compact()` throws
  `Claude is working; compact when the turn ends`.
- Add to `kill_SendsSigtermAtOnceAndEndsClean`: `compact()` after the close throws `Claude Code process has ended`.
- `compaction_Trigger_FromWhatStartedIt ($name)`: each row does its action, then writes
  `lifecycle('uuid-1', 'started')`, `compactingStatus`, `compactBoundary`. The compaction events are
  `[{ type: 'compactionStarted', at: 1000, trigger }, { type: 'compactionEnded', at: 1000, trigger, outcome: 'done', beforeTokens: 37559, durationMs: 8303 }]`.
  | name | action | trigger |
  |---|---|---|
  | app | `compact()` | `app` |
  | typed | `send` `/compact` | `manual` |
  | typed with instructions | `send` `/compact keep the plan` | `manual` |
  | a model turn | `send` `hi`, then `lifecycleInit` before the status | `harness` |
  | a longer command name | `send` `/compactor` | `harness` |
  | status names the uuid | `compact()`, with `user_message_uuid: 'uuid-1'` on the status and no `started` frame | `app` |
- `compaction_EndsOncePerStart ($name)`, with the clock `{ now: () => at }`, `at` 1000 at the start line and 4000
  after it:
  | name | lines after the start | compaction events after the start |
  |---|---|---|
  | repeated statuses | `compactingStatus` ×2, `compactBoundary` | one `compactionEnded` `done`, `durationMs: 8303` |
  | failed status | `compactFailed` | `compactionEnded` `failed`, `beforeTokens: null`, `durationMs: 3000` |
  | the command's result | an error `result` with `user_message_uuid: 'uuid-1'` | `compactionEnded` `failed`, `durationMs: 3000` |
  | process closes | `close` with code 0 | `compactionEnded` `failed`, then `sessionEnded` (timeline order) |
  Start each row with `compact()`, `lifecycle('uuid-1', 'started')`, `compactingStatus`.
- `compaction_BoundaryWithNoStart_StartsAndEnds`: `send` `hi`, `lifecycleInit`, `compactBoundary` → events
  `compactionStarted` `harness` then `compactionEnded` `done`, both `at: 1000`.
- `compaction_CommandEndsWithoutCompacting_StartsAndFails`: `compact()`, `lifecycle('uuid-1', 'started')`, an error
  `result` with `user_message_uuid: 'uuid-1'`, `lifecycle('uuid-1', 'completed')` → `compactionStarted` `app`, then
  `compactionEnded` `app` `failed`, `beforeTokens: null`, `durationMs: null`. Write the lines in the order probe E
  measured.
- `compaction_Boundary_EmitsEntryThenItsAfterSize`: `compact()`, `started`, `compactingStatus`, `compactBoundary`
  → entry `{ kind: 'compaction', id: 'compaction-1', at: 1000, trigger: 'app', beforeTokens: 37559, afterTokens: null, durationMs: 8303, raw: [compactBoundary] }`.
  Then, with the clock at 2000, a main `assistant` line with `usage`
  `{ input_tokens: 2, cache_creation_input_tokens: 909, cache_read_input_tokens: 38019, output_tokens: 5 }` → the
  same entry with `afterTokens: 38935` and `at: 1000`. A second main reply sends no further compaction entry.
- `compaction_AppResult_ShowsNoResultEntry ($name)`: rows `app` (`compact()`) → no `result` entry; `typed`
  (`send` `/compact`) → one `result` entry. Lines: `started`, `compactingStatus`, `compactBoundary`, a success
  `result` with `user_message_uuid: 'uuid-1'` and `local_command: 'compact'`, `lifecycle('uuid-1', 'completed')`.
- `compaction_Interrupted_EndsOnceWithinTheGrace ($name)`, with `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`.
  Each row does `compact()`, `started`, `compactingStatus`, `interrupt()`, then its steps:
  | name | steps | `compactionEnded` events |
  |---|---|---|
  | no line within the grace | advance 5000 | one, `interrupted` |
  | just before the grace | advance 4999 | none |
  | the reply idles the session | `interruptReply(null)` (request `wigley-2`), advance 5000 | one, `interrupted` |
  | the boundary within the grace | `compactBoundary`, advance 5000 | one, `done` |
  | the boundary after the grace | advance 5000, `compactBoundary` | one, `interrupted`; the `compaction` entry is still sent |
  | the command's result within the grace | an error `result` with `user_message_uuid: 'uuid-1'`, advance 5000 | one, `interrupted` |
  | a failed status within the grace | `compactFailed`, advance 5000 | one, `interrupted` |
- Add a row to `send_SlashText_EmitsSkillStarted`: `compact command`, text `/compact` → `userMessage`, then
  `skillStarted` with `skill: 'compact'`, `args: ''`. It pins the plan's decision that a typed `/compact` keeps both.

`src/main/claude-code/transcripts.test.ts`:
- `transcriptEntries_CompactBoundary_CompactionEntry ($name)`. Build the boundary line with the field names 01
  recorded (expected: `{ type: 'system', subtype: 'compact_boundary', uuid: 'b1', timestamp, compactMetadata: { trigger, preTokens: 37559, postTokens: 9023, durationMs: 8303 } }`):
  | name | lines | compaction entry |
  |---|---|---|
  | manual, a reply after | boundary (`manual`), a main reply with usage summing to 38935 | `{ kind: 'compaction', id: 'history:b1', trigger: 'manual', beforeTokens: 37559, afterTokens: 38935, durationMs: 8303, raw: [boundary] }` |
  | auto | boundary (`auto`), no reply | `trigger: 'harness'`, `afterTokens: null` |
  | a sidechain and a synthetic reply first | boundary, a sidechain reply, a `SYNTHETIC_MODEL` reply, a main reply | `afterTokens` from the main reply |
  | a second boundary first | boundary b1, boundary b2, a main reply | b1 `afterTokens: null`; b2 `afterTokens` from the reply |
  | no metadata sizes | boundary with `compactMetadata: { trigger: 'manual' }` | `beforeTokens: null`, `durationMs: null` |
  | a sidechain boundary | boundary with `isSidechain: true` | no entry |
- Only when 01 records a `local_command` `Compacted` line: `transcriptEntries_CompactedOutputAfterBoundary_NoNotice`.
  Lines: boundary, the `local_command` line → no notice. The test `transcriptEntries_LocalCommand_AddsNotice` stays.

`src/plugins/agents/roster.test.ts`:
- In `foldAgentEvent_Event_FoldsRoster ($case)`, replace the row `Compacted` with two rows, each `same: true`:
  `CompactionStarted` `{ type: 'compactionStarted', at: 7000, trigger: 'app' }` and `CompactionEnded`
  `{ type: 'compactionEnded', at: 7000, trigger: 'harness', outcome: 'done', beforeTokens: 150_000, durationMs: 9000 }`.

## Done when

- The `Produces` signatures are in their files. `compacted` appears nowhere in `src`
  (`grep -rn "compacted" src` finds only prose that is not the event type).
- `npm test` passes, with the tests above.
- `npm run typecheck` errors are only in the Consumers files above; the proof lists them.
- `npm run lint` passes for the files of this task.
- Runtime checks (a real `/compact` and an autocompact in the app, the divider, the dock) wait for task 09
  "Final verification".

## Commit

One commit for the group, by pathspec, the 11 files above. Example message:
`Add compaction events and entry to the agent contract; Claude adapter decodes compaction, implements compact()`.
The commit message notes that `npm run typecheck` fails until tasks 03 and 06 land.

## Addendum (round 3): one threshold for Claude's idle compaction

The user chose to pass the app's threshold to Claude's own idle compaction, so both use one rule.

Files:     also modify `src/main/claude-code/claude-launch.ts` and its test.
Produces:  `AgentStart.idleCompactMinTokens: number | null` in `src/contracts/agent.ts`. Doc comment: the context
           size above which the harness may compact an idle session on its own; null leaves the harness's default.
Decisions:
- `claudeEnv` (or the launch step that builds the child's env from the request) removes any inherited
  `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`, then sets it to `String(request.idleCompactMinTokens)` when that is not null.
  Add the name beside `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` in the stripped list.
- Update every `AgentStart` literal in `src/main/claude-code/` and `src/shared/` tests with `idleCompactMinTokens: null`.
  Chat main's literal is task 05's.
- Claude's idle compaction reaches the app as trigger `harness`, like autocompact (task 01, probe F).
GIVEN a start request with `idleCompactMinTokens: 150000` and an inherited `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS=300000`
WHEN the launch builds the env THEN the child gets `150000`.
GIVEN `idleCompactMinTokens: null` and the same inherited value WHEN the launch builds the env THEN the child has no
`CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`.
Tests:     two rows in the launch test that owns the stripped-variable rule (find it beside `claude-launch.ts`), each
           asserting the child env's `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` (`'150000'`, then absent).

## Cold read fixes

These override any earlier line of this task that they contradict.

- **Interrupt before the first status.** When `interrupt()` runs while an `app` or `manual` uuid is armed and no
  compaction has taken it, the harness arms the 5 s compaction grace for that uuid. At grace expiry with still no
  compaction, it sends `compactionStarted` then `compactionEnded interrupted` for it. Reason: chat releases a held row
  only on `compactionEnded`, and a ⌃C right after `compact()` is the common skip.
- **Stale state.** Wherever the tracker closes uuids (`abandon`, `interruptAnswered` with no turn open, the grace's
  expiry) the harness also clears its armed uuids and any kept compaction whose end was already sent. A grace-ended
  compaction waits only for its boundary entry; it never blocks a new start, and a `compacting` status that arrives
  after its end was sent starts a new compaction.
- **Harness end.** Any `result` ends an open `harness` compaction as `failed` when no boundary came, including a
  `turnUnrequested` result. Turns are serial, so the result closes the turn the compaction began in; a stuck dock is
  worse than an early `failed`.
- **The failed notice stays.** The decoder's `Compaction failed: <compact_error>` notice shows on every failed
  `compact_result`, after an interrupt too: the decoder stays stateless. When task 01's probe B shows a distinct
  interrupt text, 01's table gets a row that drops the notice for that text.
- **Env placement.** A separate `const` list beside `NESTED_SESSION_ENV`, with its own comment (the variable is the
  app's setting, not a parent session's), holds `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`. `claudeEnv` strips it, so
  `spawnCli` never passes a stale value; `claudeLaunch` sets it after `claudeEnv` when `idleCompactMinTokens` is not
  null. With null the user's own value is dropped too. Update `NESTED_SESSION_ENV`'s comment so it no longer says
  every other `CLAUDE_CODE_*` name passes through, and `claude-stream.md` § Launch if it lists env handling.
- **Rows added** (one each, events listed in the row): fallback trigger rule 3 (oldest armed uuid); the fallback end
  on any `result`; the fallback no-compaction start-and-fail on a `result`; a `harness` end on a bare `result`; a
  `harness` end on a `turnUnrequested` result; the end by a terminal lifecycle frame; a typed `/compact` refused with
  no compaction; `compact(), interrupt()`, no lines, advance 5000 → `compactionStarted app` then `compactionEnded
  interrupted`; a stale armed uuid after `abandon`, then a harness `compacting` status → trigger `harness`; a second
  `compacting` status after a grace-ended compaction → a new `compactionStarted`.

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
