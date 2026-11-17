# 05 — Focus resolvers read the run's target

Status: not started
Type: Batch
Rung: hard · changes which session about 50 commands act on, across four plugins, with guards to bypass
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
- Every command that resolves the visible or focused session reads `context.targetSessionId` first, so an agent aims
  it without moving the user's view (round 1). A run with no target behaves exactly as today.
- **chat** — `sessionFor(tabs, context)` in `chat-commands.ts`: with a target it returns `tabs.session(target)` and
  skips the visible-tab read and the fired-in-another-box check. `inSession` logs `no chat session <target>` and does
  nothing when chat holds no such session, else `no Chat tab shown` as today. This one change covers every command
  `inSession`, `inRunningSession` and `pickControlOf` wrap.
- **sessions** — in `src/plugins/sessions/page/start.ts`, with a target:
  - `closeSession` passes the `mode.isShown()` guard and closes the target, its `atOnce` read from the target's tabs and
    popups as today.
  - `renameSession` and `projectKey` (`favoriteProject`, `moveProjectUp`, `moveProjectDown`) pass the guard and act on
    `rowOf(target)`; an unknown row logs `no session to rename` / `no session for projects` as today.
    `renameSession` with a target calls `mode.show()` before it opens the dialog, since the dialog waits on the user's
    typing.
  - `togglePopup` toggles the target's popup and does not call `mode.show()`.
  - `nextTab` and `prevTab` (`stepToTab`) skip `api.modes.stepTab` and `mode.show()`, and step the target's tabs.
- **workflow** and **workflow-large** — `runOnSelected` in each `page/start.ts` becomes a handler that reads the
  context: the target, else `sessions.active` as today.
- Pane commands (`splitDown`, `splitRight`, `closePane`, the swaps, the core's pane focus and resize), `nextSession`,
  `prevSession` and the side bar's list commands act on the user's layout, not on a session: they ignore a target
  (Decided at plan time).
- `chat.stopAll`, `newSession` and every command that already takes a `sessionId` in its argument are left as they are.

GIVEN session A's Chat tab is visible and session B is held WHEN `chat.focusBox` runs with `targetSessionId: 'B'` THEN B's box takes focus and A's does not
GIVEN no chat session `Z` WHEN `chat.send` runs with `targetSessionId: 'Z'` THEN it logs `no chat session Z` and sends nothing
GIVEN Sessions mode is hidden WHEN `sessions.closeSession` runs with `targetSessionId: 's2'` THEN main is asked to close `s2`
GIVEN Sessions mode is hidden and no target WHEN `sessions.closeSession` runs THEN it logs `close ignored: Sessions mode is hidden` as today
GIVEN `sessions.active` is `a` WHEN `workflow.toggleHeadless` runs with `targetSessionId: 'b'` THEN the stage action runs for `b`

Tests:
- `src/plugins/chat/page/chat-commands.test.ts`: one new `it.each` `a target picks the session over the visible tab`
  with rows `focusBox` (B's box focused), `send` (B's box text sent for B), `interrupt` (B interrupted), and the
  unknown-target row (logs `no chat session Z`, nothing sent). Search the file for the visible-tab helpers
  (`setUp`, `session`) and build B beside A with them.
- `src/plugins/sessions/page/start.test.ts`: beside the `closeSession` tests, one `it.each` `a target passes the hidden
  mode's guard` with rows `closeSession` (main asked to close `s2`), `renameSession` (the dialog opens for `s2`'s row),
  and the no-target row (the hidden-mode log line).
- `src/plugins/workflow/page/start.test.ts`: one `it` `a target runs the stage action for that session over the
  selected one`.
- `src/plugins/workflow-large-page.test.ts`: one row in the test that asserts `invoked` for `clearAndMake`, with a
  target `b` while `a` is selected, expecting `{ sessionId: 'b', command: 'clearAndMake' }`.

Done when: `npm run typecheck` passes; the test gate runs the tests above. A targeted page command run from main is
checked live by 10 (Final verification).
Commit:    one commit for the group
