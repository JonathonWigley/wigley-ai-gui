# 03 — Relay holds a call across an app restart

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo: `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-marketplace`, branch `main` (that repo's `AGENTS.md`: commit
straight to `main`). Spec: `plugins/wigley/scripts/forms/README.md` § The relay, the bullets **App gone mid-call**,
**Starting the app** (the Windows `app-*` lookup) and **Late connection**. The README is already in its after-state;
do not edit it.

Files:     modify `plugins/wigley/scripts/forms/relay.py` · modify `plugins/wigley/scripts/forms/start_app.py` ·
           test `plugins/wigley/scripts/forms/tests/test_relay.py` · test `plugins/wigley/scripts/forms/tests/test_start_app.py` ·
           modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json`
Consumes:  none. Task 04 makes the Windows `app-<short sha>` folders this task finds; this task reads only the
           folder names and their modified times, so it does not wait for 04.
Produces:  in `relay.py`:
           `RECONNECT_WAIT_SECONDS = 30.0`
           `RECONNECT_POLL_SECONDS = 0.5`
           `Relay.__init__(self, endpoint_dir, hello, write_host, start=None, reconnect_wait: float = RECONNECT_WAIT_SECONDS, reconnect_poll: float = RECONNECT_POLL_SECONDS)`
           in `start_app.py`:
           `def list_app_folders(base: PurePath) -> list[tuple[PurePath, float]]`
           `def installed_app_command(env, platform: str = sys.platform, is_file=..., app_folders: Callable[[PurePath], list[tuple[PurePath, float]]] = list_app_folders) -> tuple[list[str], str]`

## Decisions

### relay.py: the waiting call

- **What holds a waiting call.** `Relay._pending` today maps a request id to its tool name. After: it maps the id to
  a small record of the tool name and the host's line exactly as received (the bytes `_forward` writes, without the
  newline). The re-send writes those bytes again, unchanged (README: the relay forwards every message unchanged).
  Insertion order is the re-send order.
- **A new state flag.** `Relay._reconnecting: bool`, read and written only under `self._lock`. It is True from the
  moment a dropped channel leaves at least one call waiting until the waiting calls are re-sent or answered.
- **`_drop(channel)`.** Today it clears `_pending` and answers each entry with `APP_GONE`. After: it forgets the
  channel and closes it as today. When `_pending` is empty, it does nothing more (no poll, no start: the next call
  starts the app as today). When `_pending` holds calls, it sets `_reconnecting` and starts one daemon thread on a
  new method `_reconnect()`. It answers no call. `_drop` runs on the reader thread or, from `_forward`'s failed
  write, on the stdin thread; the thread keeps both free.
- **`_reconnect()`** (the new method; one runs at a time, guarded by `_reconnecting`):
  1. Poll: every `reconnect_poll` seconds (0.5 s), for up to `reconnect_wait` seconds (30 s) from the drop, call
     `self._connect(launch=False)`. It reads the endpoint file each time, since a restarted app rewrites it. Stop
     at the first True, or when `_refusal` is set.
  2. Past 30 s with no connection and no refusal: call `self._connect(launch=True)` once. That runs `start_app`
     as a tool call does, with its own 45 s channel wait.
  3. Connected: `_open` has already said hello and replayed `initialize` (id `REPLAY_ID`) and
     `notifications/initialized`. Then, under `self._lock`, write each waiting call's line plus `b"\n"` to the new
     channel in insertion order, keep them in `_pending`, and set `_reconnecting` to False. A write that fails here
     goes through `_drop` as today, which starts a new reconnect for the calls still waiting.
  4. Not connected (refusal, or a failed start): under `self._lock`, take every waiting call, clear `_pending`, and
     set `_reconnecting` to False. Answer each one outside the lock:
     - after a refused hello: the refusal tool error `_answer_alone` sends today for a `tools/call`, with that
       call's tool words. Move that text into a helper both paths call; its wording does not change.
     - otherwise: `_tool_error(request_id, APP_GONE.format(...))` with the call's tool words. The `APP_GONE` text
       does not change.
  5. `close()` sets a new `threading.Event` (`self._closed`). The poll checks it before each try and stops with no
     start and no answer when it is set; `close()` already clears `_pending`.
- **A second call that arrives while one waits.** `handle_line` skips its `self._connect(launch=True)` while
  `_reconnecting` is True, so the relay starts no app inside the 30 s window and never races an install.
  `_forward` checks `_reconnecting` under `self._lock` before it checks the channel: while it is True, a
  `tools/call` with an id joins `_pending` with its line, is not written, and `_forward` returns True (the relay does
  not answer it). The same reconnect re-sends it after the first call, or answers it with the same error. The flag
  check and the re-send share `self._lock`, so no call is sent twice and none is lost between them, even when
  `_open` has already set the new channel.
- **What the host sees meanwhile.** For a waiting call: nothing, until the app's answer to the re-sent call or the
  error in step 4. Every other host message takes today's no-app path while `_reconnecting` is True: `initialize`,
  `ping` and `tools/list` are answered by the relay (`tools.json`, else `BUILT_IN_TOOLS`); a notification and the
  host's answer to an app request are not forwarded. `notifications/cancelled` still runs `_remember`, which removes
  the cancelled id from `_pending`: that call is not re-sent and gets no answer.
- **`_forward`'s write failure.** It calls `_drop(channel)` as today and returns `is_call`. The failed call is
  already in `_pending`, so it is held and re-sent like any other waiting call.
- **Unchanged.** `connect_if_running`, `_open`, `_replay`, `_say_hello`, `_from_app` (it still removes an answered
  id from `_pending`), the hello timeout, `not_started` and the needs_manual_open path for a call that finds no app
  when nothing waits.
- Update the module docstring of `test_relay.py` ("the app-gone error") to name the held call.

### start_app.py: the Windows install

- **`installed_app_command`, win32 branch.** `base = PureWindowsPath(LOCALAPPDATA, "Programs", "wigley-ai-gui")`.
  Call `app_folders(base)`. Pick the folder with the greatest modified time; on a tie, the greater name. The
  binary is `<folder>\wigley-ai-gui.exe`; the cwd is that folder. The `LOCALAPPDATA`-unset failure and the macOS
  and other-platform branches do not change.
- **No `app-*` folder** (the list is empty, or `base` is missing): raise `StartFailed` with the existing missing-app
  text, naming `base`:
  `there is no installed wigley-ai-gui app at C:\L\Programs\wigley-ai-gui; run npm run install-app in the wigley-ai-gui repo`.
- **The newest folder holds no exe:** `is_file` is False, so the existing failure names the exe path in that folder.
- **`list_app_folders(base)`** (the default `app_folders`): each entry of `base` that is a folder and whose name
  starts with `app-`, as `(base / name, modified time in seconds)`. An empty list when `base` does not exist or
  cannot be listed (OSError). It reads the real file system; only the win32 branch calls it.
- Update the docstring of `installed_app_command` and the module docstring of `test_start_app.py` to the new
  Windows path.

### Version

Bump `version` in both plugin manifests in the same commit, from the version found at run time: the minor part
up by one, the patch part to 0 (1.14.0 at plan time, so 1.15.0). This task is the plan's only marketplace change,
so it bumps once (`AGENTS.md` § Changing a plugin).

## Behaviour

GIVEN a call waits on the app WHEN the channel drops and the app's channel accepts again within 30 s
THEN the relay says hello, replays `initialize` and `notifications/initialized`, sends the call's line again,
starts no app, and the app's answer reaches the host with the call's id.

GIVEN a call waits on the app WHEN the channel drops and no app answers for 30 s THEN the relay runs `start_app`
once; on success it sends the call again; on failure the host gets the `APP_GONE` tool error for that call.

GIVEN a call waits through a reconnect WHEN the host sends a second `tools/call` THEN the relay starts nothing for
it, holds it, and sends it after the first call, or answers it with the same error.

GIVEN no call waits WHEN the channel drops THEN the relay does not poll; the next call starts the app as today.

GIVEN `%LOCALAPPDATA%\Programs\wigley-ai-gui\` holds `app-aaa` (modified 100) and `app-bbb` (modified 200) WHEN
`installed_app_command` runs on win32 THEN it returns the exe in `app-bbb`, with `app-bbb` as the cwd.

## Tests

In `test_relay.py`. `make_relay` gains `reconnect_wait` (default 0.3) and `reconnect_poll` (default 0.02) and passes
them to `relay.Relay`. To bring an app back on the same path, a test stops the first `FakeApp`, removes the socket
file (`os.unlink(self.channel)`), and starts a second `FakeApp`.

- `AppGoneTests.test_a_call_waiting_when_the_app_goes_gets_the_app_gone_error` — change: the relay's start returns
  `StartResult(False, "gone")` and `reconnect_wait` is 0.1; the host still gets exactly
  `{"jsonrpc": "2.0", "id": 7, "result": {"content": [{"type": "text", "text": ROUND_APP_GONE}], "isError": True}}`.
- `AppGoneTests.test_each_waiting_call_gets_the_app_gone_text_of_its_own_tool` — change the same way; the pinned
  results by id (7: `ROUND_APP_GONE`, 8: `PRIMER_APP_GONE`) stay.
- `test_after_the_app_goes_the_next_call_tries_to_start_it_again` and
  `test_a_call_the_host_cancelled_gets_no_app_gone_error` — keep unchanged; they now prove that no call waiting
  means no poll.
- New class `HeldCallTests`:
  - `test_a_waiting_call_is_sent_again_to_the_app_that_comes_back` — send `INITIALIZE`, `INITIALIZED`,
    `tool_call(7)` to a `hold_calls=True` app; stop it; start a second `FakeApp` (no hold) with
    `reconnect_wait=2.0`. The second app's hello equals `HELLO`; it receives, in order,
    `{**INITIALIZE, "id": relay.REPLAY_ID}`, `INITIALIZED`, `tool_call(7)`; the host's next message is
    `{"jsonrpc": "2.0", "id": 7, "result": FakeApp.ANSWERS["tools/call"]}`; `self.spawned == []`.
  - `test_an_app_that_stays_gone_is_started_after_the_poll` — `reconnect_wait=0.1`; a `start` that starts a second
    `FakeApp` and returns ready. Starts counted: exactly 1; the host gets the app's answer for id 7.
  - `test_a_second_call_while_one_waits_is_held_and_sent_after_it` — hold `tool_call(7)`, stop the app, send
    `named_tool_call(8, "open_primer")` during the poll, then start a second `FakeApp`. No start ran; the second app
    receives `tool_call(7)` then `named_tool_call(8, "open_primer")` after the replayed handshake.
  - `test_a_call_cancelled_while_it_waits_is_not_sent_again` — hold `tool_call(3)`, stop the app, send
    `notifications/cancelled` for 3, then a second call `tool_call(4)`, then start a second `FakeApp`. The second app
    receives `tool_call(4)` and never `tool_call(3)`; the host gets no message for id 3.
  - `test_tools_list_while_a_call_waits_is_answered_by_the_relay` — during the poll, `tools/list` id 5 gets
    `{"jsonrpc": "2.0", "id": 5, "result": relay.BUILT_IN_TOOLS}` (no `tools.json` in the folder).
  - `test_a_refused_hello_after_the_drop_answers_with_the_refusal` — the second `FakeApp` answers
    `{"ok": False, "error": "relay protocol 1, app protocol 2"}`; the host gets a tool error for id 7 whose text holds
    `relay protocol 1, app protocol 2` and `Send the round again with ask_round`; no start ran.

In `test_start_app.py`, `InstalledAppCommandTests`:

- `test_windows_runs_the_exe_under_localappdata` — rename to `test_windows_runs_the_exe_in_the_newest_app_folder`;
  `app_folders` returns `[(PureWindowsPath("C:\\L\\Programs\\wigley-ai-gui\\app-aaa"), 100.0),
  (PureWindowsPath("C:\\L\\Programs\\wigley-ai-gui\\app-bbb"), 200.0)]`; the result equals
  `(["C:\\L\\Programs\\wigley-ai-gui\\app-bbb\\wigley-ai-gui.exe"], "C:\\L\\Programs\\wigley-ai-gui\\app-bbb")`.
- `test_windows_breaks_a_modified_time_tie_by_the_greater_name` — `app-aaa` and `app-bbb` both at 100.0 → `app-bbb`.
- `test_windows_with_no_app_folder_fails_naming_the_folder` — `app_folders` returns `[]`; the message equals
  `there is no installed wigley-ai-gui app at C:\L\Programs\wigley-ai-gui; run npm run install-app in the wigley-ai-gui repo`.
- `test_list_app_folders_lists_only_app_folders` — in a temp folder make folder `app-1`, file `app-2`, folder
  `other`; the names listed are `["app-1"]`; a missing base lists `[]`.

## Done when

Every command in the marketplace `AGENTS.md` § Done passes from the repo root, the forms suite
(`cd plugins/wigley/scripts/forms && python3 -m unittest discover`) among them, and both manifests carry the new
version. The live check of a call held across a real restart and `install-app` is task 12's.

## Commit

One commit on marketplace `main`, holding every file above, for example: "Forms relay: hold a waiting call across
an app restart and re-send it; find the Windows install in the newest app-* folder; bump to 1.15.0". Do not push.

## Proof

