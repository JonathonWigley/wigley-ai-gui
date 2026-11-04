# 07 — Auto-compact plugin

Status: in progress
Type: Task
Wave: 5 · Depends on: 04, 05
Plan: [plan.md](plan.md)

Read first: `docs/features/auto-compact/design.md` (§ Rules, § Decisions), and AGENTS.md § Architecture: the plugin,
registration, plugin talk, setting and send gate bullets.

Files:
- create `src/plugins/auto-compact/manifest.ts`
- create `src/plugins/auto-compact/main/send-gate.ts` · test `src/plugins/auto-compact/main/send-gate.test.ts`
- create `src/plugins/auto-compact/main/start.ts` · test `src/plugins/auto-compact/main/start.test.ts`
- modify `src/plugins/manifests.ts`, `src/plugins/main.ts`

Consumes:
- `export function formatTokens(tokens: number): string` ← 04, in `src/shared/format-tokens.ts`
- In `src/plugins/chat/contract.ts` ← 05:
  - `export interface SendGateInput { sessionId: string; hostSessionId: string; profileDir: string; text: string; now: number }`
  - `export interface SendGateVerdict { action: 'compact'; reason: string }`
  - `export type SendGate = (input: SendGateInput) => SendGateVerdict | null;`
  - `ChatMainExports.addSendGate(gate: SendGate): () => void`
- Already in the tree: `ChatAgentEvent { sessionId; profileDir; hostSessionId; event }` and
  `ChatMainEvents.agentEvent` (`src/plugins/chat/contract.ts`), and `MAIN_AGENT_ID`, `AgentEvent` and
  `UsageAgentEvent` (`src/contracts/agent.ts`)

Produces:
- `export const autoCompactManifest` in `src/plugins/auto-compact/manifest.ts` — id `auto-compact`,
  `dependsOn: ['chat']`, `settings: { minTokens: 150000 }`
- In `src/plugins/auto-compact/main/send-gate.ts`:
  - `export type LatestUsage = ReadonlyMap<string, UsageAgentEvent>;` — keyed by host session id
  - `export function withAgentEvent(latest: LatestUsage, hostSessionId: string, event: AgentEvent): LatestUsage`
  - `export function sendGateVerdict(usage: UsageAgentEvent | null, minTokens: number, now: number):
    SendGateVerdict | null`
- `export const autoCompactMainPart: MainPart<typeof autoCompactManifest>` in
  `src/plugins/auto-compact/main/start.ts`

## Decisions

1. **The setting key.** Plugin settings live in `settings.json` under the plugin id (`mergeUserSettings`,
   `src/main/config/user-settings.ts`: "each plugin's under its id"). The key the user writes is therefore
   `"auto-compact": { "minTokens": … }`, and its dotted path is `auto-compact.minTokens`, not
   `autoCompact.minTokens`. Keep the id `auto-compact`: plugin ids are lowercase letters, digits and `-`
   (`definePlugin`). Task 08 corrects the docs that say `autoCompact.minTokens`.
2. **No null.** The setting is `minTokens: 150000`, typed `number`. **0 turns auto-compact off.** The config cannot
   take null for a setting with a non-null default:
   - `mergeSetting` (`src/main/config/user-settings.ts`) accepts null only when the default is null. Otherwise it
     throws `"<path>" must be number, not null.`
   - `pluginOptionalSettings` (`src/shared/plugin-manifests.ts`) throws on an `optionalSettings` kind for a setting
     whose default is a value.
   - `definePlugin`'s `NullKindsDeclared` requires that kind as soon as the type admits null.
   The other way to turn it off is `plugins.disabled`. plan.md's `number | null` and design.md's "0 or null" need
   the change the run log records (task 08 fixes design.md).
3. **Manifest.** Follow `usage-tab-line/manifest.ts` and `usage/manifest.ts`:
   - `commands: {}`, `scopes: {}`, `themeTokens: {}`.
   - Above the manifest, a comment saying what the plugin does: it holds a send to an idle session whose cache is
     cold and whose context is above `minTokens`, and compacts first, through chat's send gate. It is main only and
     has no surface or layout.
   - `settingInfo.minTokens`:
     - label `Auto-compact threshold`
     - description `Compact a session before a message when its prompt cache is cold and its context is above this many tokens; 0 turns it off.`
4. **Main only.** The plugin has no page part and no layout: it draws nothing. Every surface is chat's or usage's.
   Precedent: `usage-tab-line` is a page-only plugin with no main part. Add `autoCompactManifest` to
   `builtInManifests` after `chatManifest`. Add `autoCompactMainPart` to `mainParts` after `chatMainPart`. Do not
   touch `src/plugins/page.ts`.
5. **The fold** (`withAgentEvent`). It is pure. It returns the same map object when the event changes nothing, else
   a new map.
   - `usage` with `agentId === MAIN_AGENT_ID`: it replaces the host session's event unless that event's `at` is
     newer. An equal `at` replaces, as in `withSessionUsage` in `usage-store.ts`.
   - `usage` of a subagent: no change.
   - `sessionEnded`: drops the host session. Chat sends a restored or resumed row's saved usage again as a
     `chat.agentEvent` (contract comment on `ChatMainEvents`), so a later process refills it.
   - Every other event: no change.
   - The key is `hostSessionId`, not `sessionId`. Chat's `clear` keeps the row's `sessionId` but starts a new host
     session. A fold keyed by `sessionId` would hold the first send after a clear on the old conversation's cold
     usage.
6. **The verdict** (`sendGateVerdict`) follows design.md § Rules. Chat asks gates only for an idle session (task 05),
   so the idle rule is not checked here. It returns null when one of these is true:
   - `minTokens` is 0
   - `usage` is null
   - `usage.cacheExpiresAt` is null
   - `usage.cacheExpiresAt > now` (the cache is warm; at `now` exactly it is cold)
   - `usage.contextTokens <= minTokens` ("above" is strictly greater)
   Otherwise it returns `{ action: 'compact', reason: \`auto · cache cold · ${formatTokens(usage.contextTokens)}\` }`.
   The separator is ` · ` (space, U+00B7, space).
7. **No clock.** `SendGateInput.now` comes from chat with each ask, so the gate reads `input.now`. The plugin takes
   no clock from `services`.
8. **Wiring** (`start.ts`):
   - `type AutoCompactApi = MainApi<typeof autoCompactManifest, ChannelShape, Record<never, never>,
     QualifiedEvents<'chat', ChatMainEvents>>`
   - `let latest: LatestUsage = new Map()`
   - `api.events.on('chat.agentEvent', ({ hostSessionId, event }) => { latest = withAgentEvent(latest,
     hostSessionId, event) })`
   - `const removeGate = api.dependency<ChatMainExports>('chat').addSendGate((input) =>
     sendGateVerdict(latest.get(input.hostSessionId) ?? null, api.settings().minTokens, input.now))`
   - It reads the setting at each ask, so a `settings.json` change applies at the next send (hot reload).
   - It returns `{ commands: {}, dispose: removeGate }`. The event listener is an `api` registration, which the host
     disposes. The gate's dispose function is chat's own, which `api` cannot see.
   - It hands the self-test no script (decision 9).
9. **Self-test and drive.** The plugin adds no self-test script and no drive action. Its visible effect (the held
   row, the dock, the chip) is chat's and usage's, and task 05's chat script proves the hold through a fixture gate.
   The table test below proves the verdict, and the wiring test proves the registration. Task 09's drive run sends
   `fake: cold`, then a message, with this plugin on, and checks the held row reads its reason.

## GIVEN / WHEN / THEN

- GIVEN the last main usage of host session h1 is 182 400 tokens with its cache expired WHEN chat asks the gate for
  h1 THEN the gate returns `{ action: 'compact', reason: 'auto · cache cold · 182k' }`.
- GIVEN `minTokens` is 0 WHEN chat asks THEN the gate returns null.
- GIVEN a row was cleared (new host id) WHEN chat asks for the new host id THEN the gate returns null.
- GIVEN the plugin stops WHEN its dispose runs THEN the gate is removed from chat.

## Tests

- `send-gate.test.ts`: `sendGate_$case` — one `it.each`. Each row folds its `events` (each a pair of host session id
  and `AgentEvent`) through `withAgentEvent` from an empty map. Then it asserts
  `sendGateVerdict(latest.get(row.ask) ?? null, row.minTokens, NOW)` equals `row.expected`, with literal values.
  Use `NOW = 1_000_000`, `cold(tokens, at = 900_000)` = a main usage with `cacheExpiresAt: 999_000`, `warm` with
  `cacheExpiresAt: 1_001_000`, `minTokens: 150000` unless the row says otherwise, and ask `h1` unless it says
  otherwise.

  | case | events | minTokens | ask | expected |
  |---|---|---|---|---|
  | `ColdAbove` | h1 cold 182_400 | 150000 | h1 | `{ action: 'compact', reason: 'auto · cache cold · 182k' }` |
  | `ColdAtNow` | h1 cold 200_000 with `cacheExpiresAt: 1_000_000` | 150000 | h1 | `{ action: 'compact', reason: 'auto · cache cold · 200k' }` |
  | `Warm` | h1 warm 182_400 | 150000 | h1 | `null` |
  | `ColdBelow` | h1 cold 120_000 | 150000 | h1 | `null` |
  | `ColdAtThreshold` | h1 cold 150_000 | 150000 | h1 | `null` |
  | `NullExpiry` | h1 main usage 182_400, `cacheExpiresAt: null` | 150000 | h1 | `null` |
  | `NoUsage` | none | 150000 | h1 | `null` |
  | `MinTokensZero` | h1 cold 182_400 | 0 | h1 | `null` |
  | `SubagentUsageIgnored` | h1 cold 182_400; then h1 subagent (`agentId: 'fake-agent-1-1'`) usage 10_000 at 950_000, warm | 150000 | h1 | `{ action: 'compact', reason: 'auto · cache cold · 182k' }` |
  | `OlderEventIgnored` | h1 cold 182_400 at 900_000; then h1 warm 50_000 at 800_000 | 150000 | h1 | `{ action: 'compact', reason: 'auto · cache cold · 182k' }` |
  | `NewerEventReplaces` | h1 cold 182_400 at 900_000; then h1 cold 40_000 at 950_000 | 150000 | h1 | `null` |
  | `SessionEndedDrops` | h1 cold 182_400; then h1 `sessionEnded` | 150000 | h1 | `null` |
  | `AfterClearNewHostId` | h1 cold 182_400 | 150000 | h2 | `null` |

- `send-gate.test.ts`: `withAgentEvent_NoChange_ReturnsSameMap` — `it.each` with rows: a subagent usage, an older
  main usage, `turnEnded`, and `sessionEnded` for an unknown host id. Each returns the same map object (`toBe`).
- `start.test.ts`: `autoCompactMainPart_RegistersGateReadsSettingPerAskAndRemovesOnDispose`. Build a fake `api` as
  `usage/main/start.test.ts` does: `events.on` records listeners; `dependency('chat')` returns `{ addSendGate }`,
  which records the gate and returns a remover spy; `settings` reads a mutable `{ minTokens }`. Then:
  1. Emit `chat.agentEvent` `{ sessionId: 's1', profileDir: '~/.claude-work', hostSessionId: 'h1', event: <main
     usage 182_400, cacheExpiresAt 999_000> }`.
  2. The gate on `{ sessionId: 's1', hostSessionId: 'h1', profileDir: '~/.claude-work', now: 1_000_000 }` equals
     `{ action: 'compact', reason: 'auto · cache cold · 182k' }`.
  3. Set `minTokens` to 0. The same ask returns null.
  4. Call `dispose()`. The remover spy was called once.
  `addSendGate` was called exactly once, at start.

## Done when

`npm test` passes, the type check included (`definePlugin` checks the manifest's `settingInfo`). The app starts with
the plugin listed: `npm run selftest -- --plugin chat` passes, and its start throws no "part whose manifest is
missing" error.

## Commit

One commit for the group: "Add the auto-compact plugin: a send gate that compacts a cold, large session before the
next message".

## Addendum (round 3): one threshold for Claude's idle compaction

Consumes:  `ChatMainExports.addIdleCompactThreshold(read: () => number | null): () => void` ← 05.
Decisions:
- `start.ts` also registers a reader: `minTokens > 0 ? minTokens : null`, read from the setting at each call.
  Dispose removes it with the send gate.
- With `minTokens` 0 the reader gives null, so Claude's idle compaction keeps its own default.
Tests:     rows in the wiring test: the reader gives `150000` for the default setting and `null` for `minTokens: 0`.

## Cold read fixes

These override any earlier line of this task that they contradict.

- **Layers.** Add `modify scripts/check-layers.mts` to Files: entries `src/plugins/auto-compact` (`src/contracts`,
  `src/shared`) and `src/plugins/auto-compact/main` (`src/contracts`, `src/shared`, `src/plugins/auto-compact`,
  `src/plugins/chat/contract.ts`), modelled on `usage/main`, and the plugin's paths in the manifests and `main.ts`
  layer lists. `npm run lint` fails without them.
- **`sessionEnded` keeps the usage.** Chat re-emits saved usage only at app restore and on resume from history, not
  when a resting row's next send starts a process, so dropping it would leave the gate blind in the case the design
  names (a session whose process ended). The fold keeps the entry on `sessionEnded`; the map holds one event per host
  session per app run. The `SessionEndedDrops` row becomes `SessionEndedKeeps`.
- **`compactionEnded done` drops the usage.** Any trigger: the host session's entry is removed, so stale
  pre-compaction usage never holds a send; the next reply's `usage` refills it. Rows `CompactionEndedDropsDone`, and
  `CompactionEndedFailedKeeps` with `failed` and `interrupted` cases.
- **Slash commands pass.** `sendGateVerdict` returns null when `input.text.trimStart()` starts with `/`. Row
  `SlashCommand_NotHeld` (`/compact` on a cold 200k session).

## Proof

