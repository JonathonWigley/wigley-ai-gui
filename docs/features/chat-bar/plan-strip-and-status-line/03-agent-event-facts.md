# 03 — Subagent facts in agent events

Status: done
Type: Task
Wave: 1 · Depends on: none (the background-tasks plan landed, plan.md § Preconditions)
Plan: [plan.md](plan.md)

Planned against the background-tasks plan's landed shape in `.claude/worktrees/background-tasks` at `229ca469`
(`src/contracts/agent.ts` with `taskStarted` / `taskFinished`, `stream-decoder.ts` with `startTask` / `finishTask`,
`src/plugins/agents/roster.ts` with `Roster { agents: RunningAgent[]; tasks: RunningTask[] }`). Re-read those files on
`main` before starting; a line this document calls "today" is that tree.

**Precondition: probe one Agent call before coding.** Claude Code's Agent tool schema has `name` ("Name for the
spawned agent"), `model` (enum `sonnet`, `opus`, `haiku`, `fable`) and `effort` (enum `low`, `medium`, `high`,
`xhigh`, `max`) inputs: verified 2026-11-02 from the tool definition a Claude Code session receives. No stream line
shows them yet: `docs/features/agent-chat/claude-stream.md` § Subagents lists only `description`, `prompt`,
`subagent_type` and `run_in_background`. Before writing code, probe them as the background-tasks plan probed its task
lines: one short `claude -p --output-format stream-json --verbose` turn whose prompt asks for one Agent call with
`name`, `model: "haiku"` and `effort: "low"` and `run_in_background: true`. Record the Agent `tool_use` line's
`input` and the launch receipt's `tool_use_result` (with `resolvedModel`) in § Subagents, with the Claude Code version
and date. When the measured keys or values differ from the ones above, stop and report before coding: the
`name`, `model` and `effort` rules below rest on them.

Files:     modify `docs/features/agent-chat/claude-stream.md` (the probe's record, § Subagents) ·
           modify `src/contracts/agent.ts` ·
           modify `src/main/claude-code/stream-decoder.ts` · test `src/main/claude-code/stream-decoder.test.ts` ·
           create `src/main/claude-code/agent-definitions.ts` · test `src/main/claude-code/agent-definitions.test.ts` ·
           create `src/main/claude-code/model-prices.ts` · test `src/main/claude-code/model-prices.test.ts` ·
           modify `src/main/claude-code/claude-code-harness.ts` · test `src/main/claude-code/claude-code-harness.test.ts` ·
           modify `src/shared/fake-agent-harness.ts` · test `src/shared/fake-agent-harness.test.ts` ·
           modify `src/plugins/agents/roster.ts` (one case, compile only) ·
           test `src/plugins/agents/roster.test.ts` · test `src/plugins/agents/main/start.test.ts` ·
           test `src/plugins/agents/main/agent-log.test.ts` · test `src/plugins/workflow/main/agent-signals.test.ts` ·
           test `src/plugins/workflow/main/start.test.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
           (the last six: event literals gain the new required fields, nothing else)
Consumes:  `taskStarted` / `taskFinished` in `AgentEvent`, `startTask` in `stream-decoder.ts` ← background-tasks plan (landed)
           `toolSummary(name, input)` in `src/main/claude-code/tool-summary.ts` (tree)
           `claudeConfigFolder(profileDir, env, homeDir, paths)` in `src/main/claude-code/claude-launch.ts` (tree)
           `Files.list`, `readIfPresent` in `src/contracts/files.ts`; `Paths.join`, `Paths.samePath` in `src/contracts/paths.ts` (tree)
Produces:  in `src/contracts/agent.ts`, `AgentEvent` members (plan.md § File Structure, exactly):
           `| { type: 'agentSpawned'; at: number; agentId: string; parentAgentId: string; agentType: string; description: string; name: string; model: string | null; effort: string | null }`
           `| { type: 'agentReplied'; at: number; agentId: string; model: string; spendUsd: number | null }`
           `| { type: 'toolStarted'; at: number; agentId: string; toolUseId: string; tool: string; summary: string }`
           `| { type: 'taskStarted'; at: number; taskId: string; agentId: string; description: string; command: string | null }`
           in `src/main/claude-code/agent-definitions.ts`:
           `export interface AgentDefinition { model: string | null; effort: string | null }`
           `export type AgentDefinitions = ReadonlyMap<string, AgentDefinition>`
           `export function agentFrontmatter(text: string): { name: string | null; model: string | null; effort: string | null }`
           `export function loadAgentDefinitions(deps: { files: Files; paths: Paths; log: Log }, projectDir: string, configFolder: string): Promise<AgentDefinitions>`
           in `src/main/claude-code/model-prices.ts`:
           `export function replySpendUsd(model: string, usage: Json): number | null`
           in `src/main/claude-code/stream-decoder.ts`:
           `export function createStreamDecoder(isKeptOut?: (requestId: string) => boolean, definitionOf?: (agentType: string) => AgentDefinition | null): StreamDecoder`

## Decisions

**Contract** (`src/contracts/agent.ts`). Add the four members above. Comments, one line each where the meaning is not
the name: `name` is the label the agent was given, its type when none; `model` and `effort` are null when unknown;
`agentReplied` reports a subagent's model and spend so far, on each reply and on its launch receipt; `model` is the
model id Claude used (the reply's, or the receipt's `resolvedModel`), `spendUsd` the agent's estimated spend so far
(cumulative, not the reply's share), null before its first reply or when any reply's model has no list price;
`summary` is the tool call's one-line description (the tool ChatEntry's `summary`); `command` is the shell command a
task runs, the whole text with no length cap, null when the harness links the task to none. `agentReplied` sits after `agentFinished` in the union. Fix the `AgentEvent` comment's pointer if it
names only the old members.

**Name.** `asString(input.name)` when not `''`, else the event's `agentType` (which is `subagent_type` or
`general-purpose`, as today). Source: the Agent tool's `name` input (design.md § Subagent facts).

**Model and effort at spawn.** `model` = `asString(input.model)` when not `''`, else the definition's `model`, else
null. `effort` = `asString(input.effort)` when not `''`, else the definition's `effort`, else null. The Agent tool's
schema takes optional `model` and `effort` inputs (see the precondition), and an explicit input overrides the
definition, so the input reads first. The value stays verbatim (an alias such as `sonnet`). A definition `model` of
`inherit` reads as null (the loader maps it).

**The model the roster shows, in order.** Each later source replaces the earlier one:

1. `agentSpawned.model`: the Agent call's `model` input, else the definition file's `model`, else null.
2. The launch receipt's `resolvedModel`: a `user` line's `tool_result` for a decoded Agent call whose
   `tool_use_result.resolvedModel` is a non-empty string (claude-stream.md § Subagents shows it on the background
   launch receipt, `status: "async_launched"`, and on a foreground agent's completion receipt). The decoder pushes
   `{ type: 'agentReplied', agentId: <that tool_use_id>, model: resolvedModel, spendUsd: <the agent's spend so far> }`,
   the spend computed as for a reply (null when no reply is recorded yet). So the full id replaces the input's alias
   and the definition's value seconds after the spawn, before the first reply.
3. Each reply's `message.model` (below).

Effort has no later source: it stays the spawn's value.

**Definition lookup** (`agent-definitions.ts`). `loadAgentDefinitions` builds one map keyed on agent type:

- Folders, each listed with `files.list(folder, { recursive: true })`, every entry of kind `file` ending `.md`:
  1. `<projectDir>/.claude/agents/` — type is the frontmatter `name`, else the file's base name without `.md`.
  2. `<configFolder>/agents/` — same keying. A project type wins over a profile type of the same name (Claude Code's
     precedence: project over user).
  3. Each installed plugin's `<installPath>/agents/` — type is `<plugin>:<name>`, `<plugin>` being the key of
     `installed_plugins.json`'s `plugins` record up to its `@` (`wigley@wigley-ai-marketplace` → `wigley`).
- Installed plugins come from `<configFolder>/plugins/installed_plugins.json` (read through `readIfPresent`; missing →
  no plugins). Measured on this Mac (`~/.claude-personal/plugins/installed_plugins.json`, 2026-11-02): `{ "version": 2,
  "plugins": { "<name>@<marketplace>": [ { "scope": "user" | "project", "projectPath"?: string, "installPath": string,
  "version": string, … } ] } }`; `installPath` is absolute and may sit under another config folder. Per plugin key, use
  the install whose `scope` is not `user` and whose `projectPath` is `paths.samePath` to `projectDir`; else the
  `scope: "user"` install; else none. Other scopes and `enabledPlugins` are not read: Claude only spawns a type its
  session loaded.
- `configFolder` is `claudeConfigFolder(request.profileDir, deps.env, deps.homeDir, deps.paths)`, the folder the
  harness already reads `settings.json` from (the chat profile's `CLAUDE_CONFIG_DIR`, `~` resolved; the env's
  `CLAUDE_CONFIG_DIR` or `~/.claude` for a null profile).
- `agentFrontmatter(text)`: when the first line is `---` and a later line is `---`, read each line between them of
  the form `key: value` (key at column 0); `value` trimmed, one pair of surrounding `"` or `'` dropped, `''` → null.
  Keys read: `name`, `model`, `effort`. No closed block → all three null. It does not import
  `src/plugins/docs/frontmatter.ts`: `src/main/claude-code` may import only `src/contracts`, `src/shared` and
  `src/shared/paths` (`scripts/check-layers.mts`).
- A file that fails to read, or a JSON file that does not parse, is logged (`deps.log('claude', …)` naming the path)
  and skipped; the load never rejects. A first-seen type keeps its entry within one folder (`list` has no set order,
  so a duplicate name inside one folder is the user's own conflict).
- Cached per session: the harness calls `loadAgentDefinitions` once in `startClaudeProcess`, right after it starts
  the `settings.json` read, and keeps the resolved map in a `let definitions: AgentDefinitions = new Map()`. The
  decoder gets `(agentType) => definitions.get(agentType) ?? null`. A spawn decoded before the load resolves gets
  null model and effort from the definition (the reads take milliseconds; a model's first Agent call takes seconds).
  The model still arrives with the first `agentReplied`.

**Reply and spend** (decoder + `model-prices.ts`). In `decodeAssistant`, before the content blocks, for a line whose
`parent_tool_use_id` is a string, whose `message.model` is a string other than `<synthetic>`, and whose
`message.usage` is an object: record that usage under the agent (`parent_tool_use_id`) and the message id
(`message.id`), replacing an earlier record of the same message id, then push
`{ type: 'agentReplied', agentId, model: message.model, spendUsd }`. `spendUsd` is the sum of `replySpendUsd` over the
agent's recorded messages, each priced by its own model; null when any of them prices to null, and it stays null for
that agent once an unpriced reply is recorded, whatever replies follow. Claude sends one
`assistant` line per content block, each with the message's usage, so keying on message id keeps a multi-block reply
from counting twice. A main-conversation line emits no `agentReplied`; the main agent's spend stays `total_cost_usd`.

`replySpendUsd(model, usage)`:

- Tokens: `input_tokens`; cache writes split by `cache_creation.ephemeral_5m_input_tokens` and
  `cache_creation.ephemeral_1h_input_tokens`; when `cache_creation` is not an object, or neither of those two fields
  is a number, all of `cache_creation_input_tokens` at the 5m rate; `cache_read_input_tokens`; `output_tokens`. Any
  other missing number is 0.
- Spend = Σ tokens × rate per MTok ÷ 1,000,000.
- Model match: drop one trailing `[…]` suffix (`claude-opus-5-5[1m]`), then the table key equal to the id, or the key
  followed by `-` and eight digits (a dated snapshot, `claude-haiku-4-5-20251001`). No match → null.
- Claude Haiku 5.5 is priced by prompt length: when `input_tokens + cache writes + cache_read_input_tokens` is over
  100,000, the "over 100,000" row prices every class of that reply.
- The table is a `Readonly<Record<string, readonly PriceRow[]>>` in `model-prices.ts`, with a comment naming the page
  and date below. `interface PriceRow { maxPromptTokens: number | null; input: number; write5m: number; write1h: number;
  cacheRead: number; output: number }` (rates per MTok, module-private). A reply takes the first row whose
  `maxPromptTokens` is null or not below its prompt tokens. Every key holds one row with `maxPromptTokens: null`,
  except `claude-haiku-5-5`: `[{ maxPromptTokens: 100000, … }, { maxPromptTokens: null, … }]`. No Claude price
  leaves `src/main/claude-code/` (plan.md boundary rule).

**Pinned prices**, US dollars per million tokens, verbatim from https://platform.claude.com/docs/en/about-claude/pricing
§ Model pricing, fetched 2026-11-02 (docs.claude.com/en/docs/about-claude/pricing redirects there). Model ids from
https://platform.claude.com/docs/en/about-claude/models/overview and § Model IDs and versioning (dateless ids from the
4.6 generation; `claude-opus-4-5` and `claude-sonnet-4-5`, `claude-haiku-4-5` are aliases whose dated snapshots the
date rule matches). Columns: input · 5m cache write · 1h cache write · cache hit · output.

| Key | Page row | in | 5m | 1h | hit | out |
|---|---|---|---|---|---|---|
| `claude-fable-5-1` | Claude Fable 5.1 | 10 | 12.50 | 20 | 0.25 | 50 |
| `claude-fable-5` | Claude Fable 5 | 10 | 12.50 | 20 | 1 | 50 |
| `claude-opus-5-5` | Claude Opus 5.5 | 4 | 5 | 8 | 0.20 | 20 |
| `claude-opus-5` | Claude Opus 5 | 5 | 6.25 | 10 | 0.50 | 25 |
| `claude-opus-4-8` | Claude Opus 4.8 | 5 | 6.25 | 10 | 0.50 | 25 |
| `claude-opus-4-7` | Claude Opus 4.7 | 5 | 6.25 | 10 | 0.50 | 25 |
| `claude-opus-4-6` | Claude Opus 4.6 | 5 | 6.25 | 10 | 0.50 | 25 |
| `claude-opus-4-5` | Claude Opus 4.5 | 5 | 6.25 | 10 | 0.50 | 25 |
| `claude-sonnet-5-5` | Claude Sonnet 5.5 | 2 | 2.50 | 4 | 0.10 | 10 |
| `claude-sonnet-5` | Claude Sonnet 5 | 2 | 2.50 | 4 | 0.20 | 10 |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 3 | 3.75 | 6 | 0.30 | 15 |
| `claude-sonnet-4-5` | Claude Sonnet 4.5 | 3 | 3.75 | 6 | 0.30 | 15 |
| `claude-haiku-5-5` (prompt ≤ 100,000) | Claude Haiku 5.5 (for prompts up to 100,000 tokens) | 0.10 | 0.125 | 0.20 | 0.01 | 0.50 |
| `claude-haiku-5-5` (prompt > 100,000) | Claude Haiku 5.5 (for prompts over 100,000 tokens) | 0.50 | 0.625 | 1 | 0.05 | 2.50 |
| `claude-haiku-4-5` | Claude Haiku 4.5 | 1 | 1.25 | 2 | 0.10 | 5 |

Left out, so they show no cost: Claude Mythos 5.1 and Mythos 5 (limited availability; the pages name no API id),
and the retired Opus 4.1, Opus 4, Sonnet 4 and Haiku 3.5. The page's 1.1× `inference_geo` and fast-mode prices are
not applied: the stream does not say which a reply used.

**Tool summary.** `startAgentOrTool` puts `summary` on `toolStarted`: the `summary` of the `ToolEntry` the same block
built (`toolEntry(block, event)` runs just before it in `decodeAssistant`; pass the entry's summary in, or call
`toolSummary(name, block.input)` once and share it). The ChatEntry and the event always carry the same string.

**Task command.** Measured link (`docs/features/agent-chat/claude-stream.md` § Subagents, the main agent's background
Bash and a subagent's own Bash): a non-`local_agent` `system/task_started` carries `tool_use_id`, the id of the Bash
`tool_use` that started it, and that `assistant` line comes before `task_started`. In `startTask`, `command` is
`asJson(toolEntries.get(asString(event.tool_use_id))?.input).command` when it is a non-empty string, the whole text
(not the summary's first line, and no length cap: task 09's open box draws the whole command); else null (no linked call, or a call with no `command`, as a later task type may
have). The rule reads `input.command` of any tool, not only `Bash`, so a shell tool under another name still links.

**Fake harness** (`src/shared/fake-agent-harness.ts`). It emits what the adapter would:

- `toolStartedEvent` adds `summary: call.summary`.
- `FAKE_SUBAGENTS` entries gain `name`, `model`, `effort` and `reply`:
  - first: `name: 'map-decoder'`, `model: 'sonnet'`, `effort: 'medium'`,
    `reply: { model: 'claude-sonnet-5-5', spendUsd: 0.0421 }`; its Agent entry's `input` gains `name: 'map-decoder'`.
  - second: `name: null` (event `name: 'Explore'`), `model: null`, `effort: null`,
    `reply: { model: 'claude-haiku-5-5', spendUsd: 0.0019 }`.
- `emitAgentsTurn` emits each subagent's `agentReplied` (its `reply`, at `clock.now()`) just before that subagent's
  `startFakeTool`, as the decoder emits a reply's `agentReplied` ahead of the `toolStarted` its blocks give.
- `FAKE_TASKS` entries gain `command`: `'npm run selftest'` (main's) and `'npm run build -- --watch'` (the first
  subagent's); `startFakeTasks` puts it on `taskStarted`.
- The file's header comment names `agentReplied` beside the subagent events.

**Exhaustive switches and every other reader of `AgentEvent`** (measured in the background-tasks tree; re-grep
`satisfies never` and `event.type` on `main`):

| Site | What it does with `agentReplied` after this task |
|---|---|
| `src/plugins/agents/roster.ts` `foldAgentEvent` (the only `satisfies never` switch) | 03 adds `case 'agentReplied':` to the no-change group (returns `roster`); 04 folds it |
| `src/plugins/workflow/main/agent-signals.ts` `signalOf` | falls to `default: return []`; no edit |
| `src/plugins/usage/main/start.ts` | reads only `event.type === 'usage'`; no edit |
| `src/plugins/agents/main/agent-log.ts` | logs every event as JSON; logs it; no edit |
| `src/plugins/chat/main/chat-sessions.ts` | checks only `sessionEnded`, forwards every event; no edit |

The new fields on `agentSpawned`, `toolStarted` and `taskStarted` break every typed literal of those events. Each
named test file gets the fields and nothing else: `name` equal to the literal's `agentType`, `model: null`,
`effort: null`, `summary: ''` or the tool's real summary where the test feeds a ChatEntry, `command: null`. In
`src/plugins/agents/roster.test.ts` the `spawned` / tool / task helpers build the fields from the `RunningAgent` /
`RunningTask` fixture; no fold expectation changes.

## GIVEN / WHEN / THEN

- GIVEN an Agent call `{ description: 'read notes', subagent_type: 'Explore', name: 'notes-reader' }` WHEN decoded
  THEN `agentSpawned` has `name: 'notes-reader'`, `agentType: 'Explore'`.
- GIVEN an Agent call with no `name` and no definition for its type WHEN decoded THEN `name` is the type, `model` and
  `effort` are null.
- GIVEN the project's `.claude/agents/mapper.md` with `model: sonnet` and `effort: high` WHEN a session in that project
  decodes an Agent call of type `mapper` THEN `agentSpawned` carries `model: 'sonnet'`, `effort: 'high'`.
- GIVEN the wigley plugin installed at user scope with `agents/haiku.md` (`name: haiku`, `model: haiku`,
  `effort: low`) WHEN a call of type `wigley:haiku` is decoded THEN `model: 'haiku'`, `effort: 'low'`.
- GIVEN the measured subagent line (§ Subagents, 4.76: Explore's Read, `claude-haiku-5-5`, usage input 2, 5m write
  15637, read 0, output 17) WHEN decoded THEN `agentReplied { agentId: 'toolu_01FqZQTLkePVaZcsvgWG3jqK', model:
  'claude-haiku-5-5', spendUsd: 0.001963325 }` comes before `toolStarted { …, tool: 'Read', summary:
  '<project>/notes.txt' }`.
- GIVEN two `assistant` lines of one subagent message id WHEN decoded THEN the second `agentReplied` carries the same
  `spendUsd` (that message counted once).
- GIVEN a main Bash `tool_use` `{ command: 'sleep 6', run_in_background: true }` then its `task_started`
  (`task_type: 'local_bash'`, same `tool_use_id`) WHEN decoded THEN `taskStarted.command` is `'sleep 6'`.
- GIVEN a `task_started` whose `tool_use_id` names no decoded call WHEN decoded THEN `command` is null.

## Tests

- `stream-decoder.test.ts`, table `decode_AgentEvents_$case`: the `spawned` helper gains `name` (default the
  `agentType`), `model: null`, `effort: null`; each `toolStarted` expectation gains its `summary` (catches a summary
  that differs from the ChatEntry's); `taskBegan` gains `command` (default null). The table gains an optional
  `definitions` field the row's decoder is built with. New rows:
  - `spawn with name` — the `name` input wins over the type (catches name read from the wrong key).
  - `spawn of a defined type` — model and effort from `definitions` (catches the lookup not reaching the event).
  - `spawn whose input names model and effort` — input `{ model: 'opus', effort: 'max' }` over a definition of
    `sonnet` / `low` (catches the precedence flipped).
  - `subagent reply` — the measured 4.76 line above, with `<project>` kept literal (catches a missing or misplaced
    `agentReplied`, and a summary differing from the entry's).
  - `subagent reply re-sent for a second block` — same message id twice, spend unchanged (catches double counting).
  - `subagent replies of two messages` — spend is the sum (catches spend not cumulative).
  - `subagent reply of an unpriced model` — `claude-mythos-5-1`, `spendUsd: null`.
  - `subagent replies priced then unpriced` and `subagent replies unpriced then priced` — two message ids of one
    agent, one `claude-haiku-5-5` and one `claude-mythos-5-1`, in each order; the last `agentReplied` has
    `spendUsd: null` (catches a sum of the priced replies only).
  - `launch receipt sets the resolved model` — an Agent call with input `model: 'haiku'`, then its launch receipt
    shaped after § Subagents' measured 3.47 line (`resolvedModel: 'claude-haiku-5-5'`): `agentSpawned.model` is
    `'haiku'`, then `agentReplied { model: 'claude-haiku-5-5', spendUsd: null }` (catches the receipt's model dropped).
  - `receipt of a non-Agent tool` — a Bash `tool_result` whose `tool_use_result` has no `resolvedModel`: no
    `agentReplied`.
  - `main reply` and `synthetic subagent reply` — no `agentReplied` (catches main spend leaking in).
  - `main background Bash task` — the `tool_use` then `task_started` lines shaped after § Subagents' measured
    `bvrvtgapv` line; `command: 'sleep 6'`.
  - `subagent-owned Bash task` — the subagent's own Bash `tool_use` (parent id set) then the measured
    `bpdumb7hy`-shaped `task_started`; `command` from that call.
  - `task with no linked call` — `command: null`.
- `model-prices.test.ts`, `replySpendUsd_$case` (`toBeCloseTo(expected, 12)`):

  | case | model | usage | expected |
  |---|---|---|---|
  | HaikuUnderTier | `claude-haiku-5-5` | in 2, 5m 15637, read 0, out 17 | 0.001963325 |
  | HaikuOverTier | `claude-haiku-5-5` | in 2, read 150000, out 10 | 0.007526 |
  | Opus1hWrite | `claude-opus-5-5` | in 3, 1h 2000, read 40000, out 120 | 0.026412 |
  | NoSplitIsFiveMinute | `claude-sonnet-5-5` | `cache_creation_input_tokens` 1000, no `cache_creation` | 0.0025 |
  | SplitWithoutFieldsIsFiveMinute | `claude-sonnet-5-5` | `cache_creation_input_tokens` 1000, `cache_creation` `{}` | 0.0025 |
  | DatedSnapshot | `claude-haiku-4-5-20251001` | in 1000, out 1000 | 0.006 |
  | ContextSuffix | `claude-opus-5-5[1m]` | out 1000 | 0.02 |
  | Unpriced | `claude-mythos-5-1` | out 1000 | null |
  | NotADateSuffix | `claude-opus-5-5-preview` | out 1000 | null |

  Catches a wrong rate column, the tier threshold, the TTL split and the id match.
- `agent-definitions.test.ts` over `createMemoryFiles()` and the posix `Paths` the harness tests use:
  `agentFrontmatter_$case` (QuotedValues, NoClosingFence → nulls, EmptyValue → null, KeyNotAtColumnZero ignored)
  and `loadAgentDefinitions_$case` (ProjectAgent, ProfileAgent, ProjectOverProfile, NoNameUsesFileName, InheritIsNull,
  PluginUserScope, PluginProjectScopeOfThisFolderWins, PluginProjectScopeOfAnotherFolderIgnored, NoInstalledFile,
  InstalledFileNotJson logs and loads the rest).
- `claude-code-harness.test.ts`: `start_AgentDefinition_ReachesTheSpawn` — memory files hold
  `<projectDir>/.claude/agents/mapper.md`; after the start settles, a fed Agent call line of type `mapper` emits
  `agentSpawned` with its model and effort (catches the harness not wiring the loader or the config folder). The
  existing `toolStarted` literal (`start_AgentEvents_…`) gains its summary.
- `fake-agent-harness.test.ts`: `send_AgentsText_SpawnsTwoSubagentsAndHoldsTurn` expects the new fields and the two
  `agentReplied` events; the event-order table (the `agentSpawned fake-agent-2-1 …` rows) gains
  `agentReplied fake-agent-2-1` / `-2-2` before each `toolStarted`.

No self-test step: nothing the page draws changes in this task (task 09 draws these facts; task 11's live check 10
checks the `name`, `model` and `effort` inputs and the receipt's model on a real session).

Done when: `npm run typecheck`, `npm test` and `npm run lint` pass; `grep -rln "installed_plugins\|replySpendUsd\|ephemeral_1h\|resolvedModel" src | grep -v src/main/claude-code` prints nothing.
Commit:    one commit for the group

## Proof

Commit 602263b9 · proof: diff read: agentSpawned name/model/effort, agentReplied, toolStarted summary, taskStarted command in agent.ts; whole-tree tsc clean; worker's 23 test files (626 tests) pass · concerns: Done-when grep for installed_plugins.json also hits five pre-existing docs-plugin readers — a second reader of that file now exists beside the new loader, layer rules stop reuse; probe ran a live claude -p haiku turn
