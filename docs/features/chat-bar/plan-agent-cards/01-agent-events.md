# 01 — Agent events carry context and background launch

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/stream-decoder.ts` ·
           modify `src/shared/fake-agent-harness.ts` · modify `src/plugins/chat/main/preview/preview-agent-events.ts` ·
           test `src/main/claude-code/stream-decoder.test.ts` · test `src/shared/fake-agent-harness.test.ts` ·
           test `src/plugins/chat/main/preview/chat-preview.test.ts`
Consumes:  none
Produces:  in `src/contracts/agent.ts`, the `AgentEvent` union member
           `{ type: 'agentReplied'; at: number; agentId: string; model: string; spendUsd: number | null; contextTokens: number | null; contextWindow: number | null }`
           and the new member `{ type: 'agentLaunched'; at: number; agentId: string }`, each with a doc comment
Decisions:
- `contextTokens` = the latest reply's `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
  (missing fields count 0); null before the subagent's first reply. Kept per agent beside `replySpends`.
- `contextWindow` = the window the decoder last learned for the event's `model`, else null. The decoder learns windows
  from every `result` line's `modelUsage`: each `modelUsage[model].contextWindow` that is a number is recorded per model
  name. When a result records a window for a model that differs from the one recorded before (or none was), the
  decoder emits, in the same decoded line, one `agentReplied` for every subagent still pending or launched whose latest
  model is that model, carrying its latest model, spend, context tokens and the new window. Reuse the shape
  `session-usage.ts`'s `contextWindowOf` reads; do not import across into usage state.
- `reportResolvedModel` (launch receipt) carries the agent's latest `contextTokens` (null when none) and the window
  for the resolved model.
- `agentLaunched` is emitted in `finishAgentOrTool` where the launch receipt is detected (`isLaunchReceipt`), after
  `reportResolvedModel`'s `agentReplied`.
- The fake harness and chat's preview events gain the new fields with plausible values: give each sample subagent a
  context (e.g. 84_000 of 200_000, and one at 166_000 of 200_000 so the warning colour shows in the preview) and mark
  one sample subagent launched.
- Every other `AgentEvent` switch in the tree must handle `agentLaunched` (the compiler's `satisfies never` finds
  them; `roster.ts` is task 02's — add a `return roster` case there only if the compile needs it before 02 lands).
GIVEN a subagent reply with usage `{ input_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 80000, output_tokens: 500 }` WHEN decoded THEN its `agentReplied` has `contextTokens` 82010
GIVEN no result has named a window WHEN a subagent replies THEN `contextWindow` is null
GIVEN a running subagent on `claude-opus-5-5` WHEN a `result` arrives whose `modelUsage['claude-opus-5-5'].contextWindow` is 200000 THEN an `agentReplied` for that subagent carries `contextWindow` 200000 and its latest spend and context tokens
GIVEN that window already recorded WHEN another result names the same window THEN no extra `agentReplied` is sent
GIVEN an Agent call's launch receipt with `isAsync: true` WHEN decoded THEN `agentReplied` then `agentLaunched` are sent for that agent id
GIVEN a foreground Agent call's completion receipt WHEN decoded THEN no `agentLaunched` is sent
Tests:     rows added to the existing subagent-reply, launch-receipt and result tables in `stream-decoder.test.ts`
           for each GIVEN above, asserting the exact values written there; `fake-agent-harness.test.ts` and
           `chat-preview.test.ts` updated to the new event shapes
Done when: `npm run typecheck`, `npm run lint` and `npx vitest run src/main/claude-code src/shared/fake-agent-harness.test.ts src/plugins/chat/main/preview` pass
Commit:    one commit for the group

## Proof
