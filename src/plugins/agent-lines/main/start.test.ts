import { describe, expect, it } from 'vitest';
import type { SelfTestScript } from '../../../contracts/plugin';
import { startMainPart } from '../../../shared/plugin-part-harness.test-support';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { agentLinesMainPart } from './start';

// A self-test host, so the part reads its dependencies as a self-test run does.
const WITH_SELF_TEST = { services: { selfTest: { run() {} } } };

describe('agentLinesMainPart', () => {
  it('start_RegistersLayoutsAndHandsScript', () => {
    const registered: unknown[] = [];
    const scripts: SelfTestScript[] = [];
    const api = {
      layouts: {
        register: (registration: unknown) => {
          registered.push(registration);
        },
      },
      services: {
        homeDir: '/home',
        selfTest: { run: (script: SelfTestScript) => scripts.push(script) },
      },
      dependency: () => ({}),
    } as unknown as Parameters<typeof agentLinesMainPart.start>[0];

    agentLinesMainPart.start(api);

    expect(registered).toEqual([{ layoutTypes }]);
    expect(scripts).toHaveLength(1);
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startMainPart(agentLinesMainPart, WITH_SELF_TEST);
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual({
      registrations: 0,
      timers: 0,
      listeners: 0,
      observers: 0,
      frames: 0,
    });
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startMainPart(agentLinesMainPart, WITH_SELF_TEST);
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });
});
