import type { DemoPageContext, DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import {
  createSampleSequence,
  type SessionFlow,
  sampleChecklist,
  sampleFlow,
} from '../../workflow/contract';
import { SPIKE_WORKFLOW_ID } from '../contract';

// `showSample` is the workflow engine's page export.
export interface WorkflowSpikePageDemoDeps {
  showSample(flow: SessionFlow): Disposable;
}

const ITEMS = [
  'Agree what the prototype must feel like',
  'Build the quest board prototype',
  'Check it runs',
];

// Each beat's stage, its count of leading done items and whether a turn runs.
const BEATS: readonly {
  name: string;
  stage: string;
  done: number;
  turnRunning: boolean;
}[] = [
  { name: 'Build', stage: 'build', done: 1, turnRunning: true },
  { name: 'Done', stage: 'done', done: 3, turnRunning: false },
];

// The Spike step: the demo session's sample flow at Build, then at Done.
export function registerDemoSteps(
  services: PageServices,
  deps: WorkflowSpikePageDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'workflow-spike.run',
    section: 'workflows',
    order: 40,
    title: 'Spike workflow',
    caption:
      'Spike workflow: a throwaway prototype, built and checked fast for the user to try',
    files: [
      'src/plugins/workflow-spike/main/start.ts',
      'src/plugins/workflow-spike/page/start.ts',
      'src/plugins/workflow-spike/contract.ts',
    ],
    enter: async (context) => spikeStage(deps, context),
  });
}

function spikeStage(
  deps: WorkflowSpikePageDemoDeps,
  context: DemoPageContext,
): DemoStage {
  const sessionId = context.sessions.session;
  const shown = createSampleSequence(deps.showSample);
  return {
    beats: BEATS.map(({ name, stage, done, turnRunning }) => ({
      name,
      show() {
        shown.show(
          sampleFlow(sessionId, context.scratchDir, {
            workflow: SPIKE_WORKFLOW_ID,
            stage,
            checklist: sampleChecklist(ITEMS, done),
            turnRunning,
          }),
        );
      },
    })),
    dispose: () => shown.dispose(),
  };
}
