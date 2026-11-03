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
- [x] [Claude adapter knows a saved session's usage](01-adapter-saved-usage.md)
- [x] [Usage store keeps the newest event](02-store-newest-usage.md)
- [x] [Page draws a zero line](03-page-zero-line.md)

### Wave 2
- [x] [Chat reads a restored row's saved usage](04-chat-restored-usage.md) — after 01

### Wave 3
- [x] [Doc re-read](05-doc-re-read.md) — after 01–04

### Wave 4
- [x] [Final verification](06-final-verification.md) — after 05

## Run log

Review base: 46f417b5

### Groups
- 02 · 7e37654f · diff read matches Decisions; tsc clean on usage-store · concerns: none
- 03 · 278491fc · diff read matches Decisions; Produces signatures present; tsc clean outside group 01's in-progress files · concerns: brief named a rowLineInput table in usage-view-model.test.ts that did not exist; worker added one
- 01 · 6dd19915 · diff read matches Decisions; every Produces present; no hasReply left; npm run typecheck clean · concerns: none beyond rulings; resume read logs a rejection even after close (matches the settings read)
- 04 · 804e0855 · diff read matches Decisions; Produces present; npm run typecheck clean · concerns: none
- 05 · none · no changes: design.md matches the landed code; two loose lines handed to the review · concerns: lastUsage doc names only the missing-transcript rejection, not the bad-id one; store doc says an older event changes nothing though it records the profile
- 06 · none · drive run 20261103-004411-8700 (real Claude, ~$0.31+): check 1 PASS (0k then 0k/300k in row and status); check 2 PASS (restored row 49k, status 49k cache 3m before any send; row line is context-only by design, the check's 'cache in both' wording was wrong); check 3 on an open row only activates it (chat-sessions.ts:1517) — rerun 3b on a closed row: limit arrives, but both lines flash 0k before the transcript seed lands (to the review) · concerns: resume of a closed session draws the page zero line until the adapter seed lands — plan expected no 0k between; restored entry header reads '1 step · 498246h 44m' (epoch-start duration, code this run did not touch)
### Contract changes
- readTranscript (new export): none → export async function readTranscript(files: Files, paths: Paths, projectsFolder: string, sessionId: string): Promise<string> in past-sessions.ts · why: readHistory, readLastUsage and the harness's resume seed share one session-id check and path · consumers: 01 · group 01
- readTranscript: exported → module-private; readSavedReplies(files, paths, projectsFolder, sessionId): Promise<SavedReply[]> exported in past-sessions.ts · why: review finding 6, one place reads a saved session's main replies · consumers: readLastUsage, the harness's resume seed · review fix
### Rulings
- A session holding no usage takes an incoming usage whatever its at — the Decisions line conditions the skip on a kept usage — none expected · group 02 · group 02
- Same-state identity is pinned by its own toBe test beside the toEqual table — the table cannot see identity — one extra test · group 02 · group 02
- Zero meter built by a private zeroContextMeter() through formatTokens(0), fresh object per call — keeps one formatter — one allocation per draw · group 03 · group 03
- NoSnapshotYet moved out of the build table into build_NoSnapshotYet_DrawsNothing, since the table's other rows now draw — clarity — none · group 03 · group 03
- Resume seed reads readTranscript + mainReplies + withSavedReplies on the live state rather than calling readLastUsage — the Decisions line folds into the live state — none · group 01 · group 01
- New session starts as withSavedReplies(EMPTY_SESSION_USAGE, []) rather than a named constant — reuses the empty-list rule — a reviewer may prefer a constant · group 01 · group 01
- New-session leading events are pinned by extending start_Turn_EmitsUsageEventsAndAsksContextUsage; with its 30% override the second event's configured limit is 300000 — 'both limits null' holds for the first event only — none · group 01 · group 01
- Fake lastUsage takes a pending fail and hold at call time; a held failing call rejects after release — none · group 01 · group 01
- requireHarness() runs inside the async emitSavedUsage, so a missing harness is a logged rejection and restore never throws — keeps restore synchronous — a log line in place of a throw · group 04 · group 04
- oxfmt --write on chat-sessions.test.ts (43a3c7ec) as lead editor-tooling — one formatter rewrap in group 04's test; agent-strip.css, chat/main/start.ts and sessions/title-tool lint/format failures predate the run (base 46f417b5) and are left — none · lead
### Review rounds
- implementation review · 2c774d03 · NEEDS FIXES (2 Important, 5 Minor, 3 pre-existing; 1 prose fix lead-applied 38feb604)
- re-review (correctness) · fix commits 36893a00, 7a2ebec0 · PASS (findings 1, 2, 4-doc, 5, 6, 7 closed; 3, 4-route, 8, 9, 10 to follow-ups fa06fcba)
### Test gate
- vitest src/main/claude-code, src/shared/fake-agent-harness.test.ts, src/plugins/usage, src/plugins/usage-tab-line, src/plugins/chat (every touched module and the usage line's other host) · 1260 passed; selftest --plugin usage,chat,agent-lines (the zero line changes first-draw logging in the usage, chat status and side-bar row lines) · usage and agent-lines pass; chat's 8 minimum-width fit checks (nav.ui-tabs.session-tabs holds 120px in 99px) fail identically on base 46f417b5, pre-existing; npm run typecheck clean; oxlint/oxfmt clean on the run's files (agent-strip.css, chat/main/start.ts, sessions/title-tool predate the run)
