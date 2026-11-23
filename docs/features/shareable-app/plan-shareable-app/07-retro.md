# 07 — Auto-retro reads its command, folder and triggers from the picked retro strategy

Status: not started
Type: Task
Rung: hard · it changes the pure queue's signature and adds a reader and a pick that the queue's start, restore and launch paths all read
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/src/plugins/auto-retro/manifest.ts`
- modify `wigley-ai-gui/src/plugins/auto-retro/main/retro-queue.ts`
- modify `wigley-ai-gui/src/plugins/auto-retro/main/start.ts`
- create `wigley-ai-gui/src/plugins/auto-retro/main/retro-reader.ts`
- test `wigley-ai-gui/src/plugins/auto-retro/main/retro-queue.test.ts`
- test `wigley-ai-gui/src/plugins/auto-retro/main/start.test.ts`
- test `wigley-ai-gui/src/plugins/auto-retro/main/retro-reader.test.ts` (create)

Consumes:
- `RetroContribution` from `wigley-ai-gui/src/contracts/contributions.ts` ← 03
- `contributionsMainKey`, `ContributionsMainExports.registerFeature`, `.strategies`, `.onChanged`, `.ready`, `FeatureReader`, `ReadResult`, `Strategy`, `pickStrategy`, `StrategyPick`, `strategyControlKind` from `wigley-ai-gui/src/plugins/contributions/contract.ts` ← 03
- `pickProblemText(featureLabel, pick)` ← 03 (see Open questions: File Structure lacks this name)

Produces:
- `export const retroReader: FeatureReader<RetroContribution>` in `wigley-ai-gui/src/plugins/auto-retro/main/retro-reader.ts`
- `export interface RetroPolicy { prefixes: readonly string[]; on: readonly ('close' | 'clear')[] }` in `retro-queue.ts`
- `export function nextQueue(queue: RetroQueue, event: QueueEvent, policy: RetroPolicy): RetroQueue` in `retro-queue.ts` (a new third parameter)
- `export function opensWithRetroCommand(titles: SessionTitles, prefixes: readonly string[]): boolean` in `retro-queue.ts` (a new second parameter)
- `export function commandPrefix(command: string): string` in `retro-queue.ts`
- `export function retroCommandText(command: string, hostIds: readonly string[]): string` in `retro-queue.ts`

## Why

`retro-queue.ts:22` hard-codes `RETRO_COMMAND = '/wigley:retro auto'`, and the manifest's `folder` setting defaults to `~/wigley-agents` (`manifest.ts:17`). A user with no wigley plugin gets a failed background row for every ended conversation (`gui-coupling.md` § 4 item 5). After this task the command, the folder and the triggers come from the picked `retro` strategy, and with no pick auto-retro queues nothing.

## Decisions

- **Settings.** The manifest's `settings` becomes `{ strategy: '', layout: 'default', settleSeconds: 5 }`. `folder` is removed, with its `settingInfo` entry. `settingControls` becomes `{ layout: 'layout', strategy: strategyControlKind('retro') }`, which is `'strategy:retro'`. The `strategy` setting info: label `Retro plugin`, description `The plugin whose retro runs for each ended conversation. Automatic picks the only one installed.` (design.md § Picking a strategy).
- **Dependencies.** `dependsOn.main` becomes `['chat', 'sessions', 'contributions']`. The page part reads nothing from the registry: the empty state shows in the `strategy:retro` Settings control that task 03 draws, and in the main log.
- **Manifest comment and description.** Remove `/wigley:retro auto` and the retro folder from the comment above the manifest. The comment says that each ended conversation queues the picked retro strategy's command, launched in that strategy's folder. The `description` string stays as it is.
- **Reader.** `retroReader.label` is `'Retro'`. `read(section)` returns `{ ok: true, value }` with `value` the section's `label` (when present), `command`, `folder` and `on`, and no other keys. It refuses, with each reason it finds, in this order:
  - not a JSON object: `"retro" is not an object`
  - `command` missing or not a non-empty string: `command: not a non-empty string`
  - `command` does not hold `{sessions}` exactly once: `command: holds {sessions} <n> times, not once`
  - the text before `{sessions}` is empty after a trim: `command: has no text before {sessions}`
  - `folder` missing or not a non-empty string: `folder: not a non-empty string`
  - `on` not an array of one or more items, each `close` or `clear`, with no repeat: `on: not a list of close and clear`
  - `label` present and not a string: `label: not a string`
  The reader reads no file and does not expand `~`.
- **Prefix.** `commandPrefix(command)` is the text before `{sessions}`, not trimmed. For `/wigley:retro auto {sessions}` it is `/wigley:retro auto `, so a row reads as a retro row exactly as `opensWithRetroCommand` reads it today (`startsWith(`${RETRO_COMMAND} `)`). `retroCommandText(command, hostIds)` replaces `{sessions}` with `hostIds.join(' ')`.
- **The queue stays pure.** `nextQueue` takes a `RetroPolicy`. `policy.prefixes` holds the prefix of **every** installed retro strategy, not only the picked one, so a change of pick still claims the rows an earlier pick launched. `policy.on` is the picked strategy's `on`, or `[]` when no strategy is picked.
  - `closed`: a host in `launched` is handled as today. Otherwise a retro queues only when `policy.on` includes `close`, the close is a user close, the conversation sent a message, and `opensWithRetroCommand(titles, policy.prefixes)` is false.
  - `cleared`: a host in `launched` is handled as today. Otherwise a retro queues only when `policy.on` includes `clear`, the conversation sent a message, and the row does not open with a prefix.
  - Every other event ignores the policy.
- **Pick.** `start.ts` registers `retroReader` under `'retro'` with `contributions.registerFeature` before the self-test early return, so the Settings control lists the strategies in every run mode. It disposes the registration in the part's `dispose`. The pick is `pickStrategy(contributions.strategies('retro'), api.settings().strategy)`, read at each event and at each launch.
- **Start waits for the registry.** `begin` (the start that loads `queue.json`) awaits `contributions.ready` before the `started` event, so the restore claim reads every installed prefix.
- **Launch.** `launch(item)` reads the pick. On `picked`, it launches with `projectDir: services.paths.expandTilde(strategy.value.folder, services.homeDir)` and the message text `retroCommandText(strategy.value.command, item.hostIds)`. On any other pick, it launches nothing, and the item stays at the head of the queue. The queue does not store the command: an item queued under one pick runs under the pick in force when it launches.
- **Wake on a pick.** `start.ts` listens to `contributions.onChanged('retro', …)` and `api.onSettingsChanged(…)`. When the pick becomes `picked` and a retro is queued with none running, it starts the next launch through the same serial chain the other events use.
- **Empty state.** When a close or a clear would have queued a retro but the pick is not `picked`, `start.ts` logs `retro not queued: <pickProblemText('Retro', pick)>` once per pick change, not once per event.
- **Data.** `queue.json` keeps its shape and path. A queue that a user wrote before this change loads unchanged.
- **User settings.** Measured at plan time: `~/.config/wigley-ai-gui/settings.json` holds no `auto-retro` key, so no edit is needed. Re-verify with `grep -n 'auto-retro' ~/.config/wigley-ai-gui/settings.json`. If a `folder` key is there, remove only that key.

## Behaviour

- GIVEN one installed retro strategy `{ command: '/acme:retro {sessions}', folder: '~/retros', on: ['close'] }` and `strategy` `''` WHEN the user closes a session that sent a message THEN one row launches in `<home>/retros` with the text `/acme:retro h1`.
- GIVEN the same strategy WHEN a `/clear` ends a sent conversation THEN no retro queues, because `on` lacks `clear`.
- GIVEN no installed retro strategy WHEN the user closes a sent session THEN nothing launches and the log holds one `retro not queued:` line.
- GIVEN two installed strategies and `strategy` `''` WHEN the user closes a sent session THEN nothing queues (pick `choose`).
- GIVEN a retro queued while unbound WHEN a strategy becomes installed THEN the queued retro launches.
- GIVEN a restored row whose first message starts with an installed strategy's prefix, though another strategy is picked WHEN the app starts THEN the row is claimed as a retro row and closing it queues nothing.

## Tests

- `retro-queue.test.ts` — the `nextQueue` table gets a policy column. Today's rows run with `{ prefixes: ['/wigley:retro auto '], on: ['close', 'clear'] }`. Add rows:
  - `close_OnLacksClose_QueuesNothing` — catches a policy that ignores `on`.
  - `clear_OnLacksClear_QueuesNothing`.
  - `close_EmptyOn_StillDropsTheLaunchedHost` — catches an unbound policy that stops a retro row's close from leaving `launched`.
  - `close_RowOpensWithASecondStrategysPrefix_QueuesNothing` — `prefixes: ['/a:retro ', '/b:retro ']`, first message `/b:retro h9`.
- `retro-queue.test.ts` — `commandPrefix` and `retroCommandText` cases: `'/wigley:retro auto {sessions}'` gives `'/wigley:retro auto '` and, with `['h1', 'h2']`, `'/wigley:retro auto h1 h2'`.
- `retro-reader.test.ts` (new) — one table over `retroReader.read`: the user's section `{ command: '/wigley:retro auto {sessions}', folder: '~/wigley-agents', on: ['close', 'clear'] }` reads ok and its value equals the section. Then one row per reason above, each asserting the exact reason text. A row with an extra key reads ok and drops the key.
- `start.test.ts` — the harness gets a contributions fake: `strategies`, `onChanged`, `ready` and `registerFeature`, holding a strategy list the test sets. Today's tests run with one strategy `{ command: '/wigley:retro auto {sessions}', folder: '~/wigley-agents', on: ['close', 'clear'] }`, and their expected texts and `projectDir` stay as they are. The `settings` helper drops `folder` and gains `strategy: ''`. Add:
  - `sessionClosed_NoStrategy_LaunchesNothingAndLogsOnce` — two closes, zero launches, one `retro not queued:` line.
  - `sessionClosed_TwoStrategiesAutomatic_LaunchesNothing`.
  - `sessionClosed_PickedStrategy_LaunchesItsCommandInItsFolder` — strategy `/acme:retro {sessions}` in `~/retros`, `strategy: 'acme'`, asserts `projectDir` `/home/me/retros` and the text `/acme:retro h1`.
  - `queuedWhileUnbound_StrategyInstalled_Launches` — fire `onChanged('retro')` after installing a strategy.
  - `start_RegistersTheRetroReaderInSelfTestMode` — catches a registration placed after the self-test return.

## Verification

```
cd /Users/jonathonwigley/Documents/ai/wigley-ai-gui
npm test -- src/plugins/auto-retro
npm run typecheck
npm run lint
grep -rn 'wigley\|RETRO_COMMAND' src/plugins/auto-retro --include='*.ts' | grep -v '\.test\.ts'
```

The last grep prints nothing.

## Done when

- The checks above pass, and the grep prints nothing.
- `RETRO_COMMAND` and the `folder` setting are gone from `src/plugins/auto-retro`.
- Runtime check: deferred to the final verification task (a close in the app launches the wigley strategy's retro once task 13's `auri.json` is installed).

Commit: one commit for the group.

## Open questions

- Settled: task 03 produces `pickProblemText` with these texts (plan.md § File Structure › Shared names).

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
