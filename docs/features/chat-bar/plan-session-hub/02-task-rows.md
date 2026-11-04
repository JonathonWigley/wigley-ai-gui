# 02 — Task rows

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/agent-strip/page/strip-boxes.ts` · modify `src/plugins/agent-strip/page/agent-strip.ts` · modify `src/plugins/agent-strip/layouts/layout.d.ts` · modify `src/plugins/agent-strip/layouts/default/layout.js` · modify `src/plugins/agent-strip/layouts/default/layout.css` · modify `src/plugins/agent-strip/page/agent-strip.css` · modify `src/plugins/agent-strip/main/selftest-script.ts` · test `src/plugins/agent-strip/page/strip-boxes.test.ts` · test `src/plugins/agent-strip/page/agent-strip.test.ts` · test `src/plugins/agent-strip/layouts/default/layout.test.ts`
Consumes:  `TaskBoxInput`, `HeldWrapper`, `trackOf`, `revealSelected`, `disposeScroller` (in the tree)
Produces:  `orderStripBoxes(roster: Roster): StripBox[]` keeps its signature, with a new order
           `div.agent-strip-rows` in each session's composer part wrapper
Decisions:
- `orderStripBoxes` returns every agent by `startedAt`, then every task by `startedAt`. Equal times keep roster order. The `h` and `l` keys step this flat list, so they go through the cards and then the rows.
- `draw` keeps the HScroller for the agent boxes only. A session with tasks and no agents has no scroller: `disposeScroller` runs when the agent count is 0.
- `draw` makes `div.agent-strip-rows` on the first draw with a task, after the scroller, and removes it on a draw with none. The scroller goes before `rows` when `rows` exists, so the cards stay on top when a subagent starts after a task. `HeldWrapper` gains `rows: HTMLElement | null`. A new `disposeRows(holder)` removes the element and sets null. `disposeHolder`, the zero-box branch and the no-task branch each call it.
- `trackOf(holder, key)` returns the track for an agent box and the rows element for a task box, so `replaceTaskBox` and the tick redraw in place.
- `revealSelected` calls `scroller.reveal` only for an agent box. It calls `element.scrollIntoView({ block: 'nearest' })` for every box.
- A row's scroll position survives a redraw: keep `rows.scrollTop` across `draw`, as `listScrollTops` keeps an open list's scroll.
- The default `taskBox` draws `div.agent-strip-row-line` inside the row, holding, in this order: a running dot, `kit.tag` `Shell` in the `accent` tone, `div.agent-strip-command`, the `cursorPrompt` while selected, then the runtime through `kit.duration`. The command text is `input.command ?? input.description`.
- The `no command` text goes away, because the description now stands in for it.
- While closed, the command takes the free width on one line, with an ellipsis. The dot, tag, prompt and runtime do not shrink.
- While `input.isOpen`, the command wraps whole, the runtime and prompt stay at the line's end, and `div.agent-strip-row-owner` under the line reads `<name> · <description>`, in `text-12` `fg-tertiary` with an ellipsis. When `input.command` is null it reads `<name>`, because the description already shows above.
- The row is `agent-strip-box agent-strip-task`, so `.is-selected` keeps its focus ring. The row has no `min-height`: the `min-height` moves to `.agent-strip-box.agent-strip-agent`.
- A row's padding is `var(--wg-space-1) var(--wg-space-2)`. `.agent-strip-rows` is a column with `gap: var(--wg-space-1)` and `overflow-y: auto`. Its `max-height` is `calc(4 * (var(--wg-text-12) * var(--wg-leading-ui) + 2 * var(--wg-space-1) + 2 * 1px) + 3 * var(--wg-space-1))`. An open row can exceed a row's height, and the column scrolls.
- The card `width` rule stays on agent cards. A row fills the composer's width.
- `agent-strip.css`'s composer cap selector adds `.ui-floating.chat-composer:has(.agent-strip-rows)`, so a session with only tasks gets the same cap.
- Keys do not change. `src/plugins/keymap.ts` stays as it is.
- Rewrite these comments for rows: `layout.d.ts`'s header and `TaskBoxInput`; `layout.js`'s header; `layout.css`'s `min-height` comment; `agent-strip.css`'s composer cap comment; `agent-strip.ts`'s file header and `HeldWrapper`. `name` stays in `TaskBoxInput`.
GIVEN a roster with an agent started at 300 and tasks started at 100 and 200 WHEN the boxes order THEN they read agent, task 100, task 200
GIVEN one task and no agent WHEN the strip draws THEN no scroller exists and the rows hold one row
GIVEN one agent and one task WHEN the agent's box leaves THEN the scroller is gone and the row stays
GIVEN two agents and one task with the first agent selected WHEN `l` runs twice THEN the selection sits on the row, and `scroller.reveal` runs once only for the second card
GIVEN one task and then an agent starts WHEN the strip draws THEN the wrapper's children read scroller, rows
GIVEN one task WHEN it ends THEN `.agent-strip-rows` is gone and the wrapper is empty
GIVEN rows scrolled to 40 WHEN a redraw runs THEN `rows.scrollTop` is 40
GIVEN a row is selected WHEN the selection moves to it THEN `scrollIntoView` runs on the row's element
GIVEN a task row WHEN its elapsed time ticks THEN its element stays the same one and it stays in the rows element
Tests:     in `strip-boxes.test.ts`, the order test's rows become: the first GIVEN; two tasks with equal starts keep roster order (`t1`, `t2`); an agent that started after a task sorts first; the empty roster row stays. In `layout.test.ts`, `head_task` drops its name check, the `no command` row becomes `command: null` with the description as the expected text, and new rows pin the open row's `<name> · <description>` line and its `<name>` line. Update the existing `agent-strip.test.ts` tests the change breaks: `draw_TaskBox_NamedForItsOwnerWithItsCommand`, `redraw_KeepsScrollerAndItsScrollLeft`, `rosterChangedWhileSelected_*`, `enter_WithBoxes` and `tick_ReplacedBox_KeepsItsBookkeeping`. In `agent-strip.test.ts`, add one test per other GIVEN with the file's fake scroller. Assert the scroller's presence, the row's parent `.agent-strip-rows`, the `reveal` calls and the element identity. In the self-test, box 3's expected text becomes `/^\[agent-strip\] box 3 of 4 in agent-strip-selftest shows: Shellnpm run selftest.*(\d+m )?\d+s/` and box 4's the same with `box 4` and `npm run build -- --watch`; the `.*` skips the key prompt. Rewrite box 4's `why` and the group's `why`, because a closed row names no owner
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above. The row's look and the 4-row scroll are checks in [09](09-final-verification.md)
Commit:    one commit for the group

## Proof

