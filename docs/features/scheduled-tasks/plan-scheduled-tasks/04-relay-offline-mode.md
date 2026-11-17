# 04 — Relay offline mode (marketplace)

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

This task changes the marketplace folder of the `ai` monorepo, `<market>` =
`/Users/jonathonwigley/Documents/.worktrees/ai-scheduled-tasks/wigley-ai-marketplace`, in the same worktree and
branch as `<gui>` (the written-ahead README commits are already on this branch). Every path and command below runs in
`<market>`. plan.md § Preconditions' relay row greps `<market>` and stays right.
It touches no file in `<gui>`. Task 05 writes the files this task reads; their shapes are pinned in plan.md
§ Shared names and shapes › Offline files. Read `<market>/AGENTS.md` whole and `README.md` § The relay and
§ Boundary rules first (plan.md § Mandatory Reads).

Files:     modify `<market>/plugins/wigley/scripts/forms/relay.py` ·
           test `<market>/plugins/wigley/scripts/forms/tests/test_relay.py` ·
           read `<market>/plugins/wigley/scripts/forms/README.md` (written ahead; edit a line only where the code
           proves it wrong) ·
           modify `<market>/plugins/wigley/.claude-plugin/plugin.json` and
           `<market>/plugins/wigley/.codex-plugin/plugin.json` (version bump)

Consumes:  nothing from another task. The offline file shapes are pinned in plan.md § Offline files:
           the env var `WIGLEY_FORMS_OFFLINE`, `<endpoint dir>/offline.json`, and the calls file
           `<calls folder>/<hello session_id>.jsonl`.
           From the tree (all in `relay.py` unless named): `Relay.__init__`, `Relay._connect(launch)`,
           `Relay._answer_alone(message)`, `Relay._reach_app()`, `Relay._fail_waiting_calls()`, `_tool_name(message)`,
           `_tool_error(request_id, text)`, `_response(request_id, result)`, `_denied_or(form_answer, request_id, tool,
           why)`, `main()`, `self._hello["session_id"]` (from `hello_from_env`), `start_app.endpoint_dir(env)`,
           `start_app.read_endpoint(endpoint_dir)`.

Produces:  in `relay.py`:
           `OFFLINE_ENV = "WIGLEY_FORMS_OFFLINE"`
           `OFFLINE_TABLE = "offline.json"`
           `def offline_calls_dir(env) -> Path | None` — the calls folder `env[OFFLINE_ENV]` names, as given (no `~`
           expansion, like `WIGLEY_AI_GUI_ENDPOINT_DIR`); `None` when unset or empty.
           `Relay.__init__` gains a last keyword parameter `offline_calls: Path | None = None`. `None` keeps today's
           behaviour on every path. A path switches on offline mode.
           `main()` passes `offline_calls=offline_calls_dir(os.environ)`.
           The relay's other new members are the implementer's choice.

Decisions:
- **What offline mode changes.** Offline mode changes only what happens where the relay would start the app today.
  The relay never runs `self._start` in offline mode: `_connect` treats `launch` as false. In each place where a
  tools/call then has no app, the call gets its offline answer (below) and a calls-file line. These are the places:
  - a call with no channel and no hold (`handle_line` → `_answer_alone`);
  - the end of a reconnect with no app (`_reach_app` → `_fail_waiting_calls`): each waiting call gets its offline
    answer instead of the app-gone error.
  Everything else stays as today: the connect at start (`connect_if_running`), forwarding while connected, the 30 s
  hold and poll after a drop, the replayed handshake, `tools/list` and the handshake answers with no app (from
  `tools.json` or the built-in list), and the tool-list notices. Reason: settled design, "With no app reachable it
  never starts the app"; the hold keeps an adopted run's reattach across an app restart or `install-app`.
- **A refused hello keeps the refusal.** With `_refusal` set, a call gets today's refused answer
  (`_refused_answer`) in offline mode too, and no calls-file line. Reason: the app is reachable; it refused.
- **The app comes back by the existing path.** Outside the 30 s hold, which polls as today, the relay does not poll
  for the app. Each tools/call with no channel
  first tries `_connect` without a start, as today. So the first call after the app opens connects, says hello,
  replays the handshake and is forwarded. Reason: settled design, "the relay's existing reconnect moves the run onto
  the app"; chat adopts the row inside `sessions.holdConnects`, so the relay's hello joins the owned row.
- **The offline answer.** The relay reads `<endpoint dir>/offline.json` (`self._endpoint_dir / OFFLINE_TABLE`) on
  each offline answer, as `_tools_list` reads `tools.json` on each list. The app rewrites the file on each start.
  - Entry found: the response's `result` is the entry's `result`, unchanged. No `_denied_or` wrap: the app's
    `permission_prompt` entry already is the deny text block (plan.md § Offline answers per tool).
  - Tool left out: a tool error (`_tool_error`, `isError: true`) with the text `The app is closed: <tool> did not
    run.` (pinned in plan.md), passed through `_denied_or` with `why` = `The app is closed`. So a left-out
    `permission_prompt` gets one text block holding `{"behavior":"deny","message":"The app is closed. The user was
    not asked, so this tool call did not run."}`.
  - A call whose params hold no string name: the tool error text `The app is closed: this call named no tool, so it
    did not run.`, and no calls-file line. No caller sends such a call; the branch exists because `_tool_name` can
    return `None`. It gets no test.
- **An unreadable table is an empty table.** These read as "every tool left out": no file, a file that is not JSON,
  a top level that is not an object, `tools` that is not an object. One entry reads as left out when it is not an
  object, its `result` is not an object, its `result.content` is not a list, or its `replay` is not a boolean. The
  relay validates only this shape, never the content. Reason: README § Boundary rules, the relay holds no tool logic.
- **The calls-file line.** One line per offline answer, appended to `<offline_calls>/<session id>.jsonl`, where the
  session id is `self._hello["session_id"]`. Shape (pinned in plan.md): `{"tool": <name>, "arguments": <params
  .arguments when an object, else {}>, "toolUseId": <params._meta["claudecode/toolUseId"] when a string, else
  null>, "at": <int epoch ms of the answer>, "replay": <the entry's replay; false for a left-out tool>}`, written with
  `json.dumps` and a trailing `\n`, in one write, UTF-8.
  - The relay creates the folder (`mkdir(parents=True, exist_ok=True)`) before the first append.
  - Each append opens the file by its path in append mode, writes the one line, and closes it. The relay keeps no
    open handle. Reason: the app claims the file by renaming it (task 05), so the next append after a rename starts
    a new file.
  - Appends happen under one lock, since the main thread and the reconnect thread can both answer. Lines keep the
    order of their appends; the app replays them in file order. Write the line before the answer goes to the host,
    so a host that reads the answer and exits leaves the line on disk.
  - A held call's line: `_WaitingCall` holds only `tool` and the raw `line`, so `_fail_waiting_calls` parses
    `call.line` again with `json.loads` to read `arguments` and `_meta`. `_WaitingCall` does not change.
  - A `None` session id (`CLAUDE_CODE_SESSION_ID` unset; host-fired Claude runs always set it): the call still gets
    its answer, no line is written, and the relay logs one stderr line through `_log` for each such call. The relay
    keeps no state for it.
  - An `OSError` on the write: the call still gets its answer; the relay logs the error through `_log`.
- **No hello change.** The hello line and `RELAY_PROTOCOL` stay as they are. The app learns about offline calls from
  the calls file, keyed by the session id it already gets. An old app ignores an env var it never set.
- **How the var reaches the relay.** The session host sets `WIGLEY_FORMS_OFFLINE` in the env of the `claude`
  process it fires; Claude Code starts the `wigley-forms` server with its own environment, the same way
  `WIGLEY_AI_GUI_ENDPOINT_DIR` reaches the relay today (README § The relay › Finding the app). No manifest change.
- **The README is written ahead.** `README.md` § The relay › Offline mode, the offline sentences in **Starting the
  app** and **App gone mid-call**, the Contents line, § Local commands' test-suite sentence and § Boundary rules were
  committed before this task, on this branch (plan.md § Docs written ahead).
  Read them first and make the code match them. Edit a README line only where the code proves it wrong, and name each
  such edit in the commit message. `relay.py`'s module docstring names the offline mode in one clause.
- **Version bump.** `<market>/AGENTS.md` § Changing a plugin: bump `version` in both wigley manifests in this
  commit, from `2.3.3` (at plan time) to `2.4.0`, a new relay mode. When main moved past 2.3.3 before this task
  runs, take the next minor version from main's value.

GIVEN offline mode, no app reachable, and an `offline.json` with an entry for `set_session_title` (replay true)
WHEN the host sends that tool call with `_meta["claudecode/toolUseId"]` `toolu_1`
THEN the host gets the entry's `result` unchanged, `<calls folder>/session-1.jsonl` holds one line with tool,
arguments, `toolUseId` `toolu_1`, an `at` in the call's time window and `replay` true, and no start ran.

GIVEN offline mode and no app WHEN the host calls a tool the table leaves out
THEN the host gets the tool error `The app is closed: <tool> did not run.` and the line's `replay` is false; for
`permission_prompt` the answer is the deny text block.

GIVEN offline mode and an `offline.json` that is missing, not JSON, or malformed
WHEN the host calls `ask_round` THEN the call gets the left-out answer.

GIVEN offline mode and a connected app holding a call WHEN the app drops and does not come back within the wait
THEN the held call gets its offline answer, is logged, and no start ran.

GIVEN offline mode and an app that dropped less than `reconnect_wait` ago WHEN the host sends a new call THEN the
call is not answered at once; it waits in the hold, and is forwarded when the app comes back within the wait.

GIVEN offline mode and a null hello session id WHEN the host calls a tool THEN the call gets its offline answer, no
calls file is written, and `_log` is called once for that call.

GIVEN offline mode and a calls-folder path that is an existing regular file WHEN the host calls a tool THEN the call
still gets its offline answer and `_log` names the write error.

GIVEN offline mode and a reachable app WHEN the host calls a tool THEN the call is forwarded as today and no line is
written.

GIVEN offline mode after an offline answer WHEN the app opens and the host calls a tool
THEN the relay connects, replays the handshake and forwards the call.

GIVEN offline mode and an app that refuses the hello WHEN the host calls a tool THEN the call gets today's refused
answer and no line is written.

Tests:     in `tests/test_relay.py`, a new `OfflineTests(RelayTestCase)`. `make_relay` gains an `offline_calls`
           keyword, passed to `Relay`. Each test passes `start=` a function that records its call, and asserts the
           record stays empty. The calls folder is `self.dir / "offline-calls"`, not created by the test, so every
           test also covers the folder's creation. Each test writes its own `offline.json`.
- `test_a_call_with_no_app_gets_the_tables_answer_and_a_calls_line_without_a_start` — one table, two calls per row
  so the order of lines is asserted. Rows: an entry with `replay` true and a `toolUseId`
  (`set_session_title`, with `structuredContent` in its `result`, to show it passes unchanged); an entry with
  `replay` false and no `_meta` (`ask_round`, `toolUseId` null); a left-out tool (`some_app_tool`, the pinned tool
  error, `replay` false); a left-out `permission_prompt` (the deny block). Asserts the whole host answer and the whole
  list of parsed lines, `at` checked to lie between the times read before and after the call. Break: the entry
  wrapped or rebuilt; `replay` taken from the wrong place; the left-out error not denied for `permission_prompt`; the
  folder not created; the line not keyed by the hello's session id. Two more rows pin the argument shapes: a call
  with `arguments: "x"` logs `"arguments": {}`, and one with `_meta: {"claudecode/toolUseId": 5}` logs
  `"toolUseId": null`.
- `test_a_call_the_relay_cannot_log_still_gets_its_answer` — rows: a hello `session_id` of `None` (the answer
  arrives, no file in the calls folder, `relay._log` called once, through `mock.patch`); the calls-folder path is an
  existing regular file (the answer arrives, `_log` called with the error). Break: a log failure that kills the
  answer.
- `test_a_call_inside_the_hold_after_a_drop_waits_for_the_app` — app with `hold_calls=False` and
  `reconnect_wait=1.0`; one forwarded call; `app.stop()`; a new call within the wait gets no answer at once; a
  `FakeApp` starts and `write_endpoint()` runs; the call is forwarded and no calls-file line is written. Break:
  offline answering checked ahead of `is_held`, which would end an adopted run's reattach across an app restart.
- `test_an_unreadable_table_answers_every_call_as_left_out` — rows: no file; `not json`; `[]`; `{"tools": []}`;
  an `ask_round` entry whose `result` has no `content` list; an entry whose `replay` is `"yes"`. Each row asserts the
  left-out answer for `ask_round` and `replay` false. Break: a malformed entry served as a result, or a parse error
  that kills the relay.
- `test_a_call_waiting_when_the_app_goes_gets_the_tables_answer_after_the_wait` — app with `hold_calls=True`,
  `reconnect_wait=0.1`; the held call carries `{"heading": "h"}` as arguments and a `_meta` tool-use id; after
  `app.stop()` it gets the table's answer and one line holding those arguments and that id. Break:
  `_fail_waiting_calls` keeps the app-gone error, the reconnect starts the app, or the held line loses its
  arguments.
- `test_a_call_with_the_app_reachable_is_forwarded_and_writes_no_line` — Break: offline mode answering from the
  table while an app is connected.
- `test_a_call_after_offline_answers_reaches_the_app_that_opened` — the test first sends `INITIALIZE` and
  `INITIALIZED`, since the relay replays only the handshake it remembered; one offline answer, then a `FakeApp` starts and
  `write_endpoint()` runs; the next call is forwarded with the replayed handshake ahead of it (as
  `HeldCallTests.REPLAYED_HANDSHAKE`). Break: offline mode latching on, so the run never moves onto the app.
- `test_a_refused_hello_in_offline_mode_keeps_the_refusal` — the answer equals today's `ROUND_REFUSED` tool error;
  no line. Break: the offline branch checked ahead of `_refusal`.
- `test_offline_calls_dir_reads_the_env` — rows: unset → `None`; `""` → `None`; `/x/offline-calls` →
  `Path("/x/offline-calls")`. Break: an empty value switching offline mode on, which writes calls into the working
  folder.
- Every existing test runs unchanged: with `offline_calls` left out, today's behaviour holds on every path.
- Runtime checks — a host-fired run with the app closed answering from the real `offline.json` that task 05 writes,
  and its calls replaying onto the adopted row — are in task 21 (Final verification). This task runs none.

Done when:
- `(cd plugins/wigley/scripts/forms && python3 -m unittest discover)` passes from `<market>`.
- The four checks in `<market>/AGENTS.md` § Done pass: both `check_manifests.py` lines (the second against
  `origin/main`, which proves the bump), `check_pointers.py`, and `claude plugin validate .`.
- `grep -c 'WIGLEY_FORMS_OFFLINE\|offline.json' <market>/plugins/wigley/scripts/forms/relay.py` is above 0 (plan.md
  § Preconditions' relay row flips).
- Each README line of the Offline mode section and the offline sentences elsewhere is true of `relay.py`, read line
  by line against the code.

Commit:    one commit for the group, on this worktree's branch, which holds the written-ahead README
           commits. It lands with the branch per `~/wigley-agents/WigleyRepos.md` § Landing; task 21 runs the
           landing. Message: the relay gains an offline mode, switched on by
           `WIGLEY_FORMS_OFFLINE`, that never starts the app, answers each call from the app's `offline.json` and
           logs it to the session's calls file for the app to replay; tests; bump to 2.4.0 (the version bump stays in
           this commit); any README line the code proved wrong.

## Proof

