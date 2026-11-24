import type { BuildBackend, GameEntry } from '../contract';

// How long a `create` waits on a replaced instance's calls before it logs that it is still waiting.
export const DRAIN_TIMEOUT_MS = 30_000;

// A backend whose `drained` resolves once every call begun on it has settled. After `dispose`, a call rejects without
// reaching the backend, so `drained` covers every call it gets.
export interface TrackedBackend extends BuildBackend {
  drained(): Promise<void>;
}

// `backend` with its `list`, `queue`, `cancel` and `saveLog` calls tracked; `dispose` disposes `backend`.
export function trackCalls(backend: BuildBackend): TrackedBackend {
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
  const saveLog = backend.saveLog?.bind(backend);
  return {
    capabilities: backend.capabilities,
    list: (game, limit) => track(() => backend.list(game, limit)),
    queue: (game, request) => track(() => backend.queue(game, request)),
    ...(cancel && {
      cancel: (game: GameEntry, buildId: string) =>
        track(() => cancel(game, buildId)),
    }),
    ...(saveLog && {
      saveLog: (
        game: GameEntry,
        buildId: string,
        jobId: string | null,
        path: string,
      ) => track(() => saveLog(game, buildId, jobId, path)),
    }),
    dispose() {
      isDisposed = true;
      backend.dispose();
    },
    drained: () => Promise.all(pending).then(() => undefined),
  };
}

// By backend data folder, the wait for the calls of every instance replaced over it. It outlives the builds part that
// held the instances, so the next part's instance over the same folder waits too.
export interface Drains {
  // Adds the calls of `instance`, disposed, to the wait for `folder`.
  hold(folder: string, instance: TrackedBackend): void;
  // Settles once the calls of every instance held for `folder` have settled; at once when none is held.
  settled(folder: string): Promise<void>;
}

export function createDrains(): Drains {
  const waits = new Map<string, Promise<void>>();
  return {
    hold(folder, instance) {
      const wait = Promise.all([waits.get(folder), instance.drained()]).then(
        () => undefined,
      );
      waits.set(folder, wait);
      void wait.then(() => {
        if (waits.get(folder) === wait) {
          waits.delete(folder);
        }
      });
    },
    settled: (folder) => waits.get(folder) ?? Promise.resolve(),
  };
}
