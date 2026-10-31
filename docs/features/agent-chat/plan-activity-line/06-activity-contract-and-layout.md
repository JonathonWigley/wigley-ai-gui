# 05 — Activity part, collapsibleRow and the built-in layout

Status: not started
Type: Batch
Wave: 2 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/page/read-chat-layout.ts` · test `src/plugins/chat/page/read-chat-layout.test.ts` · modify `src/plugins/chat/page/chat-kit.ts` · test `src/plugins/chat/page/chat-kit.test.ts` · modify `src/plugins/chat/layouts/default/layout.js` · test `src/plugins/chat/layouts/default/layout.test.ts` · modify `src/plugins/chat/page/chat.css`
Consumes:  `plain?: boolean` on `CollapsibleCardOptions` in `src/shared/page/ui/card.ts` ← 03
Produces:  in `src/plugins/chat/layouts/layout.d.ts`:
           `export type StepInput = ToolInput | ThinkingInput | RawInput;`
           `export interface ActivityInput { steps: StepInput[]; current: StepInput; live: boolean; open: boolean; }`
           `ChatKit.collapsibleRow(parent: HTMLElement, options: CollapsibleCardOptions): CollapsibleCard;`
           `ChatLayout.activity?(parent: HTMLElement, input: ActivityInput, kit: BaseKit): PartView<ActivityInput>;`
           in `src/plugins/chat/page/read-chat-layout.ts`: `activity: true` in `PART_SET`
           in `src/plugins/chat/page/chat-kit.ts`: `collapsibleRow` in the kit `createEntryKit` builds
           in `src/plugins/chat/layouts/default/layout.js`: `activity(parent, input, kit)` and the step builders `tool`, `thinking`, `raw` on `collapsibleRow`
Decisions: **contract** (`layout.d.ts`): `ActivityInput` comments say: `steps` in entry order, each the step's entry input; `current` is the last step; `live` holds while the session works on this run and it is the last entry; `open` holds while the user has the line open, and then the part draws only its header and the app places the step rows under it. `collapsibleRow` is commented as "a plain one-line row, no card, that opens `body()` in place under it; Enter on the focused entry toggles it with the entry's expanders", next to `collapsibleCard`. The `ChatLayout.activity` comment: "One run of the agent's steps (tool, thinking, raw entries between two other entries), drawn into its slot; the app keeps the cursor, the click that opens it and the step rows." `CompleteChatLayout` gets `activity` through `Required<ChatLayout>` with no edit
           **kit** (`chat-kit.ts`): `collapsibleRow(parent, options)` calls `createCollapsibleCard({ ...options, plain: true })`, pushes the handle into the kit's expanders list (as `collapsibleCard` does) and appends its element to `parent`
           **built-in steps** (`layout.js`): `tool` draws `collapsibleRow` with the status dot leading, `summary: toolLine(input)`, `mono: true`, the same body and update as today. `thinking` and `raw` draw `collapsibleRow` with summaries `Thinking` and `Raw event` and the same bodies as today. Root classes stay `chat-entry chat-tool` / `chat-thinking` / `chat-raw`. `user`, `assistant`, `permission`, `result`, `notice` do not change
           **built-in activity part** (`layout.js`): root `div.chat-activity` (plus `is-live` while `input.live`). Three states:
           - live and closed: a header line `div.chat-activity-head`: `kit.statusDot(head, 'running')`, the current action `span.chat-activity-action` (mono), then `span.chat-activity-count` `· N steps`; under it `div.chat-activity-shortlist` with one `div.chat-activity-step` per step of the latest `LIVE_STEP_LINES` steps, oldest first, the last one also `is-current`, a tool step whose result `isError` also `is-failed`; each line's text is the step's action text
           - live and open: the same header, no shortlist
           - not live (open or closed): one line `div.chat-activity-summary`: `N steps` (`1 step` for one), then `· <Tool> <count>` per tool name, then `span.chat-activity-failed` `· N failed` when any tool step failed
           update rebuilds the root's children from the new input, so `update` never throws on a state change
           **summary rules**: tool names ordered by count, most first, ties by first use; a count of 1 prints the name alone; `thinking` and `raw` steps count toward `N steps` and are not named; failed counts tool steps whose `result.isError` is true. Action text: a tool's `toolLine(input)` (already in the file), `Thinking`, `Raw event`
           `const LIVE_STEP_LINES = 5;` at the top of `layout.js`, with a comment that a user layout changes the shortlist's length (the user's answer: in the layout, not a setting)
           **CSS** (`chat.css`, tokens only, a comment heading the block): `.chat-activity` in the UI font at `text-ui`; `.chat-activity-summary` `fg-tertiary`; `.chat-activity-failed` `status-error`; `.chat-activity-head` a flex row with `space-2` gap, `fg`; `.chat-activity-action` and `.chat-activity-step` `font-mono` at `text-mono`, one line each with an ellipsis; `.chat-activity-step` `fg-tertiary`; `.chat-activity-step.is-current` `fg`; `.chat-activity-step.is-failed` `status-error`; `.chat-activity-shortlist` indented `space-4` under the header; `.chat-activity-slot` has `cursor: pointer`; `.chat-step-slot` margin `0` and `padding-left: var(--wg-space-4)`, so the step rows read as the open line's list (06 sets these two slot classes)
           tabular numerals on the counts (DESIGN.md § Type)
GIVEN a finished run of Read ×3, Bash ×2 (one failed), Edit WHEN the built-in activity part draws it THEN its summary reads `6 steps · Read 3 · Bash 2 · Edit · 1 failed` and the `· 1 failed` span carries the failed class
GIVEN a live closed run of 7 steps WHEN the part draws THEN the shortlist holds the latest 5 steps and only the last is `is-current`
Tests:     `layout.test.ts`, one `it.each` table `activity_Default_<state>` over input → expected text lines: finished (the example above; and `1 step · Read`; and 2 thinking steps → `2 steps`), live closed (header text `Bash · npm test` and `· 7 steps`; shortlist of 5 lines, last `is-current`), live open (header only, no shortlist); one more row: `update` from live to finished redraws to the summary line
           `layout.test.ts`: the existing `thinking_expanderBodyRefilledInPlace`, `raw_expanderShowsTheEvents` and the tool tests switch their fake kit from `expander`/`collapsibleCard` to `collapsibleRow`; the fake kit gains a `collapsibleRow` that records its calls
           `chat-kit.test.ts`: `collapsibleRow_RegistersWithExpanders` — after one `collapsibleRow`, `expanders.count()` is 1 and `setAllOpen(true)` opens it
           `read-chat-layout.test.ts`: add a row that a layout with `activity: 'x'` throws naming `activity`, if the file's table covers part kinds
Done when: compiles (`layout.js` passes its `// @ts-check` against `CompleteChatLayout`); `npm run lint` passes; `src/shared/layouts/layout-contracts.test.ts` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

