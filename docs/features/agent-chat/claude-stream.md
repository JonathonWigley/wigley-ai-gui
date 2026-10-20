Measured on `claude --version` → `2.1.304 (Claude Code)`, 2026-10-20, macOS.

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
these variables, and `CLAUDE_EFFORT` in particular may set the child's effort.

## User message

Both content forms are accepted. Neither needs `session_id` on the stdin line.

- Stdin `{"type":"user","message":{"role":"user","content":"Reply with the single word ok."},"parent_tool_use_id":null}`
  → the turn runs, `result` `{"subtype":"success","result":"ok",…}`.
- Stdin `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Reply with the single word ok."}]},"parent_tool_use_id":null}`
  → the same `result` `{"subtype":"success","result":"ok",…}`.
- Without `--replay-user-messages` (not passed), Claude does **not** echo the stdin message back on stdout. The only
  `user` events on stdout are tool results (§ Tool results), interrupt markers (§ Interrupt), and the `set_model`
  replay (§ Model).

## Init

**When.** `system/init` arrives only after the first stdin message, never at process start. It then arrives again
at the start of **every** turn, local slash commands included (§ Effort, § Model).

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
"plugins":         4  [{"name":"wigley","path":"/Users/jonathonwigley/.claude/plugins/cache/wigley-ai-marketplace/wigley/1.3.1","source":"wigley@wigley-ai-marketplace","version":"1.3.1"},
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

- Entries in `slash_commands` have **no** leading `/`, for example `"wigley:feature"`, `"effort"`, `"model"`,
  `"compact"`. Every skill name also appears in `slash_commands`.
- `tools` grows when a pending MCP server connects: in later probes, once `claude.ai Claude Docs` was `connected`,
  `tools` also listed `mcp__claude_ai_Claude_Docs__batch`, `…__create` and the rest.
- With `--permission-mode manual`, `tools` also lists `AskUserQuestion`, `EnterPlanMode` and `ExitPlanMode`, which the
  `auto` sessions did not list.
- `init.model` does **not** follow plan mode's model switch (§ Mode change), but it does follow `/model` (§ Model).

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
  `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1792527600,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"out_of_credits","isUsingOverage":false,"unifiedWindows":{"five_hour":{"utilization":0.48,…},"seven_day":{"utilization":0.14,…}}},…}`
- **`tool_progress`**: a heartbeat every 30 s while a tool call is pending. Its `tool_use_id` is the call id with a
  `-heartbeat-<n>` suffix, and `parent_tool_use_id` is the real call id.
  `{"type":"tool_progress","tool_use_id":"toolu_01YMhg2Ys1DtwHhK2R3A62ji-heartbeat-0","tool_name":"mcp__plugin_wigley_wigley-forms__ask_round","parent_tool_use_id":"toolu_01YMhg2Ys1DtwHhK2R3A62ji","elapsed_time_seconds":30,"heartbeat":true,…}`
  The `parent_tool_use_id` here is not a subagent id: a decoder that routes by `parent_tool_use_id` should not treat
  this line as a subagent's.
- **`user` with `isReplay: true`**: the `set_model` acknowledgement (§ Model).

Expected but not observed: `ping` stream events, `system/api_retry`, `system/permission_denied`, any
`control_request` sent by Claude to the host (none arrived, even with `--permission-prompt-tool`), and non-JSON
stdout lines (every stdout line in every probe parsed as JSON).
