import { describe, expect, it } from 'vitest';
import { createSerialQueue } from './serial-queue';

// A promise the test settles by hand.
function held(): { promise: Promise<void>; release(): void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('createSerialQueue', () => {
  it('run_EarlierWorkRejects_StartsTheNextAfterItAndRejectsOnlyItsCaller', async () => {
    const queue = createSerialQueue();
    const first = held();
    const events: string[] = [];

    const failing = queue.run(async () => {
      events.push('first starts');
      await first.promise;
      events.push('first ends');
      throw new Error('first broke');
    });
    const second = queue.run(async () => {
      events.push('second starts');
      return 'second';
    });
    await Promise.resolve();
    first.release();

    await expect(failing).rejects.toThrow('first broke');
    await expect(second).resolves.toBe('second');
    expect(events).toEqual(['first starts', 'first ends', 'second starts']);
  });

  it('settled_WorkQueuedWhileWaiting_WaitsForItToo', async () => {
    const queue = createSerialQueue();
    const events: string[] = [];
    void queue.run(async () => {
      events.push('first');
      void queue.run(async () => {
        events.push('queued by first');
      });
    });

    await queue.settled();

    expect(events).toEqual(['first', 'queued by first']);
  });
});
