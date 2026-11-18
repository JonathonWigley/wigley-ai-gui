# 10 — Bar steps

Status: not started
Type: Batch
Rung: deep · overlays four main slots that async writers also write (the pool watch, the stats poller, the updater, the retro chain), and the auto-retro guard must hold on a close whose row is already gone
Wave: 2 · Depends on: 01, 03 (auto-retro's guard reads the `ephemeral` key 03 adds to chat's `sessionClosed` and `sessionCleared`), 04 (auto-retro's page half holds `SessionsPageExports.showOnly`, and relies on 04's stack rule: the latest hold wins, and only the shown section claims rows)
Plan: [plan.md](plan.md)

Files paths are written from the `ai` repo root; every other path in this document is relative to `wigley-ai-gui/`.

Files:
- create `wigley-ai-gui/src/plugins/unity-pool/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/unity-pool/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/unity-pool/contract.ts`
- modify `wigley-ai-gui/src/plugins/unity-pool/main/start.ts`
- modify `wigley-ai-gui/src/plugins/unity-pool/page/start.ts`
- test `wigley-ai-gui/src/plugins/unity-pool/main/start.test.ts`
- create `wigley-ai-gui/src/plugins/system-stats/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/system-stats/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/system-stats/main/start.ts`
- modify `wigley-ai-gui/src/plugins/system-stats/page/start.ts`
- test `wigley-ai-gui/src/plugins/system-stats/main/start.test.ts`
- test `wigley-ai-gui/src/plugins/system-stats/page/start.test.ts`
- create `wigley-ai-gui/src/plugins/app-update/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/app-update/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/app-update/contract.ts`
- modify `wigley-ai-gui/src/plugins/app-update/main/start.ts`
- modify `wigley-ai-gui/src/plugins/app-update/page/start.ts`
- test `wigley-ai-gui/src/plugins/app-update/main/start.test.ts`
- create `wigley-ai-gui/src/plugins/auto-retro/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/auto-retro/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/auto-retro/main/start.ts`
- modify `wigley-ai-gui/src/plugins/auto-retro/page/start.ts`
- test `wigley-ai-gui/src/plugins/auto-retro/main/start.test.ts`

This task adds no new plugin part, so 07's part lists gain nothing from it.

Consumes:
- `DemoStep`, `DemoStage`, `DemoBeat`, `DemoPageContext`, `DemoMainStep`, `DemoMainStage`, `DemoMainContext`, `DEMO_HARNESS_ID` in `src/contracts/demo.ts` ← 01
- `PageServices.demoSteps: DemoStepRegistry<DemoStep>` and `MainServices.demoSteps: DemoStepRegistry<DemoMainStep>` ← 01 (each files every `register` handle in the part's registrations and checks the `<plugin id>.` prefix)
- the plugin-part harness (`startMainPart`, `startPagePart` in `src/shared/plugin-part-harness.test-support.ts`) gives a working `services.demoSteps` whose `list()` returns the registered steps ← 01
- `SessionsPageExports.showOnly(sectionId: string): Disposable` and its stack rule ← 04 (auto-retro's page half; see Decisions)
- `ephemeral?: true` on the payloads of `ChatMainEvents.sessionClosed` and `sessionCleared` in `src/plugins/chat/contract.ts`, present only for an ephemeral row, and every demo session is launched ephemeral ← 03
- tree members: `poolStateText`, `PoolFixture`, `PoolStage` (`src/plugins/unity-pool/main/selftest-fixture.ts`), `readStateFile` (`src/plugins/unity-pool/main/state-file.ts`), `statsFixture` (`src/plugins/system-stats/main/stats-fixture.ts`), `FIXTURE_ORIGIN_COMMIT` (`src/plugins/app-update/main/update-fixture.ts`), `SessionsPageExports.activate` (`src/plugins/sessions/contract.ts:668`), `sessionsRowsSlot`

Produces:
- `export type DemoPoolStage = 'panel' | 'tiles' | 'longWait'` and `showDemoStage(stage: DemoPoolStage): void` in `UnityPoolChannel.invoke`, in `src/plugins/unity-pool/contract.ts`
- `export const DEMO_POOL = 'demo-pool'`, `export interface UnityPoolDemo extends Disposable { showStage(stage: DemoPoolStage): void }`, `export function registerDemoSteps(services: MainServices, deps: UnityPoolDemoDeps): UnityPoolDemo` in `src/plugins/unity-pool/main/demo-steps.ts`
- `export function registerDemoSteps(services: PageServices, deps: UnityPoolPageDemoDeps): Disposable` in `src/plugins/unity-pool/page/demo-steps.ts`
- `export function registerDemoSteps(services: MainServices, deps: SystemStatsDemoDeps): Disposable` in `src/plugins/system-stats/main/demo-steps.ts`
- `export function registerDemoSteps(services: PageServices, deps: SystemStatsPageDemoDeps): Disposable` in `src/plugins/system-stats/page/demo-steps.ts`
- `export type DemoUpdateKind = 'available' | 'installing' | 'failed'` and `export interface AppUpdateChannel extends ChannelShape { invoke: { showDemoStatus(kind: DemoUpdateKind): void }; messages: Record<never, never> }` in `src/plugins/app-update/contract.ts`
- `export function demoStatus(kind: DemoUpdateKind): AppUpdateStatus` and `export function registerDemoSteps(services: MainServices, deps: AppUpdateDemoDeps): Disposable` in `src/plugins/app-update/main/demo-steps.ts`
- `export function registerDemoSteps(services: PageServices, deps: AppUpdatePageDemoDeps): Disposable` in `src/plugins/app-update/page/demo-steps.ts`
- `export const DEMO_QUEUED = 2` and `export function registerDemoSteps(services: MainServices, deps: AutoRetroDemoDeps): Disposable` in `src/plugins/auto-retro/main/demo-steps.ts`
- `export function registerDemoSteps(services: PageServices, deps: AutoRetroPageDemoDeps): Disposable` in `src/plugins/auto-retro/page/demo-steps.ts`

## Pattern

The pattern of task 09 (its § Reference pattern), with a main half:

1. `main/demo-steps.ts` registers one `DemoMainStep`; `page/demo-steps.ts` registers one `DemoStep` with the same id. `main/start.ts` and `page/start.ts` each call their `registerDemoSteps` once and keep no handle (unity-pool's main keeps the returned object for its channel handler only).
2. The main half writes the sample into the plugin's own slot as an **overlay**: `start.ts` keeps the real value apart, and publishes the overlay in its place while a stage is entered. The overlay never reaches a file, a CLI or a store. Leaving the stage publishes the real value again.
3. A page beat that needs another sample state asks main over the plugin's channel. The handler throws `Error('no demo step entered')` when no stage is entered.
4. A main stage never closes its demo sessions: the demo main (06) closes every session in the main stage's `sessions` map with chat's `close(id, 'finished')` after it disposes the page stage and then the main stage.

Each step's sample comes from the plugin's existing self-test or drive fixture builder, called directly (never a drive action or a preview command).

## unity-pool — step `unity-pool.pool`

| Field | Value |
|---|---|
| section | `bars` |
| order | `1` |
| title | `Unity pool` |
| caption | `Each session shows the Unity clone it holds, and the panel shows its whole pool.` |
| files | `src/plugins/unity-pool/page/start.ts`, `src/plugins/unity-pool/page/pool-view-model.ts`, `src/plugins/unity-pool/main/start.ts`, `src/plugins/unity-pool/main/state-file.ts`, `src/plugins/unity-pool/layouts/default/layout.js` |

Beats (page): each `show()` awaits `deps.showStage(stage)`, then calls `deps.activate(context.sessions.pool)`, so the demo session is the shown session and the panel shows its pool.

| name | stage |
|---|---|
| `Clone held` | `panel` |
| `Warm-up and stranded` | `tiles` |
| `Long wait` | `longWait` |

`enter` throws `Error('unity-pool.pool: no demo session')` when `context.sessions.pool` is undefined. The page stage's `dispose` does nothing: main removes the pool.

Main half `enter(context)`:
1. `rowId = await context.launchSession('Fix the level loader')`. The text titles the row, and the panel names the holder by that title.
2. `fixture: PoolFixture = { rowId, clonePaths: [context.scratchDir, services.paths.join(context.scratchDir, 'unity-2')], startedAt: Math.floor(services.clock.now() / 1000) }`. Clone 1's path is the demo session's folder, so `poolOfRow` finds the pool by clone path (`page/pool-view-model.ts:87`).
3. `deps.setDemoPool(poolOf('panel'))`, where `poolOf(stage)` is `readStateFile(poolStateText(fixture, stage))`, which must read `kind: 'pool'` (else it throws), with `pool` replaced by `DEMO_POOL`.
4. Returns `{ sessions: { pool: rowId }, dispose }`. `dispose` calls `deps.setDemoPool(null)`; 06 closes `rowId` (Pattern 4).

`showStage(stage)` calls `deps.setDemoPool(poolOf(stage))` for the entered stage's fixture; with no stage entered it throws `Error('no demo step entered')`.

```ts
export interface UnityPoolDemoDeps {
  setDemoPool(pool: PoolState | null): void;
}
export interface UnityPoolPageDemoDeps {
  activate(sessionId: string): void;                 // sessions.activate
  showStage(stage: DemoPoolStage): Promise<void>;    // api.channel.invoke('showDemoStage', stage)
}
```

Changes in `src/plugins/unity-pool/main/start.ts`:
- Hold `demoPool: PoolState | null`. Every write of `unityPoolSnapshotSlot` goes through one `publish(snapshot)`: the watch's pools, plus `demoPool` when it is set, sorted by `pool` name (the contract says sorted by name). The watch's `changed` and the first write call it; `setDemoPool` sets `demoPool` and calls it with `watch.snapshot()`.
- The pool provider stays on `watch.snapshot()`: chat never sees the demo clones.
- The `run` handler: when `pool === DEMO_POOL`, it logs `<action> <pool> <clone>: demo clone, nothing run`, returns `{ ok: false, error: 'demo', message: 'A demo clone: nothing runs.' }` and does not call `runPoolCommand` or `watch.rescan()`. The guard holds whether or not a stage is entered, so a panel drawn just before leave runs nothing either.
- Handle `showDemoStage` with `demo.showStage(stage)`.

`src/plugins/unity-pool/page/start.ts` calls `registerDemoSteps(services, { activate: sessions.activate, showStage: (stage) => api.channel.invoke('showDemoStage', stage) })`.

## system-stats — step `system-stats.panel`

| Field | Value |
|---|---|
| section | `bars` |
| order | `2` |
| title | `System stats` |
| caption | `The system stats panel shows what the machine is busy with, session by session.` |
| files | `src/plugins/system-stats/page/start.ts`, `src/plugins/system-stats/page/stats-view-model.ts`, `src/plugins/system-stats/main/start.ts`, `src/plugins/system-stats/main/grouping.ts`, `src/plugins/system-stats/layouts/default/layout.js` |

One beat: `Busy machine`, whose `show()` does nothing (the stage already shows the panel and main already holds the sample).

Page stage: `enter` takes `hold = deps.showForNow()`; `dispose` calls `hold.dispose()`.

Main half `enter`: `deps.setDemo(statsFixture('busy', services.clock.now()))`; returns `{ sessions: {}, dispose: () => deps.setDemo(null) }`.

```ts
export interface SystemStatsDemoDeps { setDemo(snapshot: StatsSnapshot | null): void }
export interface SystemStatsPageDemoDeps { showForNow(): Disposable }
```

Changes in `src/plugins/system-stats/main/start.ts`:
- Hold `demo: StatsSnapshot | null` and `beforeDemo: StatsSnapshot | null`.
- `sampled` and `failed` return at once while `demo` is set: real readings never reach the slot during the step.
- The `setShown` handler keeps its `shown`, history and poller changes, but skips its `snapshot.set(null)` while `demo` is set.
- `setDemo(next)` with a snapshot: on the first call records `beforeDemo = snapshot.get() ?? null`, sets `demo`, writes `next`. `setDemo(null)`: clears `demo`; when a seed stopped sampling (`poller === null`) writes `beforeDemo` back; else sets `prev = null`, a fresh `history`, and writes `null`, so the next two samples draw again.

Changes in `src/plugins/system-stats/page/start.ts`: a new `showForNow(): Disposable`. When the panel shows already, it returns a handle that does nothing. Else it sets `isShown = true`, calls `reportShown()` and `draw()`, and returns a handle whose `dispose` hides the panel again (`isShown = false`, `reportShown()`, `hidePanel()`) only when no `togglePanel` ran since. It never writes `uiState`: the user's hidden choice stays saved as it was.

## app-update — step `app-update.button`

| Field | Value |
|---|---|
| section | `bars` |
| order | `3` |
| title | `App update` |
| caption | `The title bar offers each new build of the app and installs it in one click.` |
| files | `src/plugins/app-update/page/start.ts`, `src/plugins/app-update/main/start.ts`, `src/plugins/app-update/main/updater.ts`, `src/plugins/app-update/layouts/default/layout.js` |

Beats (page): each `show()` awaits `deps.showDemoStatus(kind)`.

| name | kind |
|---|---|
| `Update available` | `available` |
| `Installing` | `installing` |
| `Install failed` | `failed` |

`demoStatus(kind)` in `main/demo-steps.ts`:
- `available` → `{ kind: 'available', sha: FIXTURE_ORIGIN_COMMIT.slice(0, 7) }` (`2222222`, as `main/selftest-script.ts:14` shortens it)
- `installing` → `{ kind: 'installing' }`
- `failed` → `{ kind: 'failed', error: 'install-app exited with code 1' }`

Main half `enter`: `deps.setDemo(demoStatus('available'))`; returns `{ sessions: {}, dispose: () => deps.setDemo(null) }`.

```ts
export interface AppUpdateDemoDeps { setDemo(status: AppUpdateStatus | null): void }
export interface AppUpdatePageDemoDeps { showDemoStatus(kind: DemoUpdateKind): Promise<void> } // api.channel.invoke('showDemoStatus', kind)
```

Changes in `src/plugins/app-update/main/start.ts`:
- The main and page APIs take `AppUpdateChannel` in place of `ChannelShape`.
- Hold `real: AppUpdateStatus` (the slot's value at start, `none` when unset) and `demo: AppUpdateStatus | null`. Every updater (`startUpdater`, the seed's included) gets a `SlotWriter<AppUpdateStatus>` stand-in: `get` returns `real`; `set` stores `real` and writes the slot only while `demo` is null; `dispose` does nothing. So a check or a real install that ends during the step changes `real` alone.
- `setDemo(status)`: sets `demo` and writes `status ?? real` to the slot.
- `install`: while `demo` is set, it logs `install skipped: demo`, sets the overlay to `{ kind: 'installing' }` and returns. It starts no program and never reaches the updater.
- Handle `showDemoStatus(kind)`: throws `Error('no demo step entered')` while `demo` is null; else `setDemo(demoStatus(kind))`.
- The part's `dispose` writes `real` to the slot when `demo` is set, so a stop mid-step never leaves a demo status for the next start, which reads the slot to resume an install.

`src/plugins/app-update/page/start.ts` takes `AppUpdateChannel` and calls `registerDemoSteps(services, { showDemoStatus: (kind) => api.channel.invoke('showDemoStatus', kind) })`.

## auto-retro — step `auto-retro.section`

| Field | Value |
|---|---|
| section | `bars` |
| order | `4` |
| title | `Auto retro` |
| caption | `Each conversation the user ends gets a background retro in the Retro section.` |
| files | `src/plugins/auto-retro/main/start.ts`, `src/plugins/auto-retro/main/retro-queue.ts`, `src/plugins/auto-retro/page/start.ts`, `src/plugins/auto-retro/layouts/default/layout.js` |

One beat: `Retro running, 2 queued`, whose `show()` calls `deps.activate(context.sessions.retro)`.

Page stage: `enter` throws `Error('auto-retro.section: no demo session')` when `context.sessions.retro` is undefined, then takes `hold = deps.showOnly('auto-retro')`; `dispose` calls `hold.dispose()`.

Main half `enter(context)`: `rowId = await context.launchSession('Retro of the "Fix login" conversation')`; `deps.setDemo({ rowId, queued: DEMO_QUEUED })`; returns `{ sessions: { retro: rowId }, dispose }`. `dispose` calls `deps.setDemo(null)`; 06 closes `rowId` (Pattern 4).

```ts
export interface AutoRetroDemoDeps {
  setDemo(demo: { rowId: string; queued: number } | null): void;
}
export interface AutoRetroPageDemoDeps {
  showOnly(sectionId: string): Disposable;           // sessions.showOnly
  activate(sessionId: string): void;                 // sessions.activate
}
```

Changes in `src/plugins/auto-retro/main/start.ts`:
- Register the demo step before the self-test early return, so the step exists in every run mode.
- Hold `demo: { rowId: string; queued: number } | null`. Every write of `autoRetroStateSlot` goes through one function: the state it would write now (`{ rows: [], queued: 0 }` in the self-test; else the real rows and `queue.queued.length`), with `demo.rowId` added last to `rows` and `queued` replaced by `demo.queued` while `demo` is set. `setDemo` sets `demo` and writes again. The real `rows` list, `queue` and `queue.json` never hold the demo row.
- **Demo sessions queue no retro.** In the `chat.sessionClosed` and `chat.sessionCleared` listeners, before `serial(...)`: when `event.ephemeral === true`, log `ignored demo session <sessionId>` and return. The check reads the event, not the row: on a user close the sessions plugin removes the row and then emits `sessions.closed` (`src/plugins/sessions/main/session-list.ts:471-475`), and chat's handler of that event fires `sessionClosed` (`src/plugins/chat/main/start.ts:532-534`), so the row is already gone when auto-retro hears the close. Reason `user` is the one reason that queues a retro, so a row check would let a demo row the user closes from the side bar queue `/wigley:retro auto <fake host id>`.

`src/plugins/auto-retro/page/start.ts` calls `registerDemoSteps(services, { showOnly: sessions.showOnly, activate: sessions.activate })`.

Decisions:
- Every bar step shows a sample overlay in the plugin's own slot, published by main; the real watch, poller, updater and queue keep running under it and reappear at leave (design.md § Real state stays untouched).
- unity-pool: the demo pool's name is `demo-pool`, and any Hold, Release or Open naming it returns `demo` without running the CLI. The guard holds outside the step too, so a panel drawn just before leave can never reach the CLI; the cost is that a real pool folder named `demo-pool` would get the same refusal (reported to the user as a decision).
- unity-pool beats use the self-test fixture's stages `panel`, `tiles` and `longWait`; `opening` repeats `panel`, and `unknownVersion` drops the pool, so neither shows a new state.
- system-stats has one beat: the busy sample. Real readings would show the user's own processes to the team.
- system-stats shows the panel for the step without writing `uiState`, and hides it again only when the step showed it.
- app-update shows three states through a channel call; pressing the button during the step sets `installing` on the overlay and starts nothing, in the installed app as in the dev app.
- auto-retro detects a demo session by the event's `ephemeral` key (03), not by `row.harness === DEMO_HARNESS_ID`: a user close removes the row before chat fires `sessionClosed`, so the row check misses the one close reason that queues a retro. The same key is how session-log and session-stash skip demo sessions (lead ruling R9). The event's `profile === DEMO_PROFILE` would work too; `ephemeral` is used because it names what the guard protects (a demo session leaves no trace).
- auto-retro's step holds `sessions.showOnly('auto-retro')` while it is entered: the demo holds `showOnly('demo')`, which hides the Retro section. Task 04's stack rule makes this work: the latest `showOnly` hold wins, and disposing it shows the earlier one again; while a section is shown alone, only that section claims rows, so the demo retro row, which the Demo section and the Retro section both claim, draws in the Retro section while that is the one shown.
- The demo main (06) closes the step's demo session at leave with reason `finished`, which auto-retro never queues (`isUserClose`, `main/retro-queue.ts`) and which the demo-session guard skips anyway.

GIVEN the unity-pool step entered WHEN `run` is invoked with `hold demo-pool 1` THEN it resolves `{ ok: false, error: 'demo', message: 'A demo clone: nothing runs.' }` and the CLI is not looked up or run.
GIVEN the system-stats panel shown and the step entered WHEN the poller samples THEN the slot keeps the busy fixture; WHEN the stage is disposed THEN the slot is null and the next two samples publish real readings.
GIVEN the installed app with an update available WHEN the app-update step is entered and `install` runs THEN no program starts and the slot reads `installing`; WHEN the stage is disposed THEN the slot reads the real `available` status.
GIVEN a demo session whose row is already gone from `sessions.rows` WHEN chat fires `sessionClosed` (reason `user`) or `sessionCleared` (sent) with `ephemeral: true` THEN auto-retro launches nothing, queues nothing and logs `ignored demo session <id>`.
GIVEN no stage entered WHEN unity-pool's `showDemoStage` or app-update's `showDemoStatus` is invoked THEN it rejects with `no demo step entered`.
GIVEN no stage entered WHEN `run` is invoked with `hold demo-pool 1` THEN it still resolves `{ ok: false, error: 'demo', … }` and runs no CLI.
GIVEN a real pool in the watch WHEN the unity-pool stage is entered THEN the slot's pools are both, sorted by name.
GIVEN a real retro running WHEN the auto-retro stage is entered THEN the slot's `rows` end with the demo row and `queued` is `2`, and `queue.json` holds no demo row; WHEN the stage is disposed THEN the slot holds the real rows and count again.
GIVEN the app-update stage entered and `install` run WHEN the part stops and starts again THEN the slot reads the real status, not `installing`.
GIVEN the system-stats panel hidden WHEN the page stage is entered THEN the panel shows and `uiState` is not written; WHEN the user runs `togglePanel` and then the stage is disposed THEN the dispose changes nothing.

Tests:
Each test below enters a step through the harness's demo registry (01): `services.demoSteps.list()`, the step by id, `enter(context)`.

- `src/plugins/unity-pool/main/start.test.ts`: `demoStep_RunOnTheDemoPool_RunsNoCli`. Enter the registered `unity-pool.pool` main step (from the harness's demo registry, 01) with a context whose `launchSession` resolves `'row-demo'` and whose `scratchDir` is `/scratch`. Assert the slot's pools are `['demo-pool']` with clone 1's claim on row `row-demo`; spy `harness.files.stat`, invoke `run` `hold demo-pool 1`, assert the result above and that `stat` was not called with `/home/.local/bin/unity-pool`; dispose the stage and assert the slot's pools are `[]`. Breaks it catches: a missing guard (the CLI runs), an overlay left after leave.
- `src/plugins/unity-pool/main/start.test.ts`: `demoStep_RealPoolHeld_PublishesBothSortedByName`. Write the self-test pool's state file and rescan, as `start_WritesTheWatchSnapshot_AndAChangeWritesTheNewOne` does (`:84`); enter the step; the slot's pool names are `['demo-pool', 'selftest-pool']`; dispose; they are `['selftest-pool']`. Break it catches: a `publish` that appends the demo pool unsorted, or drops the watch's pools.
- `src/plugins/unity-pool/main/start.test.ts`: `demoStep_NoStageEntered_ShowStageThrowsAndRunStillRefuses`. With no stage entered, `invoke('showDemoStage', 'tiles')` rejects with `no demo step entered`, and `invoke('run', 'hold', 'demo-pool', 1)` resolves the `demo` refusal with no `stat` of the CLI path. Breaks it catches: a guard that holds only while a stage is entered, a `showStage` that writes an overlay with no fixture.
- `src/plugins/system-stats/main/start.test.ts`: `demoStep_HoldsTheFixtureOverSamples_AndLeavingSamplesAgain`, on `startOnHarness()`: show, enter the `system-stats.panel` step, advance `FIRST_GAP_MS` and one refresh interval; the slot equals `statsFixture('busy', <the clock at enter>)`; dispose; the slot is null; advance two samples; the slot's rows are the fake sample's ids (as `setShown_PublishesFromTheSecondSample` lists them). Breaks it catches: a `sampled` that writes during the step, a leave that keeps the fixture.
- `src/plugins/system-stats/page/start.test.ts`: `it.each` `'demo stage shows the panel for now: $name'` on `startOnHarness()`, entering the page step `system-stats.panel`. Rows: `{ name: 'panel hidden', hiddenBefore: true, toggled: false }`: enter calls `setShown` `true`, dispose calls `setShown` `false`, and `stored.get('hidden')` stays `true` throughout. `{ name: 'panel shown', hiddenBefore: false, toggled: false }`: enter and dispose call no `setShown`. `{ name: 'user toggled during the step', hiddenBefore: true, toggled: true }`: enter, run `togglePanel`, dispose; the dispose adds no `setShown` call after the toggle's. (Set `hiddenBefore` with `togglePanel` before `enter`, then clear `invoked`.) Breaks it catches: a stage that writes `uiState`, a dispose that hides a panel the user had shown or toggled.
- `src/plugins/app-update/main/start.test.ts`: `demoStep_InstallStartsNothing_AndLeavingShowsTheRealStatus`, on `startWithBuild({ commit: INSTALLED, cloneDir: CLONE })`: enter `app-update.button`; status is `{ kind: 'available', sha: '2222222' }`; run install; `processes.detachedStarts` is `[]` and status is `{ kind: 'installing' }`; dispose; status is the real `{ kind: 'available', sha: '2222222' }` from `aheadGit` (ORIGIN shortened). Breaks it catches: an install that reaches the updater during the step, a leave that keeps the demo status.
- `src/plugins/app-update/main/start.test.ts`: `demoStep_StopMidStep_NextStartReadsTheRealStatus`, on `startWithBuild({ commit: INSTALLED, cloneDir: CLONE })`: enter `app-update.button`; run install; `harness.restart()` and settle, as `stop_WhileInstalling_LeavesTheStatusForTheNextStart` does (`:257`); status is `{ kind: 'available', sha: '2222222' }` and `processes.detachedStarts` is `[]`. Break it catches: a part `dispose` that leaves the demo `installing` in the slot, which the next start resumes as a real install.
- `src/plugins/app-update/main/start.test.ts`: `showDemoStatus_NoStageEntered_Throws`: with no stage entered, `invoke('showDemoStatus', 'failed')` rejects with `no demo step entered` and the status is unchanged.
- `src/plugins/auto-retro/main/start.test.ts`: `it.each` `demoSession_$event_QueuesNoRetro` with rows `{ event: 'close' }` and `{ event: 'clear' }`. Set no row for `row-h1`: the real close order removes the row first. Emit through `part.harness.emit`: for `close`, `{ ...closedEvent('h1'), ephemeral: true }` on `chat.sessionClosed`; for `clear`, the payload the `clear('h0', 'h1', true)` helper builds, plus `ephemeral: true`, on `chat.sessionCleared`; then `await settled()`. Assert `part.launches` is `[]`, `part.state()?.queued` is `0`, and the log holds `ignored demo session row-h1`. Break it catches: a guard that reads the row (it finds none and launches `/wigley:retro auto h1`), or a removed guard.
- `src/plugins/auto-retro/main/start.test.ts`: `demoStep_OverlaysTheRowAndCount_AndLeavingShowsTheRealState`. Close `h1` (a real retro starts); record `real = part.state()`; enter `auto-retro.section` with a context whose `launchSession` resolves `'row-demo'`; the state's `rows` are `real.rows` then `'row-demo'`, `queued` is `DEMO_QUEUED`, and `part.queueFile()` holds no `row-demo`; dispose; the state equals `real`. Breaks it catches: a demo row written to `queue.json`, an overlay left after leave.

Done when: `npm run typecheck`, `npm run lint` and the tests above pass, with each plugin's existing `start.test.ts` still passing.

Commit: one commit for the group.

## Proof
