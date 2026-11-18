# 05 — Host-owned agent pane

Status: not started
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
- `src/contracts/plugin.ts` as task 01 leaves it ← 01 (both modify the file; this task edits one comment after 01 lands)

Produces:
- `AgentPaneSpec.resizeTarget: ResizeTarget | null` and `AgentPaneSpec.entersFrom: PaneDirection | null` in `wigley-ai-gui/src/plugins/scoped-agents/contract.ts`
- `RightBarStop.holdsFocus(): boolean` in `wigley-ai-gui/src/renderer/pane-targets.ts`

## Decisions

- **Null means the host owns it.** With `entersFrom: null`, `outerPanes.focus.move` returns
  `false` for every direction. With `resizeTarget: null`, `outerPanes.resize` is a target whose
  `nudge` returns `false`, and `holdKeys` calls `setResizeTarget(null)`. Backlog
  (`backlog-view.ts:875-894`) and practice (`practice-view.ts:305-312`) pass non-null values and
  need no change.
- **A host-owned pane takes the keys at once.** Today `enter()` waits for the first answer
  (`takesKeysOnAnswer`). When `entersFrom` is null, `enter()` takes the keys at once, before the
  first answer, so the right-bar panel can hand the keys over on its first focus.
- **Why the core changes.** `baseChanged` in `pane-targets.ts` ends the held right-bar stop's turn
  on every base scope change after `enterStop`; `stopFor`'s `left` (`shell.ts:410`) then blurs
  the focused element. The pane changes scope on its own (`ask` → mount after a send, an answer
  landing), so a pane in the right bar would lose the keys after each send.
- **The core change.** `RightBarStop` gains `holdsFocus(): boolean`. `stopFor` builds it as
  `element.contains(document.activeElement)`. `baseChanged` still forgets the focus and resize
  targets, but ends the held stop's turn only when `heldStop.holdsFocus()` is false. Update the
  comments above `baseChanged` and `stopFor` to say so.
- **The `RightBarOptions` comment.** The comment above `RightBarOptions` (`plugin.ts:442-457`,
  measured at plan time, before 01's edits) gains one clause: "a scope change while focus sits
  inside the contribution keeps its turn". This task runs after 01, which also edits
  `contracts/plugin.ts`.
- **Host recipe** (write it in the `AgentPaneSpec` comment, for task 07): the right-bar
  contribution's `focus` calls `pane.hostTookKeys()` then `pane.toggle()`; its `left` calls
  `pane.hostTookKeys()`; `spec.leave` blurs the focused element inside the contribution, so the
  core's `focusDroppedFromRightBar` gives main the keys.
- **A step change while the pane holds the keys.** `scopeOpened` removes the focused element;
  focus drops and the keys go back to main. This is accepted: the user presses the panel key
  again.
- **Risky forms in a scoped pane do not show** (read from code, not run). agent-commands'
  `confirmRun` (`agent-commands/main/tools.ts`) adds a round through `forms.confirm`, which shows
  as a popup through `sessions.addPopup`. Owner rows are left out of the sessions page state
  (`sessions/page/start.ts:806`), and `mountChat` draws only the chat view, so the popup waits in
  a frame no pane draws, and a `risky` `run_command` waits until its tool call aborts. Task 06
  declares no demo command `risky`.

GIVEN a pane with `entersFrom: null` and `resizeTarget: null`
WHEN the pane holds the keys and the user presses a pane-move or resize key
THEN `focus.move` returns false and `resize.nudge` returns false

GIVEN a host-owned pane before its first answer
WHEN the host calls `toggle()`
THEN the pane takes the keys at once

GIVEN a held right-bar stop whose element holds the focus
WHEN the base scope changes
THEN the stop keeps its turn; and with focus outside the element the turn ends as today

## Tests

- `agent-pane.test.ts`: add rows to the outer-panes table (`:810`) for a `paneSetup` (`:60`)
  with `entersFrom: null` and `resizeTarget: null`: every direction moves nothing; `nudge`
  returns false; `setResizeTarget` gets `null`. One test: a host-owned toggle takes the keys
  before the first answer.
- `pane-targets.test.ts`: `areaTargets` (`:315`) gains a `holdsFocus` option; one `it.each`:
  base change with `holdsFocus` true keeps the turn, false ends it.
- `shell.test.ts`: beside the stop tests (`~:644-736`), `holdsFocus` is true with focus inside
  the contribution and false outside.

Done when: `npm run typecheck`, `npm run lint` and the tests above pass.

Commit: one commit for the group.

## Proof
