# 03 — Slot store clears an owner

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/state.ts` (`SlotChange`)
- modify `src/shared/state/slot-store.ts` · test `src/shared/state/slot-store.test.ts`
- modify `src/main/state/slot-holder.ts` · test `src/main/state/slot-holder.test.ts`
- test `src/renderer/state/page-state.test.ts` (one row added); read `src/renderer/state/page-state.ts`: no change. Its `applyNewer` hands every pushed change to `store.applyRemote`, so a `cleared` change from main applies there once `applyRemote` takes it.

Consumes:
- `SlotStore`, `createSlotStore`, `applyChange`, `listenerArguments`, `tellListeners` in `src/shared/state/slot-store.ts`; `createSlotHolder` in `src/main/state/slot-holder.ts` (the tree holds them).

Produces:
- `src/contracts/state.ts`: `SlotChange` gains `| { id: string; kind: 'cleared' }`.
- `src/shared/state/slot-store.ts`: `SlotStore` gains `clearOwner(pluginId: string): void`.
- `src/main/state/slot-holder.ts`: `SlotHolder` gains `clearOwner(pluginId: string): void`.
- The thrown text `Slot "<id>" is held by a live part` (the text `claim` throws today).

Decisions:
- **What `clearOwner` clears.** Every slot whose id starts with `${pluginId}.`, the dot included. So `clearOwner('chat')` leaves `chat-x.v` untouched. It walks the slots in the store's own order (first created first).
- **A live writer refuses the whole clear.** It checks every matching slot first. When `isHeld(id)` is true for one, it throws `Slot "<id>" is held by a live part`, naming the first held one, and clears nothing.
- **A cleared slot keeps its kind.** A value slot reads `undefined`. A keyed slot's `all()` is an empty map, and `readById(id).get()` is `[]`. A list slot's `get(key)` is `[]` for every key, and `readById(id).get()` is `[]`. The next `publish` of the same key succeeds and reads `undefined` (or `[]`).
- **What a reader hears (agent).** A keyed or list listener's signature carries a key, so one call per slot has no key to give. Each listener hears the clear as the deletes it is: a value slot's listener hears `(undefined)` once; a keyed slot's listener hears `(key, undefined)` once per entry, in first-set order; a list slot's listener hears `(key, { kind: 'delete' })` once per key, in first-set order. `readById` listeners hear the same arguments. So a reader such as `followRows` runs its `removed` per entry with no new code.
- **An empty slot is no change.** A value slot that reads `undefined`, or a keyed or list slot with no entry, is skipped: no `onWrite`, no listener, no `seq`. This matches "a delete of an absent key is no change".
- **Every slot empties before anyone hears.** `clearOwner` first empties every matching slot, then for each slot tells `onWrite` and queues its listeners through `tellListeners`. A listener of one slot that reads a sibling slot of the same owner finds it empty. A throw from `onWrite` follows the existing rule: the state stays updated and no listener runs.
- **Only main clears.** `SlotHolder.applyPageWrite` logs `ignored a cleared change from the page: <id>` under source `state` and ignores a `kind: 'cleared'` change, so main and the page stay in step.
- **The wire carries one change per slot.** For each slot it empties, `clearOwner` tells `onWrite` once with `{ id, kind: 'cleared' }`, then tells that slot's listeners, as a writer's change does. `applyRemote({ id, kind: 'cleared' })` empties the slot and tells the listeners the same way, and does not tell `onWrite`. `applyRemote` of `cleared` for an absent slot creates no slot and runs nothing. `applyRemote` checks no claim, as today.
- **The holder numbers each clear.** `SlotHolder.clearOwner(pluginId)` calls `store.clearOwner(pluginId)`. The holder's existing `onWrite` listener then gives each `cleared` change the next `seq` and pushes it. The push covers every slot under the owner, page-owned slots included, so the page mirror empties them too. Update the `SlotHolder` comment: `push` sends main writers' changes and every `cleared` change.
- No caller calls `clearOwner` in this task. Task 08's switch calls `SlotHolder.clearOwner` for each plugin it switches off.
- Update the doc comments on `SlotStore` and on `SlotChange` to state the rules above.

GIVEN `p.v` = 1, `p.k` holds `x` and `y`, `p.l` holds key `a`, and `p-x.v` = 5, with no live writer WHEN `clearOwner('p')` runs THEN the three `p.` slots read empty, `p-x.v` reads 5, and `onWrite` hears three `cleared` changes
GIVEN a live writer holds `p.v` WHEN `clearOwner('p')` runs THEN it throws `Slot "p.v" is held by a live part` and every `p.` slot keeps its value
GIVEN the holder at `seq` 2 WHEN `clearOwner('p')` clears `p.v` and `p.page` THEN it pushes `[3, { id: 'p.v', kind: 'cleared' }]` and `[4, { id: 'p.page', kind: 'cleared' }]`

Tests:
- New in `slot-store.test.ts`, `describe('clearOwner')`:
  - `clearOwner_EveryKind_EmptiesOwnersSlotsAndTellsEachEntry`. Publish `p.v` and set `1`, `p.k` and set `x` = 1, `y` = 2, `p.l` and put `A1` under `a`, and `{ id: 'p-x.v', process: 'main', kind: 'value' }` and set `5`; dispose every writer. Add `readById` listeners on `p.v`, `p.k`, `p.l` and `p-x.v`, and an `onWrite` listener. Then `clearOwner('p')`. Assert: `p.v` hears `[[undefined]]`; `p.k` hears `[['x', undefined], ['y', undefined]]`; `p.l` hears `[['a', { kind: 'delete' }]]`; `p-x.v` hears `[]`; `onWrite` hears `[{ id: 'p.v', kind: 'cleared' }, { id: 'p.k', kind: 'cleared' }, { id: 'p.l', kind: 'cleared' }]`; `readById('p.v').get()` is `undefined`, `readById('p.k').get()` and `readById('p.l').get()` are `[]`, `readById('p-x.v').get()` is `5`.
  - `clearOwner_LiveWriter_ThrowsAndClearsNothing`. Publish `p.k`, set `x` = 1, dispose it. Publish `p.v`, set `1`, and keep it live. `clearOwner('p')` throws `'Slot "p.v" is held by a live part'`; `readById('p.k').get()` is `[['x', 1]]`; the `onWrite` listener heard only the two sets.
- Add rows to `delete_AbsentKey_ChangesNothing` (its listeners sit on `p.k`, `p.l` and `onWrite`):
  - `{ case: 'clear of empty slots', act: (store) => { store.publish(keyedKey).dispose(); store.publish(listKey).dispose(); store.clearOwner('p'); } }`
  - `{ case: 'remote clear of an absent slot', act: (store) => store.applyRemote({ id: 'p.k', kind: 'cleared' }) }`
- Turn `applyRemote_TellsListenersAndNotOnWrite` into an `it.each` with two rows. Row `value` is the test as it stands. Row `cleared`: after `applyRemote({ id: 'p.v', kind: 'value', value: 5 })`, `applyRemote({ id: 'p.v', kind: 'cleared' })` makes the value listener hear `[5, undefined]`, `writes` stays `[]`, and `get()` reads `undefined`.
- Add to the `applyRemote` table: row `cleared keyed`, a keyed slot with two entries, whose listener hears `(key, undefined)` once per entry; row `cleared list`, a list slot with two keys, whose listener hears `(key, {kind:'delete'})` once per key. Each asserts `writes` stays `[]`.
- Add to the first `clearOwner` test: a listener of `p.v` reads `p.k` and finds it empty. Break: slots are emptied one at a time between listeners.
- New in `slot-holder.test.ts`: `applyPageWrite_Cleared_IsIgnoredAndLogged`: the slot keeps its value, `seq` does not move, and the log holds the line.
- New row in `page-state.test.ts`: a pushed `[seq, { id, kind: 'cleared' }]` empties the mirror's slot and tells its listener.
- New in `slot-holder.test.ts`: `clearOwner_PushesEachClearedSlotWithNextSeq`. `holder.store.publish(mainSlot)` sets `1` and is disposed (seq 1); `holder.applyPageWrite(pageChange)` (seq 2); `holder.store.publish({ id: 'q.v', process: 'main', kind: 'value' })` sets `7` (seq 3). Clear the pushes, then `holder.clearOwner('p')`. Assert pushes equal `[[4, { id: 'p.v', kind: 'cleared' }], [5, { id: 'p.page', kind: 'cleared' }]]`, `holder.snapshot().seq` is `5`, and `holder.snapshot().slots['q.v']` is `{ kind: 'value', value: 7 }`.

Done when: `npm run typecheck` passes; the test gate runs `slot-store.test.ts`, `slot-holder.test.ts` and `src/renderer/state/page-state.test.ts`.

Commit: one commit for the group

## Proof
