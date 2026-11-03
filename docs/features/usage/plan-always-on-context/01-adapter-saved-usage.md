# 01 — Claude adapter knows a saved session's usage

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · modify `src/main/claude-code/transcripts.ts` · modify `src/main/claude-code/past-sessions.ts` · modify `src/main/claude-code/session-usage.ts` · modify `src/main/claude-code/claude-code-harness.ts` · modify `src/main/claude-code/stream-decoder.ts` · modify `src/shared/fake-agent-harness.ts` · test `src/main/claude-code/transcripts.test.ts`, `past-sessions.test.ts`, `session-usage.test.ts`, `claude-code-harness.test.ts`, `src/shared/fake-agent-harness.test.ts`
Consumes:  `foldReply`, `usageEvent`, `replyUsageOf`, `EMPTY_SESSION_USAGE` in `session-usage.ts` (tree)
Produces:  `lastUsage(sessionId: string, projectDir: string, profileDir: string | null): Promise<UsageAgentEvent | null>` on `AgentHarness` in `src/contracts/agent.ts`
           `export interface SavedReply { reply: ReplyUsage; at: number }` in `src/main/claude-code/session-usage.ts`
           `export function withSavedReplies(state: SessionUsageState, replies: readonly SavedReply[]): SessionUsageState` in `src/main/claude-code/session-usage.ts`
           `export function mainReplies(text: string): SavedReply[]` in `src/main/claude-code/transcripts.ts`
           `export const SYNTHETIC_MODEL = '<synthetic>'` in `src/main/claude-code/transcripts.ts`
           `export async function readLastUsage(files: Files, paths: Paths, projectsFolder: string, sessionId: string): Promise<UsageAgentEvent | null>` in `src/main/claude-code/past-sessions.ts`
           on `FakeAgentHarness` in `src/shared/fake-agent-harness.ts`:
             `setLastUsage(sessionId: string, event: UsageAgentEvent | null): void`
             `failNextLastUsage(message: string): void`
             `holdNextLastUsage(): () => void` — the next `lastUsage` call waits until the returned release runs
             `readonly lastUsageCalls: readonly string[]` — each call's session id, in call order
Decisions:
- Contract doc comment, beside `history`: the main agent's `usage` event as the saved session's main replies left
  it; `at` is the last main reply's time; window, both limits and spend null; null when it has no main reply; rejects
  naming the path when the transcript is missing (round 1, `docs/features/usage/design.md`).
- `mainReplies`: every `assistant` line, oldest first, that is not `isSidechain`, whose `message.model` is not
  `SYNTHETIC_MODEL`, and whose `message.usage` is an object; `reply` from `replyUsageOf`. `at` follows
  `transcriptEntries`' rule exactly: a running `lastAt` over every parsed line (sidechain and skipped lines included),
  the line's own `timestamp` when it parses, else the last one seen, `0` before any. Lines that do not parse are
  skipped. `SYNTHETIC_MODEL` moves from `stream-decoder.ts` to `transcripts.ts`, exported; the decoder imports it.
- Every main reply is folded, not only the last, so a last reply that only read the cache keeps the TTL an earlier
  reply wrote. The live process does the same.
- `withSavedReplies`: a known state comes back unchanged (a live reply came first). Otherwise each reply folds in
  order through `foldReply(state, reply, at)`, and the result is known. An empty list returns the state known at 0
  tokens.
- `readLastUsage` keeps `readHistory`'s session-id check (reject before any read) and its path. An empty
  `mainReplies` gives null; otherwise
  `usageEvent(withSavedReplies(EMPTY_SESSION_USAGE, replies), replies[replies.length - 1].at)`.
- `SessionUsageState.hasReply` is renamed `isContextKnown`: true once the state knows the context. `foldReply` sets
  it; `usageEvent` returns null while it is false; `EMPTY_SESSION_USAGE` stays unknown. Rewrite the `SessionUsageState`
  and `usageEvent` doc comments to say "known" rather than "a reply was folded".
- `startClaudeProcess`: a new session (`request.resume` false) starts known at 0 tokens. Both existing emit points
  stay, so its events are, in order: `0k` with `contextWindow` null and both limits null (the settings read, which
  lands first), then `0k` with the reply's window and `reported` limit (the `get_context_usage` reply). The
  `isSameJson` repeat check drops an unchanged one. Existing tests that list a new session's `agentEvent`s exactly
  (e.g. `start_Turn_EmitsUsageEventsAndAsksContextUsage`) gain those leading events.
- A resumed session starts unknown and reads its transcript at start through `readLastUsage`'s path and
  `mainReplies` (the `projectsFolder` the harness already computes for `history`). On resolve, unless the process has
  closed: `usage = withSavedReplies(usage, replies)` then `emitUsage()`. On rejection: log `claude`
  `saved usage not read: <reason>` and stay unknown, so nothing goes out until the first live reply. A read that
  settles after the process closed changes nothing and emits nothing.
- The fake's `lastUsage`: an id given to `setLastUsage` resolves that event (null included); an unscripted id
  resolves null. `failNextLastUsage` rejects the next call with the message. Every call is recorded in
  `lastUsageCalls`; `pastSessionCalls` is left alone. The fake emits no startup `usage`, unchanged.
GIVEN a transcript whose main replies are followed by a sidechain reply and a `<synthetic>` reply WHEN `mainReplies` reads it THEN it returns the main replies alone, oldest first, with their timestamps
GIVEN a last main reply with no `timestamp` WHEN `mainReplies` reads it THEN its `at` is the last timestamp seen before it
GIVEN a transcript whose earlier reply wrote the 1h cache and whose last reply only read it WHEN `readLastUsage` runs THEN `cacheExpiresAt` is the last reply's `at` plus 1 h
GIVEN a resumed process whose first live reply lands before its transcript read WHEN the read resolves THEN the context stays the live reply's
GIVEN a resumed process whose transcript read rejects WHEN `get_context_usage` replies THEN no `usage` event goes out
GIVEN a new session WHEN the settings read and the `get_context_usage` reply land THEN two `usage` events go out: 0 tokens with null window, then 0 tokens with the reply's window and limit
Tests:     `transcripts.test.ts`: a `mainReplies` table — main replies with sidechain and synthetic after; no main reply → `[]`; a malformed line between; a reply without `timestamp` → previous line's time. Literal `contextTokens` and `at` per row
           `session-usage.test.ts`: a `withSavedReplies` table — unknown + replies; unknown + `[]` → known at 0; known + replies → same object; write-then-read-only keeps the TTL. The existing null-before-a-reply `usageEvent` row renamed for `isContextKnown`
           `past-sessions.test.ts`: `readLastUsage` rejects a non-session id before any read; resolves null for a transcript with no main reply; resolves the event with literal `contextTokens`, `at` and `cacheExpiresAt`
           `claude-code-harness.test.ts`: a new session's two leading events (literal values); resumed emits the seeded context; live reply before the seed wins; rejecting read logs and emits nothing before the first reply; resumed with no main reply emits 0 tokens; a read settling after close emits nothing
           `fake-agent-harness.test.ts`: scripted id resolves its event; unscripted resolves null; `failNextLastUsage` rejects once; a held call resolves only after release; calls recorded in order
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 6dd19915 · proof: diff read matches Decisions; every Produces present; no hasReply left; npm run typecheck clean · concerns: none beyond rulings; resume read logs a rejection even after close (matches the settings read)
