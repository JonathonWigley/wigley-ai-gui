import type { Disposable } from '../../../contracts/disposable';
import type { SessionRowPart } from '../contract';

// The row parts other plugins added, in add order. `add` throws on an id
// already held, and its `Disposable` removes the part; `onChanged` hears each
// add and each removal.
export interface SessionRowParts {
  add(part: SessionRowPart): Disposable;
  parts(): SessionRowPart[];
  onChanged(listener: () => void): Disposable;
}

export function createSessionRowParts(): SessionRowParts {
  const held: SessionRowPart[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    add(part) {
      if (held.some((each) => each.id === part.id)) {
        throw new Error(`row part ${part.id} is already added`);
      }
      held.push(part);
      notify();
      let isDisposed = false;
      return {
        dispose() {
          if (isDisposed) {
            return;
          }
          isDisposed = true;
          held.splice(held.indexOf(part), 1);
          notify();
        },
      };
    },
    parts: () => [...held],
    onChanged(listener) {
      // A wrapper per add, so each handle removes only its own add.
      const wrapped = () => listener();
      listeners.add(wrapped);
      return { dispose: () => listeners.delete(wrapped) };
    },
  };
}
