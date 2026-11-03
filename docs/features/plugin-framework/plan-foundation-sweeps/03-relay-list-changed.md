# 03 — Relay advertises tool-list changes

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo: `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-marketplace` (`<marketplace>`). Every path below is relative
to it. Read `<marketplace>/AGENTS.md` first: § Commit straight to main, § Changing a plugin and § Done apply.

Files:     modify `plugins/wigley/scripts/forms/relay.py` (the code and the module docstring) · modify `plugins/wigley/scripts/forms/README.md` ·
           modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json` ·
           test `plugins/wigley/scripts/forms/tests/test_relay.py`
Consumes:  `Relay._answer_alone` in `relay.py` (the tree holds it) · `Relay._from_app`, which forwards every app line
           to the host, notifications included (the tree holds it; no change)
Produces:  `Relay._answer_alone` answers `initialize` with `"capabilities": {"tools": {"listChanged": True}}` in
           `plugins/wigley/scripts/forms/relay.py`
Decisions: the relay's lone `initialize` answer advertises `tools: {listChanged: true}` (plan.md Decisions, round 3) ·
           the relay forwards the app's `notifications/tools/list_changed`, and sends one of its own when the app's
           channel drops and after it opens one, each only once the host has sent `notifications/initialized` (lead's
           decision at the seam check: at quit each dependent's disposal makes the host refetch a shrinking list, and
           without the relay's own notice the host keeps that short list after the relay falls back to `tools.json`) · the version bump follows `<marketplace>/AGENTS.md` § Changing a plugin (plan.md Preconditions)

Precondition status: the Claude Code docs (§ Dynamic tool updates) confirm that a `notifications/tools/list_changed`
makes the host refetch the tool list. They do not say whether the host needs the server to advertise
`tools.listChanged` first. This task does not rely on that: advertising it is harmless either way.

Now: `_answer_alone` answers a lone `initialize` with `{"protocolVersion": <version>, "capabilities": {"tools": {}},
"serverInfo": SERVER_INFO}` (line ~404, measured at plan time, re-verify). A host that initialized while the app was
away therefore does not say that the server can change its tool list. This task advertises it, in case the host
needs it.

After: the same answer carries `"capabilities": {"tools": {"listChanged": True}}`. Nothing else in the answer changes.

After, too: `Relay` gains `_tools_changed()`, which sends the host
`{"jsonrpc": "2.0", "method": "notifications/tools/list_changed"}` when `self._initialized` is not `None`. `_drop`
calls it last, after the app-gone errors, and only when it forgot the channel (not on its early return). `_open` calls
it after it stores the channel and starts the reader thread, on every `_open`: a start a tool call triggers is
included. A host that has not initialized gets nothing: it has not listed tools yet.
The app's own `initialize` answer is not touched here (task 05 changes it in wigley-ai-gui).

GIVEN no app is reachable WHEN the host sends `initialize` THEN the relay's answer has `capabilities` equal to
`{"tools": {"listChanged": True}}`, the host's `protocolVersion` and `serverInfo.name` `wigley-forms`

Tests:     `test_initialize_echoes_the_hosts_protocol_version` in `plugins/wigley/scripts/forms/tests/test_relay.py`
           (class `NoAppTests`) owns the lone-initialize answer. Change its capabilities assertion from
           `self.assertEqual(result["capabilities"], {"tools": {}})` to
           `self.assertEqual(result["capabilities"], {"tools": {"listChanged": True}})`. Its other two assertions
           (`protocolVersion` `2025-11-25`, `serverInfo.name` `wigley-forms`) stay. Add no new test to `NoAppTests`. Do not change
           `FakeApp.ANSWERS["initialize"]`: it is the app's answer, which the relay forwards unchanged.
           Change `StartingTests.test_a_tool_call_starts_the_app_and_replays_the_handshake`: the host sent
           `notifications/initialized`, so `_open` now writes the notice. After the call, its first `self.next_message()`
           is `{"jsonrpc": "2.0", "method": "notifications/tools/list_changed"}`, its second is the call's result
           (the assertion it has today), and then `self.output.empty()` holds. Its app-side assertions stay.
           Add, in a new class `ToolsChangedTests(RelayTestCase)`:
           `test_the_host_hears_the_tool_list_changed_when_the_app_goes_and_comes_back` — the host sends `initialize`
           and `notifications/initialized` with an app running; the app drops; the host's next message is
           `notifications/tools/list_changed`; the app starts again and the relay connects; the host's next message
           is `notifications/tools/list_changed` again. Steps: start the app, write the endpoint, `made.connect_if_running()`
           (no notice: the host has not initialized). Send `INITIALIZE`; read the app's `initialize` answer with
           `next_output()`; send `INITIALIZED`. Stop the app with `app.stop()`, then
           `wait_until(lambda: not made.connected)`, then read the drop's notice with `next_message()`.
           `FakeApp.stop()` leaves `s.sock` in place, so unlink `s.sock` (`self.dir / "s.sock"`), start a new
           `FakeApp` on the same path with `self.start_app()`, call `made.connect_if_running()`, and read the next
           message: the reconnect's notice. The replayed handshake's answer never reaches the host.
           `test_a_host_that_has_not_initialized_hears_no_tool_list_change` — no handshake; connect, then drop with
           `wait_until(lambda: not made.connected)`; then wait `0.2` s and `assertTrue(self.output.empty())`.
           The existing `AppGoneTests` cases send no `notifications/initialized`, so their expected messages do not
           change (re-verify by running them).

Docs:      `plugins/wigley/scripts/forms/README.md` § The relay:
           1. Bullet **No app.** says the relay answers the MCP handshake itself. Add one sentence: the handshake
              answer advertises `tools.listChanged`.
           2. Add one sentence to the opening paragraph (line ~401, "forwards every message, unchanged") or to the
              bullet **No app.**, whichever reads best: the relay sends its own `notifications/tools/list_changed` to
              a host that has initialized, when the app's channel drops and after it opens one, so the host refetches
              `tools/list` (the relay's own list while the app is away). Change "forwards every message, unchanged"
              in that paragraph to name this exception.
           3. In the `relay.py` module docstring (line 3), "forwards every MCP message, unchanged" gets the same
              exception, and the "holds no forms logic" sentence stays.
           Change no other line.

Version:   bump both manifests together, in this task's commit, to one value:
           1. Run `git -C <marketplace> fetch origin`. It failed on SSH authentication at plan time; if it fails again,
              go on against the last fetched `origin/main` and name that in the Proof section.
           2. Read origin's version: `git -C <marketplace> show origin/main:plugins/wigley/.claude-plugin/plugin.json`.
           3. If the local `version` in `plugins/wigley/.claude-plugin/plugin.json` equals origin's, set the next
              patch version of origin's (origin `1.14.0` gives `1.14.1`) in both
              `plugins/wigley/.claude-plugin/plugin.json` and `plugins/wigley/.codex-plugin/plugin.json`.
           4. If the local version is already higher than origin's, an unpushed commit already bumped it. Leave both
              manifests as they are: one bump per pushed series.
           The local version was `1.14.0` in both manifests at plan time, and local `main` matched the last fetched
           `origin/main` (re-verify).

Done when: from `<marketplace>`, every command of `<marketplace>/AGENTS.md` § Done passes, read from that file
           when the task runs. The ones this change touches:
           `(cd plugins/wigley/scripts/forms && python3 -m unittest discover)` ·
           `python3 scripts/check_manifests.py` · `python3 scripts/check_manifests.py --against origin/main` ·
           `python3 scripts/check_pointers.py` (the README is edited) · `claude plugin validate .`
Commit:    one commit on `main` of wigley-ai-marketplace (no branch: `<marketplace>/AGENTS.md` § Commit straight to
           main). Do not push: the push waits for the user's yes.

## Proof

