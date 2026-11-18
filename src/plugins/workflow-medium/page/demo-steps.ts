import type { DemoPageContext, DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import {
  createSampleSequence,
  type SessionFlow,
  sampleChecklist,
  sampleFlow,
} from '../../workflow/contract';
import { MEDIUM_WORKFLOW_ID, type MediumState } from '../contract';

// `showSample` is the workflow engine's page export.
export interface WorkflowMediumPageDemoDeps {
  showSample(flow: SessionFlow): Disposable;
}

const ITEMS = [
  'Agree the quest reset rules',
  'Build the reset',
  "Fix the review's findings",
];

// Each beat's stage, its count of leading done items, its review fix cycles and
// whether a turn runs.
const BEATS: readonly {
  name: string;
  stage: string;
  done: number;
  fixCycles: number;
  turnRunning: boolean;
}[] = [
  { name: 'Build', stage: 'build', done: 1, fixCycles: 0, turnRunning: true },
  { name: 'Done', stage: 'done', done: 3, fixCycles: 1, turnRunning: false },
];

// The Medium step: the demo session's sample flow through each Medium stage,
// one review fix cycle from Fix on.
export function registerDemoSteps(
  services: PageServices,
  deps: WorkflowMediumPageDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'workflow-medium.run',
    section: 'workflows',
    order: 30,
    title: 'Medium workflow',
    caption:
      'Medium workflow: an interview, a build, one review and its fixes, then land',
    files: [
      'src/plugins/workflow-medium/main/start.ts',
      'src/plugins/workflow-medium/page/start.ts',
      'src/plugins/workflow-medium/contract.ts',
    ],
    enter: async (context) => mediumStage(deps, context),
  });
}

function mediumStage(
  deps: WorkflowMediumPageDemoDeps,
  context: DemoPageContext,
): DemoStage {
  const sessionId = context.sessions.session;
  const shown = createSampleSequence(deps.showSample);
  return {
    beats: BEATS.map(({ name, stage, done, fixCycles, turnRunning }) => {
      const state: MediumState = { fixCycles };
      return {
        name,
        show() {
          shown.show(
            sampleFlow(sessionId, context.scratchDir, {
              workflow: MEDIUM_WORKFLOW_ID,
              stage,
              checklist: sampleChecklist(ITEMS, done),
              state,
              turnRunning,
            }),
          );
        },
      };
    }),
    dispose: () => shown.dispose(),
  };
}
