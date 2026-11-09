import type { PagePart } from '../../../contracts/plugin';
import { checklistCount, workflowPageKey } from '../../workflow/contract';
import { SMALL_WORKFLOW_ID } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import { workflowSmallManifest } from '../manifest';
import { SMALL_PAGE_STAGES } from '../stages';

// Small's page half on the engine: its stages, its layouts and its letter. The
// engine's `defaultChecklist` draws the agent's list.
export const workflowSmallPagePart: PagePart<typeof workflowSmallManifest> = {
  manifest: workflowSmallManifest,
  start(api) {
    const workflow = api.dependency(workflowPageKey);

    workflow.addWorkflow({
      id: SMALL_WORKFLOW_ID,
      label: 'Small',
      badge: 'S',
      stages: SMALL_PAGE_STAGES,
      draw: workflow.createWorkflowDraw(api, {
        manifest: workflowSmallManifest,
        defaultLayout,
        defaultStylesheet,
        userLayout: () => api.settings().layout,
        sideTitle: 'Checklist',
      }),
      runAction: () => Promise.reject(new Error('Small has no actions')),
      progressText: checklistCount,
    });

    return { commands: {} };
  },
};
