# 05 — Slot registry

Status: not started
Type: Task
Wave: 4 · Depends on: 04
Plan: [plan.md](plan.md)

Files:

- create `src/contracts/state.ts`
- create `src/shared/state/slot-store.ts` · test `src/shared/state/slot-store.test.ts` · test `src/shared/state/slot-store.test-d.ts`
- create `src/main/state/slot-holder.ts` · test `src/main/state/slot-holder.test.ts`
- create `src/renderer/state/page-state.ts` · test `src/renderer/state/page-state.test.ts`
- modify `src/contracts/plugin.ts`, `src/contracts/bridge.ts`
- modify `src/preload/preload.ts` · test `src/preload/preload.test.ts`
- modify `src/main/main.ts`, `src/renderer/renderer.ts`
- modify `src/main/plugins/main-api.ts` · test `src/main/plugins/main-api.test.ts`
- modify `src/renderer/plugins/page-api.ts` · test `src/renderer/plugins/page-api.test.ts`
- modify `src/shared/define-plugin.ts` · test `src/shared/define-plugin.test-d.ts`
- test `src/shared/plugin-manifests.test.ts`, `src/shared/plugin-host.test.ts`
- modify `scripts/layer-rules.mts`, `scripts/check-layers.mts` · test `scripts/layer-rules.test.mts`
- modify `src/shared/plugin-part-harness.test-support.ts` · test `src/shared/plugin-part-harness.test.ts`
- modify every `src/plugins/*/manifest.ts`: 20 folders plus `window` from task 03 (measured at plan time, re-verify)
- modify each test fixture that builds a manifest. These files hold `dependsOn:` (measured at plan time, re-verify; `tsc` names any other): `src/renderer/plugins/page-api.test.ts`, `src/shared/plugin-part-harness.test-d.ts`, `src/shared/plugin-part-harness.test.ts`, `src/shared/plugin-host.test.ts`, `src/shared/plugin-manifests.test.ts`, `src/shared/define-plugin.test-d.ts`, `src/shared/define-plugin.test.ts`, `src/main/config/config-store.test.ts`, `src/main/config/user-config.test.ts`, `src/main/plugins/main-api.test.ts`, `scripts/layer-rules.test.mts`

Consumes:

- `window` plugin manifest ← 03
- `Log` in `src/contracts/log.ts`, `Registrations.track` in `src/contracts/disposable.ts`, `ProcessName` in `src/contracts/plugin.ts`, `disabledDependencyProblem` and `dependencyOrder` in `src/shared/plugin-manifests.ts` (tree)

Produces:

Everything under `src/contracts/state.ts` in plan.md § File Structure, word for word, and these additions in the same file:

```ts
export type JsonSafe<T> = unknown extends T
  ? T
  : T extends string | number | boolean | null
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends object
      ? { [K in keyof T]: JsonSafe<T[K]> }
      : never;

// `unknown` for a JSON value, `never` otherwise: a publish parameter intersects it.
export type JsonSlot<V> = [V] extends [JsonSafe<V>] ? unknown : never;

// What a layout reads. By the slot's kind, `get()` is the value or the `[key, value]`
// entries in first-set order, and `on` passes `(value)`, `(key, value)` or `(key, change)`.
// § The store holds the full rule.
export interface LayoutSlotReader {
  get(key?: string): unknown;
  on(listener: (...args: unknown[]) => void): Disposable;
}
export interface LayoutState { read(id: string): LayoutSlotReader; }
```

`src/contracts/plugin.ts`:

```ts
// On PluginManifest, required:
reads: { readonly main: readonly string[]; readonly page: readonly string[] };

export type ReadableOwner<M extends PluginManifest, P extends ProcessName> =
  | M['id'] | M['dependsOn'][P][number] | M['reads'][P][number] | 'core';

export interface PluginState<M extends PluginManifest, P extends ProcessName> {
  publish<V>(key: SlotKey<V, P, M['id']> & JsonSlot<V>): SlotWriter<V>;
  publish<V>(key: KeyedSlotKey<V, P, M['id']> & JsonSlot<V>): KeyedSlotWriter<V>;
  publish<V extends { readonly id: string }>(key: ListSlotKey<V, P, M['id']> & JsonSlot<V>): ListSlotWriter<V>;
  read<V>(key: SlotKey<V, ProcessName, ReadableOwner<M, P>>): SlotReader<V>;
  read<V>(key: KeyedSlotKey<V, ProcessName, ReadableOwner<M, P>>): KeyedSlotReader<V>;
  read<V extends { readonly id: string }>(key: ListSlotKey<V, ProcessName, ReadableOwner<M, P>>): ListSlotReader<V>;
}

// MainApi: state: PluginState<M, 'main'>
// PageApi: state: PluginState<M, 'page'> & { forLayouts: LayoutState }
```

`src/contracts/bridge.ts`: on `BRIDGE_CHANNELS`, `stateSnapshot: 'bridge:state-snapshot'`, `stateWrite: 'bridge:state-write'`, `stateChanged: 'bridge:state-changed'`. On `Bridge`, the three members plan.md names: `stateSnapshot(): Promise<StateSnapshot>`, `stateWrite(change: SlotChange): void`, `onStateChange(listener: (seq: number, change: SlotChange) => void): Disposable`.

`src/shared/state/slot-store.ts`:

```ts
export interface SlotStore {
  publish<V>(key: SlotKey<V>): SlotWriter<V>;                    // and the keyed and list overloads
  read<V>(key: SlotKey<V>, listenerOwner: string): SlotReader<V>; // and the keyed and list overloads
  readById(id: string, listenerOwner: string): LayoutSlotReader;
  isHeld(id: string): boolean;
  applyRemote(change: SlotChange): void;
  load(slots: Record<string, SlotSnapshot>): void;
  snapshot(): Record<string, SlotSnapshot>;
  onWrite(listener: (change: SlotChange) => void): Disposable;
}
export function createSlotStore(log: Log): SlotStore;
// One plugin's view: `publish` throws for a key not under `pluginId` or of another process; each writer and each `on` goes through `track`.
export function pluginState(store: SlotStore, pluginId: string, process: ProcessName, track: <T extends Disposable>(handle: T) => T): PluginState<PluginManifest, ProcessName>;
export function layoutState(store: SlotStore, pluginId: string, track: <T extends Disposable>(handle: T) => T): LayoutState;
```

`src/main/state/slot-holder.ts`:

```ts
export interface SlotHolder {
  readonly store: SlotStore;
  snapshot(): StateSnapshot;
  applyPageWrite(change: SlotChange): void;
}
export function createSlotHolder(log: Log, push: (seq: number, change: SlotChange) => void): SlotHolder;
```

`src/renderer/state/page-state.ts`:

```ts
export function createPageState(
  bridge: Pick<Bridge, 'stateSnapshot' | 'stateWrite' | 'onStateChange'>,
  log: Log,
): Promise<SlotStore>;
```

Part harness: `PartHarness` gains `readonly state: SlotStore`. `MainPartHarnessOptions` and `PagePartHarnessOptions` gain `state?: SlotStore`. A test seeds a slot with a store it passes in, and writes a slot while the part runs through `harness.state.publish(key).set(value)`. `harness.state.publish` takes a claim that nothing releases, and `counts()` does not hold it. So a test calls `publish` once per key and keeps the writer. For a key the part under test publishes, the test calls `dispose()` on the seeding writer before the part starts. The value stays. Otherwise the part's `publish` throws `Slot "<id>" is held by a live part`.

`scripts/layer-rules.mts`: `export function readReads(file: string, source: string): { main: string[]; page: string[] }`, and `PluginFolder.reads: { main: readonly string[]; page: readonly string[] }`.

Decisions:

**Types.**

- `SlotKey`, `KeyedSlotKey` and `ListSlotKey` carry no constraint on `V`. `publish` checks JSON. A contract can declare a bad key, and its owner's `publish` does not compile.
- `JsonSafe` refuses a function, and so a `Map`, `Set`, `Date` or class with a method, because each has a function member. It refuses a required member typed `T | undefined`, because `undefined` is not JSON. It accepts an optional member. It accepts a class that holds only data: the type system cannot see that class. It passes `unknown` through, because `ChatEntry.raw` is `unknown[]` of parsed JSON and retyping it would touch the harness files.
- `read` names `ReadableOwner<M, P>` directly and infers no owner. The union adds `'core'` to the owners plan.md lists, so that every part reads task 06's core slots with no manifest entry.

**Seq.**

- Main owns `seq`. It starts at 0 and lives for the app run, across page loads.
- `seq` goes up by 1 for each change main applies: a write through a main writer, and a page write through `applyPageWrite`.
- Main pushes only the changes of main writers. So the page sees gaps in `seq`. A gap is normal and asks for no resync.
- The page drops a push with `seq` at or below the last `seq` it took. It applies every other push. Do not check for `last + 1`.
- A delete of an absent key or an absent list is no change: no listener runs, no `onWrite` runs and `seq` stays.
- Every `set` on a value slot is a change, also with an equal value. The store makes no equality check. An owner that wants less traffic checks first.

**Pushes before the snapshot.** `createPageState` runs in this order:

1. Call `bridge.onStateChange` and buffer each push.
2. Await `bridge.stateSnapshot()`. A rejection rejects `createPageState`, and `showStartFailure` shows it.
3. Call `store.load(snapshot.slots)`.
4. Drop each buffered push with `seq` at or below `snapshot.seq`. Apply the others in arrival order through `store.applyRemote`.
5. Apply later pushes at once, and add `store.onWrite` → `bridge.stateWrite`.

Listen first. A push sent between the snapshot and the listener is otherwise lost. The listener is held for the page load and never disposed.

**A page write.**

- A write through a page writer updates the page store first. Then `onWrite` runs, and then the local listeners. Main applies the change later and does not send it back.
- `onWrite` runs before the listeners in both processes. A listener that writes again then sends its own change second, and the other side sees the writes in order.
- `bridge.stateWrite` throws at the caller for a value IPC cannot clone, as `setUiState` does. `JsonSafe` makes that a cast's fault, so the store adds no guard.
- `applyPageWrite` refuses a change whose id `store.isHeld` reports as held in main. It logs under source `state`: `<id> written by the page while main holds it`. `seq` stays.
- This task does not guard against a write from the old page that lands after the new page's snapshot. The old page's sends leave before its document unloads, and the new page asks for the snapshot after it loads.

**Claims.**

- A claim lives in the store of the process that publishes. Main's store holds main parts' claims, and each page load makes a new store.
- So a page load releases every page claim with no message to main. Main never holds a claim on a page slot.
- `publish` on a key with a live claim throws `Slot "<id>" is held by a live part`.
- Disposing a writer releases only its own claim. A second dispose, or a dispose after another writer took the key, changes nothing.
- `pluginState.publish` throws `Slot "<id>" is not under plugin "<pluginId>"` when `key.id` does not start with `<pluginId>.`. Parts whose `start` takes `any` skip the compile check, so this runtime check earns its place.
- `pluginState.publish` throws `Slot "<id>" is a <key.process> slot, published from <process>` when `key.process` differs from the `process` it was given. The same parts skip the `P` type parameter. Without this check, main could hold a claim on a page slot, and `applyPageWrite` would then refuse every page write to it.
- `store.publish` has neither check. Task 06's core writes and the harness's seeding writers use it.

**What stop leaves.**

| Thing | After the owner's stop | After a page load |
|---|---|---|
| The value | stays in the store | stays in main; the new page reads it from the snapshot |
| The claim | released | gone with the old store |
| The writer | a write does nothing and logs `<id> written after stop` under the plugin id in `<id>` | gone |
| The owner's `on` listeners | disposed by the part's registrations | gone |
| Another plugin's `on` listeners | stay and hear nothing until the next write | gone with their part |
| A notice to readers | none | none |

- The next start calls `publish`, reads the last value through `writer.get()` and rebuilds from it.
- A slot no owner has written reads `undefined`, and a list slot reads `[]`. So does a slot of a disabled plugin.

**The store.**

- Snapshot shape: `SlotSnapshot` in plan.md. A keyed slot crosses as an `entries` array, because a JS object sorts an all-digit key first, and a session id is 8 hex characters. `all()` therefore keeps first-set order through a reload. A list slot crosses the same way, one `[key, items]` pair per key. The store holds keyed and list slots in a `Map`, so a key named `constructor` reads as absent.
- A reader's `on` hears only later changes and does not replay the current value.
- The store keeps the caller's reference and does not clone. A value is not changed after `set`.
- `put`, `replace` and `delete` make a new array. An array a reader holds does not change under it.
- `all()` returns a new map on each call.
- `readById(id, owner)` follows this table. This is the one home of the rule. Task 10 and the comment in `kit.d.ts` follow it.

  | Slot | `get()` | `get(key)` | `on` passes |
  |---|---|---|---|
  | value | the value | `undefined` | `(value)` |
  | keyed | a new `[key, value][]` in first-set order | the entry, or `undefined` for an absent key | `(key, value)` |
  | list | a new `[key, items][]` in first-set order | the items, or `[]` for an absent key | `(key, change)` |
  | no slot for this id | `undefined` | `undefined` | the first write's arguments, by its kind |

- `get()` returns an array and not a `Map`, because a layout reads this as `kit.d.ts` text and gets no compile error. It does not return a plain object, because a plain object sorts an all-digit key first.
- `get(key)` on a list slot returns `[]`, so a layout calls `.map` with no guard.
- `readById` holds only an id. So the kind comes from the slot. `publish`, `load` and `applyRemote` each create the slot. `publish` on an absent slot is no change: no listener runs, no `onWrite` runs and `seq` stays. `snapshot` holds the created slot. An id with no slot reads `undefined`, because the store knows no kind for it.
- The store holds listeners by slot id, apart from the slots. A listener added before the slot exists hears the first write, from a writer or from `applyRemote`. Creating the slot does not drop a listener.
- A listener's throw is caught at `on`. It logs under `listenerOwner` as `<id> listener failed: <error>`, and the other listeners run. This is the text `pluginEvents` writes. `createListeners` alone leaves the tell, so wrap each listener as `pluginEvents` does.
- `applyRemote` tells the listeners and does not run `onWrite`. `load` does neither, and runs before any listener exists.

**Main wiring in `main.ts`.**

- Create the holder after `createMainWindow` and before main parts start.
- `push` sends through `hasQuitStarted ? null : livePage(window)` on `BRIDGE_CHANNELS.stateChanged`. This is the gate `createPluginChannels` takes. With no page, `seq` still moves and the next snapshot holds the change.
- Add `ipcMain.handle(stateSnapshot)` and `ipcMain.on(stateWrite)` beside `serveUiState`'s pattern.
- `MainApiDeps` gains `state: SlotStore`, and `createMainApi` sets `state: pluginState(deps.state, manifest.id, 'main', (handle) => registrations.track(handle))`.

**Page wiring in `renderer.ts`.**

- Call `createPageState(bridge, log)` directly after the `createPageUiState` call, under the same reason as its comment "Read before the plugins start". The store then exists before `startPlugins`.
- `PageApiDeps` gains `state: SlotStore`.
- `createPageApi` sets `state: { ...pluginState(deps.state, manifest.id, 'page', track), forLayouts: layoutState(deps.state, manifest.id, track) }`, with `track` as on main.

**Preload.** `onStateChange` keeps one `ipcRenderer` listener however many registrations it holds, as `onMessage` does.

**Manifests and layer rules.**

- `reads` is required on `PluginManifest` and on `definePlugin`, as `dependsOn` is. `definePlugin` gains `const RM extends string = never` and `const RP extends string = never`. Each manifest writes `reads: { main: [], page: [] }`.
- `dependencyIds`, `dependencyOrder`, `disabledDependencyProblem`, `plugin-host.ts` and the host's `dependency` do not read `reads`. So `reads` adds no start order and no cycle. A disabled or unlisted plugin in `reads` is no config problem. `api.dependency` on a plugin only in `reads` keeps today's throw.
- `folderEntries` adds `reads.main` to the main layer's contracts, `reads.page` to the page layer's, and both to `everyDependency`.
- `requireKnownNames` also checks `reads`: `<id>: reads names <other>, which is no plugin folder`.
- `readReads` reuses `dependsOnLists`. Its error is `<file>: reads must be an object literal with main and page arrays of string literals`.
- `check-layers.mts` fills `reads` in `readPluginFolder`.
- `src/main/state`, `src/renderer/state` and `src/shared/state` need no new layer entry: each falls in its parent's layer. The layer check in `npm run lint` proves it.

**Harness.**

- `createWorld` holds one real `createSlotStore`, or the passed `state`. It logs to `world.logs`.
- `commonApi` gains a `process` parameter, `'main'` from the main harness and `'page'` from the page harness. It adds `state: pluginState(world.state, manifest.id, process, register)`, so `counts()` counts each writer and each `on`.
- The store outlives `stop` and `restart`. Real provider parts in `parts` share it.
- The page fake also sets `forLayouts`. `providerManifest` gains `reads`.

GIVEN a main owner's write and a page that has not finished its snapshot WHEN the snapshot resolves THEN the page holds every change once and in order.

GIVEN a page write WHEN it lands THEN its own listeners ran before main heard it and no push comes back.

GIVEN an owner that stopped WHEN it starts again THEN `publish` succeeds and `writer.get()` returns the last value.

GIVEN a page reload WHEN a page part publishes its old key THEN it does not throw, and it reads the old page's last value.

GIVEN plugin `a` with `reads: { main: [], page: ['b'] }` and `b` in `plugins.disabled` WHEN the config loads THEN no problem shows, and `a` reads `undefined`.

Tests (each names the break it catches):

`src/shared/state/slot-store.test.ts`:

- `publish_KeyHeldByLivePart_ThrowsUntilDisposed` — catches a dropped claim check or a dispose that keeps the claim. Text `Slot "p.v" is held by a live part`.
- `dispose_OldWriterAfterNewClaim_KeepsNewClaim` — catches a dispose that clears the claim by id.
- `writer_AfterDispose_DoesNothingAndLogs` — value unchanged, log `('p', 'p.v written after stop')`. Catches a stopped owner that still writes.
- `value_AfterWriterDisposed_StaysForNextPublish` — catches a stop that clears the value.
- `listPut_ExistingAndNewIds_ReplacesInPlaceOrAppends` with rows for `replace`, `delete` and an absent key reading `[]` — catches an append that duplicates an id.
- `listPut_HeldArray_DoesNotChange` — catches an in-place mutation.
- `delete_AbsentKey_ChangesNothing` with keyed and list rows — catches a phantom change that moves `seq`.
- `listener_Throws_LogsUnderListenerAndOthersRun` — log `('q', 'p.v listener failed: boom')`. Catches a raw `createListeners` tell.
- `on_NewListener_HearsOnlyLaterChanges` — catches a replay on subscribe.
- `write_ListenerWritesAgain_OnWriteSeesWritesInOrder` — catches `onWrite` running after the listeners, which reverses the order across the bridge.
- `applyRemote_TellsListenersAndNotOnWrite` — catches an echo loop.
- `snapshot_ThroughStructuredCloneAndLoad_ReadsEveryKind` — value, keyed and list rows through typed readers, with keyed keys `b`, `12345678`, `a` read back in that order from `all()`. Catches a shape only one side understands, and a snapshot that reorders rows.
- `readById_ByKind_GetAndOnArguments` — rows `(value)`, `(key, value)`, `(key, change)`, and `get('constructor')` on a keyed slot reading `undefined`. `get()` rows: the value; keyed entries with keys `b`, `12345678`, `a` in that order; list `[key, items]` pairs in first-set order. `get('absent')` rows: keyed `undefined`, list `[]`, and a list slot published with no write `[]`. An id with no slot reads `undefined` for `get()` and `get('k')`. Catches a layout that gets another shape than the table in § The store states, such as a `Map` or a reordered object.
- `readById_On_BeforeFirstWrite_HearsFirstWrite` — value, keyed and list rows, each through a writer and through `applyRemote`. Catches listeners held on the slot, which lose the subscription with no error.
- `pluginState_KeyUnderAnotherPlugin_Throws` — text `Slot "q.v" is not under plugin "p"`. Catches a part that skipped the types through `any`.
- `pluginState_KeyOfOtherProcess_Throws` — rows for a page key under a main view and a main key under a page view. Text `Slot "p.v" is a page slot, published from main`. Catches a claim in the wrong process, which makes `applyPageWrite` refuse the owner's writes.

`src/shared/state/slot-store.test-d.ts`:

- `JsonSafe` rows: a string, a nested record, an array of records and a record with an `unknown[]` member compile. A function, `Map`, `Set`, a class with a method and a required `string | undefined` member each carry `@ts-expect-error` at `publish`. Catches a loose `JsonSafe` body.
- `read` rows: own key, a key in `dependsOn`, a key in `reads` and a `core` key compile. A key of another plugin carries `@ts-expect-error`. `publish` of another plugin's key and `publish` of a key of the other process each carry `@ts-expect-error`.

`src/main/state/slot-holder.test.ts`:

- `mainWrite_PushesNextSeq` — catches a push with no `seq` step.
- `pageWrite_MovesSeqAndDoesNotPush` — catches an echo to the page.
- `pageWrite_SlotMainHolds_LoggedAndIgnored` — log `('state', 'p.v written by the page while main holds it')`. Catches a page that overwrites a main value.
- `snapshot_AfterBothKinds_HoldsLastSeqAndValues` — catches a snapshot that misses page writes.

`src/renderer/state/page-state.test.ts`:

- `createPageState_ListensBeforeAsking` — catches a lost push.
- `pushes_BeforeSnapshot_DropsSeenAppliesRestInOrder` — catches double application or a dropped change.
- `push_WithSeqGap_Applies` — catches a `last + 1` check.
- `write_AppliesLocallyThenSendsOnce` — catches a write that waits on main.
- `secondLoad_SameKey_PublishesAndReadsLastValue` — a second `createPageState` over a snapshot holding the old value. Catches claims kept outside the store.

Rows in existing tests:

- `src/main/plugins/main-api.test.ts`: a row each for `state.publish` in `RETURNED_HANDLE_ROWS` and a reader's `on` in `HEARING_ROWS` — catches a registration not filed under the part.
- `src/renderer/plugins/page-api.test.ts`: the same two rows in the table holding the `modes.onChanged` row and the table holding the `keys.onScopeChanged` row, and a `forLayouts` `on` row.
- `src/preload/preload.test.ts`: a row or test in `preload onMessage`'s style — `onStateChange` delivers `(seq, change)`, keeps one `ipcRenderer` listener and stops after dispose.
- `src/shared/plugin-manifests.test.ts`: a row in the `disabledDependencyProblem` table, with a plugin in `reads` disabled → `null`. A `dependencyOrder` row with a mutual `reads` that does not throw and adds no order. Catches `reads` joined to `dependencyIds`.
- `src/shared/plugin-host.test.ts`: `reads` naming a plugin not in the list starts with no throw. Catches `reads` joined to the host's missing check.
- `src/shared/define-plugin.test-d.ts`: `reads` missing carries `@ts-expect-error`. Catches an optional `reads`, which lets a manifest drop the literal the layer check reads.
- `scripts/layer-rules.test.mts`: `pluginLayers` rows for a plugin in `reads.main` and `reads.page` with the contract in that layer only. A `requireKnownNames` row with message `notes: reads names ghost, which is no plugin folder`. `readReads_$case` rows mirroring `readDependsOn_$case`.
- `src/shared/plugin-part-harness.test.ts`: `harness_Restart_KeepsSlotValueAndReleasesClaim`, and `counts()` reporting none after stop for a writer and an `on`. Catches a harness that differs from the real store.

Runtime checks: [Final verification](16-final-verification.md).

Done when: `npm run typecheck` passes; `npm run lint` passes on all 21 manifests (measured at plan time, re-verify); the test gate runs the tests above.

Commit: one commit for the group.

## Proof
