import type { Disposable } from '../../../contracts/disposable';
import { createListeners } from '../../../shared/listeners';
import type { SettingControlKind } from '../contract';

// The settings page's control kinds by id. `add` throws for an id it holds;
// `add` and each registration's first `dispose` tell `onChanged`, and a second
// `dispose` does nothing. `get` is undefined for an id it does not hold.
export interface ControlKinds {
  add(kind: SettingControlKind): Disposable;
  get(id: string): SettingControlKind | undefined;
  onChanged(listener: () => void): Disposable;
}

export function createControlKinds(): ControlKinds {
  const kinds = new Map<string, SettingControlKind>();
  const changed = createListeners<void>();
  return {
    add(kind) {
      if (kinds.has(kind.id)) {
        throw new Error(`control kind ${kind.id} is already registered`);
      }
      kinds.set(kind.id, kind);
      changed.tell();
      let isDisposed = false;
      return {
        dispose() {
          if (isDisposed) {
            return;
          }
          isDisposed = true;
          kinds.delete(kind.id);
          changed.tell();
        },
      };
    },
    get: (id) => kinds.get(id),
    onChanged: (listener) => changed.add(listener),
  };
}
