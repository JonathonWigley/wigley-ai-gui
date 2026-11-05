import type { Disposable } from '../../contracts/disposable';

// The workflows or stages one process registers, ascending by order, an entry of
// an order already held placed after it. `add` throws `<id> is already added` on
// a held id; its dispose removes the entry, and does nothing once it is gone.
export interface StageList<T extends { id: string; order: number }> {
  all(): readonly T[];
  add(entry: T): Disposable;
}

export function createStageList<
  T extends { id: string; order: number },
>(): StageList<T> {
  const entries: T[] = [];
  return {
    all: () => entries,
    add(entry) {
      if (entries.some((held) => held.id === entry.id)) {
        throw new Error(`${entry.id} is already added`);
      }
      const at = entries.findIndex((held) => held.order > entry.order);
      entries.splice(at === -1 ? entries.length : at, 0, entry);
      return {
        dispose() {
          const index = entries.indexOf(entry);
          if (index !== -1) {
            entries.splice(index, 1);
          }
        },
      };
    },
  };
}
