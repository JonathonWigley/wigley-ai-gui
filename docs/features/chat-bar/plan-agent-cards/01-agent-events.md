# 01 — Agent events carry context and background launch

Status: in progress
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
  (missing fields count 0); null before the subagent's first reply.
- One per-agent store holds each subagent's latest `model` and `contextTokens`. Both emission paths write it:
  `reportSubagentReply` (model and tokens) and `reportResolvedModel` (model only). Spend stays in `replySpends`.
  An agent ending (`finishAgent`) drops its entry.
- **Window learning.** The decoder keeps a map of model key → window, filled from every `result` line's `modelUsage`
  (each key whose `contextWindow` is a number). `windowFor(model)`: the entry whose key equals `model`, else the entry
  whose key is `model` followed by a `[…]` suffix (`claude-opus-5-5` matches `claude-opus-5-5[1m]`), else null. Never
  fall back to the largest window. Copy this rule; `session-usage.ts`'s `contextWindowOf` is private and differs.
- **Re-emission.** In `decodeResult`, after `failPendingAgents` and before the `turnEnded` push, for each subagent in
  `pendingAgents` order then `launchedAgents` order that has a stored model: when `windowFor(model)` differs from the
  window last sent for that agent, emit `agentReplied` with its stored model, `spendOf`, stored tokens and the new
  window. Track the window last sent per agent in the same store, so a repeat result sends nothing.
- `reportResolvedModel` (launch receipt) carries the agent's stored `contextTokens` (null when none) and
  `windowFor(resolvedModel)`.
- `agentLaunched` is emitted on every ok `isAsync` launch receipt, whether or not the receipt had a `resolvedModel`;
  it follows the receipt's `agentReplied` when that one is sent.
- **Fake harness** (`emitAgentsTurn`): subagent 1 replies with context 84_000 and window 200_000; subagent 2 with
  166_000 of 200_000 and is launched: its `agentLaunched` comes right after its first `agentReplied`. Update
  `fake-agent-harness.test.ts`'s exact event lists to match.
- **Chat preview** (`previewAgentEvents`): MAPPER's reply carries 166_000 of 200_000 (shows the warning colour);
  CHECKER gets no reply and no launch. `chat-preview.test.ts`'s counts stay `agentReplied: 1`, `agentSpawned: 2`.
- `roster.ts`'s `satisfies never` switch needs an `agentLaunched` case for this task to compile: add
  `case 'agentLaunched': return roster;` (task 02 gives it its real fold).
- Outside claim, low-confidence: that a result's `modelUsage` names the subagents' models. No fixture in the tree shows
  it. If it does not, windows stay null and the card shows `84k` alone; task 05 checks it live.
GIVEN a subagent reply with usage `{ input_tokens: 10, cache_creation_input_tokens: 2000, cache_read_input_tokens: 80000, output_tokens: 500 }` WHEN decoded THEN its `agentReplied` has `contextTokens` 82010
GIVEN no result has named a window WHEN a subagent replies THEN `contextWindow` is null
GIVEN a running subagent on `claude-opus-5-5` WHEN a `result` arrives whose `modelUsage['claude-opus-5-5'].contextWindow` is 200000 THEN an `agentReplied` for that subagent carries `contextWindow` 200000 and its latest spend and context tokens
GIVEN that window already sent WHEN another result names the same window THEN no extra `agentReplied` is sent
GIVEN a running subagent on `claude-opus-5-5` with 200000 sent WHEN a result names `claude-opus-5-5[1m]` with 1000000 and no plain key THEN one `agentReplied` carries 1000000
GIVEN two running subagents on one model and one on another WHEN a result names only the first model's window THEN the two get one `agentReplied` each, in spawn order, and the third none
GIVEN an Agent call's launch receipt with `isAsync: true` and a `resolvedModel` WHEN decoded THEN `agentReplied` then `agentLaunched` are sent for that agent id
GIVEN an `isAsync` launch receipt with no `resolvedModel` WHEN decoded THEN only `agentLaunched` is sent
GIVEN a foreground Agent call's completion receipt WHEN decoded THEN no `agentLaunched` is sent
Tests:     the `replied()` helper (stream-decoder.test.ts ~line 223) takes `contextTokens` and `contextWindow`;
           the existing row 'launch receipt sets the resolved model' (~line 1738) becomes
           `[spawned, replied, launched, finished]`; new rows in the subagent-reply, launch-receipt and result tables
           for each GIVEN above, asserting the exact values written there; `fake-agent-harness.test.ts` and
           `chat-preview.test.ts` updated as the Decisions pin
Done when: `npm run typecheck`, `npm run lint` and `npx vitest run src/main/claude-code src/shared/fake-agent-harness.test.ts src/plugins/chat/main/preview` pass
Commit:    one commit for the group

## Proof
