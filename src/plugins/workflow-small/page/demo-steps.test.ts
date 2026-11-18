import { describe, expect, it } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type { PageServices } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import type { SessionFlow } from '../../workflow/contract';
import { SMALL_WORKFLOW_ID } from '../contract';
import { registerDemoSteps } from './demo-steps';

// The Small step registered over a `showSample` that records each flow.
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

describe('workflow-small page demo steps', () => {
  // Breaks: a step in the wrong section or order.
  it('registers workflow-small.run', () => {
    const { step } = registerStep();

    expect({
      id: step.id,
      section: step.section,
      order: step.order,
    }).toEqual({ id: 'workflow-small.run', section: 'workflows', order: 20 });
  });

  // Breaks: a wrong done count or stage that ships with no other check.
  it.each([
    { name: 'Scope', stage: 'scope', done: 0, turnRunning: true },
    { name: 'Build', stage: 'build', done: 1, turnRunning: true },
    { name: 'Check', stage: 'check', done: 2, turnRunning: true },
    { name: 'Land', stage: 'land', done: 3, turnRunning: true },
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
        workflow: SMALL_WORKFLOW_ID,
        stage,
        done,
        turnRunning,
        state: null,
      });
    },
  );
});
