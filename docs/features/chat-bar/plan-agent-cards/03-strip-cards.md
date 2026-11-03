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
  `replaceTaskBox`) to every agent and task box, keeping its rules (an `update` that throws switches that kind of part
  to full redraws until the layouts change; the tick runs only while some box shows). `elapsedMs = now - startedAt`.
- Rewrite the `layout.d.ts` header comment: no failed or dimmed boxes; every box is running; the tick covers both.
- `strip-boxes.ts`: remove `boxLook`, `agentMeta`, `taskOwner`, `outcomeOf`; `entryIndex` returns 0 for any non-empty
  strip; `toolLineInput` maps a tool's outcome to `BoxStatus` locally (`running`→`running`, `done`→`success`,
  `failed`→`error`).
- Default layout, both boxes: head row = running dot (`kit.statusDot(head, 'running')`), name, tag, runtime
  (`kit.duration(elapsedMs)`, pushed right, mono, tertiary); then description, one line, ellipsis.
  Tag words: `Subagent`, `Background agent`, `Shell`. Background agent and Shell tags use the accent tint; Subagent the
  outlined tag.
- Agent box, under the description: `model · effort` (each null left out; line omitted when both null), dim; while not
  open, the recent tools block (fixed three-line height, lines bottom-aligned, newest at full opacity, the one before at
  0.7, the oldest at 0.4, a `data-status="error"` line in the error colour); then the footer: a bar whose fill is
  `contextTokens / contextWindow`, the text `84k/200k` (tokens rounded to whole thousands, `k` suffix; `1.2M` style at
  ≥ 1,000,000), and the cost `$0.42` (two decimals). Bar fill takes the warning colour at ≥ 0.8. With `contextWindow`
  null: no bar, text `84k`. With `contextTokens` null: no bar and no text. With `spendUsd` null: no cost. Footer omitted
  when it would be empty.
- Task box, under the description: the command as one mono line in the tools block's surface (`no command` when null);
  while open, the full command wraps (today's open behaviour). No footer.
- `update` on both boxes rewrites only the runtime text.
- Colours, sizes and radii come from the theme variables and `DESIGN.md`; read `DESIGN.md` before the CSS. Remove the
  `is-dimmed` rules.
- `selftest-script.ts`: the interrupt step now expects the strip to empty (boxes leave on `sessionEnded`), not dimmed
  boxes waiting for the next message; its `why` lines say so. Add a check that a box shows its tag and a runtime.
GIVEN an agent with contextTokens 84000 and contextWindow 200000 WHEN drawn THEN the footer reads `84k/200k` and the bar is 42% wide without the warning class
GIVEN contextTokens 166000 of 200000 WHEN drawn THEN the bar has the warning class
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
