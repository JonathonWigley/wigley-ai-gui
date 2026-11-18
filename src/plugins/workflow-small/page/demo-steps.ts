import type { DemoPageContext, DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import {
  createSampleSequence,
  type SessionFlow,
  sampleChecklist,
  sampleFlow,
} from '../../workflow/contract';
import { SMALL_WORKFLOW_ID } from '../contract';

// `showSample` is the workflow engine's page export.
export interface WorkflowSmallPageDemoDeps {
  showSample(flow: SessionFlow): Disposable;
}

const ITEMS = [
  'Find where the quest timer reads the clock',
  'Fix the drift after a clock change',
  'Run the timer tests',
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

// The Small step: the demo session's sample flow through each Small stage.
export function registerDemoSteps(
  services: PageServices,
  deps: WorkflowSmallPageDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'workflow-small.run',
    section: 'workflows',
    order: 20,
    title: 'Small workflow',
    caption:
      'Small workflow: a clear change scoped, built, checked and landed in one go',
    files: [
      'src/plugins/workflow-small/main/start.ts',
      'src/plugins/workflow-small/page/start.ts',
      'src/plugins/workflow-small/stages/index.ts',
    ],
    enter: async (context) => smallStage(deps, context),
  });
}

function smallStage(
  deps: WorkflowSmallPageDemoDeps,
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
            workflow: SMALL_WORKFLOW_ID,
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
