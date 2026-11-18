import { describe, expect, it } from 'vitest';
import type { DemoStage, DemoStep } from '../../../contracts/demo';
import type { PageServices } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { registerDemoSteps } from './demo-steps';

// The engine step registered over fakes that append to one ordered log: the
// n-th `showSample` logs `showSample#n` and its handle's dispose `dispose#n`.
function registerEngineStep() {
  const log: string[] = [];
  let shown = 0;
  const demoSteps = createDemoStepRegistry<DemoStep>();
  registerDemoSteps({ demoSteps } as unknown as PageServices, {
    showSample() {
      shown += 1;
      const n = shown;
      log.push(`showSample#${n}`);
      return { dispose: () => log.push(`dispose#${n}`) };
    },
  });
  const [step] = demoSteps.list();
  return { step, log };
}

async function enterAndShow(
  step: DemoStep,
  names: readonly string[],
): Promise<DemoStage> {
  const stage = await step.enter({
    scratchDir: '/scratch',
    sessions: { session: 's1' },
  });
  for (const name of names) {
    await stage.beats.find((beat) => beat.name === name)?.show();
  }
  return stage;
}

describe('workflow page demo steps', () => {
  // Breaks: a step in the wrong section or order.
  it('registers workflow.engine', () => {
    const { step } = registerEngineStep();

    expect({
      id: step.id,
      section: step.section,
      order: step.order,
    }).toEqual({ id: 'workflow.engine', section: 'workflows', order: 10 });
  });

  // Breaks: a dropped handle, or a gap where the row draws the stored flow.
  it('a shown beat disposes the previous handle after showing its own', async () => {
    const { step, log } = registerEngineStep();

    await enterAndShow(step, ['No level', 'No level']);

    expect(log).toEqual(['showSample#1', 'showSample#2', 'dispose#1']);
  });

  // Breaks: a sample flow left on the demo row after the step.
  it('stage dispose disposes the last handle', async () => {
    const { step, log } = registerEngineStep();
    const stage = await enterAndShow(step, ['No level']);
    log.length = 0;

    stage.dispose();

    expect(log).toEqual(['dispose#1']);
  });
});
