import type { Disposable } from '../../../contracts/disposable';
import type { BackendKind } from '../contract';

// The backend kinds backend plugins added. `add` throws for a kind string another live registration holds. Each add
// and each first `dispose` of an add tells every listener; a second `dispose` does nothing. `kinds` lists the live
// kind strings, sorted.
export interface BackendRegistry {
  add(kind: BackendKind): Disposable;
  get(kind: string): BackendKind | null;
  kinds(): string[];
  onChanged(listener: () => void): Disposable;
}

export function createBackendRegistry(): BackendRegistry {
  const live = new Map<string, BackendKind>();
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return {
    add(kind) {
      if (live.has(kind.kind)) {
        throw new Error(`backend kind "${kind.kind}" is already added`);
      }
      live.set(kind.kind, kind);
      tell();
      let isDisposed = false;
      return {
        dispose() {
          if (isDisposed) {
            return;
          }
          isDisposed = true;
          live.delete(kind.kind);
          tell();
        },
      };
    },
    get: (kind) => live.get(kind) ?? null,
    kinds: () => [...live.keys()].sort(),
    onChanged(listener) {
      const added = () => listener();
      listeners.add(added);
      return {
        dispose() {
          listeners.delete(added);
        },
      };
    },
  };
}
