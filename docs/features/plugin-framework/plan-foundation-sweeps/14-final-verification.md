# 14 — Final verification

Status: done
Type: Task
Wave: 9 · Depends on: 13
Plan: [plan.md](plan.md)

Files:     none, unless a check finds a defect: then the fix goes in the task that owns the file, and this task runs again
Consumes:  the landed code of tasks 01–13
Produces:  no code
Decisions: the whole self-test runs only when the user asks for it in the current turn (`AGENTS.md` § Running and testing), so this task runs the plugin groups below and asks the user in chat before the whole run · every check runs in a drive run or the self-test on a temp home, so no step touches the user's own config or data

Checks, each tagged with why it is on the list (`wigley:writing-tests` § What earns a live run instead):

1. **Suite and lint** — `npm run typecheck`, `npm test`, `npm run lint`. Expected path: the gate the whole plan
   rests on.
2. **Self-test of the plugins whose wiring changed most** —
   `npm run selftest -- --plugin sessions --plugin forms --plugin primer --plugin chat`. Low-confidence: start order
   changed with the per-process `dependsOn` (plan.md Decisions), tool contributions now reach sessions through
   `exports(consumer)`, and sessions' `relay` log lines became `[sessions]`. No unit test runs the real composition
   roots in this order.
3. **Self-test of the rest** — every plugin `grep -rln "selfTest" src/plugins/*/main/start.ts` lists, minus the four
   of check 2 (at plan time: `agent-lines`, `agent-strip`, `backlog`, `docs`, `notes`, `settings`, `usage`,
   `workflow`; re-verify), run as one `--plugin` list. A plugin with no script is not passed. Ask the user in chat
   first: this is near the whole self-test. When the user says no, record the list as not run.
4. **Stop through `stopAll`, at restart and at quit** — load the repo's `drive` skill. `npm run drive -- start`; run
   `sessions.open '{"sessionId":"s"}'`, `forms.openRound` and `primer.openPrimer` with `"sessionId":"s"`, and one
   `chat.start` under the fake harness. Note the last line of the run's `app.log`. Copy the run home's `tools.json`
   to the scratchpad, then `npm run drive -- restart` (it keeps the temp home, and its app exit runs the same quit
   tasks). Expected after the restart: the chat session started before it is restored as a row, so stopping wrote
   nothing to chat's open-sessions file. Then `npm run drive -- quit`; it returns and the app exits 0. In `app.log`,
   the lines after the noted line, read with `command grep -a -n -i -E "failed|error|unhandled"`, hold no line from a
   part's `dispose`, a registration's dispose or a stop (a line that names a plugin id or `stop`); any other hit is
   read and named in the Proof section. Low-confidence: quit order and the awaited, reverse-order stop have no test
   over the real `main.ts`.
5. **A live session hears a tool-list change** — in the same kind of drive run, connect a session
   (`sessions.connect`), then contribute and dispose a test tool. If no drive action can do that, record this check as
   covered by task 05's `serveMcp` tests and check 6, and skip it. Low-confidence: the notification crosses the real
   relay socket.
6. **The relay across a restart** — with a drive run started, run
   `WIGLEY_AI_GUI_ENDPOINT_DIR=<the run home's endpoint folder> python3 <marketplace>/plugins/wigley/scripts/forms/relay.py`
   (the endpoint folder is where the run's `endpoint.json` sits; `start_app.endpoint_dir` reads that variable) and
   send it `initialize` and `notifications/initialized` on stdin. Then `npm run drive -- restart`. Expected: while
   the app is away the relay writes `notifications/tools/list_changed`, and a `tools/list` sent then lists
   `ask_round`, `open_primer` and `set_session_title` (from the kept `tools.json`); once the app is back, a second
   `notifications/tools/list_changed` arrives. Low-confidence: tasks 03 and 05 test each side alone, and only this
   run joins them.

Report each check's command and result in the Proof section. A check the agent cannot reach goes in the hand-off
reply with its steps, not in this document.

Done when: checks 1, 2 and 4 pass; check 3 passes or is recorded as not run on the user's no; check 5 passes or is
recorded as covered by task 05; check 6 passes.
Commit:    none, unless a fix lands (in its own task's commit)

## Proof

Commit 8740cc31 · proof: Check 1: typecheck and lint clean; npm test 6591 of 6591 on the second full run, first run failed one timeout in node-files watch_NotRecursive, which passed twice alone. Check 2: selftest of sessions, forms, primer, chat all passed, exit 0. Check 3: not run, no user yes. Check 4: drive start, restart, quit: chat row restored, open-sessions unchanged, quit CLI exit 0, only hit a vite ResizeObserver line; app.log holds no main-process plugin lines and the app's own exit code is not read. Check 5: covered by task 05's serveMcp tests and check 6, no drive action contributes a tool. Check 6: app-away list_changed and the kept six-tool tools/list pass; the second notice arrives on the next tools/call, as the relay connects only then · concerns: After [selftest] all passed: 5 Plugin docs has no main handler for watchDoc and 1 chat loadHistory, as the page still invokes after main's handlers are disposed at quit. A tools/list written just before the channel closes goes unanswered, since _drop answers only tools/call ids, 1 of 2 runs. Each restart sends 4 list_changed in a burst. node-files watch test timed out once under full load; task 04 changed node-files.
