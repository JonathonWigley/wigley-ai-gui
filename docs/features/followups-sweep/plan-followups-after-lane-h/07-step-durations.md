# 07 — Step and tool-call durations

Status: done
Type: Task
Rung: hard · adds a field to the chat layout contract and an option to the shared collapsible, and the entry list must redraw a step whose end arrives later
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Fixes follow-up L468 (`docs/features/followups.md`, main at 9b671bd16), **Step and tool-call durations in the activity
line**: every chat entry carries `at`, so a step row in an open activity line shows the time from its `at` to the next
entry's, and a tool call shows how long it took; the activity line already shows its run's time.

Files:
- modify `src/plugins/chat/page/activity-runs.ts`
- test `src/plugins/chat/page/activity-runs.test.ts`
- modify `src/plugins/chat/page/entry-list.ts`
- test `src/plugins/chat/page/entry-list.test.ts`
- modify `src/plugins/chat/layouts/layout.d.ts`
- modify `src/plugins/chat/layouts/default/layout.js`
- modify `src/plugins/chat/layouts/default/layout.css`
- test `src/plugins/chat/layouts/default/layout.test.ts`
- modify `src/shared/page/ui/card.ts`
- test `src/shared/page/ui/card.test.ts`
- modify `docs/features/agent-chat/design.md` (§ Activity line › Open)
- modify `DESIGN.md` (the chat section's opened activity line rows)

Preconditions (run from the `wigley-ai-gui/` folder of the merged `main`):

| Claim | Command | Expected |
|---|---|---|
| Step inputs carry no time | `grep -n -A10 'export interface ToolInput' src/plugins/chat/layouts/layout.d.ts` | no `durationMs` and no `at` member |
| Entry builders take the entry as is for steps | `grep -n -A14 '^function entryInput' src/plugins/chat/page/entry-list.ts` | a branch for `result` and one for `user`, then `return entry;` |
| The collapsible row's summary is a fixed string with no trailing place | `grep -c 'trailing' src/shared/page/ui/card.ts` | `0` |
| `kit.duration` formats spans | `grep -n 'duration(ms: number): string' src/shared/page/layout-host/kit.d.ts` | one line |
| Plan `plan-followups-now` task 01 landed (a step's `at` of 0 reads as unknown) | `grep -n '=== 0\|!== 0\|> 0' src/plugins/chat/page/activity-runs.ts src/plugins/chat/page/working-turn.ts` | the check task 01 added for an `at` of 0; read it and reuse it below |

Consumes: nothing from another group. Task 06 edits `entry-list.ts`, `entry-list.test.ts` and
`agent-chat/design.md` after this task (wave 2), so this task edits them first.

Produces:
- `export function stepDurationMs(entries: readonly ChatEntry[], index: number): number | null` in
  `src/plugins/chat/page/activity-runs.ts`
- `export interface StepDuration { durationMs: number | null; }` in `src/plugins/chat/layouts/layout.d.ts`, with
  `EntryInputs.tool: ToolInput & StepDuration` and `EntryInputs.thinking: ThinkingInput & StepDuration`
- `trailing?: HTMLElement | null` on `CollapsibleCardOptions` in `src/shared/page/ui/card.ts` and on chat's
  `CollapsibleCardOptions` in `src/plugins/chat/layouts/layout.d.ts`

Decisions:
- **The span.** A step's duration runs from its `at` to the `at` of the next entry after it in the session's entries
  that is not another agent's: an entry with an `agentId` other than the step's is skipped, and an entry with none
  (user, permission, result, notice, compaction, raw, a harness kind) ends it. So a main-agent `Agent` call ends at the
  main agent's next entry, not at its subagent's first step, and a subagent's step ends at that subagent's next entry.
  A `raw` step, which has no `agentId`, counts as the main agent's (`MAIN_AGENT_ID`). A step with no such entry after it (still running, or the list's last) has `null`. A step whose `at`, or whose end
  entry's `at`, is the unknown time plan `plan-followups-now` task 01 settled (`at` 0) has `null`; use that task's
  check, not a second copy. Calls the agent made together (one message, several tool calls) each end at the next
  call's `at`, a near-zero span for all but the last: the contract carries no result time, and this plan does not add
  one (out of scope; the next entry is the item's own rule).
- **Where the times show.** The bundled `default` layout sets `activityInTranscript: false`
  (`src/plugins/chat/layouts/default/layout.js`), so under it the entry list builds no step slot and draws no `tool`
  or `thinking` row in the transcript. The step times show only under a layout that sets `activityInTranscript: true`
  and takes `default`'s `tool` and `thinking` builders (a user layout that leaves `entries` out). This task does not
  change `default`'s flag. The tests reach the builders directly (`layout.test.ts`) and through `activityShown()`
  (`entry-list.test.ts`).
- **Where it lives.** `stepDurationMs` in `activity-runs.ts`, beside `listRows`, which owns the other run times.
- **The contract.** Only the entry builders' `tool` and `thinking` inputs gain `durationMs`, through the
  `StepDuration` intersection in `EntryInputs`; `StepInput`, `ActivityInput.steps` and the working inputs' `steps`
  stay as they are, so the activity dock and `working-turn.ts` are untouched. A `raw` step row gets none: the `raw`
  builder also draws harness kinds, which are not steps. Comment on `StepDuration`: "How long the step took: from its
  `at` to the next entry that is not another agent's; null while nothing after it marks its end, or when either time
  is unknown. Epoch ms span."
- **The entry list.** `entryInput` gives a `tool` or `thinking` entry `durationMs: stepDurationMs(entries, index)`,
  `index` being the entry's place in the session's `entries` (the full list `put` and `rebuild` receive, steps out of
  the transcript included). `rebuild` maps each entry id to its index once, so it scans the list once, not once per
  step. On `put` of an entry new to the list, every step slot whose input holds `durationMs: null` has its input
  recomputed and is redrawn through `redrawSlot` when the value changed (the pattern `redrawChangedUserEntries` uses for
  delivery), so a step's time appears when the entry ending it arrives.
- **The shared row.** `createCollapsibleCard` appends `options.trailing`, when given, to the head after the summary;
  chat's `kit.collapsibleRow` and `kit.collapsibleCard` pass it through unchanged (`addCollapsible` spreads the
  options).
- **The default layout.** The `tool` and `thinking` builders create one `span.chat-step-time` and pass it as
  `trailing`. Its text is `· ${kit.duration(durationMs)}` when `durationMs` is not null, else empty with `hidden` set;
  each builder's `update` sets it from the new input. `.chat-step-time` in `layout.css` takes the activity line's
  time look: `color: var(--wg-fg-tertiary)`, `font-variant-numeric: tabular-nums`, `flex: none` (the summary
  ellipsizes before the time does). The `raw` builder is unchanged.
- **Docs.** `design.md` § Activity line › Open, after "each drawn by the `tool`, `thinking` or `raw` entry builder":
  add "; under a layout that sets `activityInTranscript`, the built-in tool and thinking rows end with the step's time
  (`· 4s`), from the step to the next entry that is not another agent's, shown once that entry arrives". `DESIGN.md`,
  the opened activity line's rows ("a tool's status dot and its mono summary, `Thinking`, `Raw event`"): add "under a
  layout that sets `activityInTranscript`, each tool and thinking row ending with its time, dim, in tabular
  numerals".

GIVEN entries `user u@1000, tool t1@2000 (main), assistant a@6200 (main)` WHEN `stepDurationMs(entries, 1)` THEN 4200.

GIVEN `tool t1@2000 (main), tool s1@2500 (agent x), tool s2@3000 (agent x), assistant a@9000 (main)` WHEN the span of
t1, s1 and s2 is read THEN 7000, 500 and null (s2: no later entry of agent x or with no agent).

GIVEN a step that is the last entry WHEN its span is read THEN null; GIVEN a step at 0, or one whose ending entry is at
0, THEN null.

GIVEN a list with activity in the transcript holding `user u, tool t1@2000` WHEN `assistant a@6200` is put THEN the
t1 slot's view receives an update whose input has `durationMs` 4200.

GIVEN the default `tool` builder drawn with `durationMs` null WHEN it updates with 65000 THEN the row's head shows the
summary then `· 1m 05s`, and before the update the time span is hidden and empty.

Tests:
- `activity-runs.test.ts`: `stepDurationMs of $given → $expected` (it.each), rows: the next main entry (4200); the
  next entry another agent's, skipped (7000 for t1 above); a subagent step ending at its own agent's next entry (500);
  a subagent's last step with only other agents after it (null); the last entry (null); a step at 0 (null); an ending
  entry at 0 (null); a raw step ended by a notice (the notice's `at` minus the step's).
- `entry-list.test.ts`: `put_EntryEndingAStep_RedrawsTheStepWithItsDuration` — under `activityShown` with a user
  layout whose `tool` builder records each input it draws or updates with: after `put(tool t1@2000)` the last recorded
  `durationMs` is null; after `put(assistant a@6200)` it is 4200. And `rebuild_StepsBetweenEntries_EachDrawnWithItsDuration`
  — rebuild over `user u@1000, tool t1@2000, thinking k1@2500, assistant a@6200` draws t1 with 500 and k1 with 3700.
- `layout.test.ts` (describe `default chat layout`): `tool_duration_TrailingTimeShowsAndUpdates ($case)` rows null →
  hidden, text `''`; 4200 → `· 4s`; null then update 65000 → `· 1m 05s`; and the same three for `thinking` as
  `thinking_duration_TrailingTimeShowsAndUpdates ($case)`. Each asserts the `.chat-step-time` span sits in
  `.ui-collapsible-head` after `.ui-collapsible-summary`.
- `card.test.ts`: `trailing: sits in the head after the summary` — `createCollapsibleCard({ summary: 's', trailing,
  body })` puts `trailing` as the head's last child, after the summary; with no `trailing` the head ends at the summary.

Done when: compiles (`npm run typecheck`); `npm test` runs the tests above green, with the rest of `entry-list.test.ts`,
`layout.test.ts`, `activity-runs.test.ts` and `card.test.ts`; `npm run lint` passes (check-styles on the new CSS rule);
the two doc lines are updated.

Commit: one commit, "Chat: each tool and thinking step row shows how long it took, from the step to the next entry of
its agent (follow-up L468)".

## Proof

Commit 023a8d3d1 e6fcb5480 · proof: diff read: stepDurationMs, StepDuration on tool/thinking inputs, card trailing, fillStepTime; compile error in read-chat-layout InputAddition fixed on the same rung; typecheck clean, lint clean but formatting (oxfmt run as lead) · concerns: layout.test asserts '· 65s' not '· 1m 05s' (fake kit counts whole seconds)
