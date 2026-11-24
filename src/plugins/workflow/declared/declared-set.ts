import type { Disposable } from '../../../contracts/disposable';
import type { KeyedSlotWriter } from '../../../contracts/state';
import type { DeclaredWorkflow } from '../contract';

// The declarations main enables: `contributed` first, then `added` (the
// self-test's `addDeclared` entries), an id already listed left out.
export function mergeDeclared(
  contributed: readonly DeclaredWorkflow[],
  added: readonly DeclaredWorkflow[],
): DeclaredWorkflow[] {
  const list: DeclaredWorkflow[] = [];
  for (const entry of [...contributed, ...added]) {
    if (!list.some((held) => held.id === entry.id)) {
      list.push(entry);
    }
  }
  return list;
}

// Writes `list` into `workflow.declared`: the slot is emptied when its keys
// are not `list`'s ids in order, then each entry is set unless the slot holds
// it already.
export function publishDeclared(
  slot: KeyedSlotWriter<DeclaredWorkflow>,
  list: readonly DeclaredWorkflow[],
): void {
  const keys = [...slot.all().keys()];
  const isSameOrder =
    keys.length === list.length &&
    keys.every((key, index) => key === list[index].id);
  if (!isSameOrder) {
    for (const key of keys) {
      slot.delete(key);
    }
  }
  for (const entry of list) {
    const held = slot.get(entry.id);
    if (held === undefined || JSON.stringify(held) !== JSON.stringify(entry)) {
      slot.set(entry.id, entry);
    }
  }
}

// One registration per declared id. `sync` registers an entry through `build`
// when its id is new, builds it again when the entry changed and disposes it
// when the entry is `undefined`; an unchanged entry is left alone.
export interface DeclaredRegistry {
  sync(id: string, entry: DeclaredWorkflow | undefined): void;
  // Syncs every entry of `list` and disposes each registration whose id the
  // list lacks.
  syncList(list: readonly DeclaredWorkflow[]): void;
}

export function createDeclaredRegistry(
  build: (entry: DeclaredWorkflow) => Disposable,
): DeclaredRegistry {
  const held = new Map<string, { json: string; registration: Disposable }>();
  const sync = (id: string, entry: DeclaredWorkflow | undefined) => {
    const current = held.get(id);
    const json = entry === undefined ? null : JSON.stringify(entry);
    if (current?.json === json) {
      return;
    }
    current?.registration.dispose();
    held.delete(id);
    if (entry !== undefined && json !== null) {
      held.set(id, { json, registration: build(entry) });
    }
  };
  return {
    sync,
    syncList(list) {
      for (const id of held.keys()) {
        if (!list.some((entry) => entry.id === id)) {
          sync(id, undefined);
        }
      }
      for (const entry of list) {
        sync(entry.id, entry);
      }
    },
  };
}
