import type { Timers } from '../../../contracts/ambient';
import type { BuildBackend, GameEntry } from '../contract';

// The longest an apply waits for a replaced instance's calls to settle before it creates the entry's next instance.
export const DRAIN_TIMEOUT_MS = 30_000;

// A backend whose `drained` resolves true once every call begun on it has settled, or false when `DRAIN_TIMEOUT_MS`
// passes first. After `dispose`, a call rejects without reaching the backend, so `drained` covers every call it gets.
export interface TrackedBackend extends BuildBackend {
  drained(): Promise<boolean>;
}

// `backend` with its `list`, `queue` and `cancel` calls tracked; `dispose` disposes `backend`.
export function trackCalls(
  backend: BuildBackend,
  timers: Timers,
): TrackedBackend {
  const pending = new Set<Promise<void>>();
  let isDisposed = false;

  function track<T>(call: () => Promise<T>): Promise<T> {
    if (isDisposed) {
      return Promise.reject(new Error('the backend was replaced; try again'));
    }
    const running = call();
    const settled = running.then(
      () => undefined,
      () => undefined,
    );
    pending.add(settled);
    void settled.then(() => pending.delete(settled));
    return running;
  }

  const cancel = backend.cancel?.bind(backend);
  return {
    capabilities: backend.capabilities,
    list: (game, limit) => track(() => backend.list(game, limit)),
    queue: (game, request) => track(() => backend.queue(game, request)),
    ...(cancel && {
      cancel: (game: GameEntry, buildId: string) =>
        track(() => cancel(game, buildId)),
    }),
    dispose() {
      isDisposed = true;
      backend.dispose();
    },
    drained() {
      if (pending.size === 0) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const handle = timers.set(() => resolve(false), DRAIN_TIMEOUT_MS);
        void Promise.all(pending).then(() => {
          timers.clear(handle);
          resolve(true);
        });
      });
    },
  };
}
