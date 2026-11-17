# 12 — Final verification

Status: not started
Type: Task
Wave: 6 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
Plan: [plan.md](plan.md)

Files:     none (live checks; captures go to `.selftest/` and `.drive/`, both git-ignored)
Consumes:  the landed run: 01–11
Produces:  the proof below
Decisions:
- Risk tier High: the run adds a shared contract (`addHookHandler` on sessions' relay server, the hook hello) and a
  new route (hook.py → relay channel → chatroom). So every check below runs (`wigley:writing-tests` § What earns a
  live run instead). Each check is tagged **expected** (the change doing what it was made for) or
  **low-confidence** (where a bug is likely), with its reason.
- `wigley:make` walks this list once, in its live session, after its test gate. Every command runs from
  `/Users/jonathonwigley/Documents/.worktrees/ai-chatroom/wigley-ai-gui` unless the check names another folder.
  Shell: zsh with BSD tools. Use absolute paths, and quote globs.
- The real-Claude round trip runs in a drive run started with `--harness claude`, not in the user's dev app. The
  drive run is the dev build, offscreen, on its own temp home and endpoint. The agent can drive its keys and read
  its log, and its rooms never reach the user's data. It spends tokens on the user's Claude login (drive skill
  § Real Claude). Name that in the report.

Checks:

1. **expected** — `npm run selftest -- --plugin chatroom` passes. Read the screenshots `chatroom-mode`,
   `chatroom-thread` and `chatroom-reply` in `.selftest/screenshots/` against `DESIGN.md` (§ Keys and focus: one
   focus ring, hints in place; § Surfaces for the side bar and sheet).
2. **low-confidence** — `npm run selftest -- --plugin sessions` passes. Reason: 02 added the hook route to the
   relay server that every relay connection goes through. The connect and join paths have no chatroom test over
   them.
3. **expected** — a drive run on the fake harness (`.agents/skills/drive/SKILL.md` § Loop):
   `npm run drive -- start`, then the `chatroom.seed` action, then `key Space k c`. Screenshots: the mode with
   `plan-demo` open, the board, and the log. Then `key Space k s` and a screenshot of the Sessions side bar that
   shows the `@1` and `2 new` badges and the peer row's raised `asks you` activity. Then `key Space z l r`: the
   preview shows every post kind and entry kind. Check token values with `query` where `DESIGN.md` gives a number.
4. **low-confidence** — in the same drive run, `fit` at the minimum width with Chatroom mode shown, then open the
   side bar over the content and pick a thread. Reason: the overlay side bar and `picked()` are wiring that no test
   sees, and the board and log stack is a new layout.
5. **low-confidence** — in the same drive run, type a reply in the composer to the seeded question and send it.
   The log shows it from `you`. The peer row's activity clears. A page reload (`restart` or a page reload through
   the drive commands) brings back the same room and thread from `chatroom.place`. Reason: the place restore and
   the slot-driven redraw after a post have no test.
6. **low-confidence** — the real-Claude round trip. Reason: it crosses the relay, the hook script, the sessions
   hook route, the room service, delivery and chat's `send`, and only the live system joins them.
   Setup:
   - `npm run drive -- start --harness claude`. Note the run home and the endpoint folder that the run gives its
     Claude sessions (`<run home>/.agents/<instance id>`, AGENTS.md § Running and testing).
   - Session A is app-run: the `chat.start` drive action in `<run home>/dev/drive-project`. Its first message asks
     it to claim `notes/**` with reason `live check` and to post a `heads-up` to thread `live-check`, then stop.
     A loads the user's installed wigley plugin, which has no hooks, so A gets the tools (they come from the app
     through the relay) but not the hook.
   - Session B is a terminal session in the same folder:
     `WIGLEY_AI_GUI_ENDPOINT_DIR=<endpoint folder> claude -p --output-format stream-json --verbose --plugin-dir /Users/jonathonwigley/Documents/.worktrees/ai-chatroom/wigley-ai-marketplace/plugins/wigley "<prompt>"`.
     `--plugin-dir` loads the worktree's wigley plugin with its hooks (`claude --help` lists the flag).
     **Low-confidence**: the user's installed wigley plugin has the same name. If Claude refuses the second copy,
     or runs the installed copy's relay and no hooks, stop this check and report it. The lead then asks the user
     how to load the worktree plugin. Installing it into the user's profile changes the user's state.
   Steps, each read from B's stream-json output and the drive run's log or a Chatroom mode screenshot:
   a. **post and board** — A's claim and heads-up show in Chatroom mode. B's prompt calls `chatroom_board`, and
      the result lists A with its claim on `notes/**`.
   b. **edit warning** — B's prompt then writes `notes/a.md`. The pre-tool hook's added context names A and its
      claim, and the edit still goes through.
   c. **nudge line** — B runs a turn of several tool calls (for example, read five files one at a time). During it,
      post a `question` to B from the composer in the drive run. A later PostToolUse result in B's output holds
      the exact nudge line that `main/delivery.ts` writes.
   d. **idle wake** — with A idle, B posts a `question` to A by A's session title. A receives chat's `send`
      message that names B and the kind. A's next turn calls `chatroom_read` and answers.
   e. **the user's word** — a composer post addressed to A reaches A through chat's `send`, and the stored
      message has `userWord: true`.
   Quit the drive run when done. Stop session B if it still runs.
7. **expected** — the marketplace Done checks (`wigley-ai-marketplace/AGENTS.md` § Done), from
   `/Users/jonathonwigley/Documents/.worktrees/ai-chatroom/wigley-ai-marketplace`:
   - `python3 scripts/check_manifests.py`
   - `python3 scripts/check_manifests.py --against origin/main`
   - `python3 scripts/check_pointers.py`
   - `claude plugin validate .` (it checks the new `hooks/hooks.json`)
   - `(cd plugins/wigley/scripts/forms && python3 -m unittest discover)` (03 changed `relay.py` and added
     `endpoint.py`)
   - the unittest line for `scripts/chatroom/` that 07 added to § Done, when 07 added one. If 07 added tests but
     no Done line, run `(cd plugins/wigley/scripts/chatroom && python3 -m unittest discover)` and report the
     missing line as a concern.

Dropped (a test already pins each one):
- the badge text and the `asks you` activity rule — `chatroom-state.test.ts` `badgeText` and `rowActivities` (09)
- the side bar order — `chatroom-state.test.ts` `threadList` (09)
- what a reply and a note post carry — `chatroom-state.test.ts` `userPostFor` (09)
- the guards, ids, cursors and claims — 05's and 01's tests
- the board's attribution — 06's tests

Checks only the user can do: none. No check here needs a real keyboard, a dead key, a native dialog or a
global shortcut. A real Telegram or Discord mirror is out of scope, so it is not a check.

Done when: every check above passes, or fails with a fix landed and the check run again. Each low-confidence
           result is in the report with its capture paths.

## Proof
