import type { Disposable } from '../contracts/disposable';

// Each `add` is its own registration, so one listener added twice is told twice
// until each `dispose`; a second `dispose` does nothing. `tell` runs the
// registrations made before it began, in add order, skipping one disposed
// meanwhile; a listener's throw leaves `tell` and skips the rest.
export interface Listeners<T> {
  add(listener: (data: T) => void): Disposable;
  tell(data: T): void;
}

export function createListeners<T>(): Listeners<T> {
  const registrations = new Set<{ listener: (data: T) => void }>();
  return {
    add(listener) {
      const registration = { listener };
      registrations.add(registration);
      return {
        dispose: () => {
          registrations.delete(registration);
        },
      };
    },
    tell(data) {
      for (const registration of Array.from(registrations)) {
        if (registrations.has(registration)) {
          registration.listener(data);
        }
      }
    },
  };
}
