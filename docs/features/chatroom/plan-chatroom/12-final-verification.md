# 12 — Final verification

Status: not started
Type: Task
Rung: standard · runs the listed live checks and reports; it edits no file
Wave: 7 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11
Plan: [plan.md](plan.md)

Files:     none (live checks; captures go to `.selftest/` and `.drive/`, both git-ignored)
Consumes:  the landed run: 01–11. This task runs after 11's doc commit, so check 7 sees the final marketplace files.
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
   `npm run drive -- start`, then the `chatroom.seed` action. Order matters, because opening a thread marks it read
   and clears its badges:
   a. First take a screenshot of the Sessions side bar. It shows the `@1` badge on the peer row, the `2 new` badge
      on the lead row and the peer row's raised `asks you` activity.
   b. Then `key Space k c`. The mode shows no thread open, and the side bar cursor is on the first row. The side bar
      order is `session:<lead>`, `plan-demo`, `session:<peer>`. Press `j`, check with `query` that the cursor is on
      `plan-demo`, then press `Enter`. Take screenshots of the mode with `plan-demo` open, of the board, and of
      the log.
   c. Then `key Space z l r`: the preview shows every post kind and entry kind.
   Check token values with `query` where `DESIGN.md` gives a number.
4. **low-confidence** — in the same drive run, `fit` at the minimum width with Chatroom mode shown, then open the
   side bar over the content and pick a thread. Reason: the overlay side bar and `picked()` are wiring that no test
   sees, and the board and log stack is a new layout.
5. **low-confidence** — in the same drive run, type a reply in the composer to the seeded question and send it.
   Keys: `<A-l>` to the log, `k` to the question, `r`, the text, `Enter`. The log shows it from `you`. The peer
   row's activity clears. Reason: the slot-driven redraw after a post has no test. This check does not reload the
   page: the drive CLI has no page reload, and `restart` restarts the app, which clears slots. The `chatroom.place`
   restore is proved by 09's `start.test.ts` place round trip.
6. **low-confidence** — the real-Claude round trip. Reason: it crosses the relay, the hook script, the sessions
   hook route, the room service, delivery and chat's `send`, and only the live system joins them.
   Setup:
   - `npm run drive -- start --harness claude`. Note the run home and the endpoint folder that the run gives its
     Claude sessions (`<run home>/.agents/<instance id>`, AGENTS.md § Running and testing).
   - Session A is app-run: the `chat.start` drive action in `<run home>/dev/drive-project`. The action takes no
     message. Send A's first message from its composer, which opens in vim NORMAL mode: `key i`, `type <message>`,
     `key Escape`, `key Enter`. The message asks A to claim `notes/**` with reason `live check` and to post a
     `heads-up` to thread `live-check`, then stop.
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
   b. **edit warning, and the `additionalContext` probe** — B's prompt then writes `notes/a.md`, and tells B to
      quote any line that starts with `Chatroom:` that it received before the edit ran. The pre-tool hook's added
      context names A and its claim, and the edit still goes through. This is the live probe that a PreToolUse
      hook's `additionalContext` reaches the agent: read it from B's quote and from the stream-json output. If the
      warning does not reach B at PreToolUse, check whether it arrives with the same edit's PostToolUse result, and
      record that outcome. Task 07 states that fallback.
   c. **nudge line** — B is a terminal session with a board row. B runs a turn of several tool calls (for
      example, read five files one at a time). During it, post a `note` from the composer in the drive run, in the
      thread `session:<B's session id>` (the thread exists after B's first hook or `chatroom_*` call, when 08 writes B's `joined` entry; check 6b's edit is that call). The
      note's `to` is B's board name, so it is an addressed message for B. A later PostToolUse result in B's output
      holds the exact nudge line that `main/delivery.ts` writes.
   d. **idle wake** — with A idle, B posts a `question` to A by A's session title. A receives chat's `send`
      message that names B and the kind. A's next turn calls `chatroom_read` and answers.
   e. **the user's word** — a composer note in A's `session:<A row id>` thread reaches A through chat's `send`,
      and the stored message has `userWord: true`. Read the stored message from the run's plugin data, in
      `<run folder>/home/` under `plugins/chatroom/rooms/<roomFileName(room)>.jsonl` (01 names the file; find it
      with `find <run folder>/home -path '*chatroom/rooms*' -name '*.jsonl'`). Or read it from A with
      `chatroom_read` on that thread.
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
