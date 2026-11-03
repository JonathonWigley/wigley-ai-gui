# 04 — Usage line compacting chip

Status: not started
Type: Task
Wave: 4 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Read first: `docs/features/auto-compact/design.md` (§ Rules, the label table), `DESIGN.md` § Motion and the
**Usage** bullet under § Surfaces, `docs/features/usage/design.md` § The usage plugin (the session line).

Files:
- create `src/shared/format-tokens.ts` · test `src/shared/format-tokens.test.ts` (create)
- modify `src/plugins/usage/page/usage-format.ts` · test `src/plugins/usage/page/usage-format.test.ts`
- modify `src/plugins/usage/contract.ts`
- modify `src/plugins/usage/main/usage-store.ts` · test `src/plugins/usage/main/usage-store.test.ts`
- modify `src/plugins/usage/main/start.ts` · test `src/plugins/usage/main/start.test.ts`
- modify `src/plugins/usage/main/usage-fixture.ts`
- modify `src/plugins/usage/main/selftest-script.ts` · test `src/plugins/usage/main/selftest-script.test.ts`
- modify `src/plugins/usage/page/usage-view-model.ts` · test `src/plugins/usage/page/usage-view-model.test.ts`
- modify `src/plugins/usage/layouts/layout.d.ts`
- modify `src/plugins/usage/layouts/default/layout.js` and `src/plugins/usage/layouts/default/layout.css`
- modify every other file that builds a `SessionUsage` or a `SessionLineInput` literal and fails to compile
  (`drive-actions.test.ts`, `session-line-parts.test.ts`, `session-lines.test.ts` and others the compiler names)

Consumes:
- `export type CompactionTrigger = 'app' | 'manual' | 'harness'` ← 02, in `src/contracts/agent.ts`
- `AgentEvent` members `{ type: 'compactionStarted'; at: number; trigger: CompactionTrigger }` and
  `{ type: 'compactionEnded'; at: number; trigger: CompactionTrigger; outcome: 'done' | 'failed' | 'interrupted';
  beforeTokens: number | null; durationMs: number | null }` ← 02
- `FAKE_COMPACT_TEXT = 'fake: compact'`, `FakeAgentHarness.holdCompactions(): void` and
  `releaseCompactions(): void`, `isFakeAgentHarness` (already in the tree) ← 03, in `src/shared/fake-agent-harness.ts`

Produces:
- `export function formatTokens(tokens: number): string` in `src/shared/format-tokens.ts` — moved from
  `src/plugins/usage/page/usage-format.ts`, its behaviour and comment unchanged. Tasks 06 and 07 consume it.
- `SessionUsage` gains `compaction: { trigger: CompactionTrigger; startedAt: number } | null;` in
  `src/plugins/usage/contract.ts`
- `export function withSessionCompaction(state: UsageState, sessionId: string, profileDir: string | null,
  compaction: SessionUsage['compaction']): UsageState` in `src/plugins/usage/main/usage-store.ts`
- `SessionLineInput` gains `compacting: string | null;` in `src/plugins/usage/layouts/layout.d.ts`

## Decisions

1. **The move.** `formatTokens` leaves `usage-format.ts`. `usage-view-model.ts` and every other usage importer
   imports it from `src/shared/format-tokens.ts`. Do not re-export it from `usage-format.ts`. The `formatTokens_$case`
   rows move to `src/shared/format-tokens.test.ts` unchanged. AGENTS.md § Architecture lets a plugin import only
   `src/contracts`, `src/shared`, its own folder and a dependency's `contract.ts`. Thus chat's page (06) and the
   auto-compact plugin (07) can reach the format only in `src/shared`.
2. **The fold.** In `usage/main/start.ts`, the `chat.agentEvent` listener gets two more arms:
   - `compactionStarted` → `withSessionCompaction(state, sessionId, profileDir, { trigger: event.trigger,
     startedAt: event.at })`
   - `compactionEnded` → `withSessionCompaction(state, sessionId, profileDir, null)`
   The compaction events carry no `agentId`: every one is the main conversation's. Fold each one.
3. **`withSessionCompaction` rules**, in the style of `withSessionUsage`:
   - A known session takes the new `compaction` and the given `profileDir`, and keeps its `usage`. When neither
     changes, it returns the same state object.
   - An unknown session with a non-null `compaction` is appended as `{ sessionId, profileDir, usage: null,
     compaction }`.
   - An unknown session with `compaction: null` returns the same state object.
   - `withSessionUsage` keeps a known session's `compaction`, and appends a new session with `compaction: null`.
   - `withoutSession` (on `sessions.ended`) drops the compaction with the session.
4. **The seed.** Every `usageFixture` variant gives its session `compaction: null`. A compaction event after a seed
   folds onto the seeded session, as a `usage` event does now.
5. **Chip text** (`compacting`), from design.md's label table:

   | `compaction.trigger` | `SessionLineInput.compacting` |
   |---|---|
   | `app` | `compacting · auto` |
   | `manual` | `compacting` |
   | `harness` | `compacting · autocompact` |
   | no compaction | `null` |

   The separator is ` · ` (space, U+00B7, space). `sessionLineInput` sets `compacting` on both the full line and the
   zero line. A session that compacts before its first `usage` event draws the zero line with the chip.
6. **Log text.** `sessionLineText` puts `<compacting>, ` before the existing text when `compacting` is not null:
   `compacting · auto, context 180k/300k, cache 42m, spend $1.23`. Pin this exact text. The self-test waits on it.
7. **Layout contract.** Comment `compacting` in `layout.d.ts`: "the chip naming the trigger while the session
   compacts (`compacting · auto`, `compacting`, `compacting · autocompact`), null otherwise". Add one sentence to the
   `sessionLine` comment on `Layout`: while `compacting` is set, the default layout draws the chip first and pulses
   the meter. No user layout overrides usage (plan.md § Preconditions). The report still names any user usage
   layout found under `~/.config/wigley-ai-gui/layouts/usage/` at run time, as AGENTS.md's setting rule asks.
8. **Default layout.** In `sessionLine`:
   - When `input.compacting` is not null, draw `kit.tag(line, input.compacting, 'accent')` first, before the meter
     (`.ui-tag--accent` is the `accent-tint` look DESIGN.md asks for).
   - Toggle the class `is-compacting` on the line root when `input.compacting` is not null.
   - Update the file's top comment to name the chip.
   - The chip is first, so it is the last item the narrow line drops.
9. **Pulse CSS**, in `usage/layouts/default/layout.css`. Copy the keyframes pattern of
   `src/plugins/sessions/layouts/default/layout.css` (`session-dot-pulse`): opacity 1 → 0.35 → 1.
   - Name the keyframes `usage-meter-pulse`.
   - Apply them to `[data-layout-owner='usage'][data-layout='default'].usage-session-line.is-compacting > .ui-meter`
     with `animation: usage-meter-pulse var(--wg-duration-pulse) ease-in-out infinite`.
   - Add `animation: none` for the same selector under `@media (prefers-reduced-motion: reduce)`.
   - Put a comment over the block: it reports agent state, it uses `duration-pulse`, and it is static under reduced
     motion.
10. **Self-test.** A visible key behaviour gets a self-test step (AGENTS.md § Running and testing). The usage script
    can reach a held compaction: it runs over the fake harness, it can send text into its session's box with keys, and
    main's `services.agentHarnesses` holds the fake.
    - `UsageSelfTestDeps` gains `compactions: { hold(): void; release(): void }`. Main start wires each one to call
      `holdCompactions()` / `releaseCompactions()` on every harness in `services.agentHarnesses` that
      `isFakeAgentHarness` accepts.
    - `open` calls `deps.compactions.hold()` before it launches the session.
    - `problems` calls `deps.compactions.release()` first. The runner calls `problems` after the script's last step
      (`src/main/selftest-runner.ts`, `checkResult` after the groups). This is the same pattern as chat's script in
      task 05, so no later script meets a held compaction.
    - Add a group after `narrow`:
      - name `compacting`
      - why: "A compaction draws the trigger's chip at the start of the session line and drops it when the compaction
        ends."
      - steps, `sendKeys` being `['i', ...text, 'Escape', 'Enter']` as in chat's script:

      | keys | expect | alsoExpect |
      |---|---|---|
      | `['i', ...FAKE_COMPACT_TEXT, 'Escape', 'Enter']` | `[usage] session line in usage-selftest: compacting · autocompact, context 180k/300k, cache 42m, spend $1.23` | `/^\[usage-tab-line\] session line in usage-selftest: compacting · autocompact, context 180k\/300k, cache 42m, spend \$1\.23$/` |
      | `['<C-c>']` | `` `[usage] ${FRESH_LINE}` `` | — |

      The second step proves that the interrupt's `compactionEnded` clears the chip. The held `harness` turn ends with
      no `usage` event, so the seeded line comes back unchanged.
    - Give the first step `screenshot: 'compacting'` and `checksFit: true`, so the chip is checked against the
      minimum width. If the narrow group left the window narrow, set `width: 'start'` on the first step.
    - If the box does not take keys at that point in the script, report it as a concern. Do not remove the group.

## GIVEN / WHEN / THEN

- GIVEN a session with usage WHEN `compactionStarted {trigger: 'app'}` arrives THEN the snapshot's session holds
  `compaction: { trigger: 'app', startedAt: <event at> }` and keeps its usage. The line reads
  `compacting · auto, context …`.
- GIVEN a compacting session WHEN `compactionEnded` arrives THEN `compaction` is null and the chip is gone.
- GIVEN a session with no usage WHEN a compaction starts THEN the zero line carries the chip.
- GIVEN reduced motion WHEN the line compacts THEN the meter does not animate (task 09 checks this live).

## Tests

- `src/shared/format-tokens.test.ts`: `formatTokens_$case`, moved from `usage-format.test.ts` with its rows.
- `usage-store.test.ts`, the `sessionUsage_$case` table: every expected `SessionUsage` gains `compaction: null`. Add a
  `compacting` step helper (`withSessionCompaction`) and these rows:
  - `CompactionStartKeepsUsage` — event s1 FIRST, start `{ trigger: 'app', startedAt: 1_000 }` → `[{ sessionId: 's1',
    profileDir: '~/.claude-work', usage: FIRST, compaction: { trigger: 'app', startedAt: 1_000 } }]`
  - `CompactionEndClears` — event, start, end (null) → `compaction: null`, `usage: FIRST`
  - `UsageDuringCompactionKeepsIt` — start, then event SECOND → `usage: SECOND`, the compaction kept
  - `StartOnUnknownSessionAppends` — start on s9 → `[{ sessionId: 's9', profileDir: '~/.claude-work', usage: null,
    compaction: { trigger: 'harness', startedAt: 1_000 } }]`
  - `EndedDropsCompactingSession` — start, `ended('s1')` → `[]`
- `usage-store.test.ts`: `sessionCompaction_UnchangedOrUnknownEnd_ReturnsSameState` — `it.each` with rows: an end on
  an unknown session, and an end on a session with no compaction. Each returns the same state object (`toBe`).
- `usage-view-model.test.ts`: `sessionLineInput_Compacting_$case` — new `it.each` over the label table: `app` →
  `'compacting · auto'`, `manual` → `'compacting'`, `harness` → `'compacting · autocompact'`, none → `null`. The
  existing zero-line test gets `compacting: null` in its expected value. Add the row
  `sessionLineInput_NoUsage_ZeroLine_Compacting`: a session with `usage: null` and an `app` compaction →
  `{ context: { label: 'Context', text: '0k', percent: 0, tone: 'normal' }, cache: null, spend: null,
  compacting: 'compacting · auto' }`.
- `usage-view-model.test.ts`, the `sessionLineText` table (`it.each<{ case; input; expected }>` under `log text`):
  add the row `Compacting` → `'compacting · auto, context 180k/300k, cache 42m, spend $1.23'`. Existing rows get
  `compacting: null`.
- `start.test.ts`, `usageMainPart_EventsAndPolls_SendSnapshots` or a new
  `usageMainPart_CompactionEvents_FoldIntoTheSession`: emit `chat.agentEvent` with `compactionStarted` (harness, at
  2_000), and assert the last sent snapshot's session has `compaction: { trigger: 'harness', startedAt: 2_000 }`.
  Then emit `compactionEnded`, and assert `compaction: null`.
- `selftest-script.test.ts`: assert that `open` calls `compactions.hold` once before `chat.launch`, and that
  `problems` calls `compactions.release`. Follow the file's existing test pattern. Add rows where a table owns the
  call order.

## Done when

`npm test` passes. `npm run selftest -- --plugin usage` passes with the new `compacting` group. The
`.selftest/screenshots/usage-compacting.png` capture is read against DESIGN.md's Usage bullet: the chip first, in
accent tint. Task 09 checks the live pulse and reduced motion.

## Commit

One commit for the group: "Usage line shows a compacting chip and pulses its meter; formatTokens moves to
src/shared".

## Cold read fixes

These override any earlier line of this task that they contradict.

- **The layout's chip is tested.** Create `src/plugins/usage/layouts/default/layout.test.ts` in the shape of
  `src/plugins/chat/layouts/default/layout.test.ts` (a fake kit, the default layout module, its `sessionLine` part).
  `sessionLine_Compacting_DrawsChipFirst`: a session line input with `compacting: 'compacting · auto'` draws a root
  with class `is-compacting` whose first child is the `kit.tag` element with text `compacting · auto`; with
  `compacting: null` the root has no `is-compacting` class and no tag. The pulse itself stays a task 09 check.
- **Comments that go untrue.** In the same edit, rewrite: the `sessionLine` comment in `layout.d.ts` (it says the
  line is drawn only while the session has usage; the host draws a zero line too, as `contract.ts` and
  `session-lines.ts` say), the `sessionLineText` doc comment (its example log text gains the chip), the
  `sessionLineInput` comment, the `SessionUsage` comment in `contract.ts`, the `layout.js` header, the `usage-store.ts`
  header, and the `start.ts` comment that lists `chat.agentEvent (the main agent's usage)`.
- **The self-test hold.** The `compacting` group's `open` also calls `release()` in its promise's catch. A run that
  skips the result step leaves the hold set for the rest of that self-test process; that is harmless, since no
  later script sends `FAKE_COMPACT_TEXT`. Record that in the step's comment.

## Proof

