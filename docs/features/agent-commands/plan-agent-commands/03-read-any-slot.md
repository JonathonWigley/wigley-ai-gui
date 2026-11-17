# 03 — Read any slot

Status: in progress
Type: Task
Rung: hard · adds the `readsEverySlot` declaration and the main state members that 08 consumes
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- modify `src/contracts/plugin.ts`
- modify `src/shared/define-plugin.ts`
- modify `src/shared/state/slot-store.ts`
- modify `src/main/plugins/main-api.ts`
- modify `src/shared/plugin-part-harness.test-support.ts`
- modify `src/shared/plugin-catalog/validate-manifest.ts`
- modify `src/shared/plugin-catalog/manifest-schema.ts`
- modify `src/shared/plugin-catalog/manifest.test-support.ts`
- test `src/shared/state/slot-store.test.ts`
- test `src/main/plugins/main-api.test.ts`
- test `src/shared/plugin-catalog/validate-manifest.test.ts`

Consumes:  none from other groups. 01 lists the same contract, harness and validator files, so this group follows it.
           In the tree: `SlotStore.snapshot()`, `SlotSnapshot` (`src/contracts/state.ts`), `pluginState(...)`,
           `createMainApi(...)`, `MANIFEST_FIELDS`, `definePlugin`
Produces:  `readsEverySlot?: true` on `PluginManifest` in `src/contracts/plugin.ts`, and on `definePlugin`'s `manifest` parameter in `src/shared/define-plugin.ts`
           `export interface MainPluginState<M extends PluginManifest> extends PluginState<M, 'main'> { readAny(id: string): SlotSnapshot | undefined; slotIds(): readonly string[] }` in `src/contracts/plugin.ts`
           `MainApi.state: MainPluginState<M>` in `src/contracts/plugin.ts`
           `snapshotOf(id: string): SlotSnapshot | undefined` and `ids(): readonly string[]` on `SlotStore` in `src/shared/state/slot-store.ts`
           `export function mainPluginState<M extends PluginManifest>(store: SlotStore, manifest: M, track: …): MainPluginState<M>` in `src/shared/state/slot-store.ts`

Decisions:
- The reach is a manifest declaration, not a list of plugin ids in the core: a built-in has no more reach than a user
  plugin (AGENTS.md § Intent, design review).
- Main only. The page's `PluginState` is unchanged.
- `definePlugin`'s `manifest` parameter gains `readsEverySlot?: true`. Without it, 08's `definePlugin` call fails the
  excess-property check, and the return type drops the field.
- **One helper owns the check.** `mainPluginState(store, manifest, track)` in `slot-store.ts` returns
  `pluginState(store, manifest.id, 'main', track)` plus `readAny` and `slotIds`. Both `createMainApi` and the plugin
  harness's main API call it, so the error text lives in one place.
- `readAny(id)` returns the slot's `SlotSnapshot`: a value, or keyed entries, or list entries, in first-set order. It is
  a read of the moment, with no listener.
- `slotIds()` returns every slot id the store holds, in code-unit order (`[...ids].sort()`).
- **Empty slots.** A slot the store created but nothing wrote (through `publish`, `load` or `applyRemote`) is listed
  by `ids()`, and `snapshotOf` returns its empty snapshot (`{ kind: 'value', value: undefined }` for a value slot).
  Only an id the store never created gives `undefined`.
- `readAny` and `slotIds` each throw `Error('Plugin "<id>" does not declare readsEverySlot')` for a plugin whose
  manifest lacks `readsEverySlot: true`. The check runs at the call, so a manifest without it still starts.
- `SlotStore.snapshotOf(id)` copies one slot as `snapshot()` copies every slot, and `ids()` lists the store's ids.
  Neither creates a slot.
- **In a user plugin's manifest:**
  - `validateManifest` accepts `readsEverySlot` only as `true`; otherwise the problem text is `readsEverySlot must be
    true`.
  - The JSON Schema declares it as `{ const: true }`.
  - `MANIFEST_FIELDS` gains it, since the compiler requires it there.
  - `validManifest()` in `manifest.test-support.ts` gains `readsEverySlot: true`.

GIVEN a keyed slot `p.k` with entries `a` and `b` WHEN `snapshotOf('p.k')` runs THEN it returns `{ kind: 'keyed', entries: [['a', …], ['b', …]] }`
GIVEN an id the store never created WHEN `snapshotOf` runs THEN it returns undefined, and `ids()` is the same before and after
GIVEN a slot created by `publish` and never written WHEN `snapshotOf` and `ids()` run THEN the slot is listed and its snapshot is empty
GIVEN a manifest with `readsEverySlot: true` WHEN its main part calls `api.state.readAny('core.mode')` THEN it gets the snapshot
GIVEN a manifest without it WHEN its main part calls `readAny` or `slotIds` THEN each throws `Plugin "<id>" does not declare readsEverySlot`

Tests:
- `src/shared/state/slot-store.test.ts`, a new `describe('snapshotOf and ids')` with:
  - one `it.each` over the three slot kinds, an empty created slot and an absent id, each with a literal expected
    snapshot; the absent row also asserts `ids()` unchanged
  - one `it` that `ids()` lists each slot once, in code-unit order (rows `B`, `a`, `A`)
- `src/main/plugins/main-api.test.ts`: one `it.each` `readAny and slotIds read every slot only for a manifest that
  declares readsEverySlot`. Rows: declared gives the snapshot and the ids; not declared makes each throw the text
  above.
- `src/shared/plugin-catalog/validate-manifest.test.ts`: add rows to the existing fault table for `readsEverySlot:
  false` and `readsEverySlot: 1`.

Done when: `npm run typecheck` passes; the test gate runs the tests above.
Commit:    one commit for the group
