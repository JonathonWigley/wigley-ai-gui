import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  dataEmitted,
  deferred,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionsPageExports, SessionsState } from '../contract';
import { sessionRow, stateOf } from './sessions-view-fakes';
import { sessionsPagePart } from './start';

// Lets a settled read's `then` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('sessions page part', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { case: 'no session', state: stateOf([], null), barPartDisposes: 0 },
    {
      case: 'a session held',
      state: stateOf(['s1'], 's1'),
      barPartDisposes: 1,
    },
  ])(
    'stops with nothing live and starts again: $case',
    async ({ state, barPartDisposes }) => {
      const harness = startPagePart(sessionsPagePart, {
        invoke: async () => state,
      });
      await settle();
      const dispose = vi.fn();
      const exports = harness
        .started()
        .exports?.(createRegistrations()) as SessionsPageExports;
      exports.addBarPart({ id: 'bar-part', build: () => ({ dispose }) });

      await harness.stop();
      expect(dispose).toHaveBeenCalledTimes(barPartDisposes);
      expect(harness.counts()).toEqual(noCounts);

      await harness.restart();
      await harness.stop();
    },
  );

  it('a state read that lands after stop changes nothing', async () => {
    const read = deferred<SessionsState>();
    const written = vi.fn();
    const harness = startPagePart(sessionsPagePart, {
      invoke: () => read.promise,
      services: { uiState: { get: () => undefined, set: written } },
    });

    const logsBeforeStop = harness.logs.length;
    await harness.stop();
    read.resolve(stateOf(['s1'], 's1'));
    await settle();

    expect(dataEmitted(harness, 'sessions.activeChanged')).toEqual([]);
    expect(written).not.toHaveBeenCalled();
    expect(harness.logs.slice(logsBeforeStop)).toEqual([]);
  });

  it('a state read that lands before stop applies', async () => {
    const written = vi.fn();
    const harness = startPagePart(sessionsPagePart, {
      invoke: async () => ({
        rows: [sessionRow('s1')],
        selectedSessionId: 's1',
      }),
      services: { uiState: { get: () => undefined, set: written } },
    });

    await settle();

    expect(dataEmitted(harness, 'sessions.activeChanged')).toEqual([
      { sessionId: 's1' },
    ]);
    expect(written).toHaveBeenCalled();
    await harness.stop();
  });
});
