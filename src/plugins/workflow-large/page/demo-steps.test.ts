import { describe, expect, it } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type { PageServices } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { SessionFlow } from '../../workflow/contract';
import { registerDemoSteps } from './demo-steps';

// The Large step registered over a `showSample` that records each flow shown.
function registerStep(shown: SessionFlow[] = []) {
  const demoSteps = createDemoStepRegistry<DemoStep>();
  registerDemoSteps(
    {
      demoSteps,
      clock: { now: () => 1_000_000 },
      paths: posixPaths,
    } as unknown as PageServices,
    {
      showSample(flow) {
        shown.push(flow);
        return { dispose: () => undefined };
      },
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

  // Breaks: a beat that shows another stage's sample.
  it('the beats show the interview, then the closed run', async () => {
    const shown: SessionFlow[] = [];
    const stage = await registerStep(shown).enter({
      scratchDir: '/scratch',
      sessions: { session: 's1' },
    });

    for (const beat of stage.beats) {
      await beat.show();
    }

    expect(shown.map((flow) => flow.stage)).toEqual(['interview', 'closed']);
  });
});
