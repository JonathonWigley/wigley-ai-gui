# 03 — Strip draws design A

Status: not started
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/agent-strip/layouts/layout.d.ts` · modify `src/plugins/agent-strip/layouts/default/layout.js` ·
           modify `src/plugins/agent-strip/layouts/default/layout.css` · modify `src/plugins/agent-strip/page/strip-boxes.ts` ·
           modify `src/plugins/agent-strip/page/agent-strip.ts` · modify `src/plugins/agent-strip/main/selftest-script.ts` ·
           test `src/plugins/agent-strip/layouts/default/layout.test.ts` · test `src/plugins/agent-strip/page/strip-boxes.test.ts` ·
           test `src/plugins/agent-strip/page/agent-strip.test.ts`
Consumes:  `RosterAgent { isBackground, contextTokens, contextWindow }`, `RosterTask { ownerName }`, no `outcome` ← 02
Produces:  in `layout.d.ts`:
           `export type AgentKind = 'subagent' | 'backgroundAgent';`
           `AgentBoxInput { name: string; kind: AgentKind; description: string; model: string | null; effort: string | null; spendUsd: number | null; contextTokens: number | null; contextWindow: number | null; elapsedMs: number; recentTools: readonly ToolLineInput[]; isSelected: boolean; isOpen: boolean }`
           `TaskBoxInput { name: string; description: string; command: string | null; elapsedMs: number; isSelected: boolean; isOpen: boolean }`
           `agentBox` returns `AgentBoxPart extends AgentStripPart { update?(input: AgentBoxInput): void }`, the same
           contract `TaskBoxPart.update` has today
           `BoxStatus` and `ToolLineInput` unchanged; `status`, `isDimmed`, `meta` and `owner` removed from the box inputs
Decisions:
- Every box ticks once a second while shown: generalise today's running-task tick (`runningTasks`, `updateTaskBox`,
  `replaceTaskBox`) to every agent and task box, keeping its rules (the tick runs only while some box shows).
  `elapsedMs = now - startedAt`. The "update threw, redraw instead" flag (`updateFailedUnder`) is kept per part kind
  (`agentBox`, `taskBox`), each reset when the layouts change.
- An agent box with no `update`, or whose `update` threw, is replaced by drawing it again; when that box is open, its
  `toolList` is drawn again into the new element and both parts replace the old two in `holder.parts`, so the list
  shows once and the old parts are disposed.
- The page log keeps its text `boxes in <name>: <count> (<running> running)`, `running` now always equal to `count`.
  The `agent-strip.test.ts` row expecting `3 (2 running)` (~line 625) becomes `3 (3 running)`.
- Rewrite the `layout.d.ts` header comment: no failed or dimmed boxes; every box is running; the tick covers both.
- `strip-boxes.ts`: remove `boxLook`, `agentMeta`, `taskOwner`, `outcomeOf`; `entryIndex` returns 0 for any non-empty
  strip; `toolLineInput` maps a tool's outcome to `BoxStatus` locally (`running`→`running`, `done`→`success`,
  `failed`→`error`).
- Default layout, both boxes: head row = running dot (`kit.statusDot(head, 'running')`), name
  (`agent-strip-name`, shrinks with an ellipsis), tag (`kit.tag(head, <words>, <tone>)`, `flex: none`), runtime
  (`agent-strip-runtime`, `kit.duration(elapsedMs)`, pushed right, mono, tertiary, `flex: none`); then the
  description (`agent-strip-description`), one line, ellipsis. Tags: `kit.tag(head, 'Subagent', 'neutral')`,
  `kit.tag(head, 'Background agent', 'accent')`, `kit.tag(head, 'Shell', 'accent')`. The task box's terminal icon is
  dropped (and its `.agent-strip-task-icon` CSS).
- Agent box, under the description: `model · effort` (`agent-strip-model`; each null left out; line omitted when both
  null), dim; while not open, the recent tools block (`agent-strip-recent`, on `block-background` with `radius-sm` per
  `DESIGN.md`, always three lines tall even with fewer or no tools, lines bottom-aligned, newest at full opacity, the
  one before at 0.7, the oldest at 0.4, a `data-status="error"` line in the error colour); then the footer
  (`agent-strip-footer`).
- **Footer.** A bar `span.agent-strip-bar` holding `span.agent-strip-bar-fill`; the fill's width comes from the custom
  property `--agent-strip-percent` set with `style.setProperty('--agent-strip-percent', String(percent))`, where
  `percent = Math.min(100, Math.round(contextTokens / contextWindow * 100))`. The bar gets `data-tone="warning"` when
  `contextTokens / contextWindow >= 0.8` (raw ratio), and the CSS colours that fill with the warning colour. Then the
  text `agent-strip-context`: `84k/200k` (tokens to whole thousands with `k`; at ≥ 1,000,000 one decimal with `M`, as
  `1.2M`), then the cost `agent-strip-cost` `$0.42` (two decimals). With `contextWindow` null: no bar, text `84k`. With
  `contextTokens` null: no bar and no context text. With `spendUsd` null: no cost. Footer omitted when it would be empty.
- Task box, under the description: the command (`agent-strip-command`) as one mono line in the same surface as the
  recent tools block (`no command` when null); while open, the full command wraps (today's open behaviour). No footer.
- `update` on both boxes rewrites only the runtime text.
- CSS: colours, sizes and radii from the theme variables and `DESIGN.md`; read `DESIGN.md` before the CSS. Remove the
  `is-dimmed` rules. The closed box's `min-height` calc covers the fullest closed agent box: head, description, model
  line, three tool lines, footer and the cursor prompt — 8 lines and 7 gaps (today's calc is 7 and 6).
- `selftest-script.ts`: the fake harness's interrupt sends `agentFinished`/`taskFinished` failed, so the interrupt
  step now expects the strip to empty (`boxesLine(0, 0)`), not dimmed boxes. Delete the trailing `strip cleared` step
  (its log line no longer changes, so it would time out) and the group `why`'s "the next message drops them" clause;
  the `why` lines say an interrupt ends the items and their boxes leave. Add a check that a box shows its tag and a
  runtime. Update `scrollsItself` to the new classes that clip (`agent-strip-name`, `agent-strip-description`,
  `agent-strip-tool`, `agent-strip-command`), dropping `agent-strip-meta`.
- `layout.test.ts`'s `FakeElement` gains a `style.setProperty` recorder so the footer rows can assert the percent.
GIVEN an agent with contextTokens 84000, contextWindow 200000 and spendUsd 0.4213 WHEN drawn THEN the footer reads `84k/200k` and `$0.42`, the fill's `--agent-strip-percent` is `42`, and the bar has no `data-tone`
GIVEN contextTokens 166000 of 200000 WHEN drawn THEN the bar has `data-tone="warning"` and percent `83`
GIVEN contextTokens 250000 of 200000 WHEN drawn THEN percent is `100`
GIVEN contextTokens 1234000 of 2000000 WHEN drawn THEN the text reads `1.2M/2.0M`
GIVEN an open agent box under a layout with no `update` WHEN a second passes THEN its tool list shows once
GIVEN contextWindow null and contextTokens 84000 WHEN drawn THEN the footer reads `84k` with no bar
GIVEN `isBackground` true WHEN drawn THEN the tag reads `Background agent`; false reads `Subagent`; a task reads `Shell`
GIVEN a task owned by `kind-fixer` WHEN drawn THEN its name reads `kind-fixer`
GIVEN a shown agent box WHEN a second passes THEN its `update` runs with `elapsedMs` one second larger and the element is kept
Tests:     `layout.test.ts` rows for each GIVEN on drawing; `strip-boxes.test.ts` updated for the removed helpers and
           `entryIndex`; `agent-strip.test.ts`'s tick tests extended to agent boxes (update kept, throwing update
           falls back to redraws)
Done when: `npm run typecheck`, `npm run lint`, `npx vitest run src/plugins/agent-strip`, and
           `npm run selftest -- --plugin agent-strip` pass
Commit:    one commit for the group

## Proof
