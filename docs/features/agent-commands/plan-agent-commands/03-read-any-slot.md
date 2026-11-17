# 03 — Read any slot

Status: not started
Type: Task
Rung: hard · adds the `readsEverySlot` declaration and the main state members that 08 consumes
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- modify `src/contracts/plugin.ts`
- modify `src/shared/state/slot-store.ts`
- modify `src/main/plugins/main-api.ts`
- modify `src/shared/plugin-catalog/validate-manifest.ts`
- modify `src/shared/plugin-catalog/manifest-schema.ts`
- test `src/shared/state/slot-store.test.ts`
- test `src/main/plugins/main-api.test.ts`
- test `src/shared/plugin-catalog/validate-manifest.test.ts`

Consumes:  none from other groups; 01 lists the same contract and validator files, so this group follows it.
           In the tree: `SlotStore.snapshot()`, `SlotSnapshot` (`src/contracts/state.ts`), `pluginState(...)`,
           `createMainApi(...)`, `MANIFEST_FIELDS`
Produces:  `readsEverySlot?: true` on `PluginManifest` in `src/contracts/plugin.ts`
           `export interface MainPluginState<M extends PluginManifest> extends PluginState<M, 'main'> { readAny(id: string): SlotSnapshot | undefined; slotIds(): readonly string[] }` in `src/contracts/plugin.ts`
           `MainApi.state: MainPluginState<M>` in `src/contracts/plugin.ts`
           `snapshotOf(id: string): SlotSnapshot | undefined` and `ids(): readonly string[]` on `SlotStore` in `src/shared/state/slot-store.ts`

Decisions:
- The reach is a manifest declaration, not a list of plugin ids in the core: a built-in has no more reach than a user
  plugin (AGENTS.md § Intent, design review).
- Main only. The page's `PluginState` is unchanged.
- `readAny(id)` returns the slot's `SlotSnapshot` (value, or keyed entries, or list entries, in first-set order), or
  `undefined` for an id with no slot. It is a read of the moment: no listener.
- `slotIds()` returns every slot id the store holds, sorted.
- Both throw `Error('Plugin "<id>" does not declare readsEverySlot')` for a plugin whose manifest lacks
  `readsEverySlot: true`. The check runs at the call, so a manifest without it still starts.
- `SlotStore.snapshotOf(id)` copies one slot as `snapshot()` copies every slot; `ids()` lists the store's ids. Neither
  creates a slot.
- In a user plugin's manifest `validateManifest` accepts `readsEverySlot` only as `true`, problem text
  `readsEverySlot must be true` otherwise; the JSON Schema declares it as `{ const: true }`; `MANIFEST_FIELDS` gains it
  (the compiler requires it there).

GIVEN a keyed slot `p.k` with entries `a` and `b` WHEN `snapshotOf('p.k')` runs THEN it returns `{ kind: 'keyed', entries: [['a', …], ['b', …]] }`, and an absent id returns undefined without creating a slot
GIVEN a manifest with `readsEverySlot: true` WHEN its main part calls `api.state.readAny('core.mode')` THEN it gets the snapshot
GIVEN a manifest without it WHEN its main part calls `readAny` or `slotIds` THEN each throws `Plugin "<id>" does not declare readsEverySlot`

Tests:
- `src/shared/state/slot-store.test.ts`: new `describe('snapshotOf and ids')` with one `it.each` over the three slot
  kinds plus an absent id (literal expected snapshots), and one `it` that `ids()` lists each slot once, sorted.
- `src/main/plugins/main-api.test.ts`: one `it.each` `readAny and slotIds read every slot only for a manifest that
  declares readsEverySlot` (rows: declared → snapshot and ids; not declared → each throws the text above).
- `src/shared/plugin-catalog/validate-manifest.test.ts`: add rows to the existing fault table for `readsEverySlot:
  false` and `readsEverySlot: 1`, and add `readsEverySlot: true` to the every-field manifest.

Done when: `npm run typecheck` passes; the test gate runs the tests above.
Commit:    one commit for the group
