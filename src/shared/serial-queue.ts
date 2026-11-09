// Work run one piece at a time: `run` starts `work` once every piece queued
// before it settled, so two never interleave, and resolves or rejects as
// `work` does; a rejection reaches only its own caller. `settled` resolves once
// no queued work is left, work queued while it waits included.
export interface SerialQueue {
  run<T>(work: () => Promise<T>): Promise<T>;
  settled(): Promise<void>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(work) {
      const running = tail.then(work);
      tail = running.catch(() => undefined);
      return running;
    },
    async settled() {
      let seen: Promise<unknown>;
      do {
        seen = tail;
        await seen;
      } while (seen !== tail);
    },
  };
}
