import { describe, expect, it } from 'vitest';
import { createFixtureBackend, gameEntry } from '../contract.test-support';
import { trackCalls } from './tracked-backend';

const timers = { set: () => 0, clear: () => undefined };

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
  ])(
    'rejects a $case after dispose without reaching the backend',
    async ({ call }) => {
      const fixture = createFixtureBackend();
      const tracked = trackCalls(fixture, timers);

      tracked.dispose();

      await expect(call(tracked)).rejects.toThrow('replaced');
      expect([fixture.listCalls, fixture.queued, fixture.cancelled]).toEqual([
        [],
        [],
        [],
      ]);
      expect(fixture.disposed).toBe(true);
    },
  );
});
