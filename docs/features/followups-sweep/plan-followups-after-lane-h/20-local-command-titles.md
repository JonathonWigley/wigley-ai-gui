# 20 — Local commands do not title a row

Status: not started
Type: Task
Rung: deep · per-process candidate state fed by the harness's async delivery events, cleared on process start, clear and drop
Wave: 2 · Depends on: 13 (both list `src/plugins/chat/main/chat-sessions.test.ts`)
Plan: [plan.md](plan.md)

Follow-up: **Row title takes a local command's text** (`followups.md` L216).

Files:     modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` ·
           modify `docs/features/session-titles/design.md` (the `firstMessage` row of the sources table)

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main` from the `wigley-ai-gui/` folder):
- `grep -n "setFirstMessageTitle(session, message.text);" src/plugins/chat/main/chat-sessions.ts` → one line, in
  `deliver`, under `if (!session.sent)`: the title is set at the write, before the harness says anything.
- `grep -n "a slash command that ended with no request naming it" src/contracts/agent.ts` → one line, in the user
  `ChatEntry`'s `delivery` comment: the contract already marks a local command as a user entry whose `delivery` goes
  from `sent` to null.
- `grep -n "const delivery: UserDelivery | null = isLocalCommand ? null : 'notReceived';" src/plugins/claude-code/main/session-fold.ts`
  → one line: Claude's adapter sends that null for a `/` message no request named.
- `grep -n "delivery: null" src/shared/fake-agent-harness.ts` → the fake's user entries carry null (it tracks no
  delivery).
- `grep -n "| \`firstMessage\` |" docs/features/session-titles/design.md` → one line.
- The scheduled-tasks plan's task 14 edits this file (`prepareLaunch`, `adopt`, launch controls), not `deliver`,
  `setFirstMessageTitle` or the `entry` handler. Write against the merged file.

Consumes: `ChatEntry`'s user `delivery` (`src/contracts/agent.ts`) — in the tree. Nothing from another task.

Produces: no new export.

Decisions:
- **The harness's delivery report decides, so chat stays harness-neutral.** `deliver` no longer sets the title. While
  the row has no first-message title, it records the message: `session.titleCandidates.set(entryId, { text,
  wasSent: false })` (a new `HeldSession` field, `Map<string, { text: string; wasSent: boolean }>`, keyed by the
  harness's entry id that `process.send` returned). The process's `entry` handler, for a `user` entry whose id the map
  holds, reads its `delivery`:
  - `sent` → mark `wasSent` and wait;
  - `received` or `notReceived` → `setFirstMessageTitle(session, text)` and clear the map (a message the user meant
    for the model titles the row even if its turn failed);
  - null after `sent` (`wasSent`) → a local command (the contract's "slash command that ended with no request naming
    it"): delete it and title nothing;
  - null on its first version → a harness or mode that tracks no delivery (the fake, Claude's fallback mode): title
    at once, as today.
  `messageDropped` for a held id deletes it. The map is cleared when a new process starts (entry ids are per process)
  and when the row is cleared: one `session.titleCandidates.clear()` in `beginProcess`, which every `startProcess`
  runs, the clear's included (`grep -n "function beginProcess" src/plugins/chat/main/chat-sessions.ts`).
  `setFirstMessageTitle` keeps its guards (row gone, title already set, whitespace only).
- **`session.sent` is unchanged.** It still turns true at the first write and is saved: auto-retro and the close flow
  read it as "the conversation sent something". Whether a local-command-only session should queue a retro is not this
  item.
- **The user sees the title a moment later.** With Claude, the row takes its first-message title when the reply
  starts (`received`) rather than at the send; until then it shows what it shows today before any message.
- **design.md.** The `firstMessage` row's text "the first message with text sent in a row that has none yet" becomes
  "the first message with text sent in a row that has none yet, once the harness reports it reached the model (or at
  once from a harness that reports no delivery); a local command such as `/effort auto` sets none".

GIVEN a new row WHEN `/effort auto` is sent and its entry arrives `sent`, then with delivery null THEN no
first-message title is set; WHEN `fix the login bug` is sent next and its entry arrives `sent` then `received` THEN
the title is `fix the login bug`.
GIVEN a harness whose user entries carry delivery null WHEN the first message is sent and its entry arrives THEN the
title is set from it.
GIVEN a first message that is dropped (`messageDropped`) WHEN a second message reaches the model THEN the title is the
second message's text.

Tests (in `chat-sessions.test.ts`, `describe('createChatSessions titles')`):
- `deliver_FirstMessage_SetsItsTitle given $given` (existing table): each row's act awaits the fake's entry
  (`await flush()` after the sends) and keeps its expectation; the fake's null delivery takes the "no delivery" path.
- The fake harness emits each sent message's user entry itself, with delivery null, a microtask after the send, which
  takes the "no delivery" path and titles at once. The tests below that drive delivery therefore start through one
  local helper `startedSilent()`, built as `startedRefusing` is (`grep -n "async function startedRefusing"
  src/plugins/chat/main/chat-sessions.test.ts`): it wraps the fake's `start` so the process's `send` emits nothing and
  returns `user-<n>`, `n` counting from 1 per started process (as Claude's ids restart per process); the helper returns
  the test plus `processes`, the fake's `processes`, so a test drives `processes[i].events.entry(…)` and
  `processes[i].events.ended(…)`. Each driven user entry carries the text sent, `images: []` and `raw: []`.
- `deliver_LocalCommandThenMessage_TitlesFromTheMessage`: on `startedSilent()`, send `/effort auto` (`user-1`), drive
  `user-1` with delivery `sent` then null; send `fix the login bug` (`user-2`), drive `user-2` `sent` then `received`
  → `titleCalls` is `[[ROW_ID, 'firstMessage', 'fix the login bug']]`, and `test.saved.last()?.sessions[0]?.sent` is
  `true` (a held local command still marks the row sent).
- `deliver_FirstMessageNotReceived_StillTitles`: `sent` then `notReceived` → titled.
- `deliver_FirstMessageDropped_TitlesFromTheNext`: `messageDropped` for the first id, then `received` for the second
  → titled from the second.
- `'titles nothing from a message the ended process sent, after $given'` (a sentence title, `typescript-vitest.md`
  § Naming), `it.each` over two rows, each on `startedSilent()`:
  send `/effort auto` (`user-1`) and `hello` (`user-2`) with no entry driven, then the row's `act`, `await flush()`,
  then drive `processes[1]`'s user entry `user-2` (text `'replayed'`) with delivery `received` → `titleCalls` is `[]`.
  Rows: `{ given: 'a relaunch', act: end `processes[0]` (`ended({ code: 0, error: null })`), then send `fix the login
  bug`, which starts `processes[1]` }` and `{ given: 'a clear', act: `test.chat.clear(ROW_ID)` }`. Without the clear
  in `beginProcess`, the old process's `user-2` (`hello`) would title the row.
- `deliver_FirstMessageAfterClear_KeepsTheTitle` (existing) passes unchanged.

Done when: compiles (`npm run typecheck`); `npm test` runs `src/plugins/chat/main/chat-sessions.test.ts` green, and the
whole suite stays green (other plugins' tests read first-message titles through the fake harness); `npm run lint`
clean. A filtered self-test is not needed: no self-test step is added or changed; the live check goes to the final
verification task.

Commit: one commit for the group, e.g. "A row's first-message title waits for a message that reaches the model, so a
local command names no row (follow-up: Row title takes a local command's text)"
