# 06 — Wire the dock into the composer and the Chat tab

Status: not started
Type: Task
Wave: 4 · Depends on: 03, 04, 05 (05 makes the flag comment's hiding sentence true)
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/composer-kit.ts` · modify `src/plugins/chat/page/chat-view.ts` ·
           modify `src/plugins/chat/layouts/layout.d.ts` (comments only) ·
           modify `src/plugins/chat/layouts/default/layout.js` (comments only) ·
           test `src/plugins/chat/page/composer-kit.test.ts`
Consumes:  `createActivityDock(deps: ActivityDockDeps): ActivityDock` ← 04 · the `div.chat-working-slot` element
           and `ComposerKit.working` ← 03 · `chatPartDraws(layouts, 'working', log)` and `surfaceBaseKit` in
           `chat-layouts.ts` (exist) · `isWorking(state)` in `chat-state.ts` (exists)
Produces:  `clock: Clock` and `timers: Timers` in `ComposerSurfaceDeps` in `src/plugins/chat/page/composer-kit.ts`
           `setTurn(entries: readonly ChatEntry[], working: boolean): void` in `ComposerSurface` in
           `src/plugins/chat/page/composer-kit.ts`
Decisions: the composer surface holds the dock module (decision 4) · the dock is display only, so it joins no
           stop (decision 1; plan.md § Goal) · the composer redraw follows the dock's height through the existing
           `followComposerHeight` (out of scope note in plan.md) · a failed default draw hides the dock; a composer
           redraw draws fresh (D10) · user layouts take the contract change, no shim (D9) · the dock's contract prose
           lands here (D12)

## What changes

`composer-kit.ts`:

- `createComposerSurface` creates one `ActivityDock` with `deps.clock`, `deps.timers` and a `changed` that draws
  the dock's input into the working slot.
- Drawing an input, in the shape the entry list's `drawSlotPart` and `updatePartSlot` use (plan.md D10):
  - null: dispose the drawn `working` part, empty the slot, set `hidden = true`.
  - an input while nothing is drawn: `hidden = false`, draw the `working` part into the slot through
    `chatPartDraws(deps.layouts, 'working', deps.log)` with `surfaceBaseKit(deps, 'chat', rollback)` as its kit.
    The draw sits in a `try`: `chatPartDraws(...).draw` throws when the default part itself fails. On a throw, log
    `chat` / `default layout working failed: <error>`, hold no drawn part, empty the slot and set `hidden = true`.
    Append no raw line. The throw never leaves `changed`, so `dock.set`, the chat-view handlers and the tick's
    timer callback never see it.
  - an input while a part is drawn: run the part's update (`workingDraws.update`); when it returns `none` or
    `threw`, dispose, empty the slot and draw again (the same guarded draw).
- `drawComposer`, after it places the slots, disposes the drawn working part, empties the slot and draws fresh from
  `dock.input()` (hidden when null), as it calls `drawAttachments(images)`. It never runs an update there: the
  layout may have changed.
- `setTurn(entries, working)` calls `dock.set(entries, working)`.
- `dispose` disposes the dock and the drawn working part.
- The `ComposerSurface` and `ComposerSurfaceDeps` comments name the working slot and the dock's clock and timers.

`chat-view.ts`:

- `createTab` passes `clock: deps.clock` and `timers: deps.timers` to `createComposerSurface`. The only callers of
  `createComposerSurface` at plan time are `chat-view.ts` and `composer-kit.test.ts`, both in this task, so the new
  required deps keep `npm run typecheck` green inside this wave.
- A helper `drawTurn(tab)` calls `tab.composer.setTurn(tab.state.entries, isWorking(tab.state))`. Call it after
  each change of the tab's entries or working flag: `putEntry`, the `entries` channel handler, and each place that
  calls `tab.entries.setWorking` today (`activity`, `sessionRunning`, `sessionRested`, and `createTab` after its
  first `drawComposer`). In the `activity` handler, call it right after `setWorking` and before the
  `[chat] <tab> is <activity>` log line, so the self-test's idle line (task 07) is logged after the dock changed.
- Comments: `ChatViewDeps` ("`timers` and `clock` tick a live activity line's time and the working block's") names
  the activity dock; the `createTab` comment lists the dock among the composer's contents.

`layout.d.ts` and `layout.js` comments (plan.md D12; they are true once this task's dock draws):

- `ChatLayout`'s `working` part comment: the activity dock, drawn into the composer's working slot
  (`ComposerKit.working`); the input is a `LiveWorkingInput` while the turn runs and a `DoneWorkingInput` while the
  session is idle after a finished turn, until the user sends the next message; a user `working` part receives
  both and branches on `input.state` (D9); the app sends the input again on each change and once a second with a
  new `now` while the turn is live; the slot hides while there is nothing to show; it is not a cursor stop.
- `LiveWorkingInput` head: "The running turn, drawn in the composer's activity dock. Times are epoch ms."
  `DoneWorkingInput` head adds: "the dock shows it while the session is idle, until the user sends the next
  message."
- `steps` on both: "the turn's steps in entry order, each the step's entry input, leaving out subagents' tool calls
  (a tool whose `agentId` is not `main`); the layout picks the ones it shows."
- `LiveWorkingInput.startedAt` replaces today's held-block wording: "When the turn began: its first entry, the later
  of the user's last message and the first entry after the last result. While the turn holds no entries, the dock
  keeps the start it shows; a dock that was hidden or done starts at `now`." `LiveWorkingInput.now`: "The time of
  this draw or update; the turn's time is `now - startedAt`."
- `activityInTranscript` comment, before the pick sentence task 02 wrote: "Whether the entry list draws the agent's
  steps (activity lines and their step rows) and the `result` entries; `false` leaves them out of the list and the
  entry cursor. A user layout that wants the activity lines sets it `true` (D9)."
- `layout.js`: the file's head comment, the `working` comment and the `WORKING_ACTION_LINES` comment name the
  activity dock in place of the working block.

GIVEN a surface over the default layout WHEN `setTurn` runs with a user entry and a running main tool, working
THEN the working slot is shown and holds `div.chat-working` with the tool's action line
GIVEN that surface WHEN `setTurn` runs with the same entries plus a `result`, idle THEN the slot holds
`div.chat-working.is-done`
GIVEN that surface WHEN `setTurn` runs idle with no result after the last user entry THEN the slot is hidden and
empty
GIVEN a user layout whose `working` update throws WHEN `setTurn` runs live with one main tool, then again with a
second main tool (so the dock's input changes and the part's update runs) THEN the slot is drawn again with
`default`
GIVEN a live dock drawn with `default` WHEN the layouts change to a user layout with its own `working` part and
`drawComposer` runs THEN the slot's root carries the user layout's `data-layout` and the slot holds one child
GIVEN a default `working` draw that throws WHEN `setTurn` runs live THEN the slot is empty and hidden and the log
holds `default layout working failed: <error>`
GIVEN a live dock WHEN the surface is disposed THEN the drawn part is disposed and the dock's timer is cleared

Tests:     `composer-kit.test.ts` `surfaceDeps` gains a fake clock and fake timers built in the file · add
           `working_SetTurn_LiveThenDoneThenHidden` (one test over the first three GIVENs: the slot's `hidden`, its
           root class list and the first action line or the done line at each step) · add
           `working_UserUpdateThrows_RedrawsWithDefault` (the fourth GIVEN: two `setTurn` calls; after the second
           the slot's root carries `data-layout="default"` and the log holds
           `layout <user> working update failed: <error>`) · add `working_LayoutChange_RedrawsFreshWithTheNewLayout`
           (the fifth GIVEN: `data-layout` is the user's, and the slot has one child) · add
           `working_DefaultDrawThrows_HidesTheSlotAndLogs` (the sixth GIVEN, with a `default` layout whose `working`
           throws) · add `working_Dispose_DisposesThePartAndClearsTheTick` (the last GIVEN: the part's dispose ran
           and the fake timers hold no armed timer) ·
           `composer_UpdateThrows_DrawsWithDefaultUntilTheLayoutsChange` is written for the composer part alone and
           stays as it is · the tick, the held rule and the finished-line data stay pinned in
           `activity-dock.test.ts` (04), not here · the `drawTurn` call sites in `chat-view.ts` have no unit test
           (the repo has no `chat-view.test.ts`): task 09's self-test checks 1, 2 and 4 are their accepted proof
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

