import { describe, expect, it } from 'vitest';
import type { FileWatch } from '../../../contracts/files';
import type { DocChange } from '../contract';
import { createViewWatches } from './view-watches';

// A watch the test starts by hand: each `watchFile` call waits until the test
// resolves it.
interface StartingWatch {
  path: string;
  changed: () => void;
  closed: boolean;
  start(): void;
}

function setUp() {
  const starting: StartingWatch[] = [];
  const sent: DocChange[] = [];
  const watchFile = (path: string, changed: () => void) =>
    new Promise<FileWatch>((resolve) => {
      const record: StartingWatch = {
        path,
        changed,
        closed: false,
        start: () =>
          resolve({
            dispose: () => {
              record.closed = true;
            },
          }),
      };
      starting.push(record);
    });
  const watches = createViewWatches(watchFile, (change) => sent.push(change));
  return { starting, sent, watches };
}

describe('createViewWatches', () => {
  it('watch_ChangeSeen_SendsViewAndPath', async () => {
    const test = setUp();
    const watching = test.watches.watch('v', '/a.md');
    test.starting[0].start();
    await watching;

    test.starting[0].changed();

    expect(test.sent).toEqual([{ viewId: 'v', path: '/a.md' }]);
  });

  it('watch_SecondCallWhileFirstStarting_KeepsOnlySecond', async () => {
    const test = setUp();
    const first = test.watches.watch('v', '/a.md');
    const second = test.watches.watch('v', '/b.md');
    test.starting[1].start();
    await second;
    test.starting[0].start();
    await first;

    expect(test.starting[0].closed).toBe(true);
    expect(test.starting[1].closed).toBe(false);
  });

  it('watch_SecondCallAfterFirstStarted_ClosesFirst', async () => {
    const test = setUp();
    const first = test.watches.watch('v', '/a.md');
    test.starting[0].start();
    await first;

    const second = test.watches.watch('v', '/b.md');
    test.starting[1].start();
    await second;

    expect(test.starting[0].closed).toBe(true);
    expect(test.starting[1].closed).toBe(false);
  });

  it('watch_NullPath_ClosesAndWatchesNothing', async () => {
    const test = setUp();
    const first = test.watches.watch('v', '/a.md');
    test.starting[0].start();
    await first;

    await test.watches.watch('v', null);

    expect(test.starting[0].closed).toBe(true);
    expect(test.starting).toHaveLength(1);
  });

  it('watch_OtherView_LeavesWatchOpen', async () => {
    const test = setUp();
    const first = test.watches.watch('v', '/a.md');
    test.starting[0].start();
    await first;

    const other = test.watches.watch('w', '/a.md');
    test.starting[1].start();
    await other;

    expect(test.starting[0].closed).toBe(false);
    expect(test.starting[1].closed).toBe(false);
  });

  it('closeAll_WatchStillStarting_ClosedOnceStarted', async () => {
    const test = setUp();
    const started = test.watches.watch('v', '/a.md');
    const starting = test.watches.watch('w', '/b.md');
    test.starting[0].start();
    await started;

    test.watches.closeAll();
    test.starting[1].start();
    await starting;

    expect(test.starting[0].closed).toBe(true);
    expect(test.starting[1].closed).toBe(true);
  });
});
