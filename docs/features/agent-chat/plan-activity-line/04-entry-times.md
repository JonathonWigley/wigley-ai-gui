# 04 — Entries carry their time

Status: done
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent.ts` · create `src/main/claude-code/entry-stamp.ts` · test `src/main/claude-code/entry-stamp.test.ts` · modify `src/main/claude-code/claude-code-harness.ts` · test `src/main/claude-code/claude-code-harness.test.ts` · modify `src/main/claude-code/stream-decoder.ts` · modify `src/main/claude-code/tool-entries.ts` · modify `src/main/claude-code/transcripts.ts` · test `src/main/claude-code/transcripts.test.ts` · modify `src/main/main.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` · modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/start.test.ts` · modify `src/plugins/chat/main/preview/chat-preview.ts` · test `src/plugins/chat/main/preview/chat-preview.test.ts` · modify `src/plugins/chat/main/preview/preview-session.ts` · modify `src/shared/fake-agent-harness.ts` · test `src/shared/fake-agent-harness.test.ts` · test (entry literals gain `at` only) `src/plugins/chat/main/folder-choices.test.ts`, `src/plugins/chat/main/accounts.test.ts`, `src/plugins/chat/page/entry-list.test.ts`, `src/plugins/chat/page/chat-state.test.ts`, `src/plugins/chat/page/chat-kit.test.ts`, `src/plugins/chat/page/chat-commands.test.ts`, `src/plugins/chat/layouts/default/layout.test.ts`, and any other file the compiler names
Consumes:  `Clock` in `src/contracts/ambient.ts` (in the tree); `MainServices.clock` (in the tree)
Produces:  every `ChatEntry` variant gains `at: number` in `src/contracts/agent.ts`
           `export type EntryDraft` (each `ChatEntry` variant without `at`, distributive) and `export function createEntryStamp(clock: Clock): (draft: EntryDraft) => ChatEntry` in `src/main/claude-code/entry-stamp.ts`
           `ClaudeCodeHarnessDeps.clock: Clock` in `src/main/claude-code/claude-code-harness.ts`
           `ChatSessionsDeps.clock: Clock` in `src/plugins/chat/main/chat-sessions.ts`
           `ChatPreviewDeps.clock: Clock` in `src/plugins/chat/main/preview/chat-preview.ts`
           `createFakeAgentHarness(clock: Clock)` in `src/shared/fake-agent-harness.ts`
Decisions: **the field** (the user's requirement): `at` is epoch milliseconds, when the entry first appeared. The contract comment above `ChatEntry` says so, and that a later version of the entry (same id) keeps its first `at`. The layout inputs in `layout.d.ts` do not gain `at`: the activity part gets its times as its own fields (06)
           **clock injection** follows the codebase: `Clock` from `src/contracts/ambient.ts`, the composition root's `{ now: () => Date.now() }` in `src/main/main.ts` passed down; no module reads `Date.now()` itself
           **Claude adapter, live**: the stream decoder and `tool-entries.ts` build `EntryDraft`s, so `stream-decoder.test.ts` does not change. `startClaudeProcess` makes one `createEntryStamp(deps.clock)` per process and `emitEntry` stamps each draft before emitting. The stamp keeps a map of id → first `at`: a draft whose id it has seen gets that `at` again (a tool and its result, a streaming text growing)
           **Claude adapter, history**: `transcriptEntries` sets each entry's `at` from its transcript line's top-level `timestamp` (ISO 8601, parsed with `Date.parse`). Measured at plan time on a real transcript under `~/.claude-personal/projects/`: every `user`, `assistant` and `system` line carries `timestamp`; bookkeeping lines (`mode`, `last-prompt`, `ai-title` and the like) do not, and become nothing or raw entries. A tool's entry takes its `tool_use` line's time; pairing its result keeps it. A line with no parseable `timestamp` takes the `at` of the entry before it, or `0` when it is the first
           **chat main**: its own notices and permission entries (`chat-sessions.ts`) and the preview's notices (`chat-preview.ts`) take `deps.clock.now()`; `start.ts` passes `services.clock` to both
           **fake harness**: stamps each emitted entry with `clock.now()`, keeping the first `at` per id as the adapter does; `FAKE_HISTORY` entries take fixed times one second apart. `main.ts` passes its `clock`; tests pass a fixed fake clock
           **preview fixtures**: `previewEntries()` gives the entry at 0-based index i the `at` of a fixed epoch constant plus `i * 2000`, so the preview's finished lines read stable times (`4s`, `8s`, `4s`)
GIVEN a stamp over a clock at 1000 WHEN a draft with id `t1` is stamped, the clock moves to 5000 and `t1` is stamped again THEN both carry `at: 1000`, and a new id stamped then carries `5000`
GIVEN a transcript whose assistant line has `"timestamp":"2026-10-27T16:07:09.193Z"` WHEN `transcriptEntries` reads it THEN its entries carry `at: Date.parse('2026-10-27T16:07:09.193Z')`, and a following line with no timestamp carries the same `at`
Tests:     `entry-stamp.test.ts`: `stamp_SameIdKeepsFirstAt_NewIdTakesNow` (the first GIVEN)
           `transcripts.test.ts`: add a table `transcriptEntries_At_<case>` with rows: a line's own timestamp; a line with none takes the one before; a first line with none takes `0`; a tool result line keeps the tool_use line's time. Existing expected entries gain `at`
           `claude-code-harness.test.ts`: the harness made with a fake clock; one assertion that an emitted entry carries the clock's time
           `fake-agent-harness.test.ts`: existing tests pass a fake clock; expected entries gain `at`
           every other test file above: entry literals gain `at` and nothing else
Done when: compiles (`tsc` through the type tests, so every `ChatEntry` literal carries `at`); `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 9ee97fa · proof: diff read: every Produces present (at on every variant, EntryDraft + createEntryStamp, clock deps on harness/sessions/preview, createFakeAgentHarness(clock)); tsc and lint clean · concerns: stamp spreads use an as ChatEntry cast (TS cannot see Omit-union + at as ChatEntry)
