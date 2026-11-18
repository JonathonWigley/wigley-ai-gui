import type { DemoPageContext, DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import {
  createSampleSequence,
  type SessionFlow,
  sampleFlow,
} from '../contract';

// `showSample` is the part's own; `setHeadless` is chat's page export.
export interface WorkflowPageDemoDeps {
  showSample(flow: SessionFlow): Disposable;
  setHeadless(sessionId: string, headless: boolean): Promise<void>;
}

// The engine step: the demo session's chip with no level, warning of an agent
// working with none, then headless. Leaving it turns headless off again.
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
        async show() {
          await deps.setHeadless(sessionId, false);
          shown.show(
            sampleFlow(sessionId, projectDir, {
              missedLevel: true,
              turnRunning: true,
            }),
          );
        },
      },
      {
        name: 'Headless',
        async show() {
          shown.show(sampleFlow(sessionId, projectDir, {}));
          await deps.setHeadless(sessionId, true);
        },
      },
    ],
    dispose() {
      void deps.setHeadless(sessionId, false);
      shown.dispose();
    },
  };
}
