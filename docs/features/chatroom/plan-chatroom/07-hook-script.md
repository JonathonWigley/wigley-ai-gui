# 07 — Hook script and hooks.json

Status: not started
Type: Task
Rung: deep · crosses Claude Code's hook contract, a git subprocess and the app's socket under a hard time budget, and rests on hook fields marked low-confidence below
Wave: 2 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Files (wigley-ai-marketplace): create `plugins/wigley/hooks/hooks.json` · create `plugins/wigley/scripts/chatroom/hook.py` · create `plugins/wigley/scripts/chatroom/tests/__init__.py` · test `plugins/wigley/scripts/chatroom/tests/test_hook.py` · modify `plugins/wigley/scripts/forms/README.md` · modify `AGENTS.md`
Consumes:  `endpoint.open_channel(path: str, timeout: float = HELLO_TIMEOUT_SECONDS)` ← 03
           `endpoint.channel_path(endpoint_dir: Path) -> str | None` ← 03
           `endpoint.RELAY_PROTOCOL` ← 03
           the hook wire: hello with `"hook": "<name>"`, one request line, one `HookReply` line `{"ok": true, "reply": {...}}` or `{"ok": false, "error": "..."}` ← 02
           `start_app.endpoint_dir(env) -> Path` (in the tree)
Produces:  in `wigley-ai-marketplace/plugins/wigley/scripts/chatroom/hook.py`:
           `HOOK_TIMEOUT_SECONDS = 1.5`
           `GIT_TIMEOUT_SECONDS = 1.0`
           `def request_from_input(event: str, hook_input: dict, run_git: Callable[[list[str], str], str | None]) -> dict | None`
           `def commit_paths(command: str, cwd: str, run_git: Callable[[list[str], str], str | None]) -> list[str] | None`
           `def ask_app(channel: str, hello: dict, request: dict, timeout: float) -> str | None` — the reply's `text`, or None
           `def output_for(event: str, text: str | None) -> str` — the stdout line, `''` for none
           `def main(argv: list[str], stdin, stdout, env) -> int` — always 0
           the request record 08 parses (pinned below)
Decisions:
- **hooks.json (pinned).**
  ```json
  {
    "description": "Chatroom: warns before an edit or commit that touches another session's claim, and reports touched paths and unread chatroom messages after an edit",
    "hooks": {
      "PreToolUse": [{ "matcher": "Edit|Write|MultiEdit|Bash", "hooks": [{ "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/scripts/chatroom/hook.py\" pre", "timeout": 5 }] }],
      "PostToolUse": [{ "matcher": "Edit|Write|MultiEdit", "hooks": [{ "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/scripts/chatroom/hook.py\" post", "timeout": 5 }] }]
    }
  }
  ```
  `timeout` is Claude's own bound in seconds (the default is 600 for a command hook, vendor docs); 5 s backs up the script's own 1.5 s bound. Plugin hooks load from `hooks/hooks.json` with no manifest field (vendor docs, code.claude.com/docs/en/hooks § plugin hooks); the plugin manifests do not change.
- **Hook input (vendor docs, verified 2026-11-17).** Common fields: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`; inside a subagent also `agent_id` and `agent_type` ("When a subagent calls a tool, tool events such as PreToolUse and PostToolUse fire the same configured hooks … and the input carries the `agent_id` and `agent_type`"). PreToolUse and PostToolUse add `tool_name`, `tool_input`, `tool_use_id`. Write and Edit `tool_input` carry `file_path` (absolute). Bash `tool_input` carries `command`.
- **Low-confidence (unverified).** (a) MultiEdit: the vendor page lists no MultiEdit input; the script reads `tool_input.file_path` for it as for Edit, and a missing field sends nothing. (b) That Claude's hook `agent_id` equals the subagent id chat's agent events carry (the Agent tool call's id, `src/contracts/agent.ts`): 08's attribution of hook-touched paths to a subagent rests on it; a mismatch names a subagent the board cannot match, never a wrong session. (c) That the hook's `session_id` equals `CLAUDE_CODE_SESSION_ID`, which the relay hello sends: the hook route finds the session by it (02).
- **Output (vendor docs, verified).** Both events take `{"hookSpecificOutput": {"hookEventName": "PreToolUse" | "PostToolUse", "additionalContext": "<text>"}}` on stdout with exit 0; PreToolUse lists `additionalContext` in its decision-control table. The script prints that one JSON object on one line only when the reply has non-empty text, and prints nothing otherwise. It never prints `permissionDecision`: the hook never blocks (design § Claims). Exit code is always 0, an exception included: `main` catches every exception, writes one line to stderr (Claude hides stderr on exit 0), and returns 0.
- **Neutral request (pinned).** No app code names Claude's fields (plan § Boundary rules), so the script maps them:
  `{"tool": "edit" | "write" | "commit", "paths": [<absolute path>, ...], "agentId": <agent_id or null>, "cwd": <cwd>}`
  Edit and MultiEdit → `edit`; Write → `write`; Bash running `git commit` → `commit`. `agentId` is the input's `agent_id`, null when absent (the main agent). `cwd` is the input's `cwd`.
- **Which calls send.** `pre`: Edit, Write, MultiEdit, and Bash whose command runs `git commit`. `post`: Edit, Write, MultiEdit. Every other input, a Bash command with no `git commit`, an input that is not a JSON object, or a missing field → `request_from_input` returns None and the script prints nothing, opens no channel and exits 0. This also covers a host other than Claude that runs the file with another input shape.
- **Commit paths (decided).** A `git commit` commits staged paths plus any pathspec it names, so `commit_paths` sends their union, absolute:
  - Find the commit: `shlex.split(command, posix=True)`; a split error → None. Cut the token list at the first shell operator token (`&&`, `||`, `;`, `|`). Look for `git`, then optional `-C <dir>` / `-c <k=v>` pairs, then `commit`. No match → None (not a commit). Only the first `git commit` in the command counts.
  - `-C <dir>` sets the folder git runs in, relative to `cwd`.
  - Pathspec: every token after `commit` that does not start with `-`, skipping the value after each option that takes one: `-m`, `-F`, `-C`, `-c`, `-t`, `--message`, `--file`, `--author`, `--date`, `--template`, `--reuse-message`, `--reedit-message`, `--fixup`, `--squash`, `--cleanup`, `--trailer`. An option written with `=` takes no next token. Every token after `--` is pathspec.
  - Staged: `git diff --cached --name-only -z`. With `-a` or `--all` (or a short-flag cluster holding `a`, such as `-am`), add `git diff --name-only -z` (tracked changes).
  - Make each path absolute against `git rev-parse --show-toplevel`; make each pathspec token absolute against the git folder. A pathspec that names a folder is sent as that folder; 08 matches by prefix.
  - `run_git(args, cwd)` runs `git` with `GIT_TIMEOUT_SECONDS` and returns stdout, or None on a non-zero exit, a timeout or a missing git; a None from any git call → `commit_paths` returns the paths it has so far. Deduplicate, keep first-seen order.
  - A command that only names `git commit --amend` with nothing staged sends `[]` paths; 08 then finds no hit.
- **Session hello (pinned).** `{"protocol": endpoint.RELAY_PROTOCOL, "session_id": <input session_id>, "project_dir": env CLAUDE_PROJECT_DIR or <input cwd>, "harness": "claude", "config_dir": env CLAUDE_CONFIG_DIR or null, "hook": "chatroom.pre" | "chatroom.post"}`. `harness` is `claude`: only Claude Code runs plugin hooks in this plan (Codex reads the room at turn boundaries, plan § Out of scope).
- **Finding the app.** `endpoint.channel_path(start_app.endpoint_dir(env))`; None → print nothing, exit 0. The script never starts the app.
- **ask_app.** `endpoint.open_channel(channel, timeout=HOOK_TIMEOUT_SECONDS)`, write the hello line and the request line, read until a newline (each read bounded by the channel's timeout), parse the one line. Never call `hello_done()`, so the timeout holds for the whole exchange. Return the reply's `reply.text` when `ok` is true and `text` is a non-empty string; None on `ok: false`, an OSError, a timeout (`b""` from `read`), a line that is not JSON, or a missing `text`. Close the channel in `finally`.
- **Imports.** `hook.py` puts `Path(__file__).resolve().parent.parent / "forms"` at the front of `sys.path` before `import endpoint` and `import start_app`, so it runs from the plugin cache and from its tests. Standard library only.
- **Reply 08 sends (pinned for both sides).** `{"text": "<line(s)>"}` or `{"text": null}`; 08's handlers return it as the `HookReply.reply`.
- **marketplace AGENTS.md.** § Contents names "hooks" under Why the layout looks like this, but the section has no hooks bullet. Add one: **Plugin hooks in `hooks/hooks.json`.** Claude Code loads a plugin's `hooks/hooks.json` with no manifest field and expands `${CLAUDE_PLUGIN_ROOT}` in its commands. The wigley plugin's hooks run `scripts/chatroom/hook.py`, which always exits 0 and prints nothing when the app is away, so a hook never slows or blocks a session; give each hook a `timeout`. The hooks are Claude-only helpers (the chatroom gives Codex no hook path), so the skill rules must hold without them. Before writing a sentence about whether Codex reads a plugin's `hooks/hooks.json`, check Codex's plugin docs; with no check, leave Codex out of the bullet (low-confidence: unverified). Also add `plugins/<plugin>/hooks/hooks.json` to the layout tree, and the line `(cd plugins/wigley/scripts/chatroom && python3 -m unittest discover)` to § Done.
- **claude plugin validate.** Run it (§ Done). If it reports a schema error on `hooks/hooks.json`, fix the file to its message; the report says what it checked.
- **forms README § The relay.** Add a bullet **Hook calls**: a hello with a `hook` field is one request, not an MCP session: the client sends one JSON line after the hello and reads one reply line, `{"ok": true, "reply": …}` or `{"ok": false, "error": …}`, then the app closes the channel; the app opens no session and adds no row, and does not hold the hello. The chatroom hook (`scripts/chatroom/hook.py`) is the one client; it gives up after 1.5 s and prints nothing.

GIVEN the app answers `{"ok": true, "reply": {"text": "Chatroom: src/a.ts is claimed by Shop Revamp (refactor; 12 min left) — ask them in the room before you change it."}}` WHEN Claude runs `hook.py pre` for an Edit of `/w/src/a.ts` THEN stdout is one line `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": "Chatroom: src/a.ts is claimed by …"}}` and the exit code is 0
GIVEN no endpoint file, or an app that does not answer within 1.5 s WHEN the hook runs THEN stdout is empty and the exit code is 0
GIVEN a Bash call `npm test` WHEN `hook.py pre` runs THEN it opens no channel and prints nothing

Tests:     `test_hook.py` › `test_request_from_input` — one table, rows (event, input → expected request or None): Edit pre with `agent_id` → `{"tool": "edit", "paths": ["/w/a.ts"], "agentId": "agent-1", "cwd": "/w"}`; Write post with no `agent_id` → `agentId` None; MultiEdit pre → `edit`; Bash `npm test` pre → None; Bash `git commit -m x` post → None (post sends no Bash); Read pre → None; input not an object → None; Edit with no `tool_input.file_path` → None
           `test_hook.py` › `test_commit_paths` — one table over a fake `run_git` that answers by args (top `/w`, staged `a.ts\0`, tracked `b.ts\0`): `git commit -m "fix it"` → `["/w/a.ts"]`; `git commit -am x` → `["/w/a.ts", "/w/b.ts"]`; `git commit -m x -- c.ts sub/` → `["/w/a.ts", "/w/c.ts", "/w/sub"]`; `git -C sub commit -m x` → git run in `/w/sub`; `cd x && git commit --message=y d.ts` → `["/w/a.ts", "/w/d.ts"]`; `git status` → None; `git log --grep commit` → None; an unclosed quote → None; staged call returns None → `[]` plus pathspec
           `test_hook.py` › `test_output_for` — rows: (`pre`, text) → the PreToolUse JSON line; (`post`, text) → the PostToolUse line; (`pre`, None) and (`post`, `""`) → `""`
           `test_hook.py` › `test_ask_app_against_a_fake_app` — a fake app on a temp Unix socket (the `FakeApp` pattern of `forms/tests/test_relay.py`): rows: replies ok with text → that text, and the app received exactly the hello (with `hook`) and the request line; replies `{"ok": false, …}` → None; never replies → None within 1.5 s plus a small margin; closes at once → None
           `test_hook.py` › `test_main_never_fails` — rows: stdin not JSON; no endpoint folder; `run_git` raising; each → exit 0 and empty stdout
Done when: `(cd plugins/wigley/scripts/chatroom && python3 -m unittest discover)` passes; the four checks in marketplace `AGENTS.md` § Done pass, `claude plugin validate .` included; the test gate runs the tests above
Commit:    one commit for the group

## Proof
