# 05 — Target-capable commands read the run's target

Status: in progress
Type: Batch
Rung: hard · changes which session the target-capable commands act on, across four plugins, with a guard to bypass
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- modify `src/plugins/chat/page/chat-commands.ts`
- modify `src/plugins/sessions/page/start.ts`
- modify `src/plugins/workflow/page/start.ts`
- modify `src/plugins/workflow-large/page/start.ts`
- test `src/plugins/chat/page/chat-commands.test.ts`
- test `src/plugins/sessions/page/start.test.ts`
- test `src/plugins/workflow/page/start.test.ts`
- test `src/plugins/workflow-large-page.test.ts`

Consumes:  `PageCommandContext.targetSessionId` ← 01
Produces:  no new export; the behaviour below

Decisions:
- **Which commands read the target.** Only commands declared `targets: true` read `targetSessionId` (lead ruling 1).
  The flags are set in 04 and 06. `runFor` refuses a target for any other command (01). So a handler below that reads
  the target is reached with one only for a flagged command.
- A run with no target behaves exactly as today.
- **chat** — `sessionFor(tabs, context)` in `chat-commands.ts`:
  - With a target it returns `tabs.session(target)`, and skips the visible-tab read and the fired-in-another-box check.
  - `inSession` logs `no chat session <target>` and does nothing when chat holds no such session. With no target it
    logs `no Chat tab shown` as today.
  - `inRunningSession` with a resting target logs `<name> has no running process` as today.
  - The flagged chat commands are `send`, `sendNow`, `interrupt` and `allowOrCopy`. They reach the target through this
    one change.
  - A targeted `allowOrCopy` keeps its range branch: with a range open in the target, it copies. "Ran" does not prove
    the effect, and the agent reads state to check it (lead ruling 8).
- **sessions** — in `src/plugins/sessions/page/start.ts`, with a target:
  - `closeSession` passes the `mode.isShown()` guard and closes the target. Its `atOnce` is read from the target's tabs
    and popups, as today.
  - `renameSession` passes the guard, calls `mode.show()`, then opens the dialog for `rowOf(target)`, since the dialog
    waits on the user's typing. An unknown row logs `no session to rename`, as today.
- **workflow** and **workflow-large** — `runOnSelected` in each `page/start.ts` becomes a handler that reads the
  context: the target, else `sessions.active` as today.
  - The stage action still runs through `keyRunner`, so a failure inside the stage action stays log-only. The command's
    handler finishes, and `run_command` answers `Ran` (lead ruling 8; design.md § Errors says so).
- **Commands that ignore a target.** Every other command is unflagged, and `run_command` refuses a `session` for it.
  Run without `session`, it acts as a key does, on the user's focused or visible session or on the cursor:
  - chat: the box, picker, control, attachment and entry commands
  - sessions: `togglePopup`, `nextTab`, `prevTab`, `favoriteProject`, `moveProjectUp`, `moveProjectDown`, the pane
    commands and the list commands
  - `session-stash.stash`, `notes.open`
  - `forms.*`, `primer.*`, `audio-picker.*`, `unity-pool.*`, `usage.*`, `agent-strip.*`, and the chat hub and
    start-prompt commands
- **Comments.** Update every comment this change makes untrue:
  - the `chatCommandHandlers` header ("acts only on the session whose Chat tab is the visible tab")
  - `sessionFor` ("The visible Chat tab's session")
  - `closeSession` ("never on a row the user cannot see")
  - `renameSession` ("Acts on the focused pane's session")
  - Large's "Each command runs `workflow.stageAction` on the selected session"

GIVEN session A's Chat tab is visible and session B is held WHEN `chat.send` runs with `targetSessionId: 'B'` THEN B's box text is sent for B, and A's is not
GIVEN the run's `editor` is A's box and the target is B WHEN `chat.interrupt` runs THEN B is interrupted (the fired-in-another-box check is skipped)
GIVEN no chat session `Z` WHEN `chat.send` runs with `targetSessionId: 'Z'` THEN it logs `no chat session Z` and sends nothing
GIVEN Sessions mode is hidden WHEN `sessions.closeSession` runs with `targetSessionId: 's2'` THEN main is asked to close `s2`
GIVEN Sessions mode is hidden WHEN `sessions.renameSession` runs with `targetSessionId: 's2'` THEN the mode shows and the dialog opens for `s2`'s row
GIVEN Sessions mode is hidden and no target WHEN `sessions.closeSession` runs THEN it logs `close ignored: Sessions mode is hidden` as today
GIVEN `sessions.active` is `a` WHEN `workflow.toggleHeadless` runs with `targetSessionId: 'b'` THEN the stage action runs for `b`

Tests:
- `src/plugins/chat/page/chat-commands.test.ts`: one new `it.each` `a target picks the session over the visible tab`.
  - Rows:
    - `send`: B's box text sent for B
    - `sendNow`: the same
    - `interrupt`: B interrupted
    - `interrupt` with `editor` set to A's box: B interrupted
    - `allowOrCopy`: B's pending permission allowed
    - the unknown target: logs `no chat session Z`, nothing sent
    - `interrupt` on a resting B: logs `<name> has no running process`
  - Build B beside A with the file's `setUp` and `session` helpers.
- `src/plugins/sessions/page/start.test.ts`: beside the `closeSession` tests, one `it.each` `a target passes the hidden
  mode's guard`.
  - Rows:
    - `closeSession`: main asked to close `s2`
    - `renameSession`: the mode shown and the dialog opened for `s2`'s row
    - `renameSession` with an unknown target: logs `no session to rename`
    - no target: the hidden-mode log line
- `src/plugins/workflow/page/start.test.ts`: in `engineKeys_RunStageActionOnTheSelectedSession %s`, add a target
  column. With target `s2` while `s1` is selected, `mainAction` and `toggleHeadless` run for `s2`.
- `src/plugins/workflow-large-page.test.ts`: extend `commands_WithASelectedSession_RunThroughTheEngine %s` with a target
  row. With target `b` while `selected('a')`, it expects `stageActions()` to equal `[{ sessionId: 'b', action:
  'clearAndMake' }]`.

Done when: `npm run typecheck` passes; the test gate runs the tests above. A targeted page command run from main is
checked live by 10 (Final verification).
Commit:    one commit for the group
