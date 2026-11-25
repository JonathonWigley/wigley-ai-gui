# 03 — Built-in places and the Inbox count

Status: not started
Type: Parallel
Rung: standard · each edit adds two fields to an existing `api.modes.add` call, and the count follows `setContext`'s pattern in `src/plugins/work-board/page/start.ts`
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/sessions/page/start.ts`
- modify `src/plugins/work-inbox/page/start.ts` · test `src/plugins/work-inbox/page/start.test.ts`
- modify `src/plugins/work-board/page/start.ts`
- modify `src/plugins/builds/page/start.ts`
- modify `src/plugins/docs/page/start.ts`
- modify `src/plugins/backlog/page/start.ts`
- modify `src/plugins/scheduling/page/start.ts`
- modify `src/plugins/chatroom/page/start.ts`
- modify `src/plugins/practice/page/start.ts`
- modify `src/plugins/gallery/page/start.ts`
- modify `src/plugins/settings/page/start.ts`
- modify `CHANGELOG.md`

Consumes:  `Mode.place`, `Mode.showCommand` ← 01 · `ModeHandle.setCount` ← 02
Produces:  nothing other tasks read

Decisions:
- Reference edit: in each plugin's `api.modes.add({ … })`, add `place` and `showCommand: 'showMode'` (every one of
  these manifests declares `showMode`).
- Pinned values, `place` per plugin (the user's order, round 1 and 2):

  | Plugin | `place` |
  |---|---|
  | sessions | `{ group: 1, order: 1 }` |
  | work-inbox | `{ group: 1, order: 2 }` |
  | work-board | `{ group: 1, order: 3 }` |
  | builds | `{ group: 1, order: 4 }` |
  | docs | `{ group: 2, order: 1 }` |
  | backlog | `{ group: 2, order: 2 }` |
  | scheduling | `{ group: 2, order: 3 }` |
  | chatroom | `{ group: 2, order: 4 }` |
  | practice | `{ group: 3, order: 1, at: 'bottom' }` |
  | gallery | `{ group: 3, order: 2, at: 'bottom' }` |
  | settings | `{ group: 3, order: 3, at: 'bottom' }` |

- Inbox count: `work-inbox`'s page part sets its mode handle's count to `sectionCounts(work).needs_you`
  (`src/plugins/work-inbox/page/inbox-state.ts`) at start and on every `work.state` change, from the same slot read the
  view draws from; it reads the real `work.state`, never the demo's sample state. While the state is `undefined`
  (before the first lands) it sets `null`. The call sits beside `view.stateChanged` in the existing `stateListener`
  callback and the immediate `view.stateChanged(state.get())` call, after `mode` is assigned; dispose needs nothing,
  since the handle's disposal drops the item and its count.
- CHANGELOG `### Added`: `Inbox marks its activity bar item with its Needs you count.`

GIVEN no `shell.activityBar` setting WHEN the app starts THEN the bar reads Sessions, Inbox, Board, Builds | Docs, Backlog, Schedules, Chatroom, and Practice, Gallery, Settings at the bottom
GIVEN two items in Needs you WHEN the Inbox state lands THEN Inbox's item has count 2, and 0 when the section empties

Tests:     `workInboxPagePart_NeedsYouItems_SetsModeCount` in `src/plugins/work-inbox/page/start.test.ts`, against the existing mode fake with 02's `setCount` added: undefined state sets null, two Needs you items set 2, an emptied section sets 0.
           The places get no test: they are design values (`wigley:writing-tests` § What earns neither), the order rule is pinned in 01's table, and the built-in order is checked live in 06 check 1.
Done when: compiles; lint passes; the test gate runs the test above
Commit:    one commit for the group

## Proof

