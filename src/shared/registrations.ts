import type { Disposable, Registrations } from '../contracts/disposable';

// `dispose` disposes every tracked handle in reverse track order, each once, a throw not skipping the rest,
// then throws the first error; a second `dispose` does nothing. `track` after `dispose` disposes the handle at once.
// A handle disposed by its owner is forgotten: `track` wraps the handle's own `dispose` to remove it from the store.
export function createRegistrations(): Registrations & Disposable {
  const handles = new Set<Disposable>();
  let isDisposed = false;
  return {
    track(handle) {
      const ownDispose = handle.dispose;
      let isHandleDisposed = false;
      handle.dispose = () => {
        if (!isHandleDisposed) {
          isHandleDisposed = true;
          handles.delete(handle);
          ownDispose.call(handle);
        }
      };
      if (isDisposed) {
        handle.dispose();
      } else {
        handles.add(handle);
      }
      return handle;
    },
    dispose() {
      isDisposed = true;
      const errors: unknown[] = [];
      for (const handle of [...handles].reverse()) {
        try {
          handle.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw errors[0];
      }
    },
  };
}
