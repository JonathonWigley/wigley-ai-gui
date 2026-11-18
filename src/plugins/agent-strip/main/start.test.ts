import { describe, expect, it } from 'vitest';
import type { DemoMainStep } from '../../../contracts/demo';
import type { SelfTestScript } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { agentStripMainPart } from './start';

// A self-test host, so the part reads its dependencies as a self-test run does.
const WITH_SELF_TEST = {
  services: { selfTest: { run() {} } },
  dependencies: [
    fakeDependency(
      chatMainKey,
      (consumer) =>
        ({
          addInstructions: () => consumer.track({ dispose() {} }),
        }) as unknown as ChatMainExports,
    ),
  ],
};

describe('agentStripMainPart', () => {
  it('start_RegistersLayoutsAndHandsScript', () => {
    const registered: unknown[] = [];
    const scripts: SelfTestScript[] = [];
    const instructions: string[] = [];
    const api = {
      layouts: {
        register: (registration: unknown) => {
          registered.push(registration);
        },
      },
      services: {
        homeDir: '/home',
        selfTest: { run: (script: SelfTestScript) => scripts.push(script) },
        demoSteps: createDemoStepRegistry<DemoMainStep>(),
      },
      dependency: () => ({
        addInstructions: (text: string) => instructions.push(text),
      }),
    } as unknown as Parameters<typeof agentStripMainPart.start>[0];

    agentStripMainPart.start(api);

    expect(registered).toEqual([{ layoutTypes }]);
    expect(scripts).toHaveLength(1);
    expect(instructions).toEqual([expect.stringContaining('30 characters')]);
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startMainPart(agentStripMainPart, WITH_SELF_TEST);
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startMainPart(agentStripMainPart, WITH_SELF_TEST);
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });
});
