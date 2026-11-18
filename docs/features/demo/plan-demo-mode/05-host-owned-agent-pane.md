# 05 — Host-owned agent pane

Status: in progress
Type: Task
Rung: deep · changes how the core right bar ends a held stop's turn, across async scope changes and focus moves
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/src/plugins/scoped-agents/contract.ts`
- modify `wigley-ai-gui/src/plugins/scoped-agents/page/agent-pane.ts`
- test `wigley-ai-gui/src/plugins/scoped-agents/page/agent-pane.test.ts`
- modify `wigley-ai-gui/src/renderer/pane-targets.ts`
- test `wigley-ai-gui/src/renderer/pane-targets.test.ts`
- modify `wigley-ai-gui/src/renderer/shell/shell.ts`
- test `wigley-ai-gui/src/renderer/shell/shell.test.ts`
- modify `wigley-ai-gui/src/contracts/plugin.ts`

Consumes:
- `AgentPaneSpec` and `AgentPane` (`scoped-agents/contract.ts:71-100`), `OuterPanes`, `ResizeTarget` and `PaneDirection` (`src/contracts/panes.ts`), `RightBarStop` and `baseChanged` (`src/renderer/pane-targets.ts`), `stopFor` (`src/renderer/shell/shell.ts:410`), `RightBarOptions` (`src/contracts/plugin.ts:458`) — all in the tree now.
- `src/contracts/plugin.ts` as task 01 leaves it ← 01 (both modify the file; this task edits `RightBarOptions` after 01 lands)

Produces:
- `AgentPaneSpec.resizeTarget: ResizeTarget | null` and `AgentPaneSpec.entersFrom: PaneDirection | null` in `wigley-ai-gui/src/plugins/scoped-agents/contract.ts`
- `AgentPane.holdsKeys(): boolean` in `wigley-ai-gui/src/plugins/scoped-agents/contract.ts`
- `RightBarOptions.keepsTurn?(): boolean` in `wigley-ai-gui/src/contracts/plugin.ts`
- `RightBarStop.keepsTurn?(): boolean` in `wigley-ai-gui/src/renderer/pane-targets.ts`

## Decisions

- **Null means the host owns it.** With `entersFrom: null`, `outerPanes.focus.move` returns
  `false` at once for every direction, before it reads `OPPOSITE_DIRECTIONS` (that table has no
  `null` key). With `resizeTarget: null`, `outerPanes.resize` is a target whose `nudge` returns
  `false`, and `holdKeys` calls `setResizeTarget(null)`. Backlog (`backlog-view.ts:875-894`) and
  practice (`practice-view.ts:288-296`) pass non-null values and need no change.
- **Resize keys while a host-owned pane holds the keys.** `pane-targets.resize` asks the view's
  resize target (null), then the outer panes' (main's view's, if it set one), then the side bar.
  This is the same fallthrough as for every right-bar stop today (unity-pool, system-stats). It is
  accepted. The pane adds no divider, and no code calls `setResizeTarget` for the right bar.
- **A host-owned pane is always shown.** A host that passes `entersFrom: null` also passes
  `isAlwaysShown: true`. With `isAlwaysShown: false`, a second `toggle()` hides the pane
  (`hidesPane` in `toggle`, `agent-pane.ts:388`), so a host-owned pane must not use it.
  `createAgentPane` throws `Error('a host-owned agent pane must be always shown')` when
  `entersFrom === null` and `isAlwaysShown === false`.
- **A host-owned pane takes the keys at once.** Today `enter()` waits for the first answer
  (`takesKeysOnAnswer`) when nothing shows yet. When `entersFrom` is null, `enter()` calls
  `takeKeys(true)` at once and never sets `takesKeysOnAnswer`. Then, when `mount` and `askBox` are
  both null, it calls `readSession()`. The answer lands in `showAnswer`, which finds `hasKeys`
  true and `isChanged` true and calls `holdKeys(true)`, so the ask box or the chat view gets the
  focus. Before the answer, `takeKeys(true)` sets scope `ask` and focuses `body`.
- **`AgentPane.holdsKeys()`** returns `hasKeys`: true from `takeKeys` until `releaseKeys` or
  `dispose`. It is false after `dispose`.
- **The pane keeps the DOM focus inside itself when it swaps what it shows.** `showSession` and
  `scopeOpened` remove the focused ask box or chat view. When `hasKeys` is true and `body`
  contains `document.activeElement`, they call `body.focus()` before `dropMount()` and
  `destroyAskBox()`. So the DOM focus never drops to `document.body` while the pane holds the
  keys, and `listenToRightBarFocus` never runs `focusDroppedFromRightBar` for the swap. `send`'s
  success path calls `showSession` alone; it no longer calls `destroyAskBox()` first, because
  `showSession` already does.
- **Why the core changes.** `baseChanged` in `pane-targets.ts` ends the held right-bar stop's turn
  on every base scope change after `enterStop`. `stopFor`'s `left` (`shell.ts:410`) then blurs the
  focused element. The pane changes the base scope on its own: `setScope('ask')`, `mount.shown()`,
  and a mount's chat tab that arrives after `shown()` (`chat-view.ts:803`). So a pane inside a
  right-bar stop would lose the keys after each send and each answer.
- **The core change is opt-in.** `RightBarOptions` gains `keepsTurn?(): boolean`. `stopFor`
  copies it onto the stop as `RightBarStop.keepsTurn` when the option is present. `baseChanged`
  still forgets the focus and resize targets and clears `isAwaitingView`. It ends the held stop's
  turn only when `heldStop.keepsTurn?.() !== true`. A stop without `keepsTurn` (unity-pool at
  `unity-pool/page/start.ts:304`, system-stats at `system-stats/page/start.ts:251`) ends its turn
  on every base scope change, as today. The DOM focus is not read: the contribution answers.
  Update the comments above `RightBarStop`, `PaneTargets` (the `baseChanged` sentence) and
  `stopFor` to say so.
- **The `RightBarOptions` comment.** The comment above `RightBarOptions` (`plugin.ts:442-457`,
  measured at plan time, before 01's edits) changes "a base scope change the core did not make
  runs" to "a base scope change the core did not make runs while `keepsTurn` is absent or returns
  false", and gains one sentence: "`keepsTurn` lets a contribution keep its turn through base
  scope changes it makes itself, such as an agent pane inside it taking the keys."
- **Host recipe** (write it in the `AgentPaneSpec` comment; task 07 follows it). The host's
  right-bar contribution is the stop, and the pane sits inside the contribution's element:
  - `isAlwaysShown: true`, `entersFrom: null`, `resizeTarget: null`.
  - The contribution passes `keepsTurn: () => pane.holdsKeys()`.
  - The contribution's `left` calls `pane.hostTookKeys()` as well as its own work.
  - The host's command that moves the keys into the pane and back calls `pane.toggle()`.
  - `spec.leave` sets the host's own scope and focuses the host's element. This base change keeps
    the turn, because `leaveToHost` calls `spec.leave` before `releaseKeys`, so `holdsKeys()` is
    still true.
  - When the shown mode changes (`coreModeSlot`) while `pane.holdsKeys()` is true, the host blurs
    the focused element inside its contribution. `focusDroppedFromRightBar` then ends the turn and
    gives main the keys, as a base change ends any other stop's turn today.
- **A scope change while the pane holds the keys.** `scopeOpened(<new scope>)` keeps the keys in
  the pane: the pane focuses `body`, drops the old mount or ask box, reads the new scope, and
  `showAnswer` focuses what the answer shows. The text in the old ask box is lost, as today.
- **Risky forms in a scoped pane do not show** (read from code, not run). agent-commands'
  `confirmRun` (`agent-commands/main/tools.ts`) adds a round through `forms.confirm`, which shows
  as a popup through `sessions.addPopup`. Owner rows are left out of the sessions page state
  (`sessions/page/start.ts:806`), and `mountChat` draws only the chat view, so the popup waits in
  a frame no pane draws, and a `risky` `run_command` waits until its tool call aborts. Task 06
  declares no demo command `risky`.

GIVEN a pane with `entersFrom: null` and `resizeTarget: null`
WHEN the pane holds the keys or not, and the user presses any pane-move key or a resize key
THEN `focus.move` returns false for each of the four directions and `resize.nudge` returns false

GIVEN a host-owned pane before its first answer
WHEN the host calls `toggle()`
THEN the pane takes the keys at once, and when the answer lands the ask box gets the focus

GIVEN a host-owned pane that holds the keys in its ask box
WHEN the user sends and the ask resolves with a session
THEN `holdsKeys()` is still true, the chat view is mounted and shown, and the DOM focus never
sat on `document.body` between the ask box's removal and the mount

GIVEN a held right-bar stop whose `keepsTurn` returns true
WHEN the base scope changes
THEN the stop keeps its turn and its `left` is not called; with `keepsTurn` false or absent the
turn ends as today

## Tests

- `agent-pane.test.ts`:
  - `paneSetup` (`:71`) gains a `resizeTarget?: null` option, its `entersFrom` option takes
    `null`, and its `setResizeTarget` fake records `setResizeTarget null` for a null target and
    `setResizeTarget` for any other (update the existing expectations that read it).
  - Add rows to the outer-panes table (`:810`) for a `paneSetup` with `isAlwaysShown: true`,
    `entersFrom: null` and `resizeTarget: null`: each of the four directions, with the keys held
    and not held, returns false and records no call; `outerPanes.resize.nudge` returns false;
    after the pane takes the keys, `events` hold `setResizeTarget null`.
  - `toggle_HostOwnedBeforeFirstAnswer_TakesKeysAtOnce`: `scopeOpened('two-sum')`, `toggle()`
    before `answerSession`; `calls` holds `tookKeys` and `holdsKeys()` is true; after
    `answerSession(null)` the ask box's editor got the focus.
  - `send_HostOwnedHoldsKeys_KeepsKeysThroughTheMount`: the pane element is attached to
    `document.body`; the pane holds the keys in its ask box; a `focusout` listener on `document`
    records each event whose `relatedTarget` is null; `send()` and resolve the ask with `s1`.
    Expect `holdsKeys()` true, the mount's `shown` count 1, no `heldKeys(null)`, and no recorded
    `focusout` with a null `relatedTarget`.
  - `createAgentPane_HostOwnedNotAlwaysShown_Throws`.
- `pane-targets.test.ts`: `areaTargets` (`:315`) gains a `keepsTurn` option on its stops; one
  `it.each`: a base change with `keepsTurn` true keeps the area `right` and calls no `left`;
  with `keepsTurn` false, and with no `keepsTurn`, the turn ends and `left` runs once.
- `shell.test.ts`: beside the stop tests (`:644-736`): a contribution with
  `keepsTurn: () => answer` gives a stop whose `keepsTurn()` follows `answer`; a contribution
  without it gives a stop with no `keepsTurn`.

Done when: `npm run typecheck`, `npm run lint` and the tests above pass.

Commit: one commit for the group.

## Proof
