# 06 — Claude Code adapter

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 05
Plan: [plan.md](plan.md)

Files:     create `src/main/claude-code/claude-code-harness.ts` · `src/main/claude-code/claude-launch.ts` ·
           `src/main/claude-code/stream-decoder.ts` · `src/main/claude-code/claude-controls.ts` ·
           `src/main/claude-code/tool-summary.ts`
           test `src/main/claude-code/claude-code-harness.test.ts` · `src/main/claude-code/claude-launch.test.ts` ·
           `src/main/claude-code/stream-decoder.test.ts` · `src/main/claude-code/claude-controls.test.ts` ·
           `src/main/claude-code/tool-summary.test.ts`
           modify `src/main/main.ts`
Consumes:  `docs/features/agent-chat/claude-stream.md` and its sections ← 01 ·
           `AgentHarness`, `AgentProcess`, `AgentProcessEvents`, `AgentStart`, `ChatEntry`, `SessionControl`,
           `ControlChoice`, `ProcessActivity` in `src/contracts/agent.ts` ← 05 ·
           `MainServices.agentHarnesses: readonly AgentHarness[]` and main.ts's `agentHarnesses` list ← 05 ·
           `Settings.claude: { command: string }` / `defaultSettings.claude` ← 05 ·
           `expandHome(value: string, homeDir: string): string` in `src/shared/expand-home.ts` ← 05 ·
           `'src/main/claude-code'` layer in `scripts/check-layers.mts` ← 05 · `Log` in `src/contracts/log.ts` (tree)
Produces:  `export type ClaudeSpawn = (command: string, args: readonly string[], options: { cwd: string; env:
           NodeJS.ProcessEnv }) => ChildProcessWithoutNullStreams` in `claude-code-harness.ts`
           `export interface ClaudeCodeHarnessDeps { command: string; permissionTool: string; env: NodeJS.ProcessEnv;
           log: Log; spawn: ClaudeSpawn }` in `claude-code-harness.ts`
           `export function createClaudeCodeHarness(deps: ClaudeCodeHarnessDeps): AgentHarness` in
           `claude-code-harness.ts`
           `export interface ClaudeLaunch { args: string[]; cwd: string; env: NodeJS.ProcessEnv }` and
           `export function claudeLaunch(request: AgentStart, permissionTool: string, env: NodeJS.ProcessEnv):
           ClaudeLaunch` in `claude-launch.ts`
           `export interface DecodedLine { entries: ChatEntry[]; reported: Partial<Record<ClaudeControlId, string>>;
           commands: string[] | null; turnEnded: boolean; controlResponse: { requestId: string; error: string | null }
           | null; hostRequest: { requestId: string; subtype: string } | null }`,
           `export interface StreamDecoder { decode(line: string): DecodedLine }` and
           `export function createStreamDecoder(): StreamDecoder` in `stream-decoder.ts`
           `export type ClaudeControlId = 'mode' | 'effort' | 'model'`,
           `export const CLAUDE_CONTROLS: readonly { id: ClaudeControlId; label: string; choices: ControlChoice[] }[]`,
           `export function controlValue(id: ClaudeControlId, reported: string): string`,
           `export function userMessage(text: string): object` and
           `export function controlMessage(id: ClaudeControlId, value: string, requestId: string): object` in
           `claude-controls.ts`
           `export const TOOL_SUMMARY_LENGTH = 80;` and `export function toolSummary(name: string, input: unknown):
           string` in `tool-summary.ts`
           (all internal to `src/main/claude-code/`; only `createClaudeCodeHarness` leaves it, through main.ts)
Decisions: the installed CLI in stream-json mode, one process per session, no new package (round 3) · auto mode with
           what it would still prompt sent to chat's `permission_prompt` tool (rounds 2, 3) · controls `mode`,
           `effort`, `model` declared by the adapter (round 2 note; design review) · entries carry the raw events
           (round 1 note, round 2) · replies stream (round 1) · `node:child_process` for `claude` only here (plan.md
           Boundary rules) · where `claude-stream.md` records a fact this task names its section and pins what the
           code does whatever the fact turns out to be; a recorded fact that contradicts a pinned shape below is
           applied as recorded and logged under Rulings in plan.md's Run log
Approach:  `stream-decoder.ts` is the deep module: every Claude JSON shape is read there and nowhere else, and it is
           pure (a line in, a `DecodedLine` out), so its tests build lines shaped after `claude-stream.md`'s excerpts.
           `claude-code-harness.ts` is the thin process wrapper over it: spawn, stdin writes, stderr, exit, timers.

## Launch (`claude-launch.ts`)

- `args`, in this order: `-p`, `--input-format`, `stream-json`, `--output-format`, `stream-json`,
  `--include-partial-messages`, `--verbose`, then `--session-id <sessionId>` when `resume` is false or `--resume
  <sessionId>` when true, then `--permission-mode`, `auto`, `--permission-prompt-tool`, `<permissionTool>`. When
  `claude-stream.md § Launch` records `--verbose` as not needed for stream-json output, it stays (it changes no line
  the decoder reads).
- `cwd`: `request.projectDir`.
- `env`: a copy of the `env` passed in (main passes `process.env`); `CLAUDE_CONFIG_DIR` set to `request.profileDir`
  when that is non-null, and the inherited value (or its absence) kept when null.

## Controls (`claude-controls.ts`)

Ids, labels and choices, in this order (from `claude --help` 2.1.304; `claude-stream.md § Choices` confirms):

- `mode`, `Mode`: `auto` Auto · `acceptEdits` Accept edits · `manual` Manual · `plan` Plan · `dontAsk` Don't ask.
  `bypassPermissions` is left out: it needs `--allow-dangerously-skip-permissions` at launch. A mode `§ Choices`
  records as refused mid-session is left out too.
- `effort`, `Effort`: `low` Low · `medium` Medium · `high` High · `xhigh` Extra high · `max` Max.
- `model`, `Model`: `opus` Opus · `sonnet` Sonnet · `haiku` Haiku · `fable` Fable (the aliases `--model` help names,
  plus `haiku`; `§ Choices` may add or drop an alias).

`controlValue(id, reported)`: for `model`, the first choice whose value appears in `reported` lowercased (`claude-opus-5-5[1m]`
→ `opus`), else `reported` as is; for `mode` and `effort`, `reported` as is.

`userMessage(text)`: the stdin user message per `§ User message` — `{ type: 'user', message: { role: 'user',
content: text }, parent_tool_use_id: null }`, content as a block array `[{ type: 'text', text }]` instead when
`§ User message` records a plain string refused.

`controlMessage(id, value, requestId)`:
- `mode`: `{ type: 'control_request', request_id: requestId, request: { subtype: <the subtype § Mode change records,
  set_permission_mode expected>, mode: value } }`
- `effort`: `userMessage('/effort <value>')`
- `model`: `userMessage('/model <value>')` (by slash command, as design.md names it; a `set_model` control request
  replaces it only when `§ Model` records the slash command not taking effect mid-session)

## Decoding (`stream-decoder.ts`)

One decoder per process; it keeps the entries it built (by id) so a later line replaces them. Every entry it
returns is a whole entry: an entry sent again with the same id replaces the earlier one. Shapes named below are the
ones `claude-stream.md` records in the section given.

- Blank line → empty `DecodedLine`. A line that is not JSON, or JSON whose `type` the rules below do not name → one
  `raw` entry `raw-<k>` (`k` counts the decoder's raw entries from 1) whose `raw` is `[line]` for unparsable text and
  `[event]` for parsed JSON.
- `system`/`init` (`§ Init`): no entry; `commands` = `slash_commands` then `skills`, each without a leading `/`,
  duplicates dropped, first kept; `reported.mode` = `permissionMode`; `reported.model` = `model`; `reported.effort`
  = the field `§ Effort` names, absent when none carries it. When init arrives only at the first message, the
  controls keep value null until then (the harness emits them at start with null values).
- Other `system` subtypes: an event `§ Mode change` / `§ Effort` / `§ Model` records as reporting a new value sets
  that `reported` field and adds no entry; every other one → a `raw` entry.
- `stream_event` (`§ Stream events`), keyed by `parent_tool_use_id` (null for the main conversation) so subagent
  streams never mix with the main one: `message_start` notes the current message id; `content_block_start` of type
  `text` / `thinking` adds an entry `text-<messageId>-<index>` / `thinking-<messageId>-<index>` (`kind`
  `assistant` / `thinking`, empty text, `streaming: true`, `raw: [the start event]`); `text_delta` / `thinking_delta`
  appends to that entry's text and returns it (the deltas are not kept in `raw`: their content is the text);
  `content_block_stop` returns it with `streaming: false`. `message_delta`, `message_stop`, `ping`, tool-use starts
  and `input_json_delta` return nothing.
- `assistant` (`§ Assistant messages`), for each content block in order: `text` / `thinking` → the entry of the same
  message id and kind whose text equals the block's text gets `streaming: false` and the event appended to its `raw`;
  with no such entry, a new one `text-<messageId>-f<position>` / `thinking-<messageId>-f<position>` (position in the
  event's `content`), `streaming: false`, `raw: [event]`. `tool_use` → entry `tool-<block.id>`: `toolUseId` the block
  id, `name`, `input`, `summary: toolSummary(name, input)`, `result: null`, `raw: [event]`.
- `user` (`§ Tool results`): each `tool_result` block → the tool entry with that `toolUseId` gets `result: { text,
  isError: block.is_error === true }` (`text` the string content, or the text blocks' texts joined by `\n` with any
  other block written `[<type>]`) and the event appended to `raw`; a `tool_use_id` with no tool entry → a `raw`
  entry. A `user` event with text content and no `tool_result` (`§ Slash commands`, `§ Effort`) → a `notice` entry
  `notice-<k>`, tone `info`, text with `<local-command-stdout>` / `</local-command-stdout>` removed and trimmed; empty
  after that → a `raw` entry. An echo of a message the app sent (`§ User message`) → no entry.
- `result` (`§ Result`): `turnEnded: true`; when `is_error` is true and `result` is a non-empty string, first a
  `notice` `notice-<k>` tone `error` with that text; then a `result` entry `result-<k>`: `stopReason` =
  `stop_reason` when a string, else `subtype`; `costUsd` = `total_cost_usd` when a number, else null; `durationMs` =
  `duration_ms` when a number, else null; `raw: [event]`.
- `control_response` (`§ Mode change`): `controlResponse` = `{ requestId, error }`, `error` null on success and the
  error text on an error subtype; no entry.
- `control_request` from Claude: `hostRequest` = `{ requestId, subtype }` and a `raw` entry; the harness refuses it.
- Events with a non-null `parent_tool_use_id` decode by the same rules (plan A draws no nesting).

## Tool summary (`tool-summary.ts`)

`toolSummary(name, input)`: `Bash` → the first line of `input.command`; `Read`, `Edit`, `Write`, `MultiEdit` →
`input.file_path`; `NotebookEdit` → `input.notebook_path`; `Grep`, `Glob` → `input.pattern`; `WebFetch` →
`input.url`; `WebSearch` → `input.query`; `Task`, `Agent` → `input.description`; any other name, or a named field
that is missing or not a string → the first string-valued field of `input` in key order; none → `''`. A summary
longer than `TOOL_SUMMARY_LENGTH` (80) characters is its first 79 characters plus `…`.

## Process (`claude-code-harness.ts`)

- `id`: `'claude'`.
- `start(request, events)`: spawns `deps.command` with `claudeLaunch(request, deps.permissionTool, deps.env)`;
  reads stdout and stderr line by line (`node:readline`). In a microtask after `start` returns it emits `controls`
  (the three controls, value null) and `activity('idle')`. Each stdout line goes through the decoder: `entries` →
  `events.entry` in order; `reported` → the controls' values set through `controlValue`, `events.controls` emitted
  when any value changed; `commands` → `events.commands`; `turnEnded` → `activity('idle')`; `hostRequest` → writes a
  `control_response` with subtype `error`, the request id and the error `wigley-ai-gui answers no <subtype>
  requests` (envelope per `§ Mode change`).
- Each stderr line → `deps.log('claude', line)`; the last one is kept for the exit error. A stdin stream error is
  logged the same way and not thrown (the exit follows).
- `send(text)`: writes `userMessage(text)` as one JSON line; emits `entry({ kind: 'user', id: 'user-<n>', text, raw:
  [the message object] })` (`n` counting sends from 1; the adapter, not chat, emits it — plan.md § Who emits what)
  and `activity('working')`. A text matching `^/(effort|model)
  (\S+)$` is also a control command (below), with its user entry shown.
- `setControl(id, value)`: an id not in `CLAUDE_CONTROLS` throws `Claude Code has no control <id>`; a value not among
  that control's choices throws `Claude Code control <id> has no choice <value>`. `mode` writes
  `controlMessage('mode', value, 'wigley-<k>')` (`k` counting the process's control requests from 1); on the
  matching `controlResponse` with no error the mode's value becomes `value` and `controls` is emitted; with an error,
  a `notice` entry `control-notice-<k>` tone `error`, text `Could not set Mode to <value>: <error>`. `effort` and `model` while activity is
  `working` throw `Claude is working; change <label> when the turn ends`; otherwise they write `controlMessage`,
  emit `activity('working')`, and the turn they start is a control command: its `result` entry is not emitted, a
  result with `is_error` false sets the control's value to `controlValue(id, value)` (unless a line already reported
  it), and an error result's notice is emitted. When `§ Effort` / `§ Model` record that the command prints no
  `result`, the value is set and nothing marks the activity working.
- `interrupt()`: no-op unless activity is `working`. Otherwise it interrupts by the route `§ Interrupt` records as
  ending the turn and leaving the process usable — the `control_request` with subtype `interrupt` (request id
  `wigley-<k>`) when both work, SIGINT when only it works — and emits a `notice` `control-notice-<k>` tone `info` text
  `Interrupted`. The harness's own notices (this one, the mode-set error) use ids `control-notice-<k>`, `k` counting
  the harness's notices from 1, separate from the decoder's `notice-<k>`. The turn's `result` brings `idle`; when `§ Interrupt` records no `result` after an interrupt,
  `idle` is emitted on the interrupt's `control_response` (or at once after SIGINT).
- Exit: on the child's `close` event (stdio drained; same code and signal as `exit`), never `exit`, `activity('idle')` first when working, then `ended({ code, error })` once: `error`
  null when the code is 0 or `end()` was called; otherwise `claude exited with code <code>: <last stderr line>` (`with
  signal <signal>` when the code is null; `: <last stderr line>` left out when there was none). On the child's
  `error` (spawn failure), `ended({ code: null, error })` once with `claude was not found at <command>; set
  claude.command` for `ENOENT` and the error's message otherwise.
- `end()`: resolves on the child's `close` event (at once when it already has closed). It ends stdin; 3000 ms later, with the
  child still running, it sends `SIGTERM`; 3000 ms after that, `SIGKILL`. Both timers clear on `close`. After `end()`
  is called, or after `close`, `send`, `setControl` and `interrupt` throw `Claude Code process has ended`.

## main.ts

One change in the `agentHarnesses` list task 05 wrote: outside the self-test it holds `createClaudeCodeHarness({
command: expandHome(defaultSettings.claude.command, inputs.homeDir), permissionTool:
'mcp__plugin_wigley_wigley-forms__permission_prompt', env: process.env, log, spawn })`, `spawn` from
`node:child_process` (main.ts may import `node:`). The self-test keeps `[createFakeAgentHarness()]` alone. The tool
name is the one `claude-stream.md § Permission tool` confirms; a different confirmed name is used instead and the
run log says so.

## Behaviour and tests

GIVEN a fresh request (`resume: false`, `profileDir: '/p'`) WHEN `claudeLaunch` runs THEN args are the pinned list with `--session-id <id>`, cwd is `projectDir`, and `env.CLAUDE_CONFIG_DIR` is `/p`
GIVEN `resume: true` and `profileDir: null` with an inherited `CLAUDE_CONFIG_DIR=/x` WHEN `claudeLaunch` runs THEN args carry `--resume <id>` and no `--session-id`, and `env.CLAUDE_CONFIG_DIR` is `/x`
GIVEN an init line with `permissionMode: 'auto'`, `model: 'claude-opus-5-5[1m]'`, `slash_commands: ['/compact', 'model']`, `skills: ['wigley:feature', 'compact']` WHEN decoded THEN `commands` is `['compact', 'model', 'wigley:feature']`, `reported` holds mode `auto` and model `claude-opus-5-5[1m]`, and no entry
GIVEN message_start `m1`, a text block start at index 0, deltas `Hel` and `lo`, block stop WHEN decoded line by line THEN entry `text-m1-0` is returned as `''` streaming, `Hel`, `Hello`, then `Hello` with `streaming: false`
GIVEN that stream followed by an assistant event for `m1` with text `Hello` WHEN decoded THEN `text-m1-0` returns with two raw events (start, assistant) and no new entry
GIVEN an assistant event with a `tool_use` block `t1`, `Bash`, `{ command: 'ls -la\necho' }` WHEN decoded THEN entry `tool-t1` has summary `ls -la` and result null
GIVEN that tool entry and a user event with `tool_result` for `t1`, content `[{ type: 'text', text: 'a' }, { type: 'image' }]`, `is_error: true` WHEN decoded THEN `tool-t1` has result `{ text: 'a\n[image]', isError: true }`
GIVEN a result line `{ subtype: 'success', stop_reason: 'end_turn', total_cost_usd: 0.01, duration_ms: 1200 }` WHEN decoded THEN a result entry with those values and `turnEnded` true
GIVEN a result with `is_error: true`, `result: 'boom'`, no `stop_reason`, subtype `error_during_execution` WHEN decoded THEN a notice `boom` tone error, then a result entry with stopReason `error_during_execution`, costUsd null
GIVEN the line `not json` WHEN decoded THEN one raw entry `raw-1` with raw `['not json']`
GIVEN a user event with text `<local-command-stdout>Set effort to high</local-command-stdout>` WHEN decoded THEN a notice `Set effort to high` tone info
GIVEN `controlValue('model', 'claude-sonnet-5')` and `controlValue('model', 'custom-x')` WHEN run THEN `sonnet` and `custom-x`
GIVEN a Bash input whose command is 100 characters on one line WHEN summarised THEN the summary is 80 characters ending in `…`
GIVEN a started process over a fake child WHEN `send('hi')` runs THEN stdin got one JSON line equal to `userMessage('hi')` and events are user `hi` then `working`
GIVEN a started process WHEN `setControl('mode', 'plan')` runs and a success control_response for `wigley-1` arrives THEN stdin got `controlMessage('mode', 'plan', 'wigley-1')` and controls report mode `plan`
GIVEN a working process WHEN `setControl('effort', 'high')` runs THEN it throws `Claude is working; change Effort when the turn ends`
GIVEN a started process WHEN the child writes `oops` to stderr and exits with code 1 THEN log got `('claude', 'oops')` and `ended({ code: 1, error: 'claude exited with code 1: oops' })`
GIVEN a spawn whose child emits an `ENOENT` error WHEN started THEN `ended({ code: null, error: 'claude was not found at /bin/claude; set claude.command' })`
GIVEN a started process whose child ignores stdin's end WHEN `end()` runs and fake time passes 3000 ms then 3000 ms THEN stdin ended, then `SIGTERM`, then `SIGKILL`, and `end()` resolves on `close` with `ended({ code: null, error: null })`

Tests:     `claude-launch.test.ts`: `claudeLaunch_NewSession_PinnedArgsAndProfileEnv`,
           `claudeLaunch_Resume_ResumeFlagAndInheritedConfigDir` — the exact arrays and env values above
           `stream-decoder.test.ts`: `decode_Init_ReportsCommandsAndControls`, `decode_TextStream_UpdatesOneEntry`,
           `decode_AssistantAfterStream_AddsRawToStreamedEntry`, `decode_ToolUse_AddsToolEntryWithSummary`,
           `decode_ToolResult_PairsByToolUseId`, `decode_Result_AddsResultEntry`,
           `decode_ErrorResult_AddsNoticeThenResult`, `decode_NotJson_AddsRawEntry`,
           `decode_LocalCommandOutput_AddsNotice`, `decode_ControlResponse_ReportsRequestOutcome` (`{ requestId:
           'wigley-1', error: null }` and an error case with its text) — the values above, each line built in the
           test after `claude-stream.md`'s excerpts
           `claude-controls.test.ts`: `controlValue_Model_MapsFullNameToAlias`,
           `controlMessage_Mode_IsControlRequest`, `controlMessage_Effort_IsSlashCommand` — `/effort high` as user
           message content
           `tool-summary.test.ts`: `toolSummary_Bash_FirstLineOfCommand`, `toolSummary_FileTools_FilePath`,
           `toolSummary_UnknownTool_FirstStringField`, `toolSummary_Long_TruncatedTo80`
           `claude-code-harness.test.ts` (a fake child: `PassThrough` stdin/stdout/stderr, an `EventEmitter` for
           `close`/`error` (the fake child emits `close`, not `exit`), `kill` recording its signals; `vi.useFakeTimers()` for `end`):
           `send_WritesUserMessageAndEmitsWorking`, `setControl_Mode_WritesRequestAndReportsOnResponse`,
           `setControl_EffortWhileWorking_Throws`, `stderrAndExit_LogsAndEnds`,
           `interrupt_AfterErrorResult_UsesDistinctNoticeIds` (an error result line, then `interrupt()` while working:
           the decoder's `notice-1` and the harness's `control-notice-1` are two distinct ids), `spawnNotFound_EndsWithHint`,
           `end_EscalatesToSigtermThenSigkill`, `start_EmitsNullControlsThenIdle` (three controls, values null)
           The real CLI round trip is a live check in task 13 (final verification), not a unit test
Done when: `npm run typecheck`, `npm test`, `npm run lint` pass; `grep -rln "child_process" src` lists files under
           `src/main/claude-code/` and `src/main/main.ts` only; `npm run selftest` passes (the self-test still runs
           the fake)
Commit:    one commit for the group — "Claude Code adapter: the installed CLI in stream-json mode behind AgentHarness,
           a pure stream decoder into chat entries, mode/effort/model controls, interrupt and a staged end"

## Proof

