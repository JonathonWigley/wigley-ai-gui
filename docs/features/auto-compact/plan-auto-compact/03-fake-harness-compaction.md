# 03 — Fake harness compaction

Status: not started
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Read first: `docs/features/auto-compact/design.md` § Records, and `docs/features/agent-chat/claude-stream.md`
§ Compaction (what the fake imitates).

Files:     modify `src/shared/fake-agent-harness.ts` · test `src/shared/fake-agent-harness.test.ts`

Consumes:
- `export type CompactionTrigger = 'app' | 'manual' | 'harness'` ← 02, in `src/contracts/agent.ts`
- `AgentEvent` members `{ type: 'compactionStarted'; at: number; trigger: CompactionTrigger }` and
  `{ type: 'compactionEnded'; at: number; trigger: CompactionTrigger; outcome: 'done' | 'failed' | 'interrupted';
  beforeTokens: number | null; durationMs: number | null }` ← 02
- `ChatEntry` member `{ kind: 'compaction'; id: string; at: number; trigger: CompactionTrigger;
  beforeTokens: number | null; afterTokens: number | null; durationMs: number | null; raw: unknown[] }` ← 02
- `AgentProcess.compact(): void` — throws after `end`, and while a turn runs ← 02

Produces, all in `src/shared/fake-agent-harness.ts`:
- `export const FAKE_COMPACT_TEXT = 'fake: compact';`
- `export const FAKE_COLD_TEXT = 'fake: cold';`
- `export const FAKE_COMPACTED_CONTEXT_TOKENS = 24_000;` (used by this task's tests only)
- `FakeAgentCall` gains the member `| { method: 'compact' }`
- `FakeAgentHarness` gains `holdCompactions(): void;` and `releaseCompactions(): void;`
- the fake process's `compact(): void`

## Decisions

1. **Three starts, one finish.** Each start opens a compaction with its trigger. All three finish through one path.
   - `process.compact()` → trigger `app`. It makes no user entry, no `userMessage` and no `skillStarted`.
   - A `send` whose `typedSkill(text)?.skill` is `compact` (`/compact`, and `/compact <args>`) → trigger `manual`.
     It keeps its user entry, `userMessage` and `skillStarted` (skill `compact`), as every slash send does now.
   - A `send` of `FAKE_COMPACT_TEXT` → trigger `harness`.
2. **Busy.** A compaction keeps the process's `isTurnOpen` true from its start call until it ends. `compact()`
   pushes `{ method: 'compact' }` to `calls` first, as every method records refused calls. Then it throws in these
   cases:
   - after `end`, `kill` or a `FAKE_END_TEXT` exit (`requireRunning`, message `fake agent process has ended`)
   - while `isTurnOpen` is true (a held turn, a held compaction, or a compaction whose microtask has not run yet),
     message `fake agent is running a turn`
3. **Emission order.** Each start emits in a microtask, as every fake emission does. `n` is a per-process count of
   compactions, from 1. `N` is the send's turn number.
   - `app`: `turnStarted`, `activity working`, `compactionStarted {trigger: 'app'}`.
   - `manual`: the user entry `user-N`, `userMessage`, `skillStarted {skill: 'compact', args: ''}`, `turnStarted`,
     `activity working`, `compactionStarted {trigger: 'manual'}`.
   - `harness`: the user entry `user-N`, `userMessage`, `turnStarted`, `activity working`,
     `compactionStarted {trigger: 'harness'}`.
   Then, when compactions are not held, the **done** finish runs at once in the same microtask:
   1. Set `isTurnOpen` to false.
   2. Emit the entry `{ kind: 'compaction', id: 'compaction-<n>', trigger, beforeTokens, afterTokens: null,
      durationMs, raw: [{ fake: 'compaction' }] }`.
   3. Emit `compactionEnded {trigger, outcome: 'done', beforeTokens, durationMs}`.
   4. For `app` and `manual`: emit `turnEnded`, then `activity idle`. There is no result entry, no `usage` and no
      `planUsage`.
      For `harness`: emit the assistant entry `assistant-N` with the text `fake agent compacted`
      (`streaming: false`, `raw: [{ fake: 'assistant', text: 'fake agent compacted' }]`), then the normal turn end
      of turn `N` (result, usage, plan rows, `turnEnded`, `activity idle`).
   - `beforeTokens` on a done finish is the `contextTokens` of the last main `usage` event this process emitted. It
     is null when the process has emitted none.
   - `durationMs` is `clock.now()` at the finish minus `clock.now()` at `compactionStarted`, on every outcome.
4. **After-size rule.** The fake fills `afterTokens` from the next main `usage` event the process emits, as the
   design says the adapter does.
   - The next `usage` event after a done compaction carries `contextTokens: FAKE_COMPACTED_CONTEXT_TOKENS` (24 000).
     Only that one event: later turns go back to `fakeUsageEvent(turn, at)`.
   - A `FAKE_COLD_TEXT` turn is the exception: its 200 000 wins.
   - Just before that `usage` event (after the result entry), the process emits the compaction entry again, the same
     id, with `afterTokens` set to the event's `contextTokens` and `raw: [{ fake: 'compaction' }, { fake:
     'compaction-after' }]`. The entry stamp keeps its first `at`.
   - Only the newest done compaction waits for its after-size. A newer done compaction replaces an older one that
     still waits. The older one keeps `afterTokens: null`.
   - Every main `usage` event the process emits goes through one process-level step that applies these rules and
     records the last main `contextTokens` (for `beforeTokens`). `emitTurnEnd` takes that event from the process,
     not from `fakeUsageEvent` directly.
5. **`FAKE_COLD_TEXT`** runs the echo turn (`fake agent heard: fake: cold`). Its `usage` event is
   `{ ...fakeUsageEvent(N, at), contextTokens: 200_000, cacheExpiresAt: at }`, so the cache is cold at once.
6. **Hold.** `holdCompactions()` sets a harness-wide flag. A compaction is held when the flag is set at the moment
   it emits `compactionStarted`. A held compaction stops after `compactionStarted` with `isTurnOpen` true. Each
   of these ends it, and only these:
   - `releaseCompactions()` clears the flag. In one microtask, it then runs the done finish of every held compaction
     that is still running, across processes, in start order. With nothing held, it only clears the flag.
   - `interrupt()` → outcome `interrupted` (decision 7).
   - `end()`, `kill()` or a `FAKE_END_TEXT` send → outcome `failed` (decision 8).
   - Any other `send` → the done finish runs first, in the send's microtask, before the send's own emissions
     (`finishSubagents` and the user entry). Claude takes a message sent during a compaction after it.
   A compaction ended any of these ways is dropped from the held list, so a later release does not finish it again.
   The fake sends exactly one `compactionEnded` for each `compactionStarted`.
7. **Interrupt during a compaction.** `interrupt()` keeps its current microtask: running tasks end (`taskFinished`
   failed), then subagents, then the notice, `turnEnded` and `activity idle`. Insert
   `compactionEnded {outcome: 'interrupted', beforeTokens: null, durationMs}` just before the notice. There is no
   compaction entry. The notice id is `notice-compaction-<n>`. This is because an app compaction has no turn number of
   its own, and `notice-<turn>` would replace an earlier turn's notice. A `harness` compaction's turn gets no reply
   and no `usage`.
8. **Process end during a compaction.** The fake emits `compactionEnded {outcome: 'failed', beforeTokens: null,
   durationMs}` just before `sessionEnded`: in `end`'s exit (held by `holdEnd` or not), in `kill`'s exit, and in the
   `FAKE_END_TEXT` exit. If task 02's adapter landed with another outcome for a process end, use the adapter's
   outcome here. Report that as a concern.
9. **Doc comments.** Update the file's header comment (the list of agent events the fake emits), the
   `FakeAgentHarness` comment (hold and release, as it describes `holdEnd`/`releaseEnd`), and a comment over each new
   text constant, in the style of `FAKE_HOLD_TEXT`'s.

## GIVEN / WHEN / THEN

- GIVEN an idle process WHEN `compact()` runs THEN it emits `turnStarted`, `activity working`, `compactionStarted`
  (`app`), the `compaction-1` entry, `compactionEnded` (`done`), `turnEnded` and `activity idle`, and no user entry.
- GIVEN an idle process WHEN `/compact` is sent THEN it emits the user entry and `skillStarted` before a `manual`
  compaction.
- GIVEN an idle process WHEN `FAKE_COMPACT_TEXT` is sent THEN it runs a `harness` compaction, then a reply, then a turn
  end whose `usage` reads 24 000. The compaction entry comes again with `afterTokens: 24000` just before that `usage`.
- GIVEN compactions are held WHEN a compaction starts THEN it emits nothing after `compactionStarted` until a release,
  interrupt, end, kill or send.
- GIVEN a held compaction WHEN `interrupt()` runs THEN `compactionEnded` (`interrupted`) comes before the
  `Interrupted` notice, and no compaction entry comes.
- GIVEN a held compaction WHEN the process ends THEN `compactionEnded` (`failed`) comes before `sessionEnded`.
- GIVEN a process that ended, or a held turn, or a held compaction WHEN `compact()` runs THEN it throws, and `calls`
  ends with `{ method: 'compact' }`.

## Tests

In `src/shared/fake-agent-harness.test.ts`. Extend `timelineLine` so an agent event line also shows its `trigger`
when it has one (`compactionStarted app`, `compactionEnded app done`). No existing event has `trigger`, so no
existing line changes.

- `compaction_$case` — new `it.each`, one row per trigger. Each row starts a process, runs `hi` first (so
  `beforeTokens` is 42000), clears the timeline, runs the start, flushes, and asserts `timeline.map(timelineLine)`:
  - `app` (`agent.compact()`): `turnStarted`, `activity working`, `compactionStarted app`, `compaction compaction-1`,
    `compactionEnded app done`, `turnEnded`, `activity idle`.
  - `manual` (send `/compact`): `user user-2`, `userMessage`, `skillStarted main`, `turnStarted`,
    `activity working`, `compactionStarted manual`, `compaction compaction-1`, `compactionEnded manual done`,
    `turnEnded`, `activity idle`.
  - `harness` (send `FAKE_COMPACT_TEXT`): `user user-2`, `userMessage`, `turnStarted`, `activity working`,
    `compactionStarted harness`, `compaction compaction-1`, `compactionEnded harness done`, `assistant assistant-2`,
    `result result-2`, `compaction compaction-1`, `usage main`, `planUsage`, `turnEnded`, `activity idle`.
  Each row also asserts the first compaction entry with `toEqual`: `{ kind: 'compaction', id: 'compaction-1',
  at: 1000, trigger, beforeTokens: 42000, afterTokens: null, durationMs: 0, raw: [{ fake: 'compaction' }] }`.
- `afterSize_NextMainUsage_FillsTheEntryOnce` — `hi`, `compact()`, `hi`, `hi`. The second `hi` emits the entry
  `compaction-1` with `afterTokens: 24000` and `raw: [{ fake: 'compaction' }, { fake: 'compaction-after' }]`, just
  before `{ ...fakeUsageEvent(2, 1000), contextTokens: 24000 }`. The third `hi` emits no compaction entry, and its
  usage equals `fakeUsageEvent(3, 1000)`.
- `send_ColdText_UsageIsColdAtOnce` — the usage event equals `{ ...fakeUsageEvent(1, 1000), contextTokens: 200000,
  cacheExpiresAt: 1000 }`.
- `heldCompaction_$case` — new `it.each`, the compaction's version of `visualHold_CutShort_ClearsTheTimer`. Each row:
  `hi`, `holdCompactions()`, `compact()`, flush, assert the timeline ends at `compactionStarted app`, clear the
  timeline, run the row's call, flush, and assert the lines:
  - `release` (`harness.releaseCompactions()`): `compaction compaction-1`, `compactionEnded app done`, `turnEnded`,
    `activity idle`.
  - `interrupt`: `compactionEnded app interrupted`, `notice notice-compaction-1`, `turnEnded`, `activity idle`.
  - `end`: `compactionEnded app failed`, `sessionEnded`, `ended`.
  - `kill`: `compactionEnded app failed`, `sessionEnded`, `ended`.
  - `endText` (send `FAKE_END_TEXT`): `user user-2`, `userMessage`, `activity working`, `compactionEnded app failed`,
    `sessionEnded`, `ended`.
  - `heldEnd` (`holdEnd()`, `end()`, flush, `releaseEnd()`): `compactionEnded app failed`, `sessionEnded`, `ended`.
  - `send` (send `hi`): `compaction compaction-1`, `compactionEnded app done`, `turnEnded`, `activity idle`,
    `user user-2`, `userMessage`, `turnStarted`, `activity working`, `assistant assistant-2`,
    `assistant assistant-2`, `result result-2`, `compaction compaction-1`, `usage main`, `planUsage`, `turnEnded`,
    `activity idle`.
  - `interruptThenRelease`: interrupt, flush, then `releaseCompactions()`. The lines are the `interrupt` row's lines
    alone: the release finishes nothing.
- `compact_Refused_ThrowsAndRecords` — new `it.each`, rows `afterEnd`, `heldTurn` (`FAKE_HOLD_TEXT` open),
  `heldCompaction`, `sameTick` (two `compact()` calls before a flush). Each: `expect(() => agent.compact()).toThrow()`
  and `record.calls.at(-1)` equals `{ method: 'compact' }`.

## Done when

`npm test` passes: the tests above and the existing suite, unchanged but for `timelineLine`.

## Commit

One commit for the group: "Fake harness runs compactions: compact(), /compact, fake: compact, fake: cold, hold and
release".

## Cold read fixes

These override any earlier line of this task that they contradict.

- **Compaction state.** Keep one `openCompaction` record (trigger, start time, held flag), separate from
  `isTurnOpen`. `send`, `interrupt`, `end` and `kill` mark it ended synchronously, at call time, and drop it from the
  held list at the same moment. Each emission microtask first checks that its compaction is still the open one and
  emits nothing otherwise. The done finish that a `send` runs never sets `isTurnOpen`: the send's own turn owns it.
  `compact()`'s busy check reads both `isTurnOpen` and `openCompaction`. Reason: one `compactionEnded` per
  `compactionStarted` is the fake's contract with task 05, whatever the call order.
- **Rows added to `heldCompaction_$case`:** `send(FAKE_HOLD_TEXT)` during a held compaction, then `interrupt()` —
  one `compactionEnded done`, then the hold turn's interrupt as today; `compact(); interrupt()` in the same tick —
  exactly one `compactionStarted` and one `compactionEnded interrupted`; `end()` under `holdEnd`, then
  `releaseCompactions()`, then `releaseEnd()` — exactly one `compactionEnded failed`.
- **Notice id.** The interrupt notice id is `notice-compaction-<n>` for every trigger. Add one `interrupt` row for
  `manual` and one for `harness`.
- **Duration and before-size.** One `heldCompaction` row uses a clock that starts at 1000 and advances 3000 before
  the ending call. It asserts the whole `compactionEnded` payload: `durationMs: 3000`, and `beforeTokens: null` for
  the `interrupt`, `end` and release cases.

## Proof

