import type { Disposable } from '../../../contracts/disposable';
import type { FormsCardPart, FormsReviewColumn, ItemKind } from '../contract';

// The card parts and review columns other plugins added, in add order. Each
// `add` throws on an id already held, and its `Disposable` removes the part
// or column; `onChanged` hears each add and each removal.
export interface FormsContributions {
  addCardPart(part: FormsCardPart): Disposable;
  addReviewColumn(column: FormsReviewColumn): Disposable;
  cardParts(kind: ItemKind): FormsCardPart[];
  reviewColumns(): FormsReviewColumn[];
  onChanged(listener: () => void): Disposable;
}

export function createFormsContributions(): FormsContributions {
  const parts: FormsCardPart[] = [];
  const columns: FormsReviewColumn[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    addCardPart: (part) => addEntry(parts, part, 'card part', notify),
    addReviewColumn: (column) =>
      addEntry(columns, column, 'review column', notify),
    cardParts: (kind) => parts.filter((part) => part.kinds.includes(kind)),
    reviewColumns: () => [...columns],
    onChanged(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
}

// Appends `entry` to `entries` and notifies; the returned `dispose` removes
// it and notifies once, and does nothing after that.
function addEntry<T extends { id: string }>(
  entries: T[],
  entry: T,
  noun: string,
  notify: () => void,
): Disposable {
  if (entries.some((held) => held.id === entry.id)) {
    throw new Error(`${noun} ${entry.id} is already added`);
  }
  entries.push(entry);
  notify();
  return {
    dispose() {
      const position = entries.indexOf(entry);
      if (position < 0) {
        return;
      }
      entries.splice(position, 1);
      notify();
    },
  };
}
