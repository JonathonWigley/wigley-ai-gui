# 06 — Core slots and events

Status: done
Type: Task
Wave: 5 · Depends on: 05
Plan: [plan.md](plan.md)

Files:

- create `src/contracts/core-state.ts`
- create `src/renderer/state/core-slots.ts` · test `src/renderer/state/core-slots.test.ts`
- create `src/main/state/window-focus-slot.ts` · test `src/main/state/window-focus-slot.test.ts`
- modify `src/contracts/plugin.ts`
- modify `src/renderer/renderer.ts`, `src/main/main.ts`
- test `src/renderer/config-push.test.ts`
- modify `src/renderer/plugins/page-api.ts` · test `src/renderer/plugins/page-api.test.ts`
- modify `src/shared/define-plugin.ts` · test `src/shared/define-plugin.test.ts`
- modify `src/shared/plugin-part-harness.test-support.ts` · test `src/shared/plugin-part-harness.test.ts`
- modify `src/plugins/docs/page/start.ts` · test `src/plugins/docs/page/start.test.ts`
- modify `src/plugins/chat/page/start.ts` · test `src/plugins/chat/page/start.test.ts`
- modify `src/plugins/keys/page/start.ts` · test `src/plugins/keys/page/start.test.ts`
- test `src/shared/state/slot-store.test-d.ts`

Consumes:

- `SlotKey`, `SlotWriter` in `src/contracts/state.ts` ← 05
- `SlotStore`, `createSlotStore`, `store.publish`, `store.onWrite` in `src/shared/state/slot-store.ts` ← 05
- `PluginState.read` on `PageApi.state` and `MainApi.state` ← 05
- `harness.state` ← 05
- `createPageState` in `src/renderer/renderer.ts`, and `createSlotHolder`'s `store` in `src/main/main.ts` ← 05
- `Theme.name` in `src/contracts/theme.ts`, `QualifiedEvents`, `Modes` in `src/contracts/plugin.ts`, `ViewScope` in `src/contracts/keymap.ts`, `ScopeStack.current` and `ScopeStack.onChange` in `src/renderer/key-scope.ts`, `qualify` in `src/shared/plugin-manifests.ts` (tree)

Produces:

`src/contracts/core-state.ts`:

```ts
export const coreModeSlot: SlotKey<string, 'page', 'core'> = { id: 'core.mode', process: 'page', kind: 'value' };
export const coreScopeSlot: SlotKey<ViewScope, 'page', 'core'> = { id: 'core.scope', process: 'page', kind: 'value' };
export const coreThemeSlot: SlotKey<string, 'page', 'core'> = { id: 'core.theme', process: 'page', kind: 'value' };
export const coreWindowFocusedSlot: SlotKey<boolean, 'main', 'core'> = { id: 'core.windowFocused', process: 'main', kind: 'value' };

export interface CoreEvents { pageReady: null; }
```

`src/renderer/state/core-slots.ts`:

```ts
export function startPageCoreSlots(
  store: SlotStore,
  deps: { scope: Pick<ScopeStack, 'current' | 'onChange'>; modes: Pick<Modes, 'onChanged'>; theme: string },
): { themeApplied(name: string): void };
```

`src/main/state/window-focus-slot.ts`:

```ts
export function startWindowFocusSlot(
  store: SlotStore,
  focus: { isFocused(): boolean; onFocusChange(listener: (focused: boolean) => void): void },
): void;
```

`src/contracts/plugin.ts`:

- `export type PageModes = Omit<Modes, 'onChanged'>`, and `PageApi.modes: PageModes`.
- `PageApi.keys.onScopeChanged` removed.

Decisions:

**Can a plugin publish under `core`?** Today it can. `definePlugin`'s `PLUGIN_ID` regex admits the id `core`, and no folder or check refuses it (no plugin folder is named `core`, measured at plan time, re-verify). A plugin with that id would pass `SlotKey<V, P, M['id']>`, pass task 05's runtime check, and emit `core.*` events through `pluginEvents`. This task closes that gap:

- `definePlugin` throws `Plugin id "core" is reserved for the core`.
- A plugin with any other id cannot publish a core slot: the types refuse it, and task 05's `pluginState.publish` throws at run time.
- A plugin with any other id cannot emit a core event: `pluginEvents.emit` qualifies by its own id.
- The `id: 'core'` entries in `src/plugins/settings/page/setting-rows.test.ts` and `src/main/config/user-config.test.ts` are settings sections and not plugins. They do not change.

**How the core writes.**

- The core calls `store.publish(key)` directly on its process's `SlotStore`. It does not use `pluginState`, so the owner check does not apply.
- The writers live as long as their store and the core never disposes them.
- The core emits with `bus.emit(qualify('core', 'pageReady'), null)` on the page bus. It does not use `pluginEvents`.
- Parts read core slots with no manifest entry, because task 05's `ReadableOwner` holds `'core'`. A part hears the event by naming `QualifiedEvents<'core', CoreEvents>` in its `Heard`, with no `dependsOn` entry.

**Boot order on the page.** After a reload, the snapshot holds the old page's `core.*` values. No part may read them.

- Call `startPageCoreSlots` in `renderer.ts` after `createScopeStack` and `createModes`, and before `startPlugins`.
- It writes these before it returns: `core.mode` as `''`, `core.scope` as `scope.current()`, `core.theme` as `deps.theme`.
- `''` means no mode shows yet. `modes.shown()` throws in that state, so no real id is available. State this in the comment on `coreModeSlot`.
- `deps.theme` is `config.theme.name`, for the reason in § Later writes on the page.

**Later writes on the page.**

- `scope.onChange` sets `core.scope`. `modes.onChanged` sets `core.mode`.
- `Modes.onChanged` stays on the core's own registry for this one listener, with `createModes` and `src/renderer/shell/modes.test.ts` unchanged.
- `themeApplied(name)` sets `core.theme` only when `name` differs from the slot, because each config push re-applies the theme.
- Call `themeApplied(theme.name)` in `renderer.ts`'s `applier.apply`, the wrapper `createConfigPush` takes, after `themeApplier.apply(theme, applied)` and `shell.reloadBarOpenWidths()`. `applyPush` makes no call.
- `createConfigPush` runs `applier.apply` before `live.replace`. So the slot changes in the same step as the CSS, and a part's settings listener reads the new name. `createConfigPush` applies the theme on every push, a refused keymap included, so the slot always matches. A theme file edit under one name writes nothing. `visualFrames.themeApplied` stays as it is.
- The slot holds `Theme.name` and not `settings.theme`. The two are equal when the theme resolves, because `resolveTheme` finds a theme by the `name` member of its file and not by its file name. They differ when the theme named in `settings.json` fails to resolve: `themeSlice` in `src/main/config/config-store.ts` keeps the last good theme, and `settings.theme` holds the failed name. `Theme.name` then names the theme on screen.

**Main.**

- `startWindowFocusSlot` writes `window.isFocused()` at once, then `true` on `focus` and `false` on `blur`.
- `main.ts` calls it after `createSlotHolder` and before main parts start. It passes the `BrowserWindow`'s `on('focus')` and `on('blur')` through `onFocusChange`.
- The listener takes the boolean from the event, so it never calls a destroyed window.
- `services.window.isFocused` stays.

**`core.pageReady`.**

- It is a moment on the page bus, once per load.
- Emit it in `renderer.ts` directly before `document.body.dataset.ready = 'true'`, after `applyPush` has run `heldPush`. Each part has started and heard the current config.
- A main part does not hear it. `chat/page/start.ts`'s `loaded` invoke stays, because a main part needs that call.
- No part consumes the event in this task. Tasks 11 and 13 add the first listeners, for their catch-up reads. `renderer.ts` has no `await` between `startPlugins` and this emit, so a listener runs synchronously after every part start.

**Replacing the callers.** The pull members `keys.scope()` and `modes.shown()` stay. Only the two change hooks go. Grep at plan time (measured at plan time, re-verify with `grep -rnE 'onScopeChanged|modes\.onChanged' src`):

| Site | Now | After |
|---|---|---|
| `src/plugins/docs/page/start.ts` | `api.modes.onChanged((modeId) => …)` | `api.state.read(coreModeSlot).on((modeId) => …)`, body unchanged |
| `src/plugins/chat/page/start.ts` | `onScopeChanged: (listener) => api.keys.onScopeChanged(() => listener())` | `onScopeChanged: (listener) => api.state.read(coreScopeSlot).on(() => listener())` |
| `src/plugins/keys/page/start.ts` | `keys.onScopeChanged(() => anchors.applyVisibility())` | `api.state.read(coreScopeSlot).on(() => anchors.applyVisibility())` |
| `src/plugins/keys/page/start.ts` | `onScopeChanged: (listener) => keys.onScopeChanged(listener)` | reads `coreScopeSlot`; calls `listener(scope)` only when `scope !== undefined` |
| `src/renderer/plugins/page-api.ts` | `keys.onScopeChanged` and `modes.onChanged` members | removed |
| `src/shared/plugin-part-harness.test-support.ts` | `onScopeChanged: liveHandle`, and `onChanged` in `fakeModes` | removed |
| `src/shared/plugin-part-harness.test.ts` | `api.keys.onScopeChanged(() => {})` in the part that leaves things live | `api.state.read(coreScopeSlot).on(() => {})` |
| `src/renderer/plugins/page-api.test.ts` | rows `modes.onChanged` and `keys.onScopeChanged` | rows removed; task 05's `state` rows hold the rule |

- The deps named `onScopeChanged` in `src/plugins/chat/page/chat-view.ts` and `src/plugins/keys/page/unplaced-log.ts`, and their tests, keep their names and shape. They are each view's own seam.
- Update the comments in `src/contracts/plugin.ts` that describe `keys.onScopeChanged` and `modes.onChanged`. Point them at `coreScopeSlot` and `coreModeSlot`.
- The harness writes no core slot by itself, as its old members ran no listener. A part test writes through `harness.state.publish(coreScopeSlot)`, once, and calls `set(value)` on the writer it keeps (task 05 § Part harness). A part only reads `core.*`, so this claim blocks no part. `world.scope` and `keys.scope()` stay separate.

**Timing.** A scope change now reaches listeners through the slot, inside the same synchronous `scope.onChange` call. It also sends one `stateWrite`.

**The accepted change for a listener that throws.** Today `modes.onChanged` and `scopeStack.onChange` use a bare `createListeners` tell. A throw leaves the tell, skips the later listeners and reaches the code that switched the mode or changed the scope. After this task, the core's one listener writes the slot, and the store catches each listener's throw. It logs `<id> listener failed: <error>` under the listening plugin, and the other listeners run (task 05). The core registers its listener before any part starts, so the slot is written before any part hears the change. This task adds no other code for this.

GIVEN a reload with old `core.*` values in the snapshot WHEN a page part reads them in its `start` THEN it reads `''` for the mode, the current scope and the current theme name.

GIVEN a part listening on `coreScopeSlot` WHEN a pushed scope pops THEN it hears the new scope in the same call, as it did through `keys.onScopeChanged`.

GIVEN a config push with the same theme name WHEN the page applies it THEN `core.theme` stays and no `stateWrite` goes.

GIVEN a config push with a new theme name WHEN a part's settings listener reads `core.theme` THEN it reads the new name.

GIVEN a manifest with id `core` WHEN `definePlugin` runs THEN it throws.

Tests (each names the break it catches):

- `src/renderer/state/core-slots.test.ts`:
  - `startPageCoreSlots_SnapshotHoldsOldValues_WritesCurrentOnes` — a store loaded with old `core.*` values reads `''`, the current scope and the theme. Catches a part reading the last page's mode.
  - `scopeChange_WritesScopeSlot` with a row for a mode change — catches a lost subscription.
  - `themeApplied_SameName_WritesNothing` with a new-name row, counted through `onWrite` — catches a write on each config push.
- `src/renderer/config-push.test.ts`: `push_NewTheme_AppliesThemeBeforeLiveReplace` — records the order of the two calls. Catches a push that tells the settings listeners first, so that a listener reads the old `core.theme`.
- `src/main/state/window-focus-slot.test.ts`: `startWindowFocusSlot_WritesNowThenEachChange` — rows for the first value, focus and blur. Catches a slot that is empty until the first focus change.
- `src/shared/define-plugin.test.ts`: a row beside `an id holding a dot throws naming the id`, with text `Plugin id "core" is reserved for the core`. Catches a plugin that takes the core's namespace.
- `src/shared/state/slot-store.test-d.ts`: rows with the real keys. `api.state.read(coreModeSlot).get()` is `string | undefined`. `api.state.publish(coreModeSlot)` carries `@ts-expect-error`. Catches a core key typed so that plugins can publish it.
- `src/plugins/keys/page/start.test.ts`: `start_ScopeSlotChanges_AppliesAnchorVisibility`, through `harness.state`. Catches a dropped subscription, which the compiler cannot see.
- `src/plugins/docs/page/start.test.ts`: `start_ModeSlotChanges_TracksDocsModeShown`, through `harness.state` and the behaviour `isDocsModeShown` gates. Catches the same.
- `src/plugins/chat/page/start.test.ts`: `start_ScopeSlotChanges_TellsTabStops`, through `harness.state` and a shown tab's stop. Catches the same.
- `src/shared/plugin-part-harness.test.ts`: the replaced line keeps its existing expectation on the count left after a leaky stop.

Runtime checks: [Final verification](16-final-verification.md).

Done when: `npm run typecheck` passes; `grep -rnE 'keys\.onScopeChanged|api\.modes\.onChanged' src` prints nothing; `npm run lint` passes; the test gate runs the tests above.

Commit: one commit for the group.

## Proof

Commit dd6d5088 · proof: Diff read; core-state, startPageCoreSlots, startWindowFocusSlot, the definePlugin throw and the callers' moves present; typecheck and lint clean; the hooks grep prints nothing. · concerns: core.mode stays '' after the first mode shows until the first switch, and keeps the old id when the last mode is disposed, because createModes.add tells no change: a layout reading core.mode through task 10 sees this; renderer and main wiring reach no test (task 16); three stateWrites at each page load.
