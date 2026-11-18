import { describe, expect, it } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type { PageServices } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import type { SessionFlow } from '../../workflow/contract';
import { SPIKE_WORKFLOW_ID } from '../contract';
import { registerDemoSteps } from './demo-steps';

// The Spike step registered over a `showSample` that records each flow.
function registerStep() {
  const shown: SessionFlow[] = [];
  const demoSteps = createDemoStepRegistry<DemoStep>();
  registerDemoSteps({ demoSteps } as unknown as PageServices, {
    showSample(flow) {
      shown.push(flow);
      return { dispose: () => undefined };
    },
  });
  const [step] = demoSteps.list();
  return { step, shown };
}

// The count of leading done items.
function leadingDone(flow: SessionFlow): number {
  const items = flow.checklist ?? [];
  const firstOpen = items.findIndex((item) => !item.done);
  return firstOpen === -1 ? items.length : firstOpen;
}

describe('workflow-spike page demo steps', () => {
  // Breaks: a step in the wrong section or order.
  it('registers workflow-spike.run', () => {
    const { step } = registerStep();

    expect({
      id: step.id,
      section: step.section,
      order: step.order,
    }).toEqual({ id: 'workflow-spike.run', section: 'workflows', order: 40 });
  });

  // Breaks: a wrong done count or stage that ships with no other check.
  it.each([
    { name: 'Build', stage: 'build', done: 1, turnRunning: true },
    { name: 'Done', stage: 'done', done: 3, turnRunning: false },
  ])(
    'beat $name shows its flow',
    async ({ name, stage, done, turnRunning }) => {
      const { step, shown } = registerStep();
      const entered = await step.enter({
        scratchDir: '/scratch',
        sessions: { session: 's1' },
      });

      await entered.beats.find((beat) => beat.name === name)?.show();

      const flow = shown.at(-1);
      expect({
        sessionId: flow?.sessionId,
        workflow: flow?.workflow,
        stage: flow?.stage,
        done: flow === undefined ? null : leadingDone(flow),
        turnRunning: flow?.turnRunning,
        state: flow?.state,
      }).toEqual({
        sessionId: 's1',
        workflow: SPIKE_WORKFLOW_ID,
        stage,
        done,
        turnRunning,
        state: null,
      });
    },
  );
});
