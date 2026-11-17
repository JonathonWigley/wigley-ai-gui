# 03 — Relay endpoint module and Codex id

Status: not started
Type: Task
Rung: hard · adds `endpoint.py`, the module 07 imports, and changes the relay hello's `session_id` for Codex, which the app's session and forms hand-back code reads
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files (wigley-ai-marketplace): create `plugins/wigley/scripts/forms/endpoint.py` · modify `plugins/wigley/scripts/forms/relay.py` · modify `plugins/wigley/scripts/forms/README.md` · test `plugins/wigley/scripts/forms/tests/test_relay.py` · test `plugins/wigley/scripts/forms/tests/test_endpoint.py`
Consumes:  none (the tree holds `start_app.read_endpoint(endpoint_dir: Path) -> Endpoint | None` and `start_app.endpoint_dir(env) -> Path`)
Produces:  in `wigley-ai-marketplace/plugins/wigley/scripts/forms/endpoint.py`:
           `RELAY_PROTOCOL = 1`
           `HELLO_TIMEOUT_SECONDS = 10.0`
           `READ_SIZE = 65536`
           `class SocketChannel` and `class PipeChannel`, moved unchanged except the timeout parameter below: `__init__(self, path: str, timeout: float = HELLO_TIMEOUT_SECONDS)`, `hello_done()`, `read() -> bytes`, `write(data: bytes)`, `close()`
           `def open_channel(path: str, timeout: float = HELLO_TIMEOUT_SECONDS)` — raises OSError when nothing listens
           `def channel_path(endpoint_dir: Path) -> str | None` — the channel the endpoint file in `endpoint_dir` names, or None with no readable endpoint file
           in `wigley-ai-marketplace/plugins/wigley/scripts/forms/relay.py`:
           `def hello_from_env(env, process_session_id: str) -> dict[str, Any]`
           `def codex_session_id() -> str` — `"codex-" + uuid.uuid4().hex`
Decisions:
- **What moves.** `relay.py` keeps the MCP relay. `endpoint.py` takes the endpoint lookup and the channel open: `RELAY_PROTOCOL`, `HELLO_TIMEOUT_SECONDS`, `READ_SIZE`, `SocketChannel`, `PipeChannel`, `open_channel`, and a new `channel_path`. `start_app.py` keeps `Endpoint`, `endpoint_dir` and `read_endpoint`, since `start_app.py` and about 60 lines of its tests use them; `endpoint.channel_path` calls `start_app.read_endpoint`. Both modules stay standard library only.
- `relay.py` imports the module (`import endpoint`) and calls `endpoint.open_channel(...)`, `endpoint.channel_path(...)` and `endpoint.RELAY_PROTOCOL` through it, so a test that patches `endpoint.open_channel` or `endpoint.HELLO_TIMEOUT_SECONDS` reaches the relay. `Relay._connect` calls `endpoint.channel_path(self._endpoint_dir)` in place of `start_app.read_endpoint(...).channel`. `relay.py` still imports `start_app` for `start_app` and `endpoint_dir`.
- **Timeout parameter.** The two channel classes take `timeout` (seconds) in place of the module constant, read at construction; the default is `HELLO_TIMEOUT_SECONDS`, read at call time (write `timeout: float | None = None` and fall back to the module value, so a patch of `endpoint.HELLO_TIMEOUT_SECONDS` still takes effect, as test line ~1081 patches `relay.HELLO_TIMEOUT_SECONDS` today). 07 passes 1.5.
- **Codex id.** Today `session_id` is `CLAUDE_CODE_SESSION_ID` or None, and Codex sets no such variable, so every Codex hello says `null`. After: `hello_from_env(env, process_session_id)` sets `session_id` to `CLAUDE_CODE_SESSION_ID` when set; else, when `harness` is `codex`, to `process_session_id`; else None. `main()` calls `codex_session_id()` once and passes it, so every hello of one relay process (each reconnect included) carries the same id, and a new Codex process gets a new id. A Claude session with no `CLAUDE_CODE_SESSION_ID` keeps `null`, as today.
- **Effect to state in the README.** The app's forms restart hand-back reads the session id. With the relay's id, a Codex session gets a hand-back while its relay process lives (an app restart under a live Codex session). README § Saved rounds line "Codex sets neither, so a Codex session gets no restart hand-back" is stale after this task; rewrite it to say what is true.
- **README § The relay.** Update the Hello bullet: `session_id` is `CLAUDE_CODE_SESSION_ID`, or for a Codex session the relay's own id, `codex-<32 hex>`, made once per relay process. Add one sentence to the bullet list or the section's opening: the endpoint lookup and channel open live in `endpoint.py`, which `relay.py` and the chatroom hook script import. The hook-call bullet is 07's.
- **Version.** The wigley plugin is already 2.13.0 from the docs-ahead commit `35f0b1524` (marketplace `AGENTS.md` § Changing a plugin: one bump per pushed series). Do not bump.
- Keep `relay.py`'s module docstring true: it names its spec and says standard library only; add that the channel lives in `endpoint.py`.

GIVEN a Codex host (no `CLAUDECODE=1`, no `CLAUDE_CODE_SESSION_ID`) WHEN the relay connects, the app restarts, and the relay connects again THEN both hellos carry the same `session_id`, which starts with `codex-`
GIVEN a Claude host with `CLAUDE_CODE_SESSION_ID=session-9` WHEN the hello is built THEN `session_id` is `session-9`, whatever `process_session_id` is

Tests:     `test_relay.py` › `HelloTests` — rewrite `test_hello_is_null_for_each_unset_value_and_codex_without_claudecode` and its neighbours into one table test, `test_hello_session_id_by_host`: rows (env, process id → expected `session_id`): Claude env with `CLAUDE_CODE_SESSION_ID=session-9` and process id `codex-aa` → `session-9`; Codex env `{}` with `codex-aa` → `codex-aa`; `{"CLAUDECODE": "1"}` with `codex-aa` → None; `{"CLAUDECODE": "0"}` with `codex-bb` → `codex-bb`. Keep `test_hello_reads_session_project_and_deadline_from_the_environment`, passing a process id, with its whole-dict assertion
           `test_relay.py` › `test_a_codex_hello_keeps_its_session_id_across_an_app_restart` — a relay built with a Codex hello connects to a `FakeApp`, the app stops and a second `FakeApp` starts on the channel, a call reconnects; both apps received a hello whose `session_id` is the same `codex-…` value
           `test_relay.py` › `test_codex_session_id_is_codex_and_32_hex` — `codex_session_id()` matches `^codex-[0-9a-f]{32}$`, and two calls differ
           `test_endpoint.py` — move `PipeChannelTests` (Windows only) from `test_relay.py` unchanged except the module name (`endpoint.open_channel`, `endpoint.HELLO_TIMEOUT_SECONDS`), and add `test_channel_path_reads_the_endpoint_file` — a table: a written `endpoint.json` → its `channel`; no file → None; a file that is not JSON → None
           `test_relay.py` — every `mock.patch.object(relay, "open_channel" | "SocketChannel" …)` moves to the `endpoint` module (lines ~562–621, ~703, ~1054–1082 at plan time); the existing tests then pass unchanged
Done when: `(cd plugins/wigley/scripts/forms && python3 -m unittest discover)` passes; the four checks in marketplace `AGENTS.md` § Done pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof
