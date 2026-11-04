# 05 — Chat send gate and hold

Status: done
Type: Task
Wave: 4 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Read first: `docs/features/auto-compact/design.md` (§ Rules, § Records), `docs/keymap.md`, `AGENTS.md` § Architecture
(the **send gate** bullet) and § Running and testing (self-test steps).

Before you start, run `git status`. A peer can have edits in chat files. Do not revert or commit them.

Files:
- modify `src/plugins/chat/contract.ts`
- modify `src/plugins/chat/main/chat-sessions.ts`
- modify `src/plugins/chat/main/start.ts`
- modify `src/plugins/chat/main/selftest-script.ts`
- modify `src/plugins/chat/main/preview/chat-preview.ts` (its `ChatSessionState` literal gets `compaction: null`)
- modify `src/plugins/chat/page/chat-commands.ts`
- test `src/plugins/chat/main/chat-sessions.test.ts`
- test `src/plugins/chat/main/start.test.ts`
- test `src/plugins/chat/page/chat-commands.test.ts`
- test `src/plugins/chat/page/entry-list.test.ts` (only the `QueuedMessage` literal at about line 272 gets
  `holdReason: null`, so the type check passes; task 06 owns the rest of this file)

Consumes:
- `CompactionTrigger = 'app' | 'manual' | 'harness'` ← 02
- `AgentEvent` `{ type: 'compactionStarted'; at: number; trigger: CompactionTrigger }` ← 02
- `AgentEvent` `{ type: 'compactionEnded'; at: number; trigger: CompactionTrigger; outcome: 'done' | 'failed' |
  'interrupted'; beforeTokens: number | null; durationMs: number | null }` ← 02
- `AgentProcess.compact(): void` — throws after `end`, and while a turn runs ← 02
- `FAKE_COLD_TEXT = 'fake: cold'` ← 03
- `FakeAgentHarness.holdCompactions(): void` and `releaseCompactions(): void` ← 03
- `FakeAgentCall` member `{ method: 'compact' }` ← 03
- The fake's `process.compact()` runs a compaction with trigger `app` ← 03
- `isFakeAgentHarness` (already in `src/shared/fake-agent-harness.ts`)

Produces:
- In `src/plugins/chat/contract.ts`, verbatim from `plan.md` § File Structure:
  - `export interface SendGateInput { sessionId: string; hostSessionId: string; profileDir: string; text: string; now: number }`
  - `export interface SendGateVerdict { action: 'compact'; reason: string }`
  - `export type SendGate = (input: SendGateInput) => SendGateVerdict | null;`
  - `export interface SessionCompaction { trigger: CompactionTrigger; reason: string | null; startedAt: number }`
  - `ChatMainExports.addSendGate(gate: SendGate): () => void;`
  - `ChatSessionState.compaction: SessionCompaction | null;`
  - `QueuedMessage.holdReason: string | null;`
  - `ChatChannel` message `compaction: { sessionId: string; compaction: SessionCompaction | null }`
- In `src/plugins/chat/main/chat-sessions.ts`: `ChatSessions.addSendGate(gate: SendGate): () => void`.
- In `src/plugins/chat/main/start.ts`:
  - `exports.addSendGate` calls `chat.addSendGate`.
  - Drive actions `holdCompactions` and `releaseCompactions` (the drive names them `chat.holdCompactions` and
    `chat.releaseCompactions`). Each takes no args and returns `{}`.
  - `ChatDriveDeps` gains `harnesses: readonly AgentHarness[]`, passed `services.agentHarnesses`.
- In `src/plugins/chat/page/chat-commands.ts`: the `interrupt` handler also runs while a hold or a compaction is up.

Task 06 consumes `compaction`, `holdReason` and the `compaction` channel message. Task 06 also stores the
`compaction` message in the page's tab state. Task 07 consumes `addSendGate` and the gate types. Task 09 consumes
the two drive actions.

## Decisions

Names used below:
- **Held row** — the one `QueuedMessage` with `holdReason !== null`. A session has at most one held row.
- **Hold is up** — the session has a held row.
- **Waits** — `isTurnRunning(session) || session.state.compaction !== null || hold is up`.

### Where the gate runs

1. The gate runs only in `writeAtIdle`. `sendMessage` (its idle branch) and `sendAllNow` (its idle branch, with no hold
   up) reach it.
2. These paths do not ask the gates:
   - `launch` — a new session has no usage.
   - `writeNextQueued` — it drains the queue just after a turn, so the cache is warm.
   - `writeRowNow` — `sendNow` and `sendAllNow` use it only while a turn runs.
   - A queued send — a send that waits does not reach `writeAtIdle`.
3. `sendMessage` queues the message (`queue`) when the session waits. Today it queues only on `isTurnRunning`.
4. The order in `writeAtIdle` is:
   1. Read the pending history (as today).
   2. Start the process of a resting session (`startProcess`, as today).
   3. Ask the gates.
   4. On a verdict, hold. Else, `deliverWritten` (as today).

   The gates run after the process start because `compact()` needs a process. The saved usage arrives earlier,
   through `emitSavedUsage` at restore, so the gate can hold the first send to a restored resting session.
5. `SendGateInput` values:
   - `sessionId` — the row id (`session.state.sessionId`).
   - `hostSessionId` — the host session id the row's `chat.agentEvent`s carry now. After `clear` it is the new id, so
     a gate keyed by it holds nothing until the new conversation reports usage.
   - `profileDir` — the `profileDirOf(profile)` the running process started under. Keep it on `HeldSession`. Set it
     in `startProcess`. Do not read the profiles setting again, because a profile can leave the setting while its
     process runs.
   - `now` — `deps.clock.now()`.

### Gate order and failure

6. `addSendGate` adds the gate at the end of a registration list. It returns a dispose function. The dispose removes
   only that registration. A second dispose does nothing. Use one object per registration, as `addInstructions` does,
   so the same function added two times gives two registrations.
7. Ask the gates in registration order. The first non-null verdict wins. Do not ask the gates after it.
8. A gate that throws counts as null. Log `send gate failed in <sessionId>: <errorText(error)>`, then ask the next
   gate.

### The hold

9. On a verdict:
   1. Append a row with `appendQueued`. Set `holdReason` to the verdict's `reason`.
   2. Send `queued`.
   3. Log `send held in <sessionId>: <reason>`.
   4. Set `HeldSession.compactionReason` (new field, `string | null`) to the reason.
   5. Call `process.compact()`.
10. If `compact()` throws, release the hold at once:
    1. Set `compactionReason` to null.
    2. Log `compaction not started in <sessionId>: <errorText(error)>`.
    3. Release the held row (decision 11) and write it with `writeNextQueued`.

    The send does not reject.
11. To release the held row, replace it in `state.queued` with a copy that has `holdReason: null`. Copy its
    `rowOrders` stamp to the new object, as `writeRowNow` does. Then send `queued`.
12. `writeNextQueued` writes nothing and returns false in these cases:
    - The oldest unsent row is the held row.
    - `state.compaction !== null`.

    The `activity('idle')` handler then shows idle, as today. Later rows never pass the held row.
13. On a live `compactionEnded`, with any outcome, do these steps in this order:
    1. Set `state.compaction` to null and send `compaction`.
    2. Set `compactionReason` to null.
    3. If a hold is up, release the held row (decision 11) and log
       `held message <rowId> released in <sessionId> (<outcome>)`.
    4. If `harnessActivity === 'idle'`, call `writeNextQueued` once. Else the next `activity('idle')` drains the
       queue, as today.

    The rows then go out one per idle, oldest first, as today.
14. A message sent while a hold is up queues behind the held row (decision 3), in order.

### Compaction state

15. On a live `compactionStarted`, whatever its trigger:
    1. Set `state.compaction` to `{ trigger, reason, startedAt: event.at }`. For trigger `app`, `reason` is
       `compactionReason`. For any other trigger, it is null.
    2. Send `compaction`.
16. Set `state.compaction` to null and send `compaction` (only when it was not null) in these places:
    - `compactionEnded` (decision 13).
    - The process `ended` handler.
    - `clear`.

    Set `compactionReason` to null at the same places.
17. `openRow` sets `compaction: null`. `copyState` copies it. The page reads it through `sessions()` at each load.
    `chat-preview.ts` sets `compaction: null` in its state.
18. Chat still forwards both events as `chat.agentEvent`, unchanged.

### Skip

19. `interrupt` while a hold is up:
    1. Call `process.interrupt()`.
    2. Do not call `returnUnsent`. The held row and the rows behind it stay queued.
    3. Log `skipping the compaction in <sessionId>`.

    The rows go out from `compactionEnded` (outcome `interrupted`), in order. With no hold up, `interrupt` works as
    today. Reason: the user's ⌃C on a held row asks to skip the compaction, not to drop the messages
    (design.md § Rules).
20. `sendNow` on the held row does the same as decision 19. Do not call `writeRowNow`, because a write during the
    compaction runs only after it.
21. `sendAllNow` while a hold is up:
    1. Append `message`, when not null, as a new unsent row with `holdReason: null`. Send `queued`.
    2. Do as decision 19. Do not write any row now.
22. `pullBack` on the held row works as today. It returns the row to the box, and the compaction continues. Do not
    interrupt. The rows behind it wait until `compactionEnded` (decision 12).
23. A second ⌃C works as today. The adapter ends the process on a second `interrupt` within its grace.

### Process end and clear during a hold

24. The `ended` handler's `returnAllHeld` returns the held row with the other rows, in write order. No new code is
    necessary except decision 16.
25. `clear` does the same through its own `returnAllHeld`. It also applies decision 16.

### Page interrupt guard

26. In `chat-commands.ts`, `interrupt` invokes `interrupt` when one of these is true:
    - `state.activity !== 'idle'`
    - `state.compaction !== null`
    - a row in `state.queued` has `holdReason !== null`

    It still logs `nothing to interrupt in <name>` when all are false. A resting session stays refused, as today.
    Reason: the activity during an app compaction is not pinned. The Claude adapter shows `working` (its `compact()`
    writes a tracked uuid, adapter.md § 2), but the fake can show `idle`.

### Contract comments

27. Update these comments in `contract.ts`:
    - `QueuedMessage`: a held row waits for its session's compaction and is written when the compaction ends.
    - `ChatSessionState.queued`: it includes the held row.
    - `ChatSessionState.compaction`: the running compaction, or null.
    - The `send` invoke: an idle send can be held by a send gate.
    - The `interrupt` invoke: while a hold is up, it skips the compaction and returns nothing.
    - `sendNow`, `sendAllNow` and `pullBack` on a held row: the behaviour in decisions 20–22.
    - The `ChatSessions` comments in `chat-sessions.ts` for the same methods.
28. Add a comment on `ChatMainExports.addSendGate`: gates are asked in registration order before a write to an idle
    session; the first non-null verdict holds the send; a gate that throws is logged and counts as null; the dispose
    removes the gate.

### Self-test

29. Add a fixture gate to `chatSelfTestScript`. `ChatSelfTestDeps.chat` picks `addSendGate` as well. Register the
    gate once, when the script is made. The gate returns `{ action: 'compact', reason: 'selftest · cache cold' }`
    only when both of these are true:
    - The input's session is the self-test project's session.
    - The last call of `selftestProcess(marks, <selftest project>, false)` equals
      `{ method: 'send', text: FAKE_COLD_TEXT, imageCount: 0 }`.

    Before it returns that verdict, the gate calls `holdCompactions()` on the fake harness
    (`harnesses.find(isFakeAgentHarness)`). The script's `problems` check calls `releaseCompactions()`.

    The fixture gate does not use the auto-compact plugin. So chat's group passes with that plugin disabled, and it
    can land before task 07. Chat starts before auto-compact (`dependsOn: ['chat']`), so chat's fixture gate is first
    in the registration order.
30. In `INTERRUPT_AND_CLOSE_STEPS`, put these steps after `{ keys: ['Escape'], expect: '[chat] picker closed: Folder' }`
    and before the last `sendKeys(FAKE_HOLD_TEXT)`:

    | keys | expect | alsoExpect | why |
    |---|---|---|---|
    | `sendKeys(FAKE_COLD_TEXT)` | `[chat] assistant entry added in chat-selftest` | — | fake: cold is an echo turn |
    | `sendKeys('after cold')` | `[chat] 1 pending message(s) in chat-selftest` | — | The fixture gate holds the send after fake: cold; the held row waits while the fake holds the app compaction. |
    | `sendKeys('behind hold')` | `[chat] 2 pending message(s) in chat-selftest` | — | A send during the hold queues behind the held row. |
    | `['<C-c>']` | `[chat] 0 pending message(s) in chat-selftest` | `/^\[chat\] interrupted chat-selftest$/` | Ctrl+C skips the held compaction; the held row is written when the compaction ends, then the row behind it at the next idle. |

31. In `EXPECTED_CALLS`, put these calls after `{ method: 'send', text: 'pending one\npending two', imageCount: 0 }`:
    1. `{ method: 'send', text: FAKE_COLD_TEXT, imageCount: 0 }`
    2. `{ method: 'compact' }`
    3. `{ method: 'interrupt' }`
    4. `{ method: 'send', text: 'after cold', imageCount: 0 }`
    5. `{ method: 'send', text: 'behind hold', imageCount: 0 }`
32. Add this text to the end of the `interrupt and close` group's `why`: "a send after fake: cold is held as a pending
    row for an app compaction, a later send queues behind it, and Ctrl+C skips the compaction and writes both in
    order".

### Drive

33. The drive actions `holdCompactions` and `releaseCompactions` call the fake harness's `holdCompactions()` and
    `releaseCompactions()`. They throw `chat runs on no fake harness` when `harnesses` has no fake harness.
    - `holdCompactions` description: "Under the fake harness, holds every compaction that starts from now on until
      chat.releaseCompactions or an interrupt, so a held send's pending row and the dock's Compacting state stay up."
    - `releaseCompactions` description: "Ends the compactions chat.holdCompactions held, and holds no later one."
34. In the `start` drive action's description, add after the "fake: visual" clause:
    - `"fake: cold" an echo whose usage reads 200k of context with the cache already cold, so with auto-compact on
      the next message is held for a compaction`
    - `"fake: compact" a turn that runs an autocompact`

## GIVEN / WHEN / THEN

- GIVEN an idle running session and two gates, the first answering null and the second a verdict, WHEN the user
  sends, THEN chat queues the message as a held row with the second gate's reason and calls `compact()`. Chat does
  not call `send`.
- GIVEN a gate that throws and a later gate with a verdict, WHEN the user sends, THEN chat logs the failure and holds
  the message with the later gate's reason.
- GIVEN a resting restored row and a gate with a verdict, WHEN the user sends, THEN chat starts the process, then asks
  the gate, then calls `compact()` on the new process.
- GIVEN a hold is up, WHEN the user sends two more messages, THEN they queue behind the held row, and the harness's
  `idle` writes none of them.
- GIVEN a hold is up, WHEN `compactionEnded` arrives with outcome `done`, `failed` or `interrupted` and the harness is
  idle, THEN chat writes the held row. The later rows go out one per idle, in order.
- GIVEN a verdict, WHEN `compact()` throws, THEN chat logs it and writes the message at once.
- GIVEN any trigger, WHEN `compactionStarted` arrives, THEN `state.compaction` holds the trigger, the `at`, and the
  gate's reason only for `app`. Chat sends `compaction`. WHEN `compactionEnded`, the process end or a clear follows,
  THEN `state.compaction` is null and chat sends `compaction`.
- GIVEN a hold is up, WHEN the user presses ⌃C or ⌘↩ on the held row, THEN chat interrupts the process, returns
  nothing to the box, and writes the held row when `compactionEnded` arrives.
- GIVEN a hold is up, WHEN the user pulls back the held row, THEN chat returns it to the box. The compaction continues.
- GIVEN a hold is up, WHEN the process ends, THEN chat returns the held row and every row behind it to the box, in
  write order.
- GIVEN a running session with activity `idle` and a held row or a compaction up, WHEN the user presses ⌃C, THEN the
  page invokes `interrupt`.

## Tests

All main tests use `started()` or `setUp()` over the fake harness. They register gates with `test.chat.addSendGate`
and drive events with `test.process.events.agentEvent(...)` and `test.activity(...)`. A test that needs the
compaction held calls `test.harness.holdCompactions()` first. Every existing `toEqual` on a queued row gets
`holdReason: null`. Every existing state literal (about lines 461 and 1152) gets `compaction: null`.

In `chat-sessions.test.ts`, add a `describe('createChatSessions send gate and hold', …)` block:

- `sendGate_IdleSend_FirstVerdictWinsInRegistrationOrder` — `it.each` rows:

  | gates, in order | process calls | queued rows' `holdReason` | logged |
  |---|---|---|---|
  | none | `[sendCall(IDLE_SEND)]` | `[]` | — |
  | `null` | `[sendCall(IDLE_SEND)]` | `[]` | — |
  | `null`, `A` | `[{ method: 'compact' }]` | `['a']` | `[chat] send held in row-1: a` |
  | `A`, `B` | `[{ method: 'compact' }]` | `['a']`; B not called | `[chat] send held in row-1: a` |
  | throws `boom`, `A` | `[{ method: 'compact' }]` | `['a']` | `[chat] send gate failed in row-1: boom` |
  | `A` disposed, then disposed again | `[sendCall(IDLE_SEND)]` | `[]` | — |

  `A` answers `{ action: 'compact', reason: 'a' }` and `B` answers `{ action: 'compact', reason: 'b' }`.
- `sendGate_Input_RowProfileDirAndNow` — `started({ clockNow: 5000 })` (profile `personal`). The gate records
  `{ sessionId: 'row-1', profileDir: '~/.claude-personal', now: 5000 }`.
- `sendGate_NotAskedOffTheIdleWrite` — rows: a send while a turn runs; `activity('idle')` that drains a queued row;
  `sendNow` on a queued row; `launch`. For each row, the gate's call count is 0. Last row: `sendAllNow` at idle with a
  message asks the gate once.
- `send_RestingRowHeld_StartsProcessThenCompacts` — restore `record('host-a', { sent: true })`, add a gate with a
  verdict, then send. `harness.processes[0].calls` is `[{ method: 'compact' }]`. The log line
  `[chat] session row-1 process started (resume true)` comes before `[chat] send held in row-1: a`.
- `hold_LaterSendsQueueBehindAndReleaseInOrder` — `it.each` over outcome `done`, `failed`, `interrupted`:
  1. Hold, then send `b` and `c`. `queued` is the held row then `b` then `c`.
  2. `activity('idle')`. No `send` call.
  3. Emit `compactionEnded` with the outcome.
  4. Calls end with `sendCall(held)`. The log has `[chat] held message queued-1 released in row-1 (<outcome>)`.
  5. Each later `activity('idle')` writes `b`, then `c`.
- `hold_CompactThrows_WritesAtOnce` — without awaiting, send `FAKE_HOLD_TEXT`. At once, send `IDLE_SEND` with a gate
  that holds only its second call. Chat has not seen `working` yet, so it holds, and the fake's `compact()` throws
  because its turn is open. Then:
  - The calls end with `sendCall(IDLE_SEND)`.
  - The log has `[chat] compaction not started in row-1: <the fake's error text>`.
  - No row is queued.
- `compaction_StateFollowsStartedAndEnded` — first, `sessions()[0].compaction` and the `sessionStarted` message's
  `compaction` are null. Then `it.each` over trigger:

  | trigger | held by gate `a` first | `state.compaction` after `compactionStarted { at: 2000 }` |
  |---|---|---|
  | `app` | yes | `{ trigger: 'app', reason: 'a', startedAt: 2000 }` |
  | `manual` | no | `{ trigger: 'manual', reason: null, startedAt: 2000 }` |
  | `harness` | no | `{ trigger: 'harness', reason: null, startedAt: 2000 }` |

  After `compactionEnded`, `compaction` is null. The `compaction` messages sent are the set value, then null.
- `compaction_ProcessEndsDuringHold_ReturnsRowsAndClears` — hold, queue `b`, emit `compactionStarted`, then
  `ended({ code: 0, error: null })`. `returned` is `[{ sessionId: 'row-1', messages: [held, b] }]`.
  `sessions()[0].compaction` is null. The last `compaction` message has `compaction: null`.
- `hold_ClearDuringHold_ReturnsRowsAndClears` — the same values, through `clear('row-1')`.
- `interrupt_HoldUp_SkipsAndKeepsRows` — hold, queue `b`, then `interrupt('row-1')`:
  - Calls are `[{ method: 'compact' }, { method: 'interrupt' }]`.
  - `returned` is empty.
  - `queued` still has both rows.
  - The log has `[chat] skipping the compaction in row-1`.

  Then emit `compactionEnded` with outcome `interrupted`. The calls end with `sendCall(held)`.
- `sendNow_HeldRow_SkipsTheCompaction` — the same assertions through `sendNow('row-1', 'queued-1')`. The row's
  `sentEntryId` stays null.
- `sendAllNow_HoldUp_QueuesTheBoxBehindAndSkips` — hold, then `sendAllNow('row-1', b)`:
  - Calls are `[{ method: 'compact' }, { method: 'interrupt' }]`.
  - `queued` is the held row then `b`, both unsent.
- `pullBack_HeldRow_ReturnsItAndTheCompactionGoesOn` — hold, emit `compactionStarted`, queue `b`, then
  `pullBack('row-1', 'queued-1')`:
  - `returned` is `[held]`.
  - Calls are `[{ method: 'compact' }]`.
  - `compaction` is still set.
  - `activity('idle')` writes nothing.

  Then `compactionEnded` with the harness idle writes `b`.

In `chat-commands.test.ts`, give `session()` an `activity` and state override. Add:

- `interrupt_IdleActivity_InterruptsOnlyWithAHoldOrCompaction` — `it.each`:

  | activity | compaction | queued | invoked |
  |---|---|---|---|
  | `idle` | null | `[]` | `[]`, log `nothing to interrupt in <name>` |
  | `idle` | `{ trigger: 'app', reason: 'a', startedAt: 1 }` | `[]` | `[['interrupt', 'row-1']]` |
  | `idle` | null | one row with `holdReason: 'a'` | `[['interrupt', 'row-1']]` |
  | `working` | null | `[]` | `[['interrupt', 'row-1']]` |

In `start.test.ts`:

- `exports_AddSendGate_HoldsAnExportedSend` — after `exports.addSendGate(() => ({ action: 'compact', reason: 'r' }))`,
  `exports.send` makes no `send` on the process. The dispose function removes the gate, and the next `exports.send`
  writes.
- In `chat drive actions`, add `holdCompactions and releaseCompactions reject with no fake harness` — both reject
  with `chat runs on no fake harness`.

Self-test: the steps and calls in decisions 30–31. Run them with `npm run selftest -- --plugin chat`.

## Approach

- `processEvents.agentEvent` handles `compactionStarted` and `compactionEnded` only when `isLiveEvent`, next to the
  `turnEnded` branch. It forwards each event first, as today.
- `HeldSession` gains `profileDir: string | null` (null until the first start) and `compactionReason: string | null`.
  `openRow` sets both to null.
- Keep each new log line as written above. The tests match them exactly.

## Done when

- `npm run typecheck`, `npm run lint` and `npm test` pass.
- `npm run selftest -- --plugin chat` passes, with the new steps.
- Each item in Produces is present in the file it names.

The visible checks (held row label, dock, real ⌃C on a real Claude compaction) are in
[09 — Final verification](09-final-verification.md).

Commit: one commit for the group. Example message: "Chat send gate and compaction hold: gates asked before an idle
write, held row released on compactionEnded, Ctrl+C and send-now skip the compaction, compaction state on the
session".

## Addendum (round 3): the idle compaction threshold at start

Produces:  `ChatMainExports.addIdleCompactThreshold(read: () => number | null): () => void` in
           `src/plugins/chat/contract.ts`.
Consumes:  `AgentStart.idleCompactMinTokens: number | null` ← 02.
Decisions:
- Chat main keeps the registered readers in order. At each process start it calls the newest reader still
  registered and puts its value in `AgentStart.idleCompactMinTokens`; with no reader, null. A reader that throws is
  logged as a send gate failure is, and counts as null.
- The value is read at start only. A changed setting reaches a session at its next process start.
- The returned function removes the reader; a second call does nothing (the same rule as `addSendGate`'s remover).
GIVEN a registered reader returning 150000 WHEN chat starts a session's process THEN the start request carries
`idleCompactMinTokens: 150000`. GIVEN no reader THEN it carries null.
Tests:     one `it.each` in `chat-sessions.test.ts` over the fake harness's recorded start requests: rows "reader
           150000 → 150000", "no reader → null", "reader removed → null".

## Cold read fixes

These override any earlier line of this task that they contradict.

- **`SendGateInput.text`.** The input carries the message text as the user wrote it (plan.md's shape). `writeAtIdle`
  passes it; the gate test asserts it is passed.
- **Slash commands** are skipped by the plugin, not by chat (task 07 reads `text`), so chat keeps one gate rule:
  ask on every idle write.
- **Re-check after the history read.** In `writeAtIdle`, after the awaited history read and the process start,
  re-evaluate `waits` and `queue(session, message)` when it is true: two sends to a restored resting row give one
  verdict, one `compact()` call and two queued rows. Test row for that.
- **Typecheck.** Done when: typecheck errors only in files task 06 owns (`read-chat-layout.ts`, `entry-list.ts`,
  `chat-layouts.ts`, `layout.d.ts` consumers, `composer-input.test.ts`, `layouts/default/layout.test.ts`); the proof
  lists them.
- **Test harness setup.** Rows that assert a mid-hold state (`queued`, `calls`) call `test.harness.holdCompactions()`
  before the send. A row that needs an outcome the fake cannot give (`failed` with the process alive) emits the end
  by hand and asserts before the next flush, or releases with `releaseCompactions()` afterwards. The interrupt tests
  use the fake's own `compactionEnded interrupted`, never a hand-emitted one.
- **Skip siblings.** `sendNow` on an unsent row that is not the held row writes it now, as today. `sendAllNow`'s idle
  branch tests `waits` minus the hold: with a compaction up and no hold it writes every unsent row and the message
  now, as for a running turn, and asks no gate. A null message with a hold up skips like decision 19. Rows for the
  first two.
- **`compact()` throws.** Remove the held row and call `deliverWritten` directly, so a throwing write rejects `send`
  as today and the page puts the text back. Row: `compact()` and then `send` both throw → `send` rejects, no row left.
- **Compaction without a hold.** Decision 13.1 sends `compaction` only when it was not null. New rows: queued rows, a
  `manual` `compactionStarted`, `activity('idle')` → nothing written; then `compactionEnded` with the harness idle →
  the oldest row is written. A second `compactionEnded` with no start → no message sent.
- **Citations.** Decision 26's "adapter.md § 2" means task 02's `compact()` decision. `chat-sessions.test.ts` holds
  one state literal (line 466, measured at plan time, re-verify); `chat-commands.test.ts`'s `session()` gets the
  override; the `AgentStart` literals gain `idleCompactMinTokens: null`.
- **Threshold reader.** Only the newest registered reader is asked; a throw counts as null and older readers are not
  asked. Produces also: `ChatSessions.addIdleCompactThreshold(read): () => void` in `chat-sessions.ts` and the
  `exports.addIdleCompactThreshold` line in `start.ts`.


## Proof

Commit 763eeea0 · proof: Diff read against Produces: addSendGate, addIdleCompactThreshold, SendGate types, SessionCompaction, holdReason, compaction channel event, holdCompactions and releaseCompactions drive actions, ChatDriveDeps.harnesses; typecheck errors left only in task 06's page files; chat vitest green per worker · concerns: Refused /compact draws its reason twice; pull-back window between compact() and compactionStarted; Turn finished alert can fire for a compaction whose row was pulled back; start.ts compactions wiring has no unit test
