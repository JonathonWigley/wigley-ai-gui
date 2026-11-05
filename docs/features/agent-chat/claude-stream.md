Measured on `claude --version` → `2.1.304 (Claude Code)`, 2026-10-20, macOS.

§ Subagents and § Compaction's opening probe measured on 2.1.316, 2026-11-01. § Queued messages, § Message lifecycle
and § Interrupt's idle case measured on 2.1.317, 2026-11-02. § Compaction's subsections measured on 2.1.318, 2026-11-03.
§ Subagents' Probe 7 measured on 2.1.318, 2026-11-04.

# Claude Code stream-json wire facts

What the installed `claude` CLI prints and accepts in stream-json mode, measured live by the agent-chat spike (plan A,
task 01). The Claude adapter (`src/main/claude-code/`) reads this doc; each section is named by the adapter task as
`claude-stream.md § <section>`.

**How every probe ran.** A `python3` stdlib driver started the binary with `subprocess.Popen` (stdin, stdout and
stderr pipes) and logged every line with a timestamp:

- binary: `~/.local/bin/claude`
- cwd: a scratch project folder holding one file, `notes.txt`, with the line `spike` (written `<project>` below)
- env: the driver's environment with `CLAUDE_CONFIG_DIR=$HOME/.claude-personal`, minus the nested-session variables
  listed under § Launch
- base flags: `-p --input-format stream-json --output-format stream-json --include-partial-messages --verbose
  --session-id <fresh uuid4>`
- cheap flags: `--model haiku --effort low` on every probe that runs a model turn, except § Effort and § Model
- stdin: one JSON object per line; `U(<text>)` below is
  `{"type":"user","message":{"role":"user","content":"<text>"},"parent_tool_use_id":null}`

Excerpts are real output lines trimmed to the fields a fact rests on, `…` marking the cut parts. `<project>` stands
for the project folder's absolute path. Fields present on almost every line (`uuid`, `session_id`) are cut unless the
fact is about them.

## Launch

**Flags.** stream-json output needs `--verbose`; `--include-partial-messages` is optional.

- Base flags without `--verbose`, stdin `U(Reply with the single word ok.)`: the process prints one stderr line and
  exits with code 1 before any stdout:
  `Error: When using --print, --output-format=stream-json requires --verbose`
- Base flags without `--include-partial-messages`, same stdin: the turn runs. There are no `stream_event` lines and no
  `system/status` line; the output is `system/hook_started`, `system/hook_response`, `system/init`, `assistant`,
  `rate_limit_event`, `result`.

**Line order** (base flags plus cheap flags, stdin `U(Reply with the single word ok.)` written at once). The seconds
are counted from spawn:

```
0.58 system/hook_started     {"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup","hook_event":"SessionStart",…}
0.58 system/hook_response    {"type":"system","subtype":"hook_response","hook_name":"SessionStart:startup","exit_code":0,"outcome":"success",…}
0.68 system/init             {"type":"system","subtype":"init",…}
0.68 system/status           {"type":"system","subtype":"status","status":"requesting",…}
2.26 stream_event message_start
2.26 stream_event content_block_start (text, index 0)
2.27 stream_event content_block_delta (text_delta "ok")
2.27 assistant               (the whole text block)
2.27 stream_event content_block_stop
2.29 stream_event message_delta
2.29 stream_event message_stop
2.29 rate_limit_event
2.45 result/success
```

The `SessionStart` hook lines arrive at process start whether or not a message has been sent. `init` arrives only
after the first stdin message (§ Init). The `assistant` event for a block comes **before** that block's
`content_block_stop`.

**Nested-session environment.** The driver ran inside a Claude Code session. A probe with the full inherited
environment (base plus cheap flags, idle 15 s, then stdin closed) worked: the hook lines arrived and the process
exited with code 0 after 0.39 s. The child does not refuse a nested launch. Every other probe still stripped the
variables the parent session sets for its own children, so that `CLAUDE_EFFORT` and `CLAUDE_CODE_SESSION_ID` could
not leak into § Effort and § Session id:
`AI_AGENT`, `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `CLAUDE_AFK_TIMEOUT_MS`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`,
and every `CLAUDE_CODE_*` (`CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`,
`CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_CODE_SESSION_ID`,
`CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ATTENDED`). An app started from a Claude Code terminal inherits
these variables, and `CLAUDE_EFFORT` in particular may set the child's effort. The app's launch strips the named ones
and `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`, which it sets from its own setting; any other `CLAUDE_CODE_*` passes through.
It also strips `WIGLEY_SESSION_ROW` and sets it to the row's id, for `unity-pool`
(`~/wigley-agents/tools/unity-pool/README.md`).

## User message

Both content forms are accepted. Neither needs `session_id` on the stdin line.

- Stdin `{"type":"user","message":{"role":"user","content":"Reply with the single word ok."},"parent_tool_use_id":null}`
  → the turn runs, `result` `{"subtype":"success","result":"ok",…}`.
- Stdin `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Reply with the single word ok."}]},"parent_tool_use_id":null}`
  → the same `result` `{"subtype":"success","result":"ok",…}`.
- Without `--replay-user-messages` (not passed), Claude does **not** echo the stdin message back on stdout. The only
  `user` events on stdout are tool results (§ Tool results), interrupt markers (§ Interrupt), and the `set_model`
  replay (§ Model).

### Images

Measured on 2.1.309, 2026-10-23, `--model haiku`, in a scratch project folder.

- Stdin `{"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"<base64>"}},{"type":"text","text":"What colour is this image? One word."}]}}`
  with an 8×8 red PNG → a model turn, `result` text `Red.` The image block goes before the text block.
- The transcript keeps the image: the user record holds the same `image` block with its base64 `data`, and carries
  `"imagePasteIds":[1]`. A second user record follows it, `"isMeta":true,"turnCompanion":true`, with one text block
  `[Image: source: <config>/…/<session-id>/images/1.png]`: the CLI's own copy of the image on disk.

## Init

**When.** `system/init` arrives only after the first stdin message, never at process start; the command list at
start comes from § Initialize. It then arrives again at the start of **every** turn, local slash commands included
(§ Effort, § Model).

- Base plus cheap flags, 15 s idle sending nothing: stdout holds only `system/hook_started` and
  `system/hook_response` (at 0.54 s). At 15.01 s the driver sends `U(Reply with the single word ok.)`. `init` follows
  at 15.09 s.
- Same process, second message `U(Think step by step, then reply with the single word ok.)`: a second `init` at
  16.98 s. The two inits differ only in `uuid`.

**Fields** (from the § Launch probe; lists given as count plus first five):

```
"type":"system","subtype":"init"
"cwd":"<project>"
"session_id":"dad2d6db-fd6b-43eb-a73c-46a3f386323a"            (equals the --session-id passed)
"model":"claude-haiku-5-5"                                      (full name; launched with --model haiku)
"permissionMode":"auto"                                         (no --permission-mode: the profile's default)
"slash_commands": 89  ["deep-research","wigley:brief","wigley:clean-up-branches","wigley:codebase-design","wigley:debug"]
"skills":         53  ["deep-research","wigley:brief","wigley:clean-up-branches","wigley:codebase-design","wigley:debug"]
"tools":          29  ["Task","Bash","CronCreate","CronDelete","CronList"]
"mcp_servers":     6  [{"name":"plugin:wigley:wigley-forms","status":"connected","source":"plugin"},
                       {"name":"plugin:wigley:wigley-primer","status":"connected","source":"plugin"},
                       {"name":"claude.ai Claude Docs","status":"pending","source":"claudeai"},
                       {"name":"claude.ai Google Drive","status":"needs-auth","source":"claudeai"},
                       {"name":"claude.ai Google Calendar","status":"needs-auth","source":"claudeai"}]
"plugins":         4  [{"name":"wigley","path":"/Users/u/.claude/plugins/cache/wigley-ai-marketplace/wigley/1.3.1","source":"wigley@wigley-ai-marketplace","version":"1.3.1"},
                       {"name":"cc-plugin-agents-md","path":"builtin",…},{"name":"cc-plugin-telemetry",…},{"name":"cc-plugin-plugin-authoring",…}]
"capabilities":   11  ["interrupt_receipt_v1","interrupt_cancel_queued_v1","interrupt_send_now_v1","msg_lifecycle_v1",
                       "request_marker_lists_v1","sdk_mcp_tools_list_changed","sdk_mcp_manifests","mcp_read_resource_v1",
                       "mcp_tool_ui_meta_v1","ui_surface_v1","mcp_call_result_not_for_model_v1"]
```

The other keys on the line: `terminal_slash_commands` (4: `doctor`, `color`, `focus`, `reload-plugins`),
`apiKeySource`, `claude_code_version` (`"2.1.304"`), `output_style`, `agents` (10), `analytics_disabled`,
`product_feedback_disabled`, `uuid`, `original_cwd`, `additional_directories`, `messaging_socket_path`,
`fast_mode_state`, `fast_mode_disabled_reason`, `per_turn_effort_active` (`true`), `view_mode`. No key carries the
effort level (§ Effort).

- The adapter reads `capabilities` on the first init of a process: with `msg_lifecycle_v1` it tracks each message by
  its `uuid` (§ Message lifecycle); without it, it logs and posts a notice, and the working state follows turn results
  alone.

- Entries in `slash_commands` have **no** leading `/`, for example `"wigley:feature"`, `"effort"`, `"model"`,
  `"compact"`. Every skill name also appears in `slash_commands`.
- `tools` grows when a pending MCP server connects: in later probes, once `claude.ai Claude Docs` was `connected`,
  `tools` also listed `mcp__claude_ai_Claude_Docs__batch`, `…__create` and the rest.
- With `--permission-mode manual`, `tools` also lists `AskUserQuestion`, `EnterPlanMode` and `ExitPlanMode`, which the
  `auto` sessions did not list.
- `init.model` does **not** follow plan mode's model switch (§ Mode change), but it does follow `/model` (§ Model).

## Initialize

Measured on `2.1.309`, 2026-10-23, base flags without `--include-partial-messages` and `--session-id`.

**The command list at process start.** `init` waits for the first message (§ Init); an `initialize` control request
does not. Sent as the first stdin line, before any message:

```
stdin  {"type":"control_request","request_id":"probe-init","request":{"subtype":"initialize"}}
0.43   system/hook_started
0.45   system/hook_response
0.45   {"type":"control_response","response":{"subtype":"success","request_id":"probe-init","response":{…}},
        "pending_permission_requests":…,"pending_user_dialog_requests":…}
```

The inner `response` keys: `commands`, `agents`, `output_style`, `available_output_styles`, `user_output_styles_dir`,
`models`, `account`, `pid`, `claude_code_version`, `current_permission_mode`, `feedback_mode`, `analytics_disabled`,
`remote_control_*` (6 keys), `ide_rc_auto_enable_gate`, `fast_mode_state`, `fast_mode_disabled_reason`,
`session_state`, `capabilities`.

- `commands` holds the same 89 entries as `init.slash_commands`, each an object, without a leading `/`:
  `{"name":"wigley:clean-up-branches","description":"(wigley) Delete the user's branches…","argumentHint":"integration branch patterns, e.g. protos/*","aliases":["clean-up-branches"]}`.
  `description` and `argumentHint` are strings (`""` when none); `aliases` is absent when a command has none; a
  built-in skill carries `"builtin":true`.
- A plugin skill's alias is its bare name (`wigley:feature` → `feature`); a built-in command's aliases are other words
  (`usage` → `cost`, `stats`; `clear` → `reset`, `new`). The `anthropic-skills` skills reverse it: `name` is the bare
  word and the alias the qualified one (`docx` → `anthropic-skills:docx`), while `init.slash_commands` lists the
  qualified one.
- Anthropic's Agent SDK sends this request at every start; the app's Claude adapter sends it too and reads
  `commands` from its answer.

## Stream events

Every `stream_event` wraps one Anthropic Messages streaming event:
`{"type":"stream_event","event":{…},"session_id":…,"parent_tool_use_id":null,"uuid":…,"api_message_id":"msg_…"}`.

- **Message id**: `event.message.id` on `message_start`. Every `stream_event` line also carries a top-level
  `api_message_id` holding the same id.
- **Block index**: `event.index` on `content_block_start`, `content_block_delta` and `content_block_stop`.
- **Subagent separation**: `parent_tool_use_id` sits at the top level, `null` for the main conversation.

Probes: the `ok` turn (§ Launch), `U(Think step by step, then reply with the single word ok.)` (§ Init), the tool turn
(§ Tool results), and the thinking turns of § Slash commands and § Permission tool.

```
message_start        {"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-haiku-5-5","id":"msg_011CgDpN88phwYT3dWiCTKnL","type":"message","role":"assistant","content":[],"stop_reason":null,…,"usage":{…}}},"parent_tool_use_id":null,"ttft_ms":1540,"thinking_display":"updates","api_message_id":"msg_011CgDpN88phwYT3dWiCTKnL",…}
content_block_start  text:     {"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"parent_tool_use_id":null,"api_message_id":"msg_011CgDpN88phwYT3dWiCTKnL",…}
content_block_start  thinking: {"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}},"thinking_display":"updates","api_message_id":"msg_011CgDpWofpaiitzUHprVZ6r",…}
content_block_start  tool_use: {"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_017frtaMMnRxCuoRT4A17M1d","name":"Read","input":{},"caller":{"type":"direct"}}},…}
content_block_delta  text_delta:       {"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}},…}
content_block_delta  thinking_delta:   {"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"","estimated_tokens":50}},"thinking_display":"updates",…}
content_block_delta  signature_delta:  {"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"CAQSyRMK…"}},…}
content_block_delta  input_json_delta: {"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"file_path\": \"/private/t"}},…}
content_block_stop   {"type":"stream_event","event":{"type":"content_block_stop","index":0},…}
message_delta        {"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null,…},"usage":{…},"context_management":{…}},…}
message_stop         {"type":"stream_event","event":{"type":"message_stop"},…}
```

- **Thinking text is not streamed.** Every `thinking_delta` observed carried `"thinking":""` plus an
  `estimated_tokens` count (`"thinking_display":"updates"`), and the final `assistant` thinking block also has
  `"thinking":""` and only a `signature`. A thinking entry built from the stream stays empty.
- `U(Think step by step, then reply with the single word ok.)` on haiku at effort low produced **no** thinking block:
  one text block `ok`. Thinking blocks appeared in other haiku-low turns: the `/wigley:feature` and permission turns.
- Each thinking delta is paired with a `system/thinking_tokens` line (§ Other events).
- A tool_use block starts with an `input_json_delta` whose `partial_json` is `""`.
- After an interrupt, `message_delta` carries `"stop_reason":null` (§ Interrupt).
- No `ping` event was observed.

## Assistant messages

An `assistant` event carries **one content block per event**: a message with a thinking block and a tool_use block
arrives as two `assistant` events with the same `message.id`, each with a one-element `content`. Each one comes as
soon as its block completes, before that block's `content_block_stop`.

Probe `permission-deny` (§ Permission tool), message `msg_011CgDpszxJLZ3ypgw72Pcds`:

```
2.13 {"type":"assistant","message":{"model":"claude-haiku-5-5","id":"msg_011CgDpszxJLZ3ypgw72Pcds","type":"message","role":"assistant","content":[{"type":"thinking","thinking":"","signature":"CAQSuwcK…"}],"stop_reason":null,…},"parent_tool_use_id":null,…}
2.60 {"type":"assistant","message":{"model":"claude-haiku-5-5","id":"msg_011CgDpszxJLZ3ypgw72Pcds",…,"content":[{"type":"tool_use","id":"toolu_01UrPnYpW2VX1HPqepbjJA6k","name":"Write","input":{"file_path":"<project>/a.txt","content":"ok\n"},"caller":{"type":"direct"}}],…},"parent_tool_use_id":null,…}
```

Text block (§ Launch probe):

```
{"type":"assistant","message":{"model":"claude-haiku-5-5","id":"msg_011CgDpN88phwYT3dWiCTKnL","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}],"stop_reason":null,…,"usage":{…}},"parent_tool_use_id":null,"session_id":"dad2d6db-…","uuid":"18e6ef56-…","timestamp":"2026-10-20T16:38:09.350Z","request_id":"req_011CgDpN7pEArieHi8MWVM32"}
```

Tool-use block (§ Tool results probe, stdin `U(Read the file notes.txt and reply with its first line.)`):

```
{"type":"assistant","message":{…,"id":"msg_011CgDpS4AoygDTrdiKEngUp",…,"content":[{"type":"tool_use","id":"toolu_017frtaMMnRxCuoRT4A17M1d","name":"Read","input":{"file_path":"<project>/notes.txt","limit":1},"caller":{"type":"direct"}}],…},"parent_tool_use_id":null,…,"wire_tool_inputs":{"toolu_017frtaMMnRxCuoRT4A17M1d":{"file_path":"<project>/notes.txt","limit":1}}}
```

- `message.stop_reason` is always `null` on `assistant` events; the stop reason comes on the stream's
  `message_delta` and on `result`.
- `message.model` is the full model name (`claude-haiku-5-5`, `claude-sonnet-5-5`).
- The text in the `assistant` block equals the text the deltas built.
- Local slash commands print a **synthetic** `assistant` event with `"model":"<synthetic>"` and a non-`msg_` id
  (§ Effort, § Model).
- An interrupted text block still gets its `assistant` event, holding the partial text (§ Interrupt).
- A `Skill` call carries `input.skill`, the skill's name as `slash_commands` lists it (`wigley:make`), and
  `input.args` only when the call passes text.

## Tool results

Tool results come as a `user` event whose `message.content` is an array of `tool_result` blocks.

Success. Stdin `U(Read the file notes.txt and reply with its first line.)`:

```
{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_017frtaMMnRxCuoRT4A17M1d","type":"tool_result","content":"1\tspike"}]},"parent_tool_use_id":null,…,"tool_use_result":{"type":"text","file":{"filePath":"<project>/notes.txt","content":"spike","numLines":1,"startLine":1,"totalLines":2}},"tool_result_meta":[{"id":"toolu_017frtaMMnRxCuoRT4A17M1d","permission_decision":{"decision":"accept","source":"user_permanent","reason_type":"rule"}}]}
```

Failure. Same process, stdin `U(Read the file missing.txt and reply with the word done.)`:

```
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"File does not exist. Note: your current working directory is <project>.","is_error":true,"tool_use_id":"toolu_01PF6AkXN1ojzKEjsUyRw8ZE"}]},"parent_tool_use_id":null,…,"tool_use_result":"Error: File does not exist. …","tool_result_meta":[…]}
```

- `is_error` is present only on failures; a success leaves it out entirely, not `false`.
- `content` was a plain string in both Read results, and in Bash, Write and permission-error results. It was a block
  array for ToolSearch: `"content":[{"type":"tool_reference","tool_name":"mcp__plugin_wigley_wigley-forms__ask_round"}]`
  (§ Slash commands). The array's blocks are not always `text`.
- `tool_use_result` (top level) is the tool's structured result. It is an object on success and an `"Error: …"`
  string on failure.
- Tool errors that never reach the tool are wrapped: `"<tool_use_error>Error calling tool (Write): Error: …</tool_use_error>"`
  (§ Permission tool, missing tool).

## Result

One `result` line ends every turn: model turns, local slash commands (§ Effort) and interrupted turns (§ Interrupt).

`ok` turn (§ Launch probe):

```
{"type":"result","subtype":"success","is_error":false,"result":"ok","stop_reason":"end_turn","total_cost_usd":0.00374234,"duration_ms":1850,"duration_api_ms":1574,"num_turns":1,"session_id":"dad2d6db-fd6b-43eb-a73c-46a3f386323a","permission_denials":[],"terminal_reason":"completed","api_error_status":null,"result_index":0,"usage":{…},"modelUsage":{"claude-haiku-5-5":{…,"costUSD":0.00374234,…}},"ttft_ms":1664,…}
```

Tool turn (§ Tool results, first message): `"subtype":"success","is_error":false,"result":"The first line of notes.txt is: \`spike\`","stop_reason":"end_turn","total_cost_usd":0.00420566,"duration_ms":3859,"num_turns":2,"permission_denials":[],"result_index":0`

Interrupted turn (§ Interrupt): `"subtype":"error_during_execution","is_error":true,"stop_reason":"tool_use","total_cost_usd":0.0035018700000000002,"duration_ms":6593,"num_turns":3,"terminal_reason":"aborted_streaming","errors":["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"]`. There is **no** `result` key.

Denied tool (§ Permission tool, deny): `"permission_denials":[{"tool_name":"Write","tool_use_id":"toolu_01UrPnYpW2VX1HPqepbjJA6k","tool_input":{"file_path":"<project>/a.txt","content":"ok\n"}}]`, with `subtype` still `success`.

Local command (§ Effort): `{"type":"result","subtype":"success","is_error":false,"result":"Set effort level to high (this session only): …","stop_reason":null,"total_cost_usd":0,"duration_ms":19,"num_turns":0,"modelUsage":{},…}`

- **`total_cost_usd` is cumulative for the process**, not per turn, and `modelUsage` is cumulative too. § Init probe:
  turn 1 `0.00226136`, turn 2 `0.00453192`. § Model probe: `0.0828254` after the sonnet turn, then `0.08671437` with
  `modelUsage` `{"claude-sonnet-5-5":0.0828254,"claude-haiku-5-5":0.00388897}` after the haiku turn. A per-turn cost
  is the difference between consecutive results. `usage` is per turn.
- `result_index` counts the process's results from 0.
- One `result` can answer more than one message written: a message folded into a running tool turn gets no `result`
  of its own (§ Queued messages). A turn Claude runs on its own answers none (§ Subagents).
- `stop_reason` is `null` after a SIGINT and on local commands. It is `"tool_use"` after a control interrupt that
  landed after a tool call.

## Slash commands

A skill sent as the user message expands; an unknown command goes to the model as plain text.

Probe: base plus cheap flags, stdin `U(/wigley:feature x)`. At the first `stream_event` line (`message_start`,
1.95 s), the driver wrote the § Interrupt control request.

- **The skill expands**, but nothing on stdout shows the expansion. No `user` or `system` line carries the skill's
  text, because Claude does not echo user messages without `--replay-user-messages`. The session transcript
  (`$CLAUDE_CONFIG_DIR/projects/<project-slug>/<session-id>.jsonl`) shows it: a user record
  `<command-message>wigley:feature</command-message>\n<command-name>/wigley:feature</command-name>\n<command-args>x</command-args>`,
  then an `isMeta: true` user record `Base directory for this skill: …/wigley/1.3.1/skills/feature …` holding the
  skill's text.
- On stdout the turn starts like a model turn: `system/init`, `system/status`, `message_start`, then the interrupt
  ends it (`control_response` success, `user` `[Request interrupted by user]`, `result/error_during_execution`).
- **`wigley:feature`** is in both init's `slash_commands` and its `skills` (§ Init).
- **The model works the skill.** The next message, stdin `U(/nosuchcommand)` in the same process, brought no error
  line. Its turn called `ToolSearch` `select:mcp__plugin_wigley_wigley-forms__ask_round` and then
  `mcp__plugin_wigley_wigley-forms__ask_round` with `{"heading":"Feature to plan: what is the work?","overview":"The /wigley:feature call came with only the argument \"x\", …"}`.
  So the model was working the expanded skill.
- **Unknown command.** The transcript records `/nosuchcommand` as a plain user message: it was sent to the model as
  text. There was no local error, no synthetic `assistant` event, and no `result` before the model turn.
- That `ask_round` call waited on the forms app: two `tool_progress` heartbeats, 30 s apart, then
  `"content":"Connection closed","is_error":true` once stdin closed and the process was ended (§ Other events).

## Terminal-only commands

Measured on 2.1.309, 2026-10-23. Stdin `U(/login)`, then `U(/logout)`, `U(/config)`, `U(/mcp)`, `U(/status)` in one
process.

- `/login`, `/logout` and `/status` each print a synthetic `assistant` event and a `result` with no model turn:
  `{"type":"result","subtype":"success","is_error":false,"result":"/login isn't available in this environment.","total_cost_usd":0,…}`
  (the same text with `/logout` and `/status`).
- `/config` prints its usage (`Usage: /config key=value [key=value ...]` and the keys). `/mcp` prints a summary,
  ``2 MCP server(s): 2 connected, 0 not connected, 0 disabled. Use `/mcp` in the terminal for details.``, and its
  `result` carries `"local_command":"mcp"`.
- None of `login`, `logout` or `status` is in init's `slash_commands`; `config` and `mcp` are. Init's
  `terminal_slash_commands` (`doctor`, `color`, `focus`, `reload-plugins`) does not list them either, so no event
  names the commands print mode refuses.

## Auth

Measured on 2.1.309, 2026-10-23. `claude auth` has `login`, `logout` and `status`; each reads `CLAUDE_CONFIG_DIR`.

- **`claude auth status --json`** prints one JSON object and exits 0, signed in or not:
  signed in → `{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"<email>","orgName":"…","subscriptionType":"max","configDirectory":"<config>",…}`;
  an empty config folder → `{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty","configDirectory":"<config>",…}`.
- **`claude auth login`** runs with no terminal (stdin a pipe). It prints `Opening browser to sign in…`, opens the
  browser through `open` (or `$BROWSER`) on an authorize URL whose `redirect_uri` is `http://localhost:<port>/callback`,
  then prints `If the browser didn't open, visit: <url>` — the URL wrapped in an OSC 8 terminal hyperlink, so it
  shows twice on the line (once as the link target, once as its text) between escape sequences; its `redirect_uri` is
  the hosted `https://platform.claude.com/oauth/code/callback`, which shows the user a code to paste — and
  `Paste code here if prompted > `. It then waits: on the localhost callback, or on a code written to stdin.
  Options: `--claudeai` (subscription, the default), `--console` (API billing), `--email <email>`, `--sso`.
- The probe stopped there (12 s timeout, no sign-in finished): the exit code after a finished sign-in is not
  measured, so a reader confirms the result with `claude auth status --json` once the process ends.
- **`claude auth logout`** was not run, so as not to sign a profile out.
- **Keychain** (macOS, 2.1.311, 2026-10-27): the login for an unset `CLAUDE_CONFIG_DIR` is the Keychain item
  `Claude Code-credentials`; any set value uses `Claude Code-credentials-<hash>`, even `$HOME/.claude`. A user signed
  in from a plain terminal reads `loggedIn: false` with `CLAUDE_CONFIG_DIR=$HOME/.claude`, so the launch leaves the
  variable unset for the default folder.

## Interrupt

Both routes end the turn with a `result`. Only the control request leaves the process running.

**Control request.** Stdin `U(Count from 1 to 200, one number per line.)`. Haiku ran `Bash seq 1 200` and then
started a text block. At the first `text_delta` the driver wrote
`{"type":"control_request","request_id":"spike-1","request":{"subtype":"interrupt"}}`. Within the same millisecond:

```
7.80 {"type":"control_response","response":{"subtype":"success","request_id":"spike-1","response":{"still_queued":[]}}}
7.80 {"type":"assistant","message":{…,"content":[{"type":"text","text":"1 through"}],…}}
7.80 {"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]},"parent_tool_use_id":null,…}
7.80 stream_event content_block_stop / message_delta {"delta":{"stop_reason":null,…}} / message_stop
7.80 {"type":"result","subtype":"error_during_execution","is_error":true,"stop_reason":"tool_use","terminal_reason":"aborted_streaming","errors":["[ede_diagnostic] …"],…}
```

The process stayed alive. A follow-up `U(Reply with the single word ok.)` 3 s later ran a normal turn (`init`, …,
`result/success` `"result":"ok"`). The process then exited with code 0 when stdin closed.

**SIGINT.** A second process got the same prompt and SIGINT at the first `content_block_start` of text:

```
1.75 {"type":"assistant","message":{…,"content":[{"type":"text","text":"1"}],…}}
1.75 {"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]},…}
1.75 stream_event content_block_stop / message_delta / message_stop
1.75 {"type":"result","subtype":"error_during_execution","is_error":true,"stop_reason":null,"total_cost_usd":0,"duration_api_ms":0,"terminal_reason":"aborted_streaming",…}
```

There was no `control_response`. **The process then exited on its own with code 0**, within 3 s, so the follow-up
could not be sent. SIGINT ends the session as well as the turn.

The interrupt marker is a `user` event with text content `[Request interrupted by user]`, and no `tool_result`.

**Idle process.** Measured on 2.1.317. After a turn's `result`, with nothing running, the control request gets the same
reply as on a running turn and nothing follows it:

```
 1.41 {"type":"result","subtype":"success","result":"ok","result_index":0,…}
 3.42 IN  {"type":"control_request","request_id":"probe-idle","request":{"subtype":"interrupt"}}
 3.42 {"type":"control_response","response":{"subtype":"success","request_id":"probe-idle","response":{"still_queued":[]}}}
      (no line for 10 s; a later message ran a normal turn)
```

So the plain interrupt cannot tell idle from busy, and a client that waits for a `result` after it waits forever. A
named interrupt can tell them apart (§ Message lifecycle). The adapter sends the plain one and does not wait for a
`result`: the reply (success or error) closes every open message when no turn is open, and an interrupt that neither
a `result` nor such a reply answers within 5 s drops the turn state (design.md § Agent harness seam, Interrupt).

## Mode change

The subtype is `set_permission_mode`. The mode changes at once, and a `system/status` line reports it.

Probe: idle session (base plus cheap flags, no `--permission-mode`, so the profile's `auto`), 5 s after spawn and
before any user message:

```
stdin  {"type":"control_request","request_id":"spike-2","request":{"subtype":"set_permission_mode","mode":"plan"}}
stdout {"type":"control_response","response":{"subtype":"success","request_id":"spike-2","response":{"mode":"plan"}}}
stdout {"type":"system","subtype":"status","status":null,"permissionMode":"plan","uuid":…,"session_id":…}
```

Error:

```
stdin  {"type":"control_request","request_id":"spike-2b","request":{"subtype":"set_permission_mode","mode":"nosuchmode"}}
stdout {"type":"control_response","response":{"subtype":"error","request_id":"spike-2b","error":"Cannot set permission mode: must be one of acceptEdits, auto, bypassPermissions, default, dontAsk, plan","error_code":"invalid_mode"}}
```

No `system/status` line follows an error.

- The success `control_response` nests the request id and the mode as `response.request_id` and
  `response.response.mode`. The error puts `error` and `error_code` at `response.error` and `response.error_code`.
- **`manual` is reported as `default`**: `{"mode":"manual"}` returns `"response":{"mode":"default"}` and the status
  line says `"permissionMode":"default"`. Init after `--permission-mode manual` also says `"permissionMode":"default"`
  (§ Permission tool).
- **What reports the new mode:** the `system/status` line at once, then the next turn's `system/init`
  (`"permissionMode":"plan"` after the mode was set to `plan` and `U(Reply with the single word ok.)` was sent). The
  `result` line has no mode field.
- **Plan mode switched the model.** In `plan`, with `--model haiku`, the turn ran on `claude-sonnet-5-5`
  (`assistant` `message.model` and the `result` `modelUsage` key), while that turn's `init` still said
  `"model":"claude-haiku-5-5"`.

## Effort

`/effort <level>` runs locally: no model turn, cost 0. It prints a synthetic `assistant` event and a `result`. No
event reports the effort in force; `/model` with no argument prints it in text (§ Model).

Probe: base flags plus `--model haiku`, **no** `--effort` (the profile's `effortLevel` is `high`), idle 5 s, then:

```
stdin  U(/effort high)
stdout system/init …
stdout {"type":"assistant","message":{"id":"c1155488-4b7a-4f13-8a1e-a25bafb11cb1","model":"<synthetic>","role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"Set effort level to high (this session only): Comprehensive implementation with extensive testing and documentation"}],…},"parent_tool_use_id":null,"local_command_source":"<local-command-stdout>Set effort level to high (this session only): Comprehensive implementation with extensive testing and documentation</local-command-stdout>","local_command_run":{"command":"effort","args":"high"},…}
stdout {"type":"result","subtype":"success","is_error":false,"result":"Set effort level to high (this session only): …","stop_reason":null,"total_cost_usd":0,"duration_ms":19,"num_turns":0,"modelUsage":{},…}

stdin  U(/effort)
stdout system/init …
stdout {"type":"assistant","message":{"model":"<synthetic>",…,"content":[{"type":"text","text":"Usage: /effort <low|medium|high|xhigh|max|auto|ultracode [on|off]>"}]},"local_command_source":"<local-command-stdout>Usage: …</local-command-stdout>","local_command_run":{"command":"effort","args":""},…}
stdout {"type":"result","subtype":"success","is_error":false,"result":"Usage: /effort <low|medium|high|xhigh|max|auto|ultracode [on|off]>","num_turns":0,"total_cost_usd":0,…}
```

- The local output is **not** a `user` event with `<local-command-stdout>`. It is an `assistant` event with
  `message.model` `"<synthetic>"` and the plain text in `content[0].text`. The tagged text is in the top-level
  `local_command_source`, and the command and args are in `local_command_run`.
- `/effort` with no argument prints usage. It does not print the current level.
- **No event field carries effort.** Every log in the spike was searched for a key containing `effort`; the only
  match is init's `per_turn_effort_active: true`. Init, status and result have no effort value, at start or after the
  change.
- `/model` with no argument prints the effort in its text: `Current model: \`Haiku 5.5\` (effort: low)` (§ Model).
- The adapter's `/effort <value>` carries a client `uuid`, as every message it writes does (§ Message lifecycle).
- **`get_settings` reports the effort in force.** The control request
  `{"type":"control_request","request_id":"r1","request":{"subtype":"get_settings"}}` is answered before any message,
  with no model call, and its reply's `response.response` holds `effective`, `sources` and `applied`. Read only
  `applied`: `effective.effortLevel` is the settings file's value and is wrong for Opus 5.5, which ignores a top-level
  `effortLevel`. `effective` and each `sources` entry's `settings` carry the settings file's `env` block, values
  included, so the adapter's spawn rule (`droppedOutKeys`) drops `effective` and `sources` from the line the host logs
  and delivers. The request is not in the Agent SDK's TypeScript reference,
  so it is a measured reading like the rest of this file. The reply was 8.8 KB on this profile. Measured on 2.1.318,
  profile `effortLevel` `high`, with no `CLAUDE_CODE_EFFORT_LEVEL`:

  | start, then command | `applied.model` | `applied.effort` |
  |---|---|---|
  | `--model claude-opus-5-5` | `claude-opus-5-5` | `medium` |
  | no `--model` (profile `opus[1m]`) | `claude-opus-5-5` | `medium` |
  | `--model claude-sonnet-5-5` | `claude-sonnet-5-5` | `medium` |
  | `--model claude-fable-5-1` (`modelSettings` `medium`) | `claude-fable-5-1` | `medium` |
  | `--model claude-haiku-4-5` (no effort support) | `claude-haiku-4-5` | `null` |
  | `--model claude-opus-5-5 --effort low` | `claude-opus-5-5` | `low` |
  | then `/model sonnet` | `claude-sonnet-5-5` | `low` |
  | Opus, `/effort high` | `claude-opus-5-5` | `high` |
  | then `/effort auto` | `claude-opus-5-5` | `medium` |
  | then `/effort max` | `claude-opus-5-5` | `max` |
  | Opus, `/effort ultracode on` | `claude-opus-5-5` | `medium`, with `applied.ultracode` `true` |
  | `--model sonnet`, then `plan` mode | `claude-sonnet-5-5` | `medium` |
  | `--model opusplan`, then `plan` mode, then `auto` | `claude-sonnet-5-5` each time | `medium` |

  `applied.model` does not follow plan mode's model switch, as `init.model` does not (§ Mode change). `init.model`
  equals `applied.model` on `--model opusplan` (both `claude-sonnet-5-5`), `opus[1m]` (both `claude-opus-5-5`) and
  `sonnet` (both `claude-sonnet-5-5`), read after a local `/effort high`.
- **A refused `/effort` or `/model` is a `success` result.** Only the text tells a refused value from an accepted one;
  the `get_settings` reply after the command shows what applied. Measured on 2.1.318, started
  `--model claude-opus-5-5 --effort high`; every row's result is subtype `success`, `is_error` `false`:

  | command | `result` text | applied after |
  |---|---|---|
  | `/effort hihg` | Invalid argument: hihg. Valid options are: low, medium, high, xhigh, max, auto, ultracode | opus, high |
  | `/effort ultracode` | Ultracode on (this session only): dynamic workflows on every task. Effort stays high. | opus, high |
  | `/effort auto` | Effort level set to auto (this session only) | opus, medium |
  | `/model nosuchmodel` | Model 'nosuchmodel' not found | opus, high |
  | `/model default` | Set model to `Opus 5.5 (default)` for this session only | opus, high |
  | `/model best` | Set model to `Fable 5.1` for this session only | fable, high |

## Model

`/model <alias>` works mid-session. It is local (cost 0) and takes effect on the next turn. The `set_model` control
request works too. The new model shows up in the next `init` and in `assistant` `message.model`, as a full name.

Probe: base flags plus `--model haiku --effort low`, idle 5 s, then:

```
stdin  U(/model)
stdout system/init {"model":"claude-haiku-5-5",…}
stdout {"type":"assistant","message":{"model":"<synthetic>",…,"content":[{"type":"text","text":"Current model: `Haiku 5.5` (effort: low)\nUsage: /model <name>. Available: sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], fable[1m], opusplan, default, or a full model ID."}]},"local_command_run":{"command":"model","args":""},…}
stdout result/success {"num_turns":0,"total_cost_usd":0,…}

stdin  U(/model sonnet)
stdout system/init {"model":"claude-haiku-5-5",…}
stdout {"type":"assistant","message":{"model":"<synthetic>",…,"content":[{"type":"text","text":"Set model to `Sonnet 5.5` for this session only"}]},"local_command_run":{"command":"model","args":"sonnet"},…}
stdout result/success {"num_turns":0,"total_cost_usd":0,…}

stdin  U(Reply with the single word ok.)
stdout system/init {"model":"claude-sonnet-5-5",…}
stdout stream_event message_start {"message":{"model":"claude-sonnet-5-5",…}}
stdout assistant {"message":{"model":"claude-sonnet-5-5",…,"content":[{"type":"text","text":"ok"}]}}
stdout result/success {"total_cost_usd":0.0828254,"modelUsage":{"claude-sonnet-5-5":{…}},…}

stdin  {"type":"control_request","request_id":"spike-3","request":{"subtype":"set_model","model":"haiku"}}
stdout {"type":"user","message":{"role":"user","content":"<local-command-stdout>Set model to `haiku (claude-haiku-5-5)`</local-command-stdout>"},"parent_tool_use_id":null,…,"isReplay":true}
stdout {"type":"control_response","response":{"subtype":"success","request_id":"spike-3"}}

stdin  U(Reply with the single word ok.)
stdout system/init {"model":"claude-haiku-5-5",…}
stdout assistant {"message":{"model":"claude-haiku-5-5",…,"diagnostics":{"cache_miss_reason":{"type":"model_changed","cache_missed_input_tokens":30405}}}}
stdout result/success {"total_cost_usd":0.08671437,…}
```

- The `/model sonnet` turn's own `init` still says haiku; the change shows from the **next** turn's `init`.
- The `set_model` request was sent with `"model":"haiku"` rather than the planned `"sonnet"`, because the session was
  already on sonnet by then and the probe needed a visible change. It prints a `user` event (`isReplay: true`) whose
  string content is wrapped in `<local-command-stdout>`, then a `control_response` with no `response.response`. It
  prints no `result` and no `system/status` line.
- `init.model` and `message.model` are full names (`claude-sonnet-5-5`, `claude-haiku-5-5`), never the alias.
- The adapter's `/model <value>` carries a client `uuid`, as every message it writes does (§ Message lifecycle).

## Choices

From `claude --help` (2.1.304) and in-session commands:

- **Permission modes** (`--permission-mode` help): `"acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk",
  "plan"`. The `set_permission_mode` error lists `acceptEdits, auto, bypassPermissions, default, dontAsk, plan`, so
  `manual` is the CLI's alias for `default` (§ Mode change).
- **Effort levels** (`--effort` help): `low, medium, high, xhigh, max`. The `/effort` usage line adds `auto` and
  `ultracode [on|off]`.
- **Model aliases.** `--model` help names `'fable', 'opus', or 'sonnet'`. `/model` with no argument lists
  `sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], fable[1m], opusplan, default, or a full model ID`.
- **Modes accepted mid-session by `set_permission_mode`**, from a session launched in `auto` without
  `--allow-dangerously-skip-permissions` or `--dangerously-skip-permissions`:

  | mode sent | response |
  |---|---|
  | `acceptEdits` | success, `"mode":"acceptEdits"` |
  | `auto` | success, `"mode":"auto"` |
  | `manual` | success, `"mode":"default"` |
  | `dontAsk` | success, `"mode":"dontAsk"` |
  | `plan` | success, `"mode":"plan"` |
  | `bypassPermissions` | error, `"Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions","error_code":"bypass_not_launched"` |

## Permission tool

The prompt tool gets `{tool_name, input, tool_use_id}`. It answers with one text block holding
`{"behavior":"allow","updatedInput":…}` or `{"behavior":"deny","message":…}`. A missing tool kills the process at the
first prompt.

Probe: a stdlib stdio MCP server (newline-delimited JSON-RPC 2.0) with one tool, `permission_prompt`. It was loaded
with `--mcp-config` naming server `spike`:
`{"mcpServers":{"spike":{"command":"python3","args":["-I","…/mcp/permission_server.py"],"env":{"SPIKE_REPLY":"allow|deny|garbage"}}}}`.
Flags: base plus cheap plus `--mcp-config <file> --permission-mode manual --permission-prompt-tool mcp__spike__permission_prompt`.
Stdin: `U(Create a file named a.txt containing ok, using the Write tool.)`. Each reply kind ran in a fresh process
and session.

**RPC sequence the server saw:** `server/discover` (id `"server-discover-probe-1"`, answered `{}`), `initialize`
(id 0), `notifications/initialized`, `tools/list` (id 1), then one `tools/call` per prompt.

**Call arguments** (server log):

```
{"name":"permission_prompt","arguments":{"tool_name":"Write","input":{"file_path":"<project>/a.txt","content":"ok\n"},"tool_use_id":"toolu_017rShNny5qWrNUfUa62GneU"}}
```

These are the only three arguments. `tool_use_id` equals the `assistant` tool_use block's `id`.

**Allow.** The tool result is `{"content":[{"type":"text","text":"{\"behavior\": \"allow\", \"updatedInput\": {\"file_path\": \"<project>/a.txt\", \"content\": \"ok\\n\"}}"}]}`.
The Write ran: `a.txt` held `ok\n`. The `user` tool_result was `"File created successfully at: …"` with
`"tool_result_meta":[{…,"permission_decision":{"decision":"accept","source":"user_temporary"}}]`, and the result was
`success` with `"permission_denials":[]`.

**Deny.** The text was `{"behavior": "deny", "message": "spike says no"}`. The Write did not run (`a.txt` absent).
**The model sees the message as the tool's error result:**

```
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"spike says no","is_error":true,"tool_use_id":"toolu_01UrPnYpW2VX1HPqepbjJA6k"}]},…,"tool_use_result":"Error: spike says no","tool_result_meta":[{…,"non_execution_kind":"permission-rule","permission_decision":{"decision":"reject","source":"user_reject"}}]}
```

The model then replied that the write was refused and did not retry. The `result` was `success` with
`permission_denials` listing the call (§ Result). No `system/permission_denied` line appeared.

**Unreadable reply.** The text was `this is not json`. Claude treats it as a denial carrying a fixed error, which the
model sees:

```
{"type":"tool_result","content":"The permission prompt tool returned an invalid permission result. Expected {behavior: 'allow', updatedInput?: object} or {behavior: 'deny', message: string}. updatedPermissions may hold at most 4096 updates, rules and directories in all.","is_error":true,…}
… "permission_decision":{"decision":"reject","source":"config","reason_type":"other"}
```

The model retried the Write once (a second `tools/call`, same answer), then gave up. The result was `success` with
both calls in `permission_denials`.

**Prompt tool that does not exist.** Flags: base plus cheap plus `--permission-mode manual --permission-prompt-tool
mcp__plugin_wigley_wigley-forms__permission_prompt` (no `--mcp-config`; the forms app was not running). The process
started normally: it was alive at 5 s with only the hook lines. The driver then sent the Write prompt. At the first
call needing permission:

```
7.49 stderr  Error: MCP tool mcp__plugin_wigley_wigley-forms__permission_prompt (passed via --permission-prompt-tool) not found. Available MCP tools: mcp__plugin_wigley_wigley-forms__ask_round, mcp__plugin_wigley_wigley-forms__collect_last_round, mcp__plugin_wigley_wigley-primer__open_primer, mcp__plugin_wigley_wigley-primer__collect_last_primer, mcp__claude_ai_Claude_Docs__create, …
7.50 stdout  {"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"<tool_use_error>Error calling tool (Write): Error: MCP tool mcp__plugin_wigley_wigley-forms__permission_prompt (passed via --permission-prompt-tool) not found. …</tool_use_error>","is_error":true,…}]},…}
7.52 stdout  system/status "requesting"
     exit code 1, no result line
```

**Pinned name's prefix.** In that run, init's `tools` held `mcp__plugin_wigley_wigley-forms__ask_round`,
`mcp__plugin_wigley_wigley-forms__collect_last_round`, `mcp__plugin_wigley_wigley-primer__collect_last_primer` and
`mcp__plugin_wigley_wigley-primer__open_primer`. Its `mcp_servers` named `plugin:wigley:wigley-forms` (connected).
This confirms the prefix `mcp__plugin_wigley_wigley-forms__`: the forms plugin's tools are named
`mcp__plugin_wigley_wigley-forms__<tool>`, so `mcp__plugin_wigley_wigley-forms__permission_prompt` is the right name
once the server exposes that tool. On this machine the plugin did not yet expose it.

- The `--permission-prompt-tool` tool is **hidden from the model**: in the spike runs, init's `mcp_servers` listed
  `{"name":"spike","status":"connected","source":"dynamic"}`, but `tools` held no `mcp__spike__*` entry.
- The MCP child's environment, set by claude even though the driver stripped these variables from claude's own
  environment: `CLAUDECODE`, `CLAUDE_AFK_TIMEOUT_MS`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, `CLAUDE_CODE_ENTRYPOINT`,
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`,
  `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CONFIG_DIR`, `CLAUDE_PROJECT_DIR`.

**Documented shape.** code.claude.com `cli-reference` says of `--permission-prompt-tool`: "Specify an MCP tool to
handle permission prompts in non-interactive mode. Pass the full name, such as `mcp__<server>__<tool>`, of a tool on
an MCP server that the run loads. Claude Code waits for that tool's MCP server to connect before running the first
turn, up to the `MCP_TIMEOUT` startup timeout, 30 seconds by default. The prompt tool can't approve an MCP tool
marked as requiring user interaction: Claude Code converts an `allow` result for one to a deny." Its example is
`claude -p --mcp-config ./mcp.json --permission-prompt-tool mcp__permissions__approve "query"`. Neither
`cli-reference` nor `headless` (nor `agent-sdk/permissions`) documents the tool's arguments or reply shape. The only
statement of the reply shape is the CLI's own error text above:
`{behavior: 'allow', updatedInput?: object} or {behavior: 'deny', message: string}` (with an `updatedPermissions`
field implied).

## Session id

The `--session-id` uuid reaches the MCP child as `CLAUDE_CODE_SESSION_ID`, and init's `session_id` equals it.

Probe `permission-allow` (§ Permission tool), launched with `--session-id 8976fa0d-7f42-45f3-840b-f262324ab0f1`:

```
server log (at server start and in each tools/call):  "CLAUDE_CODE_SESSION_ID": "8976fa0d-7f42-45f3-840b-f262324ab0f1"
system/init:                                           "session_id":"8976fa0d-7f42-45f3-840b-f262324ab0f1"
```

It held in all three server runs: `cf1d5bfc-b6b8-4a97-9715-700d11d22bba` (deny) and
`58b7cbcc-9178-4d45-9f7f-afd1a76118d7` (garbage) matched as well. Every stdout line of a process carries the same
`session_id`. The driver had stripped its own `CLAUDE_CODE_SESSION_ID` from claude's environment, so the value is
claude's, not one passed through.

## Exit codes

Every probe used base plus cheap flags.

| case | exit code | last stderr line | time to exit |
|---|---|---|---|
| close stdin on an idle session (5 s after spawn, no message sent) | 0 | none | 0.49 s after stdin closed |
| close stdin after a finished turn | 0 | none | 0.34–0.66 s across 12 probes |
| SIGTERM, idle | 143 | none | 0.45 s |
| SIGTERM mid-turn (at the first `text_delta` of `U(Count from 1 to 200, one number per line.)`) | 143 | none | 0.50 s; **no `result` line** after the signal |
| SIGINT mid-turn (§ Interrupt) | 0 | none | exited on its own within 3 s, after a `result/error_during_execution` |
| bad flag `--permission-mode nosuchmode` | 1 | `error: option '--permission-mode <mode>' argument 'nosuchmode' is invalid. Allowed choices are acceptEdits, auto, bypassPermissions, manual, dontAsk, plan.` | 0.12 s, no stdout |
| `--output-format stream-json` without `--verbose` (§ Launch) | 1 | `Error: When using --print, --output-format=stream-json requires --verbose` | under 1 s, no stdout |
| `--permission-prompt-tool` naming a missing tool, at the first prompt (§ Permission tool) | 1 | `Error: MCP tool … (passed via --permission-prompt-tool) not found. …` | at once, no `result` |
| stdin closed while an MCP tool call was waiting (`ask_round`, § Slash commands) | not seen: still running 10 s later. The driver's SIGTERM then gave 143 | none | the pending call got a `tool_result` `"Connection closed"`, `is_error: true` |

## Other events

Event types and subtypes seen in the logs that the sections above do not cover:

- **`system/hook_started` and `system/hook_response`**: the `SessionStart:startup` hook, at process start, before
  any message (§ Launch).
  `{"type":"system","subtype":"hook_response","hook_id":"91e06484-…","hook_name":"SessionStart:startup","hook_event":"SessionStart","output":"","stdout":"","stderr":"","exit_code":0,"outcome":"success",…}`
- **`system/status`**: once per API request, before it, with `"status":"requesting"`. Also after a mode change, with
  `"status":null` and `permissionMode` (§ Mode change). Not emitted without `--include-partial-messages`.
  `{"type":"system","subtype":"status","status":"requesting","session_id":"dad2d6db-…","uuid":"4f22275d-…"}`
- **`system/thinking_tokens`**: paired with each `thinking_delta`.
  `{"type":"system","subtype":"thinking_tokens","estimated_tokens":50,"estimated_tokens_delta":50,"session_id":…,"uuid":…}`
- **`rate_limit_event`**: after each model message's `message_stop`.
  Measured 2026-10-30 on `2.1.314`: `status` is `allowed`, `allowed_warning` or `rejected`; `utilization` is 0–1 here
  (`usage_report` below uses 0–100); `unifiedWindows` holds `five_hour` and `seven_day`, each with `utilization`,
  `resetsAt` (epoch seconds), `status` and, past a threshold, `surpassedThreshold`.
  `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1793426400,"rateLimitType":"seven_day","utilization":0.95,"overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0.12,"resetsAt":1793434200,"status":"allowed"},"seven_day":{"utilization":0.95,"resetsAt":1793426400,"status":"allowed_warning","surpassedThreshold":0.75}},"overageEnabled":false},"uuid":…,"session_id":…}`
- **`tool_progress`**: a heartbeat every 30 s while a tool call is pending. Its `tool_use_id` is the call id with a
  `-heartbeat-<n>` suffix, and `parent_tool_use_id` is the real call id.
  `{"type":"tool_progress","tool_use_id":"toolu_01YMhg2Ys1DtwHhK2R3A62ji-heartbeat-0","tool_name":"mcp__plugin_wigley_wigley-forms__ask_round","parent_tool_use_id":"toolu_01YMhg2Ys1DtwHhK2R3A62ji","elapsed_time_seconds":30,"heartbeat":true,…}`
  The `parent_tool_use_id` here is not a subagent id: a decoder that routes by `parent_tool_use_id` should not treat
  this line as a subagent's.
- **`user` with `isReplay: true`**: the `set_model` acknowledgement (§ Model).

Expected but not observed: `ping` stream events, `system/api_retry`, `system/permission_denied`, any
`control_request` sent by Claude to the host (none arrived, even with `--permission-prompt-tool`), and non-JSON
stdout lines (every stdout line in every probe parsed as JSON).

## Usage

Measured 2026-10-30 on `2.1.314`. Excerpts trimmed as above.

**`/usage` in `-p` mode.** `claude -p /usage --output-format stream-json --verbose` costs no tokens and emits an
`assistant` line carrying a top-level `usage_report` beside its `message` (the text). `percent` is 0–100. `resets_at` is an
ISO-8601 string. `severity` is the server's grade. `extra_usage` amounts are minor units (cents) of `currency`.

`"usage_report":{"session":{"total_cost_usd":0,…,"model_usage":{}},"rate_limits":{"limits":[{"kind":"session","group":"session","percent":35,"resets_at":"2026-10-31T08:09:59.607264+00:00","scope":null,"severity":"normal","is_active":false},{"kind":"weekly_all","group":"weekly","percent":97,"resets_at":"2026-10-31T05:59:59.607290+00:00","scope":null,"severity":"critical","is_active":true},{"kind":"weekly_scoped","group":"weekly","percent":0,"resets_at":"2026-10-31T06:00:00+00:00","scope":{"model":{"display_name":"Fable"},"surface":null},"severity":"normal","is_active":false}],"extra_usage":{"is_enabled":false,"monthly_limit":null,"used_credits":null,"utilization":null,"currency":null}}}`

**Control requests.** `get_usage`, `get_context_usage` and `get_session_cost` are answered over stdin before any
message. The request is
`{"type":"control_request","request_id":"r1","request":{"subtype":"get_context_usage"}}`; the reply is a
`control_response` whose `response.response` holds the data.

- `get_context_usage` keys: `agents`, `apiUsage`, `autoCompactThreshold`, `autocompactSource`, `categories` (each
  `name`, `kind` of `used`, `free`, `buffer` or `deferred`, and `tokens`), `gridRows`, `isAutoCompactEnabled`,
  `maxTokens`, `mcpInstructions`, `mcpTools`, `memoryFiles`, `messageBreakdown`, `model`, `percentage`,
  `rawMaxTokens`, `skills`, `slashCommands`, `totalTokens`. On Opus, Sonnet and Haiku with
  `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=30` set in both the environment and `settings.json`, it reported
  `maxTokens: 1000000`, `rawMaxTokens: 1000000`, `autoCompactThreshold: 967000`, `autocompactSource: "model-default"`:
  the override does not show in this reply.
- `get_usage` keys: `session`, `subscription_type` (`"max"`), `rate_limits_available`, and `rate_limits` with
  `five_hour` and `seven_day` (each `utilization` 0–100 and `resets_at`), `extra_usage` (the `usage_report` fields
  plus `disabled_reason`, `user_disabled`, `spend_limit_reached`, …) and the same `limits[]`.
- `get_session_cost` replies text only: `{"text":"Total cost: $0.0000\n…"}`.

**Other usage fields.** The `result` line's `modelUsage.<model>` carries `contextWindow` (`1000000`),
`maxOutputTokens`, `costUSD` and `costBasis` (`"list"`: API list rates, not money billed). An `assistant` message's
`usage.cache_creation` splits `ephemeral_1h_input_tokens` from `ephemeral_5m_input_tokens`, the prompt cache's two TTLs.
A result names a subagent's model too, while that subagent still runs: on 2026-11-03 a haiku background subagent under
an Opus main received the window `1000000` at main's `result`, a value not checked against haiku's published window.

## Queued messages

A message written while a turn runs is queued. Where it runs depends on the running turn:

- **A turn that makes tool calls folds it in.** At the turn's next model request after the message arrives, the CLI
  takes it in with the tool results and the model answers it inside the running turn. It gets no `system/init` and no
  `result` of its own, so results and messages written stop matching one to one. The transcript records it as a
  `queued_command` attachment and a `queue-operation` `remove` with `reason` `absorbed_mid_turn`. A turn Claude runs on
  its own after a background task ends (§ Subagents) folds a message in the same way.
- **A turn with no tool call does not.** It makes no later model request to fold into, so the message runs as its own
  turn after it, with its own `init` and its own `result`.

An `interrupt` ends only the running turn; a queued message still runs.

**Folded into a tool turn.** Measured 2026-11-02 on `2.1.317`, as § How every probe ran. `T` is
U(Use the Bash tool to run \`sleep 4\`, then use the Bash tool to run \`cat notes.txt\`, then reply with the single word
done.):

```
 0.00 IN  U(T)
 0.45 system/init
 1.83 assistant [tool_use Bash "sleep 4"]
 1.84 IN  U(Reply with the single word two.)          ← written here
 2.10 assistant [tool_use Bash "cat notes.txt"]
 4.95 user [tool_result "spike"]
 8.95 user [tool_result "(Bash completed with no output)"]
 8.97 system/status requesting                         ← no system/init: "two" folded in here
10.82 assistant [text "two"]
10.85 {"type":"result","subtype":"success","result":"two","num_turns":3,"result_index":0,"queued_turn_count":0,…}
      (no second init and no second result)
```

- No stdout line marks the fold unless each message carries a client `uuid` (§ Message lifecycle). With
  `--replay-user-messages` the folded message replays (`isReplay:true`) right after the last `tool_result`, with the
  same fields as a replay that opens a turn: only its place, with no `init` since the last `result`, tells them apart.
- `result.result` holds only the turn's last text ("two"); the model never wrote "done".

**Queued behind turns with no tool call.** Measured 2026-10-20 on `2.1.304`, one process, in a fresh project folder holding `notes.txt`. Launch as in § How
every probe ran: base plus cheap flags, the § Launch nested-session variables stripped. Each phase wrote
`U(Count from 1 to 200, one number per line.)` and, at the turn's first `stream_event` (`message_start`), wrote the
queued line(s) below; it ended after 10 s with no output. Seconds are counted from spawn; excerpts trimmed as above.

**A: a second message.** Queued `U(Reply with the single word two.)` at 1.99:

```
 1.99 stream_event message_start            ← U(two) written here
 3.15 assistant (text "1\n2\n…")
 3.34 {"type":"result","subtype":"success","result":"1\n2\n…200","num_turns":1,"result_index":0,"queued_turn_count":0,…}
 3.40 system/init
 4.65 assistant (text "two")
 4.77 {"type":"result","subtype":"success","result":"two","num_turns":1,"result_index":1,"queued_turn_count":0,…}
```

**B: a second message, then an interrupt.** Queued `U(Reply with the single word four.)` and, in the same
millisecond after it, `{"type":"control_request","request_id":"probe-1","request":{"subtype":"interrupt"}}`:

```
15.72 stream_event message_start            ← U(four), then the interrupt, written here
15.73 {"type":"control_response","response":{"subtype":"success","request_id":"probe-1","response":{"still_queued":[]}}}
15.73 assistant (text "1\n2\n3\n4")
15.73 user [{"type":"text","text":"[Request interrupted by user]"}]
15.73 {"type":"result","subtype":"error_during_execution","is_error":true,"num_turns":2,"terminal_reason":"aborted_streaming","result_index":2,"queued_turn_count":0,…}
15.79 system/init
17.34 assistant (text "four")
17.44 {"type":"result","subtype":"success","result":"four","num_turns":1,"result_index":3,"queued_turn_count":0,…}
```

**C: a local command queued behind a model turn.** Queued `U(/effort medium)` at 28.97:

```
30.23 {"type":"result","subtype":"success","result":"1\n2\n…200","result_index":4,…}
30.23 system/init
30.23 assistant {"message":{"model":"<synthetic>",…,"content":[{"type":"text","text":"Set effort level to medium (this session only): …"}]},…}
30.23 {"type":"result","subtype":"success","result":"Set effort level to medium (this session only): …","num_turns":0,"local_command":"effort","result_index":5,"queued_turn_count":0,…}
```

- Behind turns with no tool call, one `result` per message written, in write order, local commands included: results
  match writes first in, first out. A fold into a tool turn breaks this (above). Re-measured on 2.1.317: a message
  queued behind the count turn still ran as its own turn with its own `init` and `result`.
- The interrupt's `still_queued` was `[]` although `U(four)` was queued, and `U(four)` ran afterwards. The plain
  `interrupt` request cancels nothing queued; init's `interrupt_cancel_queued_v1` capability names some other request
  shape, not measured.
- Every `result` carried `"queued_turn_count":0`, even the A turn's result with `U(two)` waiting behind it, so the
  field does not count queued messages. A queued local command's `result` also carries `"local_command":"effort"`.
- The process exited with code 0 when stdin closed after phase C.

## Message lifecycle

Measured 2026-11-02 on `2.1.317`, as § How every probe ran. A client `uuid` on a stdin user message makes the CLI
report what happens to that message. No flag is needed: the field alone turns it on.

- Stdin `{"type":"user","message":{…},"parent_tool_use_id":null,"uuid":"<uuid4>"}` → `command_lifecycle` frames for
  that message: `{"type":"command_lifecycle","command_uuid":"<uuid4>","state":…}`. `state` is `queued` (it entered
  the queue), `started` (it was taken into a turn), then one terminal state: `completed`, `cancelled`, `discarded` or
  `refused`. A message written with no `uuid` gets no frames.
- `result`, `assistant`, `system/status` and the first stream event of a turn carry `user_message_uuid` (the message
  that opened the turn) and `user_message_uuids` (every message the turn took in, the folded ones after the opener).
  A turn Claude runs on its own was not measured with uuids.
- init's `capabilities` advertises this as `msg_lifecycle_v1` (§ Init).
- The CLI's own schema marks `command_lifecycle`, `for_user_message_uuids` and the interrupt reply's `turn` as
  `@internal`; the public Agent SDK pages document none of them. `user_message_uuid(s)` and `priority` carry no mark
  but are not in the public pages either.

**A message folded into a tool turn** (the § Queued messages tool probe, with uuids `…-0001` on `T` and `…-0002` on
U(two)):

```
 0.53 command_lifecycle -0001 queued
 0.54 command_lifecycle -0001 started
 0.58 system/init
 0.58 system/status {"status":"requesting","user_message_uuids":["…-0001"]}
 1.51 IN  U(two) uuid -0002
 1.51 command_lifecycle -0002 queued
 8.71 command_lifecycle -0002 started                  ← no init after it: folded
 8.71 system/status {"status":"requesting","user_message_uuids":["…-0001","…-0002"]}
10.65 command_lifecycle -0002 completed                ← before the turn's result
10.66 {"type":"result","result":"two","user_message_uuid":"…-0001","user_message_uuids":["…-0001","…-0002"],…}
10.66 command_lifecycle -0001 completed                ← after the result
```

**A message with its own turn** (queued behind the count turn): `started` comes right after the earlier turn's
`result` and is followed by `system/init`, and its `completed` comes after its own `result`, whose
`user_message_uuids` lists only it.

**A local slash command** (`/effort high`, `/model sonnet`, `/status`, `/mcp`, `/context`, `/compact`, each sent alone
on an idle process with a uuid) takes the same shape as a message with its own turn: `queued`, `started`,
`system/init`, a `result` with `num_turns` 0 whose `user_message_uuid` is the command's uuid and whose
`user_message_uuids` lists only it, then `completed`. `local_command` names the command (`effort`, `model`, `mcp`,
`context`, `compact`), and is null for `/status`. `/compact` took 6.5 s from `started` to its init.

- A message whose turn is interrupted gets `cancelled` after the error `result`.
- `"priority":"later"` on the stdin message kept it out of a running tool turn: it ran as its own turn (one sample).
- A named interrupt, `{"subtype":"interrupt","for_user_message_uuids":["<uuid of the turn's opener>"]}`, replies
  `"turn":"idle"` when no turn runs (and no `result` follows) and `"turn":"stopped"` when it ended one (its `result`
  follows). The CLI's strings also define `"spared"`: the interrupt named no message of the running turn and stopped
  nothing.
- The process exited with code 1, not 0, when stdin closed right after an interrupted turn with nothing after it (one
  sample).

## Subagents

Measured on 2.1.316, 2026-11-01, as § How every probe ran (base plus `--model haiku --effort low`, one process per
probe). Excerpts are trimmed as above; `toolu_…Agent` stands for the Agent call's `tool_use` id, and `a4e4…` for a
subagent's id. The profile that ran the probes has `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in its settings.

**A subagent runs in the background unless the call says `run_in_background: false`.** Every Agent call without that
input, `Explore` included, got `"is_backgrounded":true` on its `task_started`. Only the explicit `false` ran in the
foreground (`"is_backgrounded":false`). So the Agent call's `tool_result` is, by default, the launch receipt, not the
subagent's report (below).

**The Agent call's `tool_use`.** Probe 1 (stdin `U(Use the Agent tool to start one subagent of type Explore with the
description "read notes" …)`; Explore spawned on the first attempt):

```
2.12 {"type":"assistant","message":{…,"content":[{"type":"tool_use","id":"toolu_01FqZQTLkePVaZcsvgWG3jqK","name":"Agent","input":{"description":"read notes","subagent_type":"Explore","prompt":"Use the Read tool to read the file notes.txt in the current working directory (<project>). Report back its first line only. Do not modify any files."},"caller":{"type":"direct"}}],…,"usage":{…}},"parent_tool_use_id":null,…,"wire_tool_inputs":{"toolu_01FqZQTLkePVaZcsvgWG3jqK":{"description":"read notes","subagent_type":"Explore","prompt":"…"}}}
```

- **The `tool_use` `name` is `Agent`; init's `tools` still lists `Task`** (and not `Agent`): `"tools":["Task","Bash",…]`
  on 2.1.316, as on 2.1.304 (§ Init). A decoder matches both names.
- `input` keys: `description`, `prompt`, and `subagent_type` only when the model names one. Probe 2 (no type named by
  the user): `input` is `{"description":"read notes","prompt":"…"}`, with the key absent; `task_started` then reports
  `"subagent_type":"general-purpose"`. The model may pick a type itself: probe 6's call (also no type named) carried
  `"subagent_type":"wigley:reader-sonnet"`.
- `run_in_background` is in `input` only when the model sets it: `true` in probe 4, `false` in the foreground probes,
  absent otherwise. Probe 4: `{"description":"read notes","prompt":"…","run_in_background":true}`. The CLI did not
  refuse the option.
- No other `input` key appeared in these probes. The tool's schema also takes `name`, `model` and `effort`, which the
  model sets only when asked (below).
- **`name`, `model` and `effort` inputs** (Claude 2.1.317, probed 2026-11-02 with `claude -p … --output-format
  stream-json --verbose --model haiku --effort low`, one turn whose prompt asked for one Agent call with these inputs).
  They arrive verbatim in `input` (and in `wire_tool_inputs`): `model` is the alias the call gave, not a model id.

  ```
  {"type":"assistant","message":{"model":"claude-haiku-5-5",…,"content":[{"type":"tool_use","id":"toolu_01VkSUB6QndznDsC1sePT7Rd","name":"Agent","input":{"description":"say ok","subagent_type":"general-purpose","name":"probe-agent","model":"haiku","effort":"low","run_in_background":true,"prompt":"Reply with the single word OK and use no tools."},"caller":{"type":"direct"}}],…},"parent_tool_use_id":null,…}
  ```

  `task_started` carries none of the three (`description`, `subagent_type`, `is_backgrounded`, `spawn_depth`,
  `task_type`, `prompt`, as above). The launch receipt names the model id the subagent runs on in
  `tool_use_result.resolvedModel`, and does not echo `name` or `effort`:
  `"tool_use_result":{"isAsync":true,"status":"async_launched","agentId":"ad7f1eca80ac1ed99","description":"say ok","resolvedModel":"claude-haiku-5-5","prompt":"…","outputFile":"<tasks>/ad7f1eca80ac1ed99.output","canReadOutputFile":true,…}`.
  Session transcripts of 2.1.314 (2026-10-31) show the same `name` input on Agent calls a main agent made unprompted
  (`{"subagent_type":"wigley:opus-medium","description":"Draft plan tasks 06-10","name":"drafter-b",…}`).
- A reader pins an Agent call by `tool_use.id`, which is also the `tool_use_id` of every `task_*` line below.

**The system lines for a subagent.** All four carry the Agent call's id in `tool_use_id` (not in
`parent_tool_use_id`, which no `system` line carried) and the subagent's id in `task_id`:

```
3.40 {"type":"system","subtype":"background_tasks_changed","tasks":[{"task_id":"a4e45e22d2e0fef8f","run_id":"0mvylyy1j-5c2e141f","task_type":"local_agent","subagent_type":"Explore","description":"read notes"}]}
3.40 {"type":"system","subtype":"task_started","task_id":"a4e45e22d2e0fef8f","run_id":"0mvylyy1j-5c2e141f","tool_use_id":"toolu_01FqZQTLkePVaZcsvgWG3jqK","description":"read notes","subagent_type":"Explore","is_backgrounded":true,"spawn_depth":1,"task_type":"local_agent","prompt":"Use the Read tool …"}
4.76 {"type":"system","subtype":"task_progress","task_id":"a4e45e22d2e0fef8f","run_id":"0mvylyy1j-5c2e141f","tool_use_id":"toolu_01FqZQTLkePVaZcsvgWG3jqK","description":"Reading notes.txt","subagent_type":"Explore","usage":{"total_tokens":15662,"tool_uses":1,"duration_ms":1363},"last_tool_name":"Read"}
7.71 {"type":"system","subtype":"task_updated","task_id":"a4e45e22d2e0fef8f","run_id":"0mvylyy1j-5c2e141f","patch":{"status":"completed","end_time":1793584619176}}
7.71 {"type":"system","subtype":"task_notification","task_id":"a4e45e22d2e0fef8f","run_id":"0mvylyy1j-5c2e141f","tool_use_id":"toolu_01FqZQTLkePVaZcsvgWG3jqK","status":"completed","output_file":"<tasks>/a4e45e22d2e0fef8f.output","summary":"This agent's report was delivered to you as a message from \"a4e45e22d2e0fef8f\" (its SubagentHandback call). Read it there; it is not repeated here.\n","usage":{"total_tokens":16993,"tool_uses":2,"duration_ms":4309},"handback":"send","handback_report":{"text":"First line of notes.txt: spike"}}
7.71 {"type":"system","subtype":"background_tasks_changed","tasks":[]}
```

- **New system subtypes:** `task_started` (the start: `subagent_type`, `description`, `prompt`, `is_backgrounded`,
  `spawn_depth`), `task_progress` (one per subagent tool call: `description` is a model-written label of the current
  tool call, `last_tool_name`, cumulative `usage.{total_tokens,tool_uses,duration_ms}`; `usage.total_tokens` counts the
  subagent's tokens, not the main context), `task_updated` (`patch.status`: `completed`, or `killed` on an interrupt),
  `task_notification` (the end event) and `background_tasks_changed` (`tasks` is the full list of running tasks; `[]`
  when none). `task_updated` and `task_notification` arrive in the same millisecond, and the list update follows.
  `task_started` and `task_notification` carry the call's id as `tool_use_id`; `task_updated` carries only
  `task_id` and `run_id`, and `background_tasks_changed` only its `tasks` list.
- **The subagent's id** is `task_id`: `a4e45e22d2e0fef8f`. It also appears as `agent_id` on the subagent's
  `assistant`/`user` lines and as `agentId` in the Agent call's `tool_use_result`. It differs from the call's
  `toolu_` id, and the pair is given by `task_started` (`task_id` with `tool_use_id`).
- **The end event is `system/task_notification`**, with `status` `completed` (or `stopped` after an interrupt,
  below), the call's id in `tool_use_id`, `usage` and, on a normal end, `handback_report.text` (the subagent's final
  message, here from its `SubagentHandback` tool call; a subagent that ends in plain text was not measured). No
  `<task-notification>` user message appeared. `task_notification` comes 0 ms after the subagent's last line (its last
  `user` tool result). `status` `failed` was not observed. It is not always the subagent's last word: on 2026-11-03 a
  background subagent waiting on its own background shell finished about 80 s before its shell ended, then replied and
  handed back. The adapter's log shows the finish and the late replies; the raw line was not captured, and the adapter
  has no other route that finishes a launched subagent.
- **After the end, the harness runs a turn on the main agent** when the main turn is already over (below):
  `system/init`, `system/status requesting`, an `assistant`, and a `result` whose `origin` is
  `{"kind":"peer","from":"a5d2bf79d0e109653","senderTaskId":"a5d2…","name":"general-purpose","body":"[Subagent hand-back] …","handback":true,"handbackReportText":"spike"}`;
  then a second `init` and an empty `result` (`"result":""`, `"num_turns":0`, `"origin":{"kind":"task-notification","producer":"session-task","runId":"0mvylzfvo-dc6760e4"}`).
  Each `result` carries `subagent_stats`:
  `{"spawned":1,"requested":{"background":1,"foreground":0,"unset":0},"started_in_background":1,"max_depth":1,"spawned_by_subagents":0,"completed":1,"failed":0,"killed":{"parent":0,"user":0,"system":0},"refused":{…},"by_type":{"general-purpose":1}}`.
  Neither `result` is a user turn: these two come with no stdin message. A message written while such a turn runs
  folds into it (§ Queued messages). The adapter shows working from such a turn's `init` to its `result`, as for any
  turn, with no message of its own to close.

**The subagent's own lines.** `assistant` and `user` events only; **no `stream_event` lines for a subagent** in any
probe. Every one carries `parent_tool_use_id` equal to the Agent call's `tool_use` id (checked on all subagent lines of
probes 1, 2, 4, 6 and 7), plus three top-level keys the main agent's lines lack: `agent_id`, `subagent_type`,
`task_description`. A subagent's tool call and its result:

```
4.76 {"type":"assistant","message":{"model":"claude-haiku-5-5","id":"msg_011CgdGgYLDfFWRV43cgsu25",…,"content":[{"type":"tool_use","id":"toolu_01Th9zCiM7nvQkeAH1gsms6w","name":"Read","input":{"file_path":"<project>/notes.txt"},"caller":{"type":"direct"}}],…,"usage":{"input_tokens":2,"cache_creation_input_tokens":15637,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":15637,"ephemeral_1h_input_tokens":0},"output_tokens":17,…}},"parent_tool_use_id":"toolu_01FqZQTLkePVaZcsvgWG3jqK","agent_id":"a4e45e22d2e0fef8f","request_id":"req_011CgdGgY1sEU695qQGKYAK9","subagent_type":"Explore","task_description":"read notes"}
4.84 {"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01Th9zCiM7nvQkeAH1gsms6w","type":"tool_result","content":"1\tspike\n2\t"}]},"parent_tool_use_id":"toolu_01FqZQTLkePVaZcsvgWG3jqK","agent_id":"a4e45e22d2e0fef8f","tool_result_meta":[{…}],"subagent_type":"Explore","task_description":"read notes"}
```

- A subagent's tool calls are `tool_use` blocks in `assistant` events carrying the parent id, and their results are
  `user` events carrying it: yes, as above. A thinking block is its own `assistant` line there too (one block per
  event, § Assistant messages).
- **A subagent's `assistant` events carry `message.usage`**, in the shape of the main agent's. Its values are the
  subagent's own context (above: `cache_creation_input_tokens` 15637 on its first call, against 34649 for the main
  agent's call at 2.12), so the usage plan's reader skips any line with a non-null `parent_tool_use_id`.
- A foreground subagent also emits a first `user` line holding its prompt as a text block, with the parent id
  (`"content":[{"type":"text","text":"Read the file notes.txt … "}]`, 2.46, 0 ms after `task_started`). A
  background subagent printed no such line.
- The subagent's last tool is `SubagentHandback` on this machine (its report goes back through it): its `tool_use`
  `input` is `{"message":"…"}`, and its `user` result is `{"success":true,"message":"Report delivered to your caller."}`.
  A subagent's tool list depends on the install, so a reader does not rely on this tool's name.
- A subagent's own background task (a Bash command it ran) prints a `task_started` of its own, then a
  `task_notification` when done, both without `subagent_type` and with the owning subagent named:
  `{"type":"system","subtype":"task_started","task_id":"bpdumb7hy","tool_use_id":"toolu_013yMwaFpXAMzqHRy4wXcMto","description":"Sleep for 45 seconds via python3","is_backgrounded":false,"parent_task_id":"a8e9e7aad968da282","owned_by_subagent":true,"task_type":"local_bash"}`.
  Its `task_type` is `local_bash`, against `local_agent`, and its `tool_use_id` is the subagent's own Bash call, so a
  reader keys a subagent on `task_type":"local_agent"`. Its `parent_task_id` is the owning subagent's `task_id`, not
  its Agent call's id, so a reader pairs the two from the subagent's own `task_started`.
- **The main agent's background Bash** (`run_in_background: true`, Claude 2.1.316, probed 2026-11-02 with
  `claude -p … --output-format stream-json --verbose`) prints the same task lines with no owner:
  `background_tasks_changed` listing it, then
  `{"type":"system","subtype":"task_started","task_id":"bvrvtgapv","tool_use_id":"toolu_016R…","description":"Sleep 6 seconds in background","is_backgrounded":true,"task_type":"local_bash"}`,
  then the Bash call's `tool_result` (`Command running in background with ID: bvrvtgapv. Output is being written to:
  <tasks>/bvrvtgapv.output …`). The `result` of the turn comes next, and the task keeps running past it. Its end is
  `task_updated` (`patch.status` `completed`), then `task_notification` with the same `task_id` and `tool_use_id`,
  `status` `completed`, `output_file`, and `summary` `Background command "Sleep 6 seconds in background" completed (exit
  code 0)`, then `background_tasks_changed` with `[]`. In the app's own session (a drive run, 2026-11-02), Claude then
  ran a turn of its own to report the finished command, as it does after a background subagent ends.

**The Agent call's `tool_result`.**

- **Background (the default).** It arrives at the launch, 0.07 s after `task_started` and **before any subagent line**,
  and says nothing about the report:

  ```
  3.47 {"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01FqZQTLkePVaZcsvgWG3jqK","type":"tool_result","content":[{"type":"text","text":"Async agent launched successfully. (This tool result is internal metadata …)\nagentId: a4e45e22d2e0fef8f (internal ID …)\nThe agent is working in the background. You will be notified automatically when it completes. …\noutput_file: <tasks>/a4e45e22d2e0fef8f.output\n…"}]}]},"parent_tool_use_id":null,…,"tool_use_result":{"isAsync":true,"status":"async_launched","agentId":"a4e45e22d2e0fef8f","description":"read notes","resolvedModel":"claude-haiku-5-5","prompt":"…","outputFile":"<tasks>/a4e45e22d2e0fef8f.output","canReadOutputFile":true,"canContinueAgent":true},"tool_result_meta":[{…}]}
  ```

  `content` is an array of `text` blocks; there is no `is_error`. The main agent's turn usually ends (`result`) before
  the subagent does: probe 1 `result` at 5.52, `task_notification` at 7.71; probe 4 `result` at 4.11, end at 6.07.
  The subagent's lines keep arriving after that `result`, then `task_notification` and the follow-up turn.
- **Foreground** (`run_in_background: false`). It arrives after the subagent's last line and 0.04 s after
  `task_notification`:

  ```
  6.28 system/task_notification   (status completed)
  6.32 {"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01UHa5cdpgttXA663ts275NS","type":"tool_result","content":[{"type":"text","text":"  This agent's report was delivered to you as a message from \"a9ad8b8754f9ef387\" (its SubagentHandback call). Read it there; it is not repeated here.\n  \nagentId: a9ad8b8754f9ef387 (use SendMessage …)\n<usage>subagent_tokens: 31736\ntool_uses: 2\nduration_ms: 3829</usage>"}]}]},"parent_tool_use_id":null,…,"tool_use_result":{"status":"completed","prompt":"…","agentId":"a9ad8b8754f9ef387","agentType":"general-purpose","handback":"send","handbackReport":{"text":"The first line of …"},"toolsUsed":["Read","SubagentHandback"],"content":[{"type":"text","text":"This agent's report was delivered to you as a message from …"}],"resolvedModel":"claude-haiku-5-5","totalDurationMs":3829,"totalTokens":31736,"totalToolUseCount":2,"usage":{…}}}
  ```

  `parent_tool_use_id` is `null` and `tool_use_result` is an object with `status`, `agentId`, `agentType`,
  `handbackReport.text`, `toolsUsed`, `totalDurationMs`, `totalTokens`, `totalToolUseCount` and `usage`. The report
  text is in `tool_use_result.handbackReport.text` and `task_notification.handback_report.text`; the `content` text is
  a pointer, not the report.
- **Failure.** Probe 3 (unknown type): the call gets no `task_*` line and no subagent line; its error comes 0.74 s
  after the `tool_use` (3.22 → 3.96) as an ordinary failed tool result (§ Tool results):

  ```
  3.96 {"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Agent type 'no-such-agent' not found. Available agents: claude, Explore, general-purpose, Plan, statusline-setup, wigley:haiku, …","is_error":true,"tool_use_id":"toolu_01TY9qXDX4qukQXpdow3rvTw"}]},"parent_tool_use_id":null,…,"tool_use_result":"Error: Agent type 'no-such-agent' not found. Available agents: claude, Explore, …","tool_result_meta":[{…}]}
  ```

  The model then answered in text and the turn ended `success`. A subagent that starts and then fails (`status`
  `failed`) was not observed.

**`tool_progress` for the Agent call.** A foreground subagent whose Bash call slept 45 s printed one heartbeat at
32.95 s, 30 s after the call started (§ Other events), naming the Agent call:

```
32.95 {"type":"tool_progress","tool_use_id":"toolu_01NMyJe26umYFtHXKQgytyLA-heartbeat-0","tool_name":"Agent","parent_tool_use_id":"toolu_01NMyJe26umYFtHXKQgytyLA","elapsed_time_seconds":30,"heartbeat":true,…}
```

Here `parent_tool_use_id` is the Agent call's id, the same value a subagent's own lines carry, and the line has no
`agent_id`. A decoder that maps `parent_tool_use_id` to a subagent must not read this line as the subagent's activity:
its `type` is `tool_progress`. The subagent's Bash call (a background task of its own) had no heartbeat of its own.
Background launches (the Agent call's `tool_result` came at once) printed no `tool_progress` in the 4–7 s probes; a
background subagent running past 30 s was not measured.

**Probe 4, background with `run_in_background: true`.** Same as the default, since the default is background: the
`tool_result` at launch (3.11), the main turn's `result` at 4.11 (`"result":"Waiting on the background agent …"`), the
subagent's lines at 4.45–6.07, then:

```
6.07 system/task_updated {"patch":{"status":"completed",…}}
6.07 system/task_notification {"task_id":"a5d2bf79d0e109653","tool_use_id":"toolu_01UyJ5sv6bZNWc6kmUugWkJn","status":"completed",…,"handback_report":{"text":"spike"}}
6.07 system/background_tasks_changed {"tasks":[]}
6.09 system/init … 7.43 result/success "done"   (origin kind "peer": the subagent's hand-back, above)
```

The end event ties to the Agent call by `task_notification.tool_use_id` equal to the call's `tool_use.id`
(`toolu_01UyJ5sv6bZNWc6kmUugWkJn`), and by `task_id` equal to the launch receipt's `tool_use_result.agentId`.

**Probe 6, interrupt.** The `interrupt` control request as § Interrupt sends it.

- **Foreground subagent**, interrupt at 4.34, mid-run (the subagent had made one Read, result at 3.83), before the Agent
  call's `tool_result`:

  ```
  4.34 stdin  {"type":"control_request","request_id":"spike-int","request":{"subtype":"interrupt"}}
  4.35 {"type":"control_response","response":{"subtype":"success","request_id":"spike-int","response":{"still_queued":[]}}}
  4.36 {"type":"system","subtype":"task_updated","task_id":"af0c6c15600dc7947","run_id":"0mvym12x8-634db02c","patch":{"status":"killed","end_time":1793584716241}}
  4.36 {"type":"system","subtype":"task_notification","task_id":"af0c6c15600dc7947","tool_use_id":"toolu_017C8XtU59g9eSqrTt6PAvVU","status":"stopped","output_file":"<tasks>/af0c6c15600dc7947.output","summary":"read notes"}
  4.36 {"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed. Correction to the text above: this call was stopped while running, not refused before it ran. …","is_error":true,"tool_use_id":"toolu_017C8XtU59g9eSqrTt6PAvVU"}]},"parent_tool_use_id":null,…,"tool_use_result":"User rejected tool use","tool_result_meta":[{"id":"toolu_017C8XtU59g9eSqrTt6PAvVU","non_execution_kind":"user-rejected"}]}
  4.36 {"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]},"parent_tool_use_id":null,…}
  4.36 {"type":"result","subtype":"error_during_execution","is_error":true,"stop_reason":"tool_use","terminal_reason":"aborted_tools","num_turns":3,"errors":["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"],"subagent_stats":{"spawned":1,"requested":{"background":0,"foreground":1,"unset":0},"started_in_background":0,…,"completed":0,"failed":0,"killed":{"parent":0,"user":1,"system":0},…},…}
  ```

  So the Agent call **does** get a `tool_result`, `is_error: true` with the text above, parent id `null`, in the same
  millisecond as the `task_notification` (`status: "stopped"`). **No subagent line follows the interrupt** (the subagent's
  last line was its Read result at 3.83). The turn's `result` is `error_during_execution` with
  `terminal_reason: "aborted_tools"` and `stop_reason: "tool_use"`, and the marker text reads `… for tool use]` (against
  § Interrupt's `[Request interrupted by user]` for an interrupt during text). There is no `result` key; the process
  stayed alive until stdin closed, and then exited with code **1**, not the 0 § Interrupt records for a control
  interrupt, with no stderr line (also on a second run, interrupted at 2.38 s, before `task_started`: the Agent
  call got the same error `tool_result`, the marker read `[Request interrupted by user]`, and the `result` had
  `terminal_reason` `aborted_streaming`, `stop_reason` `null` and no `task_*` lines).
- **Background subagent**, interrupt at 4.99 (the launch receipt and the main turn's `result` were already out, 4.43;
  the subagent was running). There is no pending Agent `tool_result` to cancel, so none is printed, and no `result`
  (no turn was running):

  ```
  4.99 system/task_updated {"patch":{"status":"killed",…}}
  4.99 system/task_notification {"task_id":"af1f9edb244f783e5","tool_use_id":"toolu_01SHt4fc61cUU5vZjsgvzhQ6","status":"stopped","output_file":"<tasks>/af1f9edb244f783e5.output","summary":"read notes"}
  4.99 system/background_tasks_changed {"tasks":[]}
  4.99 control_response {"subtype":"success","request_id":"spike-int","response":{"still_queued":[]}}
  4.99 {"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]},"parent_tool_use_id":"toolu_01SHt4fc61cUU5vZjsgvzhQ6","agent_id":"af1f9edb244f783e5","subagent_type":"wigley:reader-sonnet","task_description":"read notes"}
  ```

  The interrupt kills the running background subagent too, ends it with `task_notification` `status: "stopped"` (no
  `handback_report`), and prints the interrupt marker as a **subagent line** (`parent_tool_use_id` = the call's id,
  with `agent_id`). The process exited with code 0. No follow-up turn ran.
- A subagent's end therefore comes as `task_notification` in every case measured (`completed`, `stopped`), so an
  adapter finishes a subagent on that line, keyed by `tool_use_id`, and need not wait for the Agent call's `tool_result`.

**Probe 7, what stops background work** (2.1.318). One run per row, haiku, with a subagent or background Bash waiting on
a 60 s command. "Stopped" is `task_notification` `status: "stopped"` in the same 10 ms as the request.

| Request | Main turn | Background work | Result |
|---|---|---|---|
| `interrupt` | idle, in a tool, or streaming | subagent | stopped; a turn's `result` is `error_during_execution` |
| `interrupt` | at the Agent `tool_use` or at `task_started`, in the launching turn | subagent | stopped, the launch line printed first when it had not been |
| `interrupt` | idle or in a tool | main agent's background Bash | **keeps running**: `completed` at 60 s, and Claude then runs a turn of its own to report it |
| `interrupt` | idle | a subagent and that subagent's own background Bash | both stopped; the Bash's lines come last, 10 ms later |
| `stop_task` | idle | subagent | stopped, then Claude runs a turn of its own |
| `stop_task` | idle | main agent's background Bash | stopped; no turn within 15 s |
| `stop_task` | in a tool | subagent or background Bash | stopped; the main turn keeps running |

- The request is `{"type":"control_request","request_id":"…","request":{"subtype":"stop_task","task_id":"<task_id>"}}`,
  and its reply is `success` with `response: {}`, an id that names no task included.
- `interrupt` then `stop_task` for each id `background_tasks_changed` last listed, written together, ended a subagent and
  a background Bash at once, idle and in a turn, with no turn of Claude's own in the next 20 s. Each order of the two
  requests ended a Bash alone the same way.
- `background_tasks_changed` lists backgrounded tasks only: a foreground Bash, the main agent's or a subagent's, is not
  in it, and each ends with what owns it.

**Not observed:** `task_notification` `status: "failed"`, a subagent that spawns its own subagent (`spawn_depth` was 1
in every probe), a subagent `stream_event`, a `<task-notification>` user message, and a background subagent running
past 30 s.

## Compaction

Measured on 2.1.316, 2026-11-01. Probe 5: in the probe 1 process, `U(/compact)` after the first turn's `result`, then
`U(Reply with the single word ok.)`. The conversation held the Agent call and its subagent (above) and was 37,393
tokens at its last main-agent message (`usage`: `input_tokens` 2 + `cache_creation_input_tokens` 2744 +
`cache_read_input_tokens` 34647, taken as their sum). The summary took 8.3 s (5.59 → 13.98), during which the
background subagent finished (the `task_*` lines of § Subagents arrived between).

```
5.59  stdin  U(/compact)
5.63  {"type":"system","subtype":"status","status":"compacting"}
13.93 {"type":"system","subtype":"hook_started","hook_name":"SessionStart:compact","hook_event":"SessionStart",…}
13.98 {"type":"system","subtype":"hook_response","hook_name":"SessionStart:compact",…,"exit_code":0,"outcome":"success"}
13.98 {"type":"system","subtype":"status","status":null,"compact_result":"success"}
13.98 {"type":"system","subtype":"init",…}
13.98 {"type":"system","subtype":"compact_boundary","compact_metadata":{"trigger":"manual","pre_tokens":37559,"post_tokens":9023,"cumulative_dropped_tokens":28536,"duration_ms":8303,"preserved_segment":{"head_uuid":"c207…","anchor_uuid":"13de…","tail_uuid":"05ab…"},"preserved_messages":{"anchor_uuid":"13de…","uuids":["c207…","1572…","7797…","05ab…"],"all_uuids":[…]}},"logical_parent_uuid":"05ab…"}
13.98 {"type":"user","message":{"role":"user","content":"This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n<system-reminder>\n<tools-used-before-summary>Agent, Read</tools-used-before-summary>\n</system-reminder>\nSummary:\n1. Primary Request and Intent: …"},"parent_tool_use_id":null,…}
13.98 {"type":"user","message":{"role":"user","content":"<local-command-stdout>Compacted </local-command-stdout>"},"parent_tool_use_id":null,…,"isReplay":true}
13.98 {"type":"result","subtype":"success","is_error":false,"result":"","stop_reason":null,"num_turns":0,"local_command":"compact","total_cost_usd":0.00967945,"duration_ms":…,"modelUsage":{…},"subagent_stats":{…},…}
```

- **`system/compact_boundary`** is the compaction marker. `compact_metadata`: `trigger` (`"manual"` here; an automatic
  compaction's is `"auto"`, § Automatic compaction), `pre_tokens` (37559), **`post_tokens`** (9023: the after-size key exists),
  `cumulative_dropped_tokens` (28536, which is `pre_tokens − post_tokens`), `duration_ms`, `preserved_segment`
  (`head_uuid`, `anchor_uuid`, `tail_uuid`) and `preserved_messages` (`anchor_uuid`, `uuids`, `all_uuids`). The line
  also has top-level `logical_parent_uuid`.
- **A `/compact` that succeeds prints no synthetic `assistant` event** (unlike § Effort's local commands; one that
  fails prints one, § Interrupt during /compact and § /compact with nothing to compact). The lines, in order:
  `system/status compacting`, the `SessionStart:compact` hook pair, `system/status` with `status: null` and
  `compact_result: "success"`, `system/init`, `compact_boundary`, a `user` event whose string `content` is the
  summary prompt, a `user` replay `<local-command-stdout>Compacted </local-command-stdout>` (`isReplay: true`), and a
  `result` with `"local_command":"compact"`, `"result":""`, `"num_turns":0`, `"stop_reason":null` and no
  `terminal_reason`. The `init` here comes after the `status`, not before it as in other local commands.
- **`pre_tokens` against usage.** `pre_tokens` (37559) is 166 above the last main message's context (37393: the
  `assistant` `usage` sum before the compaction), so it is the context size at the compaction.
  `post_tokens` (9023) is **not** what the next message's usage shows: the next messages' context (`input_tokens` +
  `cache_creation_input_tokens` + `cache_read_input_tokens`) was 38,021 (the follow-up turn the subagent's end
  started, 16.61) and 38,930 (the `ok` turn, 18.04: `{"input_tokens":2,"cache_creation_input_tokens":909,"cache_read_input_tokens":38019}`),
  about the size before the compaction. The context after a compaction therefore reads from the next `usage`, not from
  `post_tokens`; `post_tokens` counts the conversation messages, and the next call's input also holds the system prompt
  and tools. The adapter's context size (`replyUsageOf`) is that same sum plus `output_tokens`, so its after-size reads
  a few tokens higher: with 5 output tokens, 38,930 reads 38,935.
- The next call after the compaction rebuilt the cache: `"diagnostics":{"cache_miss_reason":{"type":"messages_changed","cache_missed_input_tokens":22479}}`
  and `"input_transformations":[{"type":"thinking_dropped",…}]` on the 16.61 `assistant`.
- **`get_context_usage` reads the after-size with no model call.** Measured on 2.1.318, 2026-11-04, Haiku, as § How
  every probe ran: right after `/compact`'s `result`, the reply's `totalTokens` was 37,102 (`post_tokens` 9,304), and the
  next `assistant`, a one-word turn, summed to 38,412 with `cache_read_input_tokens` 13,463 and
  `cache_creation_input_tokens` 24,940. The reply answered in 0.14 s and its `apiUsage` was null.

The subsections below were measured on 2.1.318, 2026-11-03, as § How every probe ran. Each stdin user message carries a
client `uuid` (§ Message lifecycle), and each process has its own project folder. `IN` marks a line the driver wrote,
seconds count from spawn, and uuids are cut to their last characters. `T1` is U(Reply with the single word ok.), whose
reply reads 34,856 tokens of context. Every process ran with the user's config folder, whose `settings.json` `env` sets
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=30` even though the driver strips that variable from the child's env.

### Automatic compaction

Child env adds `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=5`. Stdin: `T1`, then after
its `result`, U(Use the Bash tool to run cat notes.txt, then reply with the single word done.) with uuid `…9189`. No
fallback was needed. Turn 2 printed two compaction attempts: one failed before the first model request, and one
succeeded between the tool result and the next model request.

```
 1.65 IN  U(Use the Bash tool…) uuid …9189
 1.65 command_lifecycle …9189 queued
 1.65 command_lifecycle …9189 started
 1.67 system/init
 1.67 {"type":"system","subtype":"status","status":"requesting","user_message_uuids":["…9189"]}
 1.67 {"type":"system","subtype":"status","status":"compacting","compact_output_chars":0}
 1.67 {"type":"system","subtype":"status","status":null,"compact_result":"failed","compact_error":"too_few_groups"}
 2.74 stream_event message_start
 3.82 assistant [tool_use Bash "cat notes.txt"]  usage {"input_tokens":2,"cache_creation_input_tokens":12985,"cache_read_input_tokens":24111,…}
 6.07 user [tool_result "spike"]
 6.08 {"type":"system","subtype":"status","status":"requesting","user_message_uuids":["…9189"]}
 6.08 {"type":"system","subtype":"status","status":"compacting","compact_output_chars":0}
16.64 {"type":"system","subtype":"hook_started","hook_name":"SessionStart:compact",…}
16.65 {"type":"system","subtype":"hook_response","hook_name":"SessionStart:compact",…,"exit_code":0,"outcome":"success"}
16.65 {"type":"system","subtype":"status","status":null,"compact_result":"success"}
16.66 {"type":"system","subtype":"compact_boundary","compact_metadata":{"trigger":"auto","pre_tokens":37384,"post_tokens":9176,"cumulative_dropped_tokens":28208,"duration_ms":10552,"preserved_segment":{"head_uuid":…,"anchor_uuid":…,"tail_uuid":…},"preserved_messages":{"anchor_uuid":…,"uuids":[…],"all_uuids":[…]}},"logical_parent_uuid":…}
16.66 {"type":"user","message":{"role":"user","content":[{"type":"text","text":"This session is being continued from a previous conversation that ran out of context.…"}]},"parent_tool_use_id":null,…,"isSynthetic":true}
17.86 stream_event message_start
19.09 assistant [text "done"]  usage {"input_tokens":2,"cache_creation_input_tokens":24288,"cache_read_input_tokens":13463,"output_tokens":5}
19.12 {"type":"result","subtype":"success","is_error":false,"result":"done","stop_reason":"end_turn","num_turns":3,"terminal_reason":"completed","user_message_uuid":"…9189","user_message_uuids":["…9189"],…}
19.12 command_lifecycle …9189 completed
```

- **Trigger.** `compact_metadata.trigger` is `"auto"`.
- **Start.** `system/status` `compacting` comes before the boundary: 10.58 s before it in the attempt that succeeded.
- **Repeats.** Turn 2 has two `compacting` lines. Each opens its own attempt, and its own `status: null` line closes
  that attempt. No attempt printed a second `compacting` line. So a `compacting` line after a closed attempt is a new
  start.
- **A failed attempt.** `compact_result: "failed"` with `compact_error: "too_few_groups"` prints no hook pair, no
  boundary and no other line, and the turn goes on to its model request.
- **Fields.** `compacting` carries `compact_output_chars` (0 both times; a `/compact`'s line does not have this field).
  It carries neither `user_message_uuid` nor `user_message_uuids`, in any probe here. An automatic compaction has no
  lifecycle frames of its own: only `…9189`'s three frames, with `completed` after the `result`.
- **Line order.** `requesting`, `compacting`, the `SessionStart:compact` hook pair, `status: null`, the boundary, the
  summary `user` line. Unlike `/compact`:
  - no `system/init` comes inside the compaction
  - no `<local-command-stdout>` replay comes
  - the compaction has no `result`: the turn's one `result` comes at its end (`num_turns` 3)
  - the summary's `content` is an array with one text block, where `/compact`'s is a string
  - no second `requesting` comes before the next model request
- **After-size.** The next reply's context is 37,753 (`2 + 24288 + 13463`), next to `pre_tokens` 37384 and `post_tokens`
  9176. The after-size reads from the next `usage`, as above.
- **Levers.** The compaction fired at about 37k of context with the 100k window. The context here is above both 5 % and
  30 % of 100k, so this probe does not tell whether the child env's 5 or `settings.json`'s 30 applied.
- No other line type (for example `autocompact_state`) came in the compaction.

### Interrupt during /compact

Stdin: `T1`; after its `result`, `U(/compact)` with uuid `…1351`; at the first `compacting` line,
`{"type":"control_request","request_id":"probe-int","request":{"subtype":"interrupt"}}`; 30 s later,
U(Reply with the single word after.). One sample, with the interrupt written within 10 ms of `compacting`.

```
 1.64 IN  U(/compact) uuid …1351
 1.64 command_lifecycle …1351 queued
 1.64 command_lifecycle …1351 started
 1.64 {"type":"system","subtype":"status","status":"compacting"}
 1.64 IN  {"type":"control_request","request_id":"probe-int","request":{"subtype":"interrupt"}}
 1.65 {"type":"control_response","response":{"subtype":"success","request_id":"probe-int","response":{"still_queued":[]}}}
 1.65 {"type":"system","subtype":"status","status":null,"compact_result":"failed","compact_error":"API Error: Request was aborted."}
 1.65 system/init
 1.65 {"type":"assistant","message":{"model":"<synthetic>",…,"content":[{"type":"text","text":"Compaction canceled."}],"usage":{"input_tokens":0,…}},"local_command_source":"<local-command-stdout>Compaction canceled.</local-command-stdout>",…}
 1.65 {"type":"result","subtype":"success","is_error":false,"result":"","stop_reason":null,"num_turns":0,"local_command":"compact","user_message_uuid":"…1351","user_message_uuids":["…1351"],…}
 1.66 command_lifecycle …1351 cancelled
      (no line for 30 s)
31.64 IN  U(Reply with the single word after.)
31.68 system/init
33.15 {"type":"result","subtype":"success","is_error":false,…,"terminal_reason":"completed",…}
```

- **A plain interrupt stops `/compact`.** No boundary and no hook pair come. The first end line is `status: null` with
  `compact_result: "failed"`, 10 ms after the interrupt; the last compaction line, `cancelled`, comes 20 ms after it.
- The command's `result` is not an error: `is_error` false, `result` empty, and no `terminal_reason`. No
  `[Request interrupted by user]` line comes. The lifecycle frame `cancelled` and the synthetic `Compaction canceled.`
  are the marks of the cancel. (§ Message lifecycle's `cancelled` after an error `result` is a model turn's shape.)
- The `after` turn runs as a normal turn on the uncompacted context (37,212 tokens).

### A message during /compact

Stdin: `T1`; after its `result`, `U(/compact)` with uuid `…705e`; at the first `compacting` line,
U(Reply with the single word two.) with uuid `…2142`.

```
 1.55 IN  U(/compact) uuid …705e
 1.55 command_lifecycle …705e queued
 1.55 command_lifecycle …705e started
 1.55 {"type":"system","subtype":"status","status":"compacting"}
 1.55 IN  U(Reply with the single word two.) uuid …2142
 1.56 command_lifecycle …2142 queued
 6.49 {"type":"system","subtype":"hook_started","hook_name":"SessionStart:compact",…}
 6.50 {"type":"system","subtype":"hook_response","hook_name":"SessionStart:compact",…}
 6.51 {"type":"system","subtype":"status","status":null,"compact_result":"success"}
 6.51 system/init  user_message_uuids ["…705e"]
 6.51 {"type":"system","subtype":"compact_boundary","compact_metadata":{"trigger":"manual","pre_tokens":34860,"post_tokens":8681,"cumulative_dropped_tokens":26179,"duration_ms":4932},…}
 6.51 user (summary, string content, "isReplay":false,"isSynthetic":true)
 6.51 user <local-command-stdout>Compacted </local-command-stdout> ("isReplay":true)
 6.51 {"type":"result","subtype":"success","result":"","num_turns":0,"local_command":"compact","user_message_uuid":"…705e",…}
 6.51 command_lifecycle …705e completed
 6.51 command_lifecycle …2142 started
 6.54 system/init  user_message_uuids ["…2142"]
 7.79 assistant [text "2"]  usage {"input_tokens":2,"cache_creation_input_tokens":23957,"cache_read_input_tokens":13463,"output_tokens":1}
 7.82 {"type":"result","subtype":"success","is_error":false,"result":"2","num_turns":1,"terminal_reason":"completed","user_message_uuid":"…2142","user_message_uuids":["…2142"],…}
 7.82 command_lifecycle …2142 completed
```

- **The message waits, then runs as its own turn.** It stays `queued` for the whole compaction. It is `started` right
  after the `/compact`'s `completed`, with its own `init` and its own `result`. It is neither folded nor cancelled.
- It runs on the small context: its reply reads 37,422 (`2 + 23957 + 13463`), next to `post_tokens` 8681.
- This boundary's `compact_metadata` has only the five fields above: `preserved_segment` and `preserved_messages` are
  optional.

### /compact with nothing to compact

Stdin: `U(/compact)` with uuid `…aa45`, as a new process's first message. Logged for 20 s.

```
 0.00 IN  U(/compact) uuid …aa45
 0.28 system/hook_started  SessionStart:startup
 0.31 system/hook_response SessionStart:startup
 0.33 command_lifecycle …aa45 queued
 0.34 command_lifecycle …aa45 started
 0.37 {"type":"system","subtype":"status","status":"compacting"}
 0.37 {"type":"system","subtype":"status","status":null,"compact_result":"failed","compact_error":"Not enough messages to compact."}
 0.38 system/init
 0.38 {"type":"assistant","message":{"model":"<synthetic>",…,"content":[{"type":"text","text":"Not enough messages to compact."}],…},"local_command_source":"<local-command-stdout>Not enough messages to compact.</local-command-stdout>","local_command_run":{"command":"compact","args":""},…}
 0.38 {"type":"result","subtype":"success","is_error":false,"result":"Not enough messages to compact.","stop_reason":null,"num_turns":0,"local_command":"compact","user_message_uuid":"…aa45",…,"total_cost_usd":0}
 0.38 command_lifecycle …aa45 completed
      (no line for 20 s)
```

- A refused `/compact` **does** print `compacting`, closed at once by `status: null` with `compact_result: "failed"`.
- The `result` is not an error (`is_error` false). Its `result` text holds the reason, and the lifecycle ends
  `completed`. Only `compact_result` and `compact_error` tell this from a success.

### Saved transcript lines

Read from each session's `<session id>.jsonl`. The folder name comes from the resolved cwd: `/tmp/…/project-a` runs as
`/private/tmp/…/project-a`, so the folder is `-private-tmp-…-project-a`.

The boundary, automatic (A) and manual (C), with `trigger` verbatim:

```
{"parentUuid":null,"logicalParentUuid":"…92c6","isSidechain":false,"type":"system","subtype":"compact_boundary","content":"Conversation compacted","level":"info","compactMetadata":{"trigger":"auto","preTokens":37384,"postTokens":9176,"cumulativeDroppedTokens":28208,"durationMs":10552,"preservedSegment":{"headUuid":…,"anchorUuid":…,"tailUuid":…},"preservedMessages":{"anchorUuid":…,"uuids":[…],"allUuids":[…]},"runningTurnSends":{"uuids":["…9189"],"openerUuid":"…9189"}},"uuid":"…a898","timestamp":"2026-11-04T00:53:22.662Z",…}
{"parentUuid":null,"logicalParentUuid":"…a5c1","isSidechain":false,"type":"system","subtype":"compact_boundary","content":"Conversation compacted","isMeta":false,"level":"info","compactMetadata":{"trigger":"manual","preTokens":34860,"durationMs":4932,"postTokens":8681,"cumulativeDroppedTokens":26179},"uuid":"…fb50","timestamp":"2026-11-04T00:54:57.884Z",…}
```

- **Keys.** The saved metadata key is `compactMetadata`, in camelCase: `trigger`, `preTokens`, `postTokens`,
  `cumulativeDroppedTokens`, `durationMs`. `preservedSegment`, `preservedMessages` and `runningTurnSends` are optional;
  `runningTurnSends` is not on the wire line. `parentUuid` is null and `logicalParentUuid` holds the parent.
- **The summary line** (A and C): `"type":"user","isVisibleInTranscriptOnly":true,"isCompactSummary":true`, no `isMeta`,
  and `message.content` a string starting `This session is being continued from a previous conversation that ran out of
  context.` A's also has `"summarizedTurnPromptUuids":["…9189"]`.
- **After a boundary from `/compact`** (C), in order: the boundary, the summary, a `user` line with `isMeta: true` and
  `<local-command-caveat>…`, the typed `user` line `<command-name>/compact</command-name>…`, and a `user` line
  `<local-command-stdout>Compacted </local-command-stdout>`.
- **After an automatic boundary** (A): attachments and the summary. No `/compact`, caveat or `Compacted` line.
- **No `system` `local_command` line says `Compacted`.** That text is a `user` line, and only for `/compact`.
- **An interrupted `/compact`** (B) has no boundary and no summary. What marks it: the caveat, the typed `/compact` line,
  and `{"type":"system","subtype":"local_command","content":"<local-command-stdout>Compaction canceled.</local-command-stdout>","level":"info","isMeta":false}`.
- **A refused `/compact`** (the nothing-to-compact process) has the same shape, with content
  `<local-command-stdout>Not enough messages to compact.</local-command-stdout>` and `"commandRun":{"command":"compact","args":""}`.

### Idle compaction

Result: no compaction in two 65-minute runs on 2.1.318 under `--print --output-format stream-json`. Stdout printed nothing
after turn 1's `completed` lifecycle line, the transcript holds no `compact_boundary`, and the debug log names no idle
attempt. The machine stayed awake: the driver's 60 s heartbeat never gapped past 61 s, so the timer was not `lapsed`. The
idle waits ran about 3,900 s, past the 54 minutes the binary's code gives.

The second run added `--setting-sources project,local --permission-mode default`, as the app launches, with no project or
local settings file, so the profile's `settings.json` `env` (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, `CLAUDE_AFK_TIMEOUT_MS`)
did not reach it. Its turn 1 read 153,532 tokens of context (`2 + 142146 + 11384`), on the 1-hour cache, above the floor.
So those settings did not hold it off. Not settled: whether this mode never starts the timer or another condition does.

Setup. Child env adds `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS=100000` and `CLAUDE_CODE_PROMPT_CACHE_TTL=1h`; the flags add
`--debug-file`. The binary accepted `1h`: turn 1's `usage.cache_creation` reads `"ephemeral_1h_input_tokens":156969,
"ephemeral_5m_input_tokens":0`. The earlier probes, with no such variable, also wrote the 1-hour cache: this account's
default. Stdin: one message, about 400,000 characters of numbered plain lines followed by `Reply with the single word
ok.`; then nothing. Turn 1's reply reads 170,434 tokens of context (`2 + 156969 + 13463`), above the 100k floor. The
driver waits until a boundary prints or 65 minutes from spawn pass, then closes stdin.

- The bulk is plain, repeated lines because a first attempt with shuffled common words ended in a refusal (`result`
  `stop_reason: "refusal"`, `terminal_reason: "api_error"`, `is_error` true, lifecycle `cancelled`, text `Start a new
  session to continue`). That process had no idle wait.
- From the binary's code, not measured: the timer fires at 90 % of the cache lifetime after the last activity (54
  minutes), and a timer more than 60 s late, as after a machine sleep, gives the outcome `lapsed`. The floor it reads
  is `max(100000, CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS ?? 200000)`.
- A user `settings.json` `env` beats the child's env. Measured with `get_context_usage`, which makes no model call, on
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW`: `settings.json` 200000 alone gave `autoCompactThreshold` 167000, the child's 300000
  alone 267000, and both together 167000. So a user's `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` in `settings.json` would
  beat what the app passes. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` moved nothing on this model in either place: the threshold
  stayed 967000, `autocompactSource` `model-default`.

Not measured: an interrupt after the summary request has run for a while (the probe's interrupt came within 10 ms of
`compacting`); an interrupt or a message during an automatic compaction; a `compacting` line repeating inside one attempt
(`compact_output_chars` above 0).
