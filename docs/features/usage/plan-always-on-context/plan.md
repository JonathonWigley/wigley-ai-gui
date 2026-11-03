# Always-on context line — plan

Feature: usage · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Every chat draws its usage line — the side-bar row line and the Chat status line — at all times. A session with no
usage shows a zero line (`0k`), and a restored, resumed or cold session shows its real context (and cache state) from
its saved transcript before its first new turn.

## Architecture

- `src/contracts/agent.ts` — `AgentHarness.lastUsage`, the one new seam member.
- Claude adapter (`src/main/claude-code/`) — reads a transcript's last main reply into a `usage` event; a process emits
  once it knows the context (new session: at start; resumed: after seeding from the transcript or its first reply).
- Fake harness (`src/shared/fake-agent-harness.ts`) — the second adapter of the seam.
- Chat main (`src/plugins/chat/main/chat-sessions.ts`) — on restoring a row that sent a message, reads `lastUsage` and
  emits it as the row's `agentEvent`.
- Usage main store (`src/plugins/usage/main/usage-store.ts`) — keeps the newest `usage` event by `at`.
- Usage page (`src/plugins/usage/page/`) — draws a zero line for a session with no usage.

## Preconditions

- `docs/` is a plain folder at the repo root, so the features home is in-repo: `test -L docs || echo plain`.
- `AgentHarness` has exactly two implementers, the Claude adapter and the fake:
  `grep -rln "planUsage" src/main src/shared --include='*.ts' | grep -v test` lists `claude-code-harness.ts` and
  `fake-agent-harness.ts` (measured at plan time, re-verify).
- Another session is reworking the usage status line and details bar (`4c8a2b0b`, `32ce1626`), in the same
  `usage-view-model.ts` and `usage-format.ts` as task 03. Before wave 1, run `git status` and
  `git log --oneline -5 -- src/plugins/usage`. Leave a peer's uncommitted edits alone, and re-read both files as they
  stand.
- `SYNTHETIC_MODEL` is private to `src/main/claude-code/stream-decoder.ts:80`: `grep -rn "SYNTHETIC_MODEL =" src`.
- The real `get_context_usage` reply carries no token count (`maxTokens`, `autoCompactThreshold` only):
  `grep -n "autocompactSource" src/main/claude-code/claude-code-harness.test.ts`.
- Restored rows open resting, with no process: `restoreRecord` in `src/plugins/chat/main/chat-sessions.ts` calls
  `openRow` and starts nothing.

## Docs written ahead

- `docs/features/usage/design.md` — commit `43f7ca3f`.

## Mandatory Reads

- `AGENTS.md` (repo root) and every nested `AGENTS*.md` under the touched folders:
  `find src docs/features/usage -name 'AGENTS*.md'`
- `docs/features/usage/design.md`
- `DESIGN.md` is not needed: no view, CSS or layout changes.

## Design Overview

```
  restore (resting row, sent)                     resume / send on a resting row (process, resume:true)
          │                                                  │
  chat ── harness.lastUsage(host id) ──┐          adapter start ── reads same transcript ── seeds usage
          │                            │                     │   (skipped when a live reply came first)
          ▼                            │          get_context_usage reply → limit, emits usage
  chat.agentEvent {usage, at=reply}    │                     │
          └──────────────┬─────────────┘                     │
                         ▼                                   ▼
         usage store: withSessionUsage keeps the newest by `at`
                         │ snapshot
                         ▼
   page: sessionLineInput / rowLineInput — usage or zero line (`0k`), never null
```

New session: the adapter's state starts with the context known (0 tokens). It emits `0k` when the profile's settings
read lands, then `0k/300k` when `get_context_usage` replies.

Decisions:

- Transcript is the restored session's source (round 1). Limit and spend arrive with the process.
- The zero line reads `0k` (the user's word): `formatTokens(0)` returns `0k`, so a known limit reads `0k/300k`.
- The transcript read folds every main reply, as the live process does, so the cache TTL an earlier reply wrote
  survives a last reply that only read the cache.
- Every row the part draws for gets a line, sessions usage does not track included.
- The store ignores a `usage` event older (by `at`) than the one it keeps, so a slow transcript read never overwrites
  a live event.
- A resumed process whose transcript read fails logs and stays unknown until its first reply: it never reports a false 0.
- `chat.agentEvent` carries the seeded event. Its other listener, the agents roster, ignores `usage`
  (`src/plugins/agents/roster.ts:112`).

Out of scope: the details bar's session section (still null before a session's first event); app-side saving of
lines across restarts (rejected in round 1).

## File Structure

Modified:

- `src/contracts/agent.ts` — `lastUsage` on `AgentHarness`.
- `src/main/claude-code/transcripts.ts`, `past-sessions.ts`, `session-usage.ts`, `claude-code-harness.ts`,
  `stream-decoder.ts` (`SYNTHETIC_MODEL` moves out to `transcripts.ts`, exported, so both readers share it).
- `src/shared/fake-agent-harness.ts`.
- `src/plugins/usage/main/usage-store.ts`.
- `src/plugins/usage/page/usage-view-model.ts`, `usage-format.ts`, `session-lines.ts` (comments),
  `src/plugins/usage/contract.ts` (comments).
- `src/plugins/chat/main/chat-sessions.ts`.

No new files. Shared names: `AgentHarness.lastUsage(sessionId: string, projectDir: string, profileDir: string | null):
Promise<UsageAgentEvent | null>`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Claude adapter knows a saved session's usage](01-adapter-saved-usage.md)
- [ ] [Usage store keeps the newest event](02-store-newest-usage.md)
- [ ] [Page draws a zero line](03-page-zero-line.md)

### Wave 2
- [ ] [Chat reads a restored row's saved usage](04-chat-restored-usage.md) — after 01

### Wave 3
- [ ] [Doc re-read](05-doc-re-read.md) — after 01–04

### Wave 4
- [ ] [Final verification](06-final-verification.md) — after 05

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
