# 06 — Chat page: dock, held row, divider

Status: not started
Type: Task
Wave: 5 · Depends on: 04, 05
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/chat/layouts/layout.d.ts`
- modify `src/plugins/chat/layouts/default/layout.js`
- modify `src/plugins/chat/layouts/default/layout.css`
- modify `src/plugins/chat/page/working-turn.ts`
- modify `src/plugins/chat/page/activity-dock.ts`
- modify `src/plugins/chat/page/composer-kit.ts`
- modify `src/plugins/chat/page/composer-input.ts`
- modify `src/plugins/chat/page/chat-view.ts`
- modify `src/plugins/chat/page/entry-list.ts`
- modify `src/plugins/chat/page/read-chat-layout.ts`
- modify `src/plugins/chat/page/chat-kit.ts`
- modify `src/plugins/chat/main/preview/preview-session.ts`
- modify `src/plugins/chat/main/selftest-script.ts` (one step, after task 05's hold step)
- test `src/plugins/chat/layouts/default/layout.test.ts`
- test `src/plugins/chat/page/working-turn.test.ts`
- test `src/plugins/chat/page/activity-dock.test.ts`
- test `src/plugins/chat/page/composer-input.test.ts`
- test `src/plugins/chat/page/entry-list.test.ts`
- test `src/plugins/chat/main/preview/chat-preview.test.ts`

Before you start, run `git status` and check for a peer's edits in these files (plan.md § Preconditions).

## Consumes

- ← 04, in `src/shared/format-tokens.ts`: `export function formatTokens(tokens: number): string`.
- ← 02, in `src/contracts/agent.ts`: `CompactionTrigger = 'app' | 'manual' | 'harness'`, and the `ChatEntry` member
  `{ kind: 'compaction'; id: string; at: number; trigger: CompactionTrigger; beforeTokens: number | null;
  afterTokens: number | null; durationMs: number | null; raw: unknown[] }`. The adapter emits the same entry `id`
  again when `afterTokens` becomes known.
- ← 05, in `src/plugins/chat/contract.ts`:
  - `SessionCompaction { trigger: CompactionTrigger; reason: string | null; startedAt: number }`. `reason` is the
    gate's reason for trigger `app`, else null.
  - `ChatSessionState.compaction: SessionCompaction | null`.
  - `QueuedMessage.holdReason: string | null`.
  - The `ChatChannel` message `'compaction': { sessionId: string; compaction: SessionCompaction | null }`.
  - `compaction: null` in the layout preview's `ChatSessionState` (`src/plugins/chat/main/preview/chat-preview.ts`),
    since the field is required.
  - The `chat.interrupt` page command reaches a held row and an app compaction while activity reads `idle`
    (`chat-commands.ts`, task 05).

## Produces

- `src/plugins/chat/layouts/layout.d.ts` (the user layout contract):
  - `export type CompactionTrigger = 'app' | 'manual' | 'harness';` declared in this file. The contract file may
    import only the kit (`layout-contracts.test.ts`), so it does not import `src/contracts/agent.ts`.
    `read-chat-layout.ts`'s `VariantFitsInput` check proves the two types fit.
  - `EntryKind` gains `'compaction'`.
  - `export interface CompactionInput { kind: 'compaction'; id: string; at: number; trigger: CompactionTrigger;
    beforeTokens: number | null; afterTokens: number | null; durationMs: number | null; raw: unknown[] }`.
    `kind`, `id` and `raw` follow every other entry input; the other fields are the plan's.
  - `EntryInputs.compaction: CompactionInput`.
  - `WorkingState` gains `'compacting'`.
  - `LiveWorkingInput.compaction: string | null` — the dock's trigger label while `state` is `'compacting'`, else null.
  - `QueuedMessageInput.holdReason: string | null` and `QueuedMessageInput.skipKey: string`.
  - `ChatKit.tokens(count: number): string` — `count` tokens as the usage line reads them (`842`, `182k`, `1.3M`,
    `0k` for none). Appends nothing.
- `src/plugins/chat/page/working-turn.ts`:
  - `export function workingInput(entries: readonly ChatEntry[], now: number, compaction: SessionCompaction | null): LiveWorkingInput`
  - `export function compactionLabel(compaction: SessionCompaction): string`
- `src/plugins/chat/page/activity-dock.ts`: `ActivityDock.set(entries: readonly ChatEntry[], working: boolean, compaction: SessionCompaction | null): void`
- `src/plugins/chat/page/composer-kit.ts`: `setTurn(entries: readonly ChatEntry[], working: boolean, compaction: SessionCompaction | null): void`
- `src/plugins/chat/page/composer-input.ts`: `composerInputOf`'s `state` pick gains `'compaction'`.
- Page log lines (`log('chat', …)`), for self-test steps to wait on:
  - `<tab name> compacting: <label>` when a `compaction` message sets a compaction.
  - `<tab name> compaction ended` when a `compaction` message clears it.
- The default layout: the `compaction` entry builder, the `compacting` dock state, the held row label.
- A `compaction` sample entry in the layout preview.

## Decisions

The dock:
- The `compaction` value flows: `channel.on('compaction')` in `chat-view.ts` → `tab.state.compaction` →
  `drawTurn(tab)` → `composer.setTurn(entries, isTurnUnderway(state), state.compaction)` → `dock.set(…)` →
  `workingInput(entries, now, compaction)`. The handler also calls `drawStatusLine(tab)` and writes the log line.
  It uses `heldFor('compaction', sessionId)` as the other handlers do. `createTab`'s first `drawTurn` reads the
  compaction from the session's state, so a page reload during a compaction shows the dock.
- While `compaction` is not null, `workingInput` returns `state: 'compacting'`. This state comes before every state
  that `turnState` derives from the entries.
- While compacting: `compaction` is `compactionLabel(compaction)`; `startedAt` is `compaction.startedAt`; `steps` are
  the turn's dock steps, as for every live input. While not compacting, `compaction` is null and the rest is as now.
- `compactionLabel` reads the label table in `design.md`: `app` → `compaction.reason`, or `auto` when the reason is
  null; `manual` → `/compact`; `harness` → `autocompact`.
- `ActivityDock.set` shows a live dock while `compaction` is not null, whatever `working` reads. An app compaction
  starts while the session's activity reads `idle`, before the held send, and the dock must show it. This path arms
  the tick, as `setWorking` does.
- The hold of a live dock over an empty turn (`isHeld` in `setWorking`) applies only when the shown input's
  `compaction` is null and the new `compaction` is null. Otherwise a compaction that starts or ends during an
  empty turn does not show.
- `isLiveChanged` also compares `compaction`.
- When the compaction clears, `set` takes the path that `working` selects, as now.
- `ComposerInput.working` reads `running && (activity !== 'idle' || compaction !== null)`. The status line's running
  indicator then shows the interrupt keys during an app compaction, which the held row names. Change the field's
  comment in `layout.d.ts` to match.
- The session row's activity (`drawActivity`) does not change. The usage line's chip (task 04) shows the compaction
  on the session's pane.

The default layout's dock:
- `WORKING_STATE_WORDS.compacting = 'Compacting…'`.
- A compacting dock draws the head (`span.chat-working-time`, `span.chat-working-state`, then
  `span.chat-working-trigger` holding `input.compaction`), then one empty `div.chat-working-bar`. It draws no tool
  box and no tool counts, also when the steps hold tools. A live input whose `compaction` is null draws no trigger
  span.
- CSS, per DESIGN.md § Chat and § Motion: `.chat-working-trigger` in `fg-secondary`. `.chat-working-bar` is a thin
  track (`height: var(--wg-indicator-width)`, `overflow: hidden`, `position: relative`). Its `::after` is a segment
  in `status-running` that slides across the track in a loop: one cycle is `var(--wg-duration-pulse)`,
  `ease-in-out`, `infinite`. Under `@media (prefers-reduced-motion: reduce)` the segment has no animation and fills
  the whole track. Copy the keyframes pattern of `src/plugins/sessions/layouts/default/layout.css`
  (`session-dot-pulse`). Use only tokens and percentages: `npm run lint` fails on a raw length or duration.

The held row:
- `entry-list.ts`'s `queuedInput(message, skipKey)` sets `holdReason: message.holdReason` and
  `skipKey: deps.kit.keys.keysFor(chatCommand('interrupt'), chatScope('chat')) ?? ''`. `keysFor` returns the keys
  formatted for the platform (`⌃C` on macOS for `<C-c>`).
- `isQueuedChanged` also compares `holdReason` and `skipKey`.
- The list reads `skipKey` at each `setQueued`. It adds no keymap listener: a held row lasts one compaction, and
  the next `queued` message draws it again.
- The default `queuedLabel`, the first that applies:
  1. sent → `sending`
  2. `holdReason` not null and `skipKey` not empty → `sends after compaction · <skipKey> skips`
  3. `holdReason` not null and `skipKey` empty → `sends after compaction`
  4. else → `pending`
  Then the image count, as now: `· 1 image`, `· 2 images`. The row does not draw the reason text: the dock shows it.

The divider:
- `compaction` is a transcript entry, not a step. `isStep` (`activity-runs.ts`) does not change, so the entry gets
  a slot when `activityInTranscript` is false, the entry cursor stops on it, and it splits a run of steps into two
  activity lines. `working-turn.ts` needs no other change for it: it is not a step, a user entry or a result.
- The page's exhaustive sets over entry kinds: `KIND_SET` in `read-chat-layout.ts` (add `compaction: true`) and
  `CompleteChatLayout.entries` (the default builder). `entry-list.ts` draws every kind through `pickEntry` and its
  `update`; it needs no kind branch. A grep for `satisfies never` and `Record<ChatEntryKind` in `src/plugins/chat/page`
  found no other set.
- The default `compaction` builder draws one `div` with class `chat-entry chat-compaction`. Its `textContent` is the
  line. Its `update` sets the new line on the same element, so the adapter's re-emit with `afterTokens` fills the
  line in place.
- The line, joined with ` · `:
  1. `Compacted`, then ` <kit.tokens(beforeTokens)>` when `beforeTokens` is not null, then
     ` → <kit.tokens(afterTokens)>` when `afterTokens` is not null.
  2. The trigger word: `app` → `auto`, `manual` → `manual`, `harness` → `autocompact`.
  3. `kit.duration(durationMs)` when `durationMs` is not null; no part when null.
  The trigger and duration parts show also while `afterTokens` is null: `Compacted 182k · auto · 9s`.
- CSS, per DESIGN.md § Chat: `.chat-compaction` is a flex row, `align-items: center`, `gap: var(--wg-space-2)`,
  `color: var(--wg-fg-tertiary)`, `font-size: var(--wg-text-12)`, tabular numerals. `.chat-compaction::before` and
  `::after` are `content: ''`, `flex: 1`, `border-top: 1px solid var(--wg-border-default)`.
- `ChatKit.tokens` lands on `ChatKit`, not `BaseKit`: only an entry builder needs it, and `BaseKit` is shared by
  every owner. `chat-kit.ts`'s `createEntryKit` sets `tokens: (count) => formatTokens(count)`.
- `chat-kit.ts` imports `formatTokens` from `src/shared/format-tokens.ts` (task 04 moved it there). Chat's page may
  not import the usage plugin, since usage depends on chat.

The self-test:
- Add one step to `src/plugins/chat/main/selftest-script.ts`, after task 05's hold step and in the same session:
  while the fake holds the compaction, wait on the page log line `<name> compacting: auto · cache cold · <tokens>`
  (the tokens as task 05's step makes them); after the release, wait on `<name> compaction ended`. Use the step
  shape and the log-wait helper the script already uses.

The layout preview:
- `previewEntries()` gains one `compaction` entry after the `raw` entry:
  `{ kind: 'compaction', trigger: 'app', beforeTokens: 182000, afterTokens: 24000, durationMs: 9000,
  raw: [{ preview: 'compaction' }] }`. Its `id` and `at` take the next place in the sequence; shift the `id`s and
  `at`s of the entries after it by one place. Update the "One entry of every kind" comment if it names the kinds.
- The preview gets no held row and no compacting dock: its `queued` stays empty, as now.

## Behaviour

- GIVEN a session at idle with a finished turn WHEN a `compaction` message sets `{ trigger: 'app', reason: 'auto ·
  cache cold · 182k', startedAt }` THEN the dock reads `0:00 Compacting… auto · cache cold · 182k` over the bar,
  ticks each second from `startedAt`, and the log reads `<name> compacting: auto · cache cold · 182k`.
- GIVEN a compacting dock WHEN the `compaction` message clears it while the session is idle THEN the dock shows the
  finished turn's line, or hides when no result follows the user's last message.
- GIVEN a live turn with tool calls WHEN a harness compaction starts THEN the dock reads `Compacting… autocompact`
  with no tool box, and its time counts from the compaction's start.
- GIVEN a held row and `<C-c>` bound to `chat.interrupt` WHEN the row draws THEN its label reads
  `sends after compaction · ⌃C skips` on macOS.
- GIVEN a compaction entry with `afterTokens` null WHEN the entry with the same id arrives with `afterTokens: 24000`
  THEN the same divider element reads `Compacted 182k → 24k · auto · 9s`.
- GIVEN the default layout with `activityInTranscript` false WHEN a compaction entry arrives THEN it shows in the
  transcript and the entry cursor stops on it.

## Tests

Add rows to the existing tests. Update each existing helper and literal input for the new required fields
(`compaction: null` on live inputs, `holdReason: null` and `skipKey: '⌃C'` on queued inputs, the third `set` and
`workingInput` argument as `null`).

- `working-turn.test.ts` — a new `it.each` in `describe('workingInput')`,
  `workingInput_Compaction ($given → $state, $label)`. Entries `user:u@100`, `tool!:t@110`; `now` 900. Assert
  `state`, `compaction` and `startedAt`:
  | given | compaction | state | label | startedAt |
  |---|---|---|---|---|
  | app | `{ trigger: 'app', reason: 'auto · cache cold · 182k', startedAt: 700 }` | `compacting` | `auto · cache cold · 182k` | 700 |
  | app, no reason | `{ trigger: 'app', reason: null, startedAt: 700 }` | `compacting` | `auto` | 700 |
  | manual | `{ trigger: 'manual', reason: null, startedAt: 700 }` | `compacting` | `/compact` | 700 |
  | harness | `{ trigger: 'harness', reason: null, startedAt: 700 }` | `compacting` | `autocompact` | 700 |
  | none | `null` | `working` | `null` | 100 |
- `activity-dock.test.ts` — `SetCall` gains a third element, `compaction`. Rows added to the `activity dock`
  `it.each` (`app` = `{ trigger: 'app', reason: 'auto · cache cold · 182k', startedAt: 700 }`; a compacting live
  input is `{ state: 'compacting', steps, startedAt: 700, now: NOW, compaction: 'auto · cache cold · 182k' }`):
  | case | calls | sent |
  |---|---|---|
  | compacting while idle after a done turn | `[[u, finished, r900], false, app]` | compacting, steps `[]` |
  | compaction ends while idle | that call, then `[[u, finished, r900], false, null]` | compacting, then `done([finished], 100, 900, 0.25)` |
  | compaction starts during an empty live turn | `[[u, finished, r900], true, null]`, then `[[u, finished, r900], true, app]` | `live('thinking', [], NOW)`, then compacting, steps `[]` |
  | compaction ends during an empty live turn | `[[u, finished, r900], true, app]`, then `[[u, finished, r900], true, null]` | compacting, then `live('thinking', [], NOW)` |
  | the same compaction again | `[[u, running], true, app]` twice | compacting with steps `[running]`, once |
  Add `dock_Tick_CompactingWhileIdle_SendsNowEachSecond`: `set([u, finished, r900], false, app)`, then `fireAll`
  with the clock at `NOW + 1000`; the second sent input is the compacting input with `now: NOW + 1000`.
- `composer-input.test.ts` — rows added to `composerInputOf`'s `it.each`, which gains `compaction`:
  `running: true, activity: 'idle', compaction: app → working: true`;
  `running: false, activity: 'idle', compaction: app → working: false`. Existing rows take `compaction: null`.
- `entry-list.test.ts` — `pending_HeldRow_PartGetsHoldReasonAndSkipKey`. Change `setUpList`'s fake `keysFor` to
  return `'⌃C'` for `chat.interrupt` and null for every other command. A user `queuedMessage` part records each
  draw and update. `setQueued([{ ...queued('q1'), holdReason: 'auto · cache cold · 182k' }])`, then
  `setQueued([{ ...queued('q1'), holdReason: null }])`. Expect
  `[{ how: 'draw', holdReason: 'auto · cache cold · 182k', skipKey: '⌃C' }, { how: 'update', holdReason: null, skipKey: '⌃C' }]`.
- `layout.test.ts`:
  - `fakeKit` gains `tokens: (count) => \`${Math.round(count / 1000)}k\``.
  - `compaction_lineFormats ($line)`, an `it.each` asserting the root's `textContent` and its class
    `chat-entry chat-compaction`:
    | trigger | beforeTokens | afterTokens | durationMs | line |
    |---|---|---|---|---|
    | `app` | 182000 | 24000 | 9000 | `Compacted 182k → 24k · auto · 9s` |
    | `manual` | 182000 | null | 9000 | `Compacted 182k · manual · 9s` |
    | `harness` | 182000 | 24000 | null | `Compacted 182k → 24k · autocompact` |
    | `app` | null | null | null | `Compacted · auto` |
  - `compaction_update_FillsTheAfterSizeInPlace`: draw `app`, 182000, null, 9000; update with `afterTokens: 24000`;
    the element is the same and reads `Compacted 182k → 24k · auto · 9s`.
  - Rows added to `working_draws`:
    - `CompactingWithATool`: `{ state: 'compacting', steps: [toolStep('Read', 'a.ts')], startedAt: 0, now: 6000,
      compaction: 'auto · cache cold · 182k' }` → `['chat-working', 'span.chat-working-time:0:06
      span.chat-working-state:Compacting… span.chat-working-trigger:auto · cache cold · 182k',
      'div.chat-working-bar:']`.
    - `CompactingManual`: same, steps `[]`, `compaction: '/compact'` → the head ends
      `span.chat-working-trigger:/compact`, then `'div.chat-working-bar:'`.
  - Rows added to `queuedMessage_Default_Label` (each with `skipKey` and `holdReason`):
    | imageCount | sent | holdReason | skipKey | label |
    |---|---|---|---|---|
    | 0 | false | `auto · cache cold · 182k` | `⌃C` | `sends after compaction · ⌃C skips` |
    | 1 | false | `auto · cache cold · 182k` | `⌃C` | `sends after compaction · ⌃C skips · 1 image` |
    | 0 | false | `auto · cache cold · 182k` | `` (empty) | `sends after compaction` |
    | 0 | true | `auto · cache cold · 182k` | `⌃C` | `sending` |
- `chat-preview.test.ts` — the kind set in the open test gains `'compaction'`.
- `src/shared/layouts/layout-contracts.test.ts` — no new row. Its `every owner contract type-checks beside kit.d.ts`
  test checks the changed `layout.d.ts`; it must pass.
- The dock's word and the divider's line are copy. The rows above assert them because `layout.test.ts` already pins
  every line the default layout assembles. Add no other copy assertion.

## Done when

- `npm run typecheck` passes: every `LiveWorkingInput`, `QueuedMessageInput` and `CompleteChatLayout` literal
  carries the new fields.
- `npm run lint` passes (layers and styles).
- The test gate runs the tests above.
- Visual checks defer to task 09 "Final verification".

Commit: one commit for the group, naming the dock's `Compacting…` state, the held row label, the divider entry, the
`ChatKit.tokens` helper and the self-test step.

## Cold read fixes

These override any earlier line of this task that they contradict.

- **Self-test strings.** Task 05's fixture gate answers `selftest · cache cold`. Expect
  `[chat] chat-selftest compacting: selftest · cache cold` in a step after 05's `behind hold` step and before its
  `<C-c>` step, and `[chat] chat-selftest compaction ended` as an `alsoExpect` on the `<C-c>` step: the interrupt ends
  the compaction. No mid-script release exists.
- **The release moment.** A brief done-line or hidden-dock frame between the `compaction: null` message and the next
  `activity` message is accepted; the Behaviour rows stand as written. Reason: holding `Compacting…` until the next
  `activity` adds a second state rule for one frame.

## Proof

