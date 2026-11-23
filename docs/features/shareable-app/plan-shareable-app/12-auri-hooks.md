# 12 — The `auri` hooks: checklist edit gate, turn-end and compaction reminders, AskUserQuestion to forms

Status: not started
Type: Batch
Rung: hard · crosses the Claude Code hook contract and the app's relay hook protocol, and adds a shared hook client the chatroom hook moves onto
Wave: 4 · Depends on: 01 (`agent-plugin/hooks/hooks.json` and `scripts/relay/` exist only after 01), 04 (`CHECKLIST_HOOK` and its reply)
Plan: [plan.md](plan.md)

Mandatory reads for this task: `docs/features/feature-contributions/design.md` § The Checklist flow;
`agent-plugin/scripts/relay/README.md` § The relay (the hook hello and the one-line `HookReply`);
`wigley-ai-gui/AGENTS.md` § Architecture, the relay paragraph's sentence on a hello carrying a `hook` field;
`~/wigley-agents/tools/workflow-gate/README.md` § Decisions and § Checklist checks (the behaviour this task carries
over, read for reference only: this task does not edit `~/wigley-agents`).

Paths are under `wigley-ai-gui/` in the worktree `W` (`~/Documents/.worktrees/ai-shareable-app`). `A` is
`wigley-ai-gui/agent-plugin`.

Files:
- create `A/scripts/relay/hook_client.py` · test `A/scripts/relay/tests/test_hook_client.py`
- modify `A/scripts/chatroom/hook.py`
- create `A/scripts/checklist/hook.py` · create `A/scripts/checklist/tests/__init__.py` · test `A/scripts/checklist/tests/test_hook.py`
- create `A/scripts/ask-user-question/hook.py` · create `A/scripts/ask-user-question/tests/__init__.py` · test `A/scripts/ask-user-question/tests/test_hook.py`
- modify `A/hooks/hooks.json` · test `wigley-ai-gui/src/shared/agent-plugin.test.ts` (four rows in `agentPluginHooks_CommandsNameExistingScripts`)
- modify `A/scripts/relay/README.md` (§ The relay, the hook clients)

Consumes:
- `CHECKLIST_HOOK = 'workflow.checklist'` in `src/plugins/workflow/contract.ts`, registered with
  `sessions.addHookHandler` ← 04. The reply is `{ reported: boolean, open: number, items: { text: string, done:
  boolean, running?: boolean }[] }`. `reported` is true once the row's flow reported a checklist or a plan
  (`set_workflow_plan`); with a plan and no checklist, `open` and `items` come from the plan's task lines. A row with
  no flow gets `{ reported: false, open: 0, items: [] }`. The request line is not read.
- `endpoint.open_channel`, `endpoint.channel_path`, `endpoint.HOOK_PROTOCOL`, `start_app.endpoint_dir` in
  `A/scripts/relay/` ← 01.
- `A/hooks/hooks.json` with the two chatroom entries ← 01.
- `agentPluginHooks_CommandsNameExistingScripts` in `src/shared/agent-plugin.test.ts`, the hooks.json row table ← 01.

Produces:
- `A/scripts/relay/hook_client.py`:
  - `HOOK_DEADLINE_SECONDS = 3.0`
  - `def session_hello(hook: str, hook_input: dict, env) -> dict` — the hook hello, as `chatroom/hook.py`'s
    `_session_hello` builds it today, with `hook` set to the given name.
  - `def ask_app_reply(channel: str, hello: dict, request: dict, deadline: float) -> dict | None` — sends the hello and
    the request, reads one line, and returns the `reply` object of an `{ "ok": true, "reply": {…} }` line; None when the
    app refuses, the channel fails, or the line is not complete by `deadline`.
  - `def app_channel(env) -> str | None` — `endpoint.channel_path(start_app.endpoint_dir(env))`.
- `A/scripts/checklist/hook.py`: `def decide(mode: str, hook_input: dict, env, reply: dict | None) -> dict | None` and
  `def main(argv, stdin, stdout, env) -> int`, run as `hook.py edit|stop|compact`.
- `A/scripts/ask-user-question/hook.py`: `def main(stdin, stdout, env) -> int`.

## Decisions

### What moves into `auri`, and what stays personal

- `~/wigley-agents/tools/workflow-gate` holds two rules. Its level gate (no edit until a `wigley:` level skill
  loaded) is the user's own workflow and stays there. Its checklist checks and compaction reminder are app features
  and move here, keyed on `WIGLEY_SESSION_ROW` and the app's flow state in place of a transcript scan. The level
  skill's `## Reporting` section that workflow-gate's compaction reminder replays stays personal.
- `~/.claude/hooks/ask-user-question-to-forms` moves here as `scripts/ask-user-question/hook.py`.
- This task edits no personal file. Task 14 removes workflow-gate's checklist checks and compaction reminder and the
  personal AskUserQuestion hook (or renames their tool names), so an app session is not gated twice.

### The shared hook client

- `chatroom/hook.py`'s transport (`ask_app`'s channel open, write, line read and deadline handling, `_set_time_left`,
  `_read_line`, `_session_hello`) moves into `hook_client.py`. `chatroom/hook.py` keeps its own `ask_app(channel,
  hello, request, deadline) -> str | None` as a wrapper that calls `ask_app_reply` and returns the reply's non-empty
  `text`, and `_hook_output` calls `hook_client.session_hello(HOOK_NAMES[event], hook_input, env)`. Its tests then
  pass unchanged; that is the proof the move kept the wire.
- What `chatroom/tests/test_hook.py` reaches stays a name of `chatroom/hook.py`: `ask_app`, `main`, `output_for`,
  `request_from_input`, `commit_paths`, `git_runner`, `GIT_TIMEOUT_SECONDS`, `subprocess` and
  `HOOK_DEADLINE_SECONDS`. The test patches `hook.HOOK_DEADLINE_SECONDS` (`mock.patch.object(hook,
  "HOOK_DEADLINE_SECONDS", …)`, test_hook.py line 280 at plan time), so `chatroom/hook.py` does
  `from hook_client import HOOK_DEADLINE_SECONDS` and `main` reads that module global as it does today
  (`deadline = time.monotonic() + HOOK_DEADLINE_SECONDS`). Never read it as `hook_client.HOOK_DEADLINE_SECONDS`
  inside `main`: the patch would then miss and the drip row would wait the full 3 s. `checklist/hook.py` imports and
  reads the constant the same way.
- `checklist/hook.py` imports `hook_client` with the same `sys.path` insert of `../relay` that `chatroom/hook.py` uses.

### The checklist hook

`hook.py <mode>` reads one Claude Code hook event on stdin and prints one JSON line or nothing. It always exits 0.
An exception prints to stderr only. The steps, in order:

1. Stdin is not a JSON object → nothing.
2. `env["WIGLEY_SESSION_ROW"]` is missing or empty → nothing: only a session the app started has a row, so a
   terminal or Codex session (Codex also discovers `hooks/hooks.json`) is never gated.
3. `hook_input["agent_id"]` is a non-empty string → nothing: subagents pass, as in workflow-gate.
4. Mode `stop` with `stop_hook_active` true → nothing, so the reminder sends a turn back once at most. Mode `compact`
   with `source` other than `compact` → nothing.
5. `app_channel(env)` is None, or `ask_app_reply` returns None (app away, refused, past the deadline) → nothing. The
   gate fails open: a session whose app is down keeps working.
6. The reply is checked: `reported` a bool, `open` an int, `items` a list whose elements each hold a string `text` and
   a bool `done`. Anything else → nothing.
7. `decide` picks the output:

| Mode | Reply | Output |
|---|---|---|
| `edit` | `reported` false | `PreToolUse` deny with `CHECKLIST_DENIAL` |
| `edit` | `reported` true | nothing |
| `stop` | `reported` true, `open` > 0 | `Stop` `additionalContext` `CHECKLIST_REMINDER` with the count |
| `stop` | any other | nothing |
| `compact` | `reported` true | `SessionStart` `additionalContext` `COMPACT_LIST` with the items |
| `compact` | `reported` false | `SessionStart` `additionalContext` `COMPACT_NONE` |

- The `stop` row follows design.md: the reminder fires while items are open. A session that never sent a list is not
  sent back at turn end (workflow-gate did that); the edit gate still stops its first edit.
- The hello's `hook` is `CHECKLIST_HOOK = "workflow.checklist"` (a module constant in `checklist/hook.py`, equal to
  04's) for all three modes: `session_hello("workflow.checklist", hook_input, env)`. 04 registers one handler under
  that one name; a per-mode name (`checklist.edit`, the way chatroom has `chatroom.pre|post`) gets `ok: false`, and
  the gate then fails open in silence.
- The request line is `{"mode": "<mode>"}`. 04's handler does not read it; it is there for the app's log.
- Output shapes, the ones workflow-gate prints today:
  `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": <text>}}`,
  and `{"hookSpecificOutput": {"hookEventName": "Stop" | "SessionStart", "additionalContext": <text>}}`.
- `COMPACT_LIST` is capped at 10,000 characters (Claude Code's `additionalContext` cap, as workflow-gate records it):
  items are dropped from the end and one `…` line closes the list when the cap would pass.

Pinned text (the tests assert these strings):

- `CHECKLIST_DENIAL`: "This app session has sent no task list yet. Before any edit, send it with the auri server's
  set_workflow_checklist tool: every step of the work in hand as concrete items, the whole list. Then make this edit
  again."
- `CHECKLIST_REMINDER`: "auri: this turn is ending with {open} open items on this session's task list. If an item
  finished, send the list again with set_workflow_checklist, each finished item done. If the work waits on the user
  or a later turn, leave the list as it is and end the turn."
- `COMPACT_LIST`: "auri: this session's task list before the compaction:" then one line per item, `- [x] <text>` or
  `- [ ] <text>`, then "Send set_workflow_checklist again when the list no longer matches the work in hand."
- `COMPACT_NONE`: "auri: this session has sent no task list yet. Send it with set_workflow_checklist before your first
  edit."

### The AskUserQuestion hook

- With `WIGLEY_SESSION_ROW` set and non-empty, it prints a `PreToolUse` deny whose reason is: "AskUserQuestion gets
  no answer in an app session. Ask through a forms round instead: load the auri server's ask_round tool (ToolSearch
  \"select:mcp__plugin_auri_auri__ask_round\") and send every open question in one call, each with its context,
  numbered choices, the recommended number and why. The auri:forms skill holds the format." With the variable unset
  it prints nothing: a terminal session keeps AskUserQuestion, since nothing there answers a forms round for certain.
- It reads stdin and ignores it, needs no app call, and imports nothing from `relay/`.
- The tool name is written as a literal; task 01's `agentPluginManifests_NameTheConstants` keeps the plugin and
  server names fixed. Use the skill folder name found under `agent-plugin/skills/` for `auri:forms`.

### `hooks/hooks.json`

Keep 01's two chatroom entries. Add, each with `"timeout": 5` and a `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/…"`
command:

- `PreToolUse`, matcher `Edit|Write|MultiEdit|NotebookEdit` → `checklist/hook.py edit`
- `PreToolUse`, matcher `AskUserQuestion` → `ask-user-question/hook.py`
- `Stop`, no matcher → `checklist/hook.py stop`
- `SessionStart`, matcher `compact` → `checklist/hook.py compact`

The file's description becomes "Auri hooks: the chatroom's edit and commit warnings, the task-list edit gate and
its turn-end and compaction reminders, and AskUserQuestion sent to a forms round". Bash is not gated, as in
workflow-gate: the gate covers the edit tools only.

### The relay README

§ The relay's line that says the chatroom hook is the one hook client names three: the chatroom hook, the checklist
hook (`workflow.checklist`) and, through `hook_client.py`, any later one. Name the reply fields and point at
design.md § The Checklist flow for their meaning.

## Behaviour

GIVEN an app session (row set) that sent no checklist WHEN it calls Edit THEN the call is denied with `CHECKLIST_DENIAL`.
GIVEN the same session after `set_workflow_checklist` WHEN it calls Edit THEN the hook prints nothing.
GIVEN a terminal session (no row) WHEN it calls Edit or AskUserQuestion THEN both hooks print nothing.
GIVEN the app is not running WHEN an app session calls Edit THEN the hook prints nothing.
GIVEN an app session whose list has 2 open items WHEN its turn ends THEN the Stop output names 2 open items, and the
next stop in that turn (`stop_hook_active`) prints nothing.
GIVEN a compaction WHEN SessionStart fires with `source` `compact` THEN the output lists every item with its mark.

## Tests

- `relay/tests/test_hook_client.py`, against a fake app on a temp Unix socket (the pattern of
  `chatroom/tests/test_hook.py`): `ask_app_reply` returns the `reply` object of an ok line; returns None on
  `{"ok": false}`, on a closed channel and on a line not complete by the deadline; `session_hello` carries
  `protocol` `HOOK_PROTOCOL`, the hook name, and `row_id` from `WIGLEY_SESSION_ROW`. Catches a transport change that
  breaks both hook clients at once.
- `chatroom/tests/test_hook.py`: unchanged. Catches a move that changed the chatroom's wire.
- `checklist/tests/test_hook.py`, one table test over `decide` with a row per line of the mode table above plus:
  no row env, a subagent, `stop_hook_active`, `source` `startup`, reply None, and three malformed replies (`reported`
  a string, `items` not a list, an item with no `text`). Each row asserts the exact output dict or None, the pinned
  texts verbatim. Catches a gate that blocks a terminal session, a subagent or a session whose app is down.
- `checklist/tests/test_hook.py`: `test_compact_list_cut_at_cap` (900 items of 20 characters; the text is at most
  10,000 characters and ends on the `…` line); `test_main_exits_zero` (bad stdin, an exception in `decide`) with
  stdout empty; one end-to-end table through `main` with a fake app, one row per mode (`edit`, `stop`, `compact`):
  each asserts the fake app received a hello with `hello["hook"] == "workflow.checklist"` and the request
  `{"mode": "<mode>"}`, and the `edit` row, answered `{ reported: false, … }`, prints the deny line. Catches a wrong
  hook name, which the fail-open path would otherwise hide.
- `src/shared/agent-plugin.test.ts` › `agentPluginHooks_CommandsNameExistingScripts`: add the four rows
  (`PreToolUse`, `Edit|Write|MultiEdit|NotebookEdit`, `scripts/checklist/hook.py`, `edit`, 5),
  (`PreToolUse`, `AskUserQuestion`, `scripts/ask-user-question/hook.py`, no mode, 5),
  (`Stop`, no matcher, `scripts/checklist/hook.py`, `stop`, 5) and
  (`SessionStart`, `compact`, `scripts/checklist/hook.py`, `compact`, 5). Catches a typo'd script path, a lost
  `compact` matcher or a missing mode argument, none of which `claude plugin validate` reports and each of which
  disables the gate.
- `ask-user-question/tests/test_hook.py`: row set → the deny line with the pinned reason; row unset → nothing; exit 0
  on both.

## Verification

```
cd /Users/jonathonwigley/Documents/.worktrees/ai-shareable-app/wigley-ai-gui/agent-plugin
(cd scripts/relay && python3 -m unittest discover)
(cd scripts/chatroom && python3 -m unittest discover)
(cd scripts/checklist && python3 -m unittest discover)
(cd scripts/ask-user-question && python3 -m unittest discover)
claude plugin validate /Users/jonathonwigley/Documents/.worktrees/ai-shareable-app/wigley-ai-gui/agent-plugin
python3 -c "import json;print(sorted(json.load(open('hooks/hooks.json'))['hooks']))"
(cd .. && npm test -- src/shared/agent-plugin.test.ts)
```

The last line prints `['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop']`. The live checks (an app session denied
before its first checklist, the Stop reminder, the compaction reminder) are task 18's.

## Done when

- The commands above pass, and `claude plugin validate` reports no hook error.
- Every script is standard library only (plan.md § Boundary rules).

Commit: one commit for the group.

## Proof

