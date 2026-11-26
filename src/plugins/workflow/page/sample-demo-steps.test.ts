import { describe, expect, it } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type { PageServices } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { SessionFlow, WorkflowDraw } from '../contract';
import { registerSampleDemoSteps } from './sample-demo-steps';

// The four sample steps over fakes that append to one ordered log: each added
// page half logs `add <id>` and its dispose `remove <id>`, each draw `draw
// <id>` and `undraw <id>`, and each shown sample is kept in `shown`.
function registerSampleSteps() {
  const log: string[] = [];
  const shown: SessionFlow[] = [];
  const demoSteps = createDemoStepRegistry<DemoStep>();
  registerSampleDemoSteps(
    { demoSteps, paths: posixPaths } as unknown as PageServices,
    {
      showSample(flow) {
        shown.push(flow);
        return { dispose: () => log.push(`unshow ${flow.stage}`) };
      },
      addWorkflow(workflow) {
        log.push(`add ${workflow.id}`);
        return { dispose: () => log.push(`remove ${workflow.id}`) };
      },
      createDraw(workflow) {
        log.push(`draw ${workflow.id}`);
        return {
          ...({} as WorkflowDraw),
          dispose: () => log.push(`undraw ${workflow.id}`),
        };
      },
      planPane: {} as never,
      runAction: async () => undefined,
      openDoc: () => undefined,
    },
  );
  const stepOf = (id: string): DemoStep => {
    const step = demoSteps.list().find((each) => each.id === id);
    if (step === undefined) {
      throw new Error(`no step ${id}`);
    }
    return step;
  };
  return { demoSteps, stepOf, log, shown };
}

const CONTEXT = { scratchDir: '/scratch', sessions: { session: 's1' } };

describe('workflow sample demo steps', () => {
  // Breaks: a step lost, or in the wrong section or order.
  it.each([
    { id: 'workflow.small', order: 20, title: 'Small workflow' },
    { id: 'workflow.medium', order: 30, title: 'Medium workflow' },
    { id: 'workflow.spike', order: 40, title: 'Spike workflow' },
    { id: 'workflow.large', order: 50, title: 'Large workflow' },
  ])('registers $id', ({ id, order, title }) => {
    const { stepOf } = registerSampleSteps();

    const step = stepOf(id);

    expect({
      section: step.section,
      order: step.order,
      title: step.title,
    }).toEqual({ section: 'workflows', order, title });
  });

  // Breaks: a demo half under the real `wigley:` id, which the page refuses
  // while the real one is added, or one left after the step.
  it('a step adds its demo page half for its life', async () => {
    const { stepOf, log } = registerSampleSteps();
    const stage = await stepOf('workflow.small').enter(CONTEXT);
    await stage.beats[0].show();

    stage.dispose();

    expect(log).toEqual([
      'draw demo:small',
      'add demo:small',
      'unshow build',
      'remove demo:small',
      'undraw demo:small',
    ]);
  });

  // Breaks: a wrong done count, stage or fix count that ships with no other
  // check.
  it.each([
    {
      id: 'small',
      name: 'Make',
      stage: 'build',
      done: 1,
      counters: {},
      turnRunning: true,
    },
    {
      id: 'small',
      name: 'Done',
      stage: 'done',
      done: 3,
      counters: {},
      turnRunning: false,
    },
    {
      id: 'medium',
      name: 'Make',
      stage: 'build',
      done: 1,
      counters: { fix: 0 },
      turnRunning: true,
    },
    {
      id: 'medium',
      name: 'Done',
      stage: 'done',
      done: 3,
      counters: { fix: 1 },
      turnRunning: false,
    },
    {
      id: 'spike',
      name: 'Make',
      stage: 'build',
      done: 1,
      counters: {},
      turnRunning: true,
    },
    {
      id: 'spike',
      name: 'Done',
      stage: 'done',
      done: 3,
      counters: {},
      turnRunning: false,
    },
  ])(
    '$id beat $name shows its flow',
    async ({ id, name, stage, done, counters, turnRunning }) => {
      const { stepOf, shown } = registerSampleSteps();
      const entered = await stepOf(`workflow.${id}`).enter(CONTEXT);

      await entered.beats.find((beat) => beat.name === name)?.show();

      const flow = shown.at(-1);
      expect({
        sessionId: flow?.sessionId,
        workflow: flow?.workflow,
        stage: flow?.stage,
        done: flow?.checklist?.filter((item) => item.done).length,
        items: flow?.checklist?.length,
        counters: flow?.counters,
        turnRunning: flow?.turnRunning,
      }).toEqual({
        sessionId: 's1',
        workflow: `demo:${id}`,
        stage,
        done,
        items: 3,
        counters,
        turnRunning,
      });
    },
  );

  // Breaks: a beat that shows another stage's sample, or a closed run with no
  // plan to draw.
  it('the Large beats show the interview, then the closed run', async () => {
    const { stepOf, shown } = registerSampleSteps();
    const stage = await stepOf('workflow.large').enter(CONTEXT);

    for (const beat of stage.beats) {
      await beat.show();
    }

    expect(
      shown.map((flow) => ({
        stage: flow.stage,
        plan:
          flow.plan === null
            ? null
            : {
                dir: flow.plan.dir,
                title: flow.plan.progress?.title,
                checked: flow.plan.progress?.checked,
                total: flow.plan.progress?.total,
                counters: flow.plan.progress?.counters,
              },
      })),
    ).toEqual([
      { stage: 'interview', plan: null },
      {
        stage: 'closed',
        plan: {
          dir: '/scratch/docs/features/daily-quests/plan-daily-quests',
          title: 'Daily quests',
          checked: 7,
          total: 7,
          counters: { reviewRounds: 1 },
        },
      },
    ]);
  });
});
