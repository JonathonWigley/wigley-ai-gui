import type { Disposable } from '../../../contracts/disposable';
import type { SessionPart } from '../contract';

// The session parts other plugins added to one sessions surface, in add
// order. `add` throws on an id already held, and its `Disposable` removes the
// part; `onChanged` hears each add and each removal.
export interface SessionPartStore {
  add(part: SessionPart): Disposable;
  parts(): SessionPart[];
  onChanged(listener: () => void): Disposable;
}

export function createSessionPartStore(): SessionPartStore {
  const held: SessionPart[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    add(part) {
      if (held.some((each) => each.id === part.id)) {
        throw new Error(`part ${part.id} is already added`);
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
