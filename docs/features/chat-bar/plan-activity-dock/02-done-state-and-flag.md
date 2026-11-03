# 02 — Working input's done state and the activityInTranscript flag

Status: not started
Type: Batch (the `WorkingInput` union with the default `working` part; the layout flag with its reader and pick)
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js` ·
           modify `src/plugins/chat/page/chat-layouts.ts` · modify `src/plugins/chat/page/read-chat-layout.ts` ·
           modify `src/plugins/chat/page/entry-list.ts` only when `tsc` flags it (§ Typecheck) ·
           test `src/plugins/chat/layouts/default/layout.test.ts` · test `src/plugins/chat/page/read-chat-layout.test.ts` ·
           create `src/plugins/chat/page/chat-layouts.test.ts`
Consumes:  `ToolInput.agentId` ← 01 (in `StepInput`, no use here) · `pickLayout` in
           `src/shared/page/layout-host/pick.ts` (exists) · `DEFAULT_ENTRY_PICK` in `chat-layouts.ts` (exists)
Produces:  in `src/plugins/chat/layouts/layout.d.ts`, members and types verbatim from plan.md § File Structure
           (its trailing comments are the after-state; this task writes the comments § Contract text gives):
           `export interface LiveWorkingInput` · `export interface DoneWorkingInput` ·
           `export type WorkingInput = LiveWorkingInput | DoneWorkingInput` ·
           `activityInTranscript?: boolean` in `ChatLayout`
           in `src/plugins/chat/page/chat-layouts.ts`:
           `export type ChatPartName = Exclude<keyof ChatLayout, 'entries' | 'activityInTranscript'>` ·
           `export function isActivityInTranscript(shown: ShownLayouts<ChatLayout>): boolean`
           in `src/plugins/chat/layouts/default/layout.js`: `activityInTranscript: false` on the layout object
Decisions: done state (decision 2) · finished-line rules (decision 3) · hiding flag in the layout, inherited
           through the pick chain (decision 5) · `done` carries no `now` (D4) · flag excluded from `ChatPartName`,
           reader error text and check order (D6) · finished-line counts joined with ` · ` (D8) · class names kept
           (decision 7) · prose lands with its code (D12)

## Contract text (`layout.d.ts`)

This task writes only the prose its own code makes true (plan.md D12). Task 06 writes the sentences that name the
dock, the working slot, the hidden rows, the filtered steps and the held start.

- `WorkingInput` becomes the union. `LiveWorkingInput` takes today's `WorkingInput` comments as they are: the head
  ("The running turn. Times are epoch ms."), `state`, `steps` ("Every step of the turn in entry order …"),
  `startedAt` (today's held-block wording) and `now`. They stay true while the entry list draws the working block.
- `DoneWorkingInput`: head "The finished turn: every entry from the user's last message to its last result. Times
  are epoch ms." Field comments as plan.md § File Structure gives them (`state`, `steps`, `startedAt`, `endedAt`,
  `stopReason`, `costUsd`). Its `startedAt` comment adds: "It can be earlier than the live turn's start, when the
  turn holds a result before its last one."
- The `working` part's comment in `ChatLayout` stays as it is (task 06 rewrites it).
- `activityInTranscript` comment: "Left out, the layout takes `default`'s." Place the member first in `ChatLayout`,
  before `entries`. Task 06 adds what the flag does.

## Typecheck

This task leaves `npm run typecheck` green on its own (plan.md § Boundary rules). The union reaches files later
tasks own; the measured uses at plan time read only `steps`, `state` and `startedAt`, which both variants hold, so
none is expected to fail. When `tsc` flags `src/plugins/chat/page/entry-list.ts` (the tick's
`{ ...workingSlot.input, now }` at line 310, or `isWorkingChanged`), make the minimal edit there: type the working
block's held input and `isWorkingChanged`'s parameters as `LiveWorkingInput`. Change nothing else in that file; task
05 removes the block. Any other file `tsc` flags gets the same minimal narrowing to `LiveWorkingInput`, named in the
commit message.

## The default `working` part (`layout.js`)

- `WORKING_ACTION_LINES` becomes `3`.
- A live input draws as today. A `done` input draws the root `div.chat-working` with the class `is-done`, holding
  one child `div.chat-working-done` whose text is the parts below joined with ` · `:
  1. the word: `Done` when `stopReason` is `end_turn` or `success`, else `stopReason` as it is
  2. `kit.duration(endedAt - startedAt)`
  3. `$` + `costUsd.toFixed(2)`, only when `costUsd` is not null
  4. each tool count as `<name> <count>` (always numbered), most used first, ties in first-use order (the existing
     `toolCounts`), none when the turn has no tool step
- `update` redraws the root afresh for either state and toggles `is-done`, so a live dock turning done (or back)
  keeps its root element.
- Comments: the `working` part's comment adds that a `done` input draws the one finished line. The file's head
  comment, the `working` comment's naming and the `WORKING_ACTION_LINES` comment keep "the working block" here;
  task 06 renames them to the activity dock (plan.md D12).

## The flag (`chat-layouts.ts`, `read-chat-layout.ts`)

- `isActivityInTranscript` picks with `pickLayout([shown.user, 'default'], shown.layouts, (layout) =>
  layout.activityInTranscript !== undefined)` and returns the picked layout's value, `true` only for `true`.
- `readChatLayout` takes `activityInTranscript` out of the parts with `entries`, before `requireLayoutParts`. The
  checks run in this order: `composerBar`, the parts (`requireLayoutParts`), the flag, `entries`. The flag check
  throws `layout <name>: activityInTranscript is not a boolean` when the value is neither a boolean nor
  `undefined`. Its doc comment names the new throw in that order.

GIVEN a done input with stop reason `end_turn`, start 0, end 65000, cost 0.574 and steps Bash, Bash, Read WHEN the
default `working` part draws it THEN its lines are `chat-working is-done` and
`div.chat-working-done:Done · 65s · $0.57 · Bash 2 · Read 1`
GIVEN a done input whose cost is null and stop reason `max_tokens` WHEN drawn THEN the line holds no cost and starts
`max_tokens · `
GIVEN a live input with nine steps WHEN drawn THEN the box lists the 3 latest tool calls
GIVEN a user layout `{ activityInTranscript: true }` WHEN `isActivityInTranscript` picks THEN it is `true`; a user
layout that leaves the flag out gives `false`

Tests:     `working_draws ($name)` in `layout.test.ts`: the `NineSteps` row's expected box lines drop to the 3
           latest (`div.chat-working-action:Read c.ts`, `div.chat-working-action is-failed:Grep todo`,
           `div.chat-working-action is-current:Bash npm test`); a new `doneTurn` helper builds a done input beside
           `workingTurn`; add rows, each with a literal expected line list:
           `DoneWithCost` — the first GIVEN above;
           `DoneNoCostOtherReason` — `max_tokens`, start 0, end 4000, cost null, one Read →
           `div.chat-working-done:max_tokens · 4s · Read 1`;
           `DoneSuccess` — `success`, start 0, end 1000, cost null, one Bash → `div.chat-working-done:Done · 1s · Bash 1`;
           `DoneNoTools` — `end_turn`, start 0, end 2000, cost 0.1, one thinking step →
           `div.chat-working-done:Done · 2s · $0.10` ·
           add `working_update_LiveToDone_KeepsTheRootAndDrawsTheLine` — update a live view with a done input: the
           same root element, `is-done` set, the done line drawn ·
           `default_DefinesEveryPart (%s)` and `SURFACE_PARTS`: the `SurfacePart` type excludes
           `activityInTranscript` ·
           `readChatLayout_PartsItChanges_ReturnsTheDefaultExport ($layout)` in `read-chat-layout.test.ts`: add rows
           `{ activityInTranscript: true }` and `{ activityInTranscript: false, working: builder }` · the error
           table there: add row `{ activityInTranscript: 'yes' }` → `activityInTranscript is not a boolean` ·
           create `chat-layouts.test.ts` with `isActivityInTranscript ($case)` over shown layouts holding the real
           `default` layout: user layout sets `true` → `true`; sets `false` → `false`; leaves it out → `false`
           (default's value, which pins the default); the user's name not loaded → `false`
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

