import { describe, expect, it } from 'vitest';
import { deferred } from '../../../shared/plugin-part-harness.test-support';
import type { BuildBackend } from '../contract';
import { createFixtureBackend, gameEntry } from '../contract.test-support';
import { trackCalls } from './tracked-backend';

const SAVES_LOGS = { cancel: true, choosesBranch: true, saveLog: true };

describe('trackCalls', () => {
  it.each([
    {
      case: 'list',
      call: (backend: ReturnType<typeof trackCalls>) =>
        backend.list(gameEntry(), 5),
    },
    {
      case: 'queue',
      call: (backend: ReturnType<typeof trackCalls>) =>
        backend.queue(gameEntry(), {
          kind: 'dev',
          branch: 'main',
          revision: null,
        }),
    },
    {
      case: 'cancel',
      call: (backend: ReturnType<typeof trackCalls>) =>
        backend.cancel?.(gameEntry(), 'x'),
    },
    {
      case: 'saveLog',
      call: (backend: ReturnType<typeof trackCalls>) =>
        backend.saveLog?.(gameEntry(), 'x', null, '/d/x.log'),
    },
  ])(
    'rejects a $case after dispose without reaching the backend',
    async ({ call }) => {
      const fixture = createFixtureBackend({ capabilities: SAVES_LOGS });
      const tracked = trackCalls(fixture);

      tracked.dispose();

      await expect(call(tracked)).rejects.toThrow(
        'the backend was replaced; try again',
      );
      expect([
        fixture.listCalls,
        fixture.queued,
        fixture.cancelled,
        fixture.savedLogs,
      ]).toEqual([[], [], [], []]);
      expect(fixture.disposed).toBe(true);
    },
  );

  it('passes a saveLog to the backend, and drained waits for it', async () => {
    const fixture = createFixtureBackend({ capabilities: SAVES_LOGS });
    const held = deferred<void>();
    const backend: BuildBackend = {
      ...fixture,
      async saveLog(game, buildId, jobId, path) {
        await fixture.saveLog?.(game, buildId, jobId, path);
        await held.promise;
      },
    };
    const tracked = trackCalls(backend);
    let isDrained = false;

    const saving = tracked.saveLog?.(gameEntry(), 'b-1', 'job-1', '/d/a.log');
    void tracked.drained().then(() => {
      isDrained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.savedLogs).toEqual([
      { gameId: 'game', buildId: 'b-1', jobId: 'job-1', path: '/d/a.log' },
    ]);
    expect(isDrained).toBe(false);
    held.resolve();
    await saving;
    await tracked.drained();
    expect(isDrained).toBe(true);
  });

  it('gives no saveLog over a backend without one', () => {
    expect(trackCalls(createFixtureBackend())).not.toHaveProperty('saveLog');
  });
});
