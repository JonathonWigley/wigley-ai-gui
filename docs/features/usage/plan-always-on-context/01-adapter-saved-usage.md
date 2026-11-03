# 01 — Claude adapter knows a saved session's usage

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/transcripts.ts` · modify `src/main/claude-code/past-sessions.ts` · modify `src/main/claude-code/session-usage.ts` · modify `src/main/claude-code/claude-code-harness.ts` · modify `src/main/claude-code/stream-decoder.ts` · modify `src/shared/fake-agent-harness.ts` · test `src/main/claude-code/transcripts.test.ts`, `past-sessions.test.ts`, `session-usage.test.ts`, `claude-code-harness.test.ts`, `src/shared/fake-agent-harness.test.ts`
Consumes:  `foldReply`, `usageEvent`, `replyUsageOf`, `EMPTY_SESSION_USAGE` in `session-usage.ts` (tree)
Produces:  `lastUsage(sessionId: string, projectDir: string, profileDir: string | null): Promise<UsageAgentEvent | null>` on `AgentHarness` in `src/contracts/agent.ts`
           `export function lastMainReply(text: string): { reply: ReplyUsage; at: number } | null` in `src/main/claude-code/transcripts.ts`
           `export const SYNTHETIC_MODEL = '<synthetic>'` in `src/main/claude-code/transcripts.ts`
           `export async function readLastUsage(files: Files, paths: Paths, projectsFolder: string, sessionId: string): Promise<UsageAgentEvent | null>` in `src/main/claude-code/past-sessions.ts`
           `export function withSavedReply(state: SessionUsageState, saved: { reply: ReplyUsage; at: number } | null): SessionUsageState` in `src/main/claude-code/session-usage.ts`
Decisions:
- Contract doc comment, beside `history`: the main agent's `usage` event as the saved session's last main reply left
  it; `at` is that reply's time; null when it has no main reply; rejects naming the path when the transcript is
  missing (round 1, `docs/features/usage/design.md`).
- `lastMainReply`: the last `assistant` line that is not `isSidechain`, whose `message.model` is not `SYNTHETIC_MODEL`,
  and whose `message.usage` is an object; `reply` from `replyUsageOf`, `at` from the line's `timestamp` through the
  file's existing `lineAt` rule. Lines that do not parse are skipped. `SYNTHETIC_MODEL` moves from `stream-decoder.ts`
  to `transcripts.ts`, exported; the decoder imports it.
- `readLastUsage` keeps `readHistory`'s session-id check (reject before any read) and its path, then returns
  `usageEvent(withSavedReply(EMPTY_SESSION_USAGE, saved), saved.at)`, null when `lastMainReply` is null. The window,
  both limits and spend are null.
- `SessionUsageState.hasReply` is renamed `isContextKnown`: true once the state knows the context. `foldReply` sets
  it; `usageEvent` returns null while it is false. `EMPTY_SESSION_USAGE` stays unknown.
- `withSavedReply`: a known state is returned unchanged (a live reply came first); otherwise a non-null `saved` folds
  as `foldReply(state, saved.reply, saved.at)`, and a null `saved` (no main reply) returns the state known at 0 tokens.
- `startClaudeProcess`: a new session (`request.resume` false) starts known (0 tokens), so `emitUsage` emits once
  `get_context_usage` replies or the settings read lands. A resumed one starts unknown and reads its transcript
  (through the same path as `history`, the `projectsFolder` the harness already computes) at start; on resolve
  `usage = withSavedReply(usage, saved)` then `emitUsage()`; on rejection log `claude` `saved usage not read: <reason>`
  and stay unknown. A read that settles after the process closed changes nothing.
- The fake harness gets `lastUsage` with a scriptable result, following how its `history` is scripted.
GIVEN a transcript whose last main reply is followed by a sidechain reply and a `<synthetic>` reply WHEN `lastMainReply` reads it THEN it returns the main reply's usage and timestamp
GIVEN a transcript with no main reply WHEN `lastMainReply` reads it THEN it returns null
GIVEN a resumed process whose first live reply lands before its transcript read WHEN the read resolves THEN the context stays the live reply's
GIVEN a new session WHEN `get_context_usage` replies THEN a `usage` event goes out with `contextTokens` 0 and the reported limit
Tests:     rows in `transcripts.test.ts` for `lastMainReply` (main reply last; sidechain after; synthetic after; none; a malformed line between) — returned `contextTokens` and `at` literal
           rows in `session-usage.test.ts` for `withSavedReply` (unknown + saved; unknown + null → known at 0; known + saved → unchanged) and the existing `usageEvent` null-before-known row renamed
           `past-sessions.test.ts`: `readLastUsage` rejects a non-session id before any read; resolves an event whose `cacheExpiresAt` is the reply's `at` plus its TTL
           `claude-code-harness.test.ts`: new session emits 0-token usage on the context-usage reply; resumed session emits the seeded context; live reply before the seed wins
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof

