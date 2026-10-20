# 01 — Spike: Claude stream-json wire facts

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `docs/features/agent-chat/claude-stream.md` · scratch only (never committed): `<scratchpad>/claude-spike/`
           (`<scratchpad>` is the session scratchpad the implementer's system prompt names)
Consumes:  the installed `~/.local/bin/claude` (2.1.304, a plan precondition); `~/.claude-personal` with the wigley plugin
Produces:  `docs/features/agent-chat/claude-stream.md` with exactly these `##` sections, in this order, each one
           named by task 06 as `claude-stream.md § <section>`:
           `Launch` · `User message` · `Init` · `Stream events` · `Assistant messages` · `Tool results` · `Result` ·
           `Slash commands` · `Interrupt` · `Mode change` · `Effort` · `Model` · `Choices` · `Permission tool` ·
           `Session id` · `Exit codes` · `Other events`
Decisions: the spike writes no product code: nothing under `src/`, `scripts/` or the repo root changes (pin) ·
           every probe runs the installed binary only; nothing is installed, updated or downloaded, and no package
           runs (`npx`, `npm` and `node` stay unused; the drivers are `python3` stdlib scripts) · every probe runs with
           `CLAUDE_CONFIG_DIR=$HOME/.claude-personal` in `<scratchpad>/claude-spike/project/` (a fresh folder holding
           one file, `notes.txt` with the line `spike`) · the turns cost real model use on the user's personal
           account, so every probe that needs a model turn adds `--model haiku --effort low` (except the `Model` and
           `Effort` probes, which change them) and sends only the prompts pinned below · each fact is recorded with
           the exact command line (environment, flags, the stdin lines sent) and an excerpt of the JSON lines it
           printed, trimmed to the fields the fact rests on with `…` for cut parts; a fact the probe did not show is
           written `Not observed:` with the attempt made · the doc states the CLI version it was measured on
           (`claude --version` output) in its first line

## What each section records

The drivers are `python3` scripts in `<scratchpad>/claude-spike/` that start `claude` with `subprocess.Popen`
(stdin, stdout, stderr pipes), write stdin lines, and log every stdout and stderr line with a timestamp to
`<scratchpad>/claude-spike/logs/<probe>.jsonl`; a wait is `time.sleep` inside the script (the shell's `sleep` is
blocked). Base flags for every probe unless its row says otherwise:
`-p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --session-id <fresh uuid4>`.

| Section | Probe | Records |
|---|---|---|
| Launch | Start once with the base flags, then once without `--verbose`, then once without `--include-partial-messages`; send `Reply with the single word ok.` | which flags stream-json output requires (the error text when one is missing); the line order from start to the first `result` |
| User message | The pinned prompt as `{"type":"user","message":{"role":"user","content":"Reply with the single word ok."},"parent_tool_use_id":null}`; then the same with `content` as `[{"type":"text","text":"…"}]` | which content forms Claude accepts; whether `session_id` is required on the stdin line |
| Init | Start and wait 15 s sending nothing; then send the prompt | whether `system`/`init` arrives at process start or only after the first message; its fields `session_id`, `model`, `permissionMode`, `slash_commands`, `skills`, `tools`, `mcp_servers`, `plugins`, `capabilities` (excerpt each; for the lists, the count and the first five names); whether init arrives again on later turns |
| Stream events | The `ok` turn, and `Think step by step, then reply with the single word ok.` | `stream_event` shapes for `message_start`, `content_block_start` (text, thinking, tool_use), `content_block_delta` (`text_delta`, `thinking_delta`, `input_json_delta`), `content_block_stop`, `message_delta`, `message_stop`; which field carries the message id and the block index |
| Assistant messages | The `ok` turn and the tool turn below | whether an `assistant` event carries the whole message or one content block per event; its `message.id`, `content[]` block shapes (text, thinking, tool_use with `id`, `name`, `input`), `parent_tool_use_id` |
| Tool results | `Read the file notes.txt and reply with its first line.` | the `user` event carrying `tool_result` (`tool_use_id`, `content` as string or blocks, `is_error`); the same for a failing call: `Read the file missing.txt and reply with the word done.` |
| Result | Every turn above | the `result` event's fields: `subtype`, `is_error`, `result`, `stop_reason`, `total_cost_usd`, `duration_ms`, `num_turns`, `session_id`, `permission_denials` |
| Slash commands | Send `/wigley:feature x` as the user message; interrupt as soon as the first `assistant` or `stream_event` line arrives (by the route `Interrupt` found working) | whether the skill expands (evidence: a `user` event or system line carrying the skill's text, or an assistant reply working the skill), and whether `wigley:feature` is in init's `slash_commands` or `skills`; also how an unknown `/nosuchcommand` comes back |
| Interrupt | Send `Count from 1 to 200, one number per line.`; at the first `text_delta` write `{"type":"control_request","request_id":"spike-1","request":{"subtype":"interrupt"}}`; then send `Reply with the single word ok.` In a second process, the same turn ended by SIGINT, then the same follow-up | for each route: the lines after it (a `control_response`? a `result` with which `subtype`?), whether the process stays alive and answers the follow-up, the exit code if it ended |
| Mode change | Idle session; write `{"type":"control_request","request_id":"spike-2","request":{"subtype":"set_permission_mode","mode":"plan"}}`; if it errors, the error text and then the same with subtype candidates found in `capabilities` or the docs | the subtype name that works, the `control_response` shape on success and on error (`"mode":"nosuchmode"`), and every event that reports the new mode (a `system` line, the next init, the next `result`) |
| Effort | Idle session without `--effort`; send `/effort high` as a user message; then `/effort` with no argument | whether it runs locally (no model cost in its `result`) or as a turn, what lines it prints (a `user` event with `<local-command-stdout>`? a `result`?), and which event, if any, reports the effort in force at start and after the change |
| Model | Idle session on `--model haiku`; send `/model sonnet`; then try `{"type":"control_request","request_id":"spike-3","request":{"subtype":"set_model","model":"sonnet"}}` | the lines each route prints, which event reports the new model (and the string it reports: alias or full name), whether the next turn's `assistant` `message.model` changes |
| Choices | `claude --help`, and `/model` with no argument in a session | the mode choices (`--permission-mode` help), the effort levels (`--effort` help), the model aliases `/model` or the help names; which modes the control request accepts mid-session (`bypassPermissions` without `--allow-dangerously-skip-permissions` included) |
| Permission tool | Write a stdlib `python3` stdio MCP server in `<scratchpad>/claude-spike/mcp/permission_server.py` (JSON-RPC 2.0 lines: `initialize`, `tools/list` with one tool `permission_prompt`, `tools/call`), which logs each call's arguments and its environment's `CLAUDE_CODE_SESSION_ID` to `<scratchpad>/claude-spike/logs/permission-calls.jsonl`; load it with `--mcp-config` naming server `spike` and run with `--permission-mode manual --permission-prompt-tool mcp__spike__permission_prompt`; send `Create a file named a.txt containing ok, using the Write tool.` with the server answering allow (`{"behavior":"allow","updatedInput":<the input>}` as the tool result's text), then again answering deny (`{"behavior":"deny","message":"spike says no"}`) | the call's argument names and shapes (`tool_name`, `input`, `tool_use_id`, any other), the reply shape Claude accepts for allow and deny (and what it does with an unreadable reply), what the model sees on deny; then one start with `--permission-prompt-tool mcp__plugin_wigley_wigley-forms__permission_prompt` and the app not running, recording what Claude does with a tool that does not exist; and init's `tools` list, showing the wigley plugin's tools named `mcp__plugin_wigley_wigley-forms__<tool>` (confirming the pinned name's prefix). The documented shape from code.claude.com `cli-reference` and `headless` pages is quoted beside the observed one |
| Session id | The permission probe's server log | that the `--session-id` uuid passed reaches the MCP child as `CLAUDE_CODE_SESSION_ID`, and init's `session_id` equals it |
| Exit codes | Close stdin on an idle session; SIGTERM an idle session; SIGTERM mid-turn; start with a bad flag (`--permission-mode nosuchmode`) | each exit code and the last stderr line; how long the process takes to exit after stdin closes |
| Other events | Every probe's log | each event `type`/`subtype` seen that no section above covers, with one excerpt each |

GIVEN the installed CLI and the personal profile WHEN every probe in the table has run THEN `claude-stream.md`
holds every listed section, each fact with its command and excerpt or marked `Not observed:` with its attempt

Tests:     none — the spike measures a live system; its record is the doc. `git status --porcelain -- src scripts
           package.json package-lock.json forge.config.mts` prints nothing after the spike (no product code)
Done when: `claude-stream.md` exists with the seventeen sections above in order, none empty; every fact listed in its
           table row is recorded or marked `Not observed:`; the doc's first line names the CLI version; the scratch
           folder stays in the scratchpad
Commit:    one commit holding `docs/features/agent-chat/claude-stream.md` only — "Agent chat spike: Claude stream-json
           wire facts measured on the installed CLI"

## Proof

436936c · diff read: the doc's first line names `2.1.304 (Claude Code)`, and all 17 `##` sections are present in the planned order; no product code changed. Its contract changes, which task 06 reads: local `/effort` and `/model` print a synthetic `assistant` event plus a zero-cost `result`, not `<local-command-stdout>`; no event reports effort; `manual` mode comes back as `default`; `total_cost_usd` is cumulative for the process; SIGINT ends the process, so only the `interrupt` control request keeps it alive; there is one assistant event per content block; thinking text is never streamed; a missing permission prompt tool exits 1 at the first prompt. Concerns: a probe may have opened a stray forms round; about 20 spike transcripts sit in `~/.claude-personal/projects/`; in plan mode the turn ran on sonnet while `init` reported haiku.
