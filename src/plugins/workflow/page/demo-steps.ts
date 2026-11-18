import type { DemoPageContext, DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import {
  createSampleSequence,
  type SessionFlow,
  sampleFlow,
} from '../contract';

// `showSample` is the part's own.
export interface WorkflowPageDemoDeps {
  showSample(flow: SessionFlow): Disposable;
}

// The engine step: the demo session's chip with no level, warning of an agent
// working with none.
export function registerDemoSteps(
  services: PageServices,
  deps: WorkflowPageDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'workflow.engine',
    section: 'workflows',
    order: 10,
    title: 'Workflow',
    caption:
      "Workflow: each session's row shows its workflow state, and warns when an agent works with no level",
    files: [
      'src/plugins/workflow/page/start.ts',
      'src/plugins/workflow/page/workflow-view.ts',
      'src/plugins/workflow/main/start.ts',
      'src/plugins/workflow/flow.ts',
      'src/plugins/workflow/contract.ts',
    ],
    enter: async (context) => engineStage(deps, context),
  });
}

function engineStage(
  deps: WorkflowPageDemoDeps,
  context: DemoPageContext,
): DemoStage {
  const sessionId = context.sessions.session;
  const projectDir = context.scratchDir;
  const shown = createSampleSequence(deps.showSample);
  return {
    beats: [
      {
        name: 'No level',
        show() {
          shown.show(
            sampleFlow(sessionId, projectDir, {
              missedLevel: true,
              turnRunning: true,
            }),
          );
        },
      },
    ],
    dispose: () => shown.dispose(),
  };
}
