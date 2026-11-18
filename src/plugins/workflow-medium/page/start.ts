import type { PagePart } from '../../../contracts/plugin';
import { checklistCount, workflowPageKey } from '../../workflow/contract';
import { MEDIUM_WORKFLOW_ID } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import { workflowMediumManifest } from '../manifest';
import { MEDIUM_PAGE_STAGES } from '../stages';
import { registerDemoSteps } from './demo-steps';

// Medium's page half on the engine: its stages, its layouts and its letter. The
// engine's `defaultChecklist` draws the agent's list. Registers the
// `workflow-medium.run` demo step.
export const workflowMediumPagePart: PagePart<typeof workflowMediumManifest> = {
  manifest: workflowMediumManifest,
  start(api) {
    const workflow = api.dependency(workflowPageKey);

    workflow.addWorkflow({
      id: MEDIUM_WORKFLOW_ID,
      label: 'Medium',
      badge: 'M',
      stages: MEDIUM_PAGE_STAGES,
      draw: workflow.createWorkflowDraw(api, {
        manifest: workflowMediumManifest,
        defaultLayout,
        defaultStylesheet,
        userLayout: () => api.settings().layout,
        sideTitle: 'Checklist',
      }),
      runAction: () => Promise.reject(new Error('Medium has no actions')),
      progressText: checklistCount,
    });
    registerDemoSteps(api.services, {
      showSample: (flow) => workflow.showSample(flow),
    });

    return { commands: {} };
  },
};
