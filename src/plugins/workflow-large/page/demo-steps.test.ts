import { describe, expect, it } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type { PageServices } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { registerDemoSteps } from './demo-steps';

const AUTO_START_SECONDS = 7;

// The Large step registered with `autoStartSeconds` set to AUTO_START_SECONDS.
function registerStep() {
  const demoSteps = createDemoStepRegistry<DemoStep>();
  registerDemoSteps(
    {
      demoSteps,
      clock: { now: () => 1_000_000 },
      paths: posixPaths,
    } as unknown as PageServices,
    {
      showSample: () => ({ dispose: () => undefined }),
      autoStartSeconds: () => AUTO_START_SECONDS,
    },
  );
  const [step] = demoSteps.list();
  return step;
}

describe('workflow-large page demo steps', () => {
  // Breaks: a step in the wrong section or order.
  it('registers workflow-large.run', () => {
    const step = registerStep();

    expect({
      id: step.id,
      section: step.section,
      order: step.order,
    }).toEqual({ id: 'workflow-large.run', section: 'workflows', order: 50 });
  });

  // Breaks: autoplay leaving the countdown before it runs down.
  it('Countdown dwells for autoStartSeconds', async () => {
    const stage = await registerStep().enter({
      scratchDir: '/scratch',
      sessions: { session: 's1' },
    });

    const countdown = stage.beats.find((beat) => beat.name === 'Countdown');

    expect(countdown?.dwellSeconds).toBe(AUTO_START_SECONDS);
  });
});
