import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PagePart } from '../../../contracts/plugin';
import { installFakeDom } from '../../../shared/page/test-dom';
import { startPagePart } from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { keysPagePart } from '../../keys/page/start';
import type { SessionsPageExports, SessionsState } from '../contract';
import { sessionRow, stateOf } from './sessions-view-fakes';
import { sessionsPagePart } from './start';

// Lets a settled read's `then` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}

// A part started first, so stopped last, which hears `sessions.activeChanged`.
// Its `dispose` holds its stop until `release`, so its listener outlives the
// sessions part's stop, where a late read would emit.
function activeChangedProbe() {
  const heard: unknown[] = [];
  const held = deferred<void>();
  const part: PagePart = {
    manifest: {
      id: 'probe',
      dependsOn: { main: [], page: [] },
      commands: {},
      scopes: {},
      settings: {},
      settingInfo: {},
      themeTokens: {},
    },
    start(api) {
      (api.events as unknown as { on: typeof api.events.on }).on(
        'sessions.activeChanged' as never,
        (data: unknown) => heard.push(data),
      );
      return { commands: {}, dispose: () => held.promise };
    },
  };
  return { part, heard, release: () => held.resolve() };
}

describe('sessions page part', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { case: 'no session', state: stateOf([], null), barPartDisposes: 0 },
    { case: 'a session held', state: stateOf(['s1'], 's1'), barPartDisposes: 1 },
  ])('stops with nothing live and starts again: $case', async ({
    state,
    barPartDisposes,
  }) => {
    const harness = startPagePart(sessionsPagePart, {
      parts: [keysPagePart],
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
    expect(harness.counts()).toEqual({
      registrations: 0,
      timers: 0,
      listeners: 0,
      observers: 0,
      frames: 0,
    });

    await harness.restart();
    await harness.stop();
  });

  it('a state read that lands after stop changes nothing', async () => {
    const read = deferred<SessionsState>();
    const probe = activeChangedProbe();
    const written = vi.fn();
    const harness = startPagePart(sessionsPagePart, {
      parts: [probe.part, keysPagePart],
      invoke: () => read.promise,
      services: { uiState: { get: () => undefined, set: written } },
    });

    const logsBeforeStop = harness.logs.length;
    const stopping = harness.stop();
    await settle();
    read.resolve(stateOf(['s1'], 's1'));
    await settle();

    expect(probe.heard).toEqual([]);
    expect(written).not.toHaveBeenCalled();
    expect(harness.logs.slice(logsBeforeStop)).toEqual([]);
    probe.release();
    await stopping;
  });

  it('a state read that lands before stop applies', async () => {
    const probe = activeChangedProbe();
    probe.release();
    const written = vi.fn();
    const harness = startPagePart(sessionsPagePart, {
      parts: [probe.part, keysPagePart],
      invoke: async () => ({
        rows: [sessionRow('s1')],
        selectedSessionId: 's1',
      }),
      services: { uiState: { get: () => undefined, set: written } },
    });

    await settle();

    expect(probe.heard).toEqual([{ sessionId: 's1' }]);
    expect(written).toHaveBeenCalled();
    await harness.stop();
  });
});
