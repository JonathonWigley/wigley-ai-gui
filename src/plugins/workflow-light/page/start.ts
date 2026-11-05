import type { PagePart } from '../../../contracts/plugin';
import { checklistCount, workflowPageKey } from '../../workflow/contract';
import { LIGHT_WORKFLOW_ID } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import { workflowLightManifest } from '../manifest';
import { LIGHT_PAGE_STAGES } from '../stages';

// Light's page half on the engine: its stages, its layouts and its letter. The
// engine's `defaultChecklist` draws the agent's list.
export const workflowLightPagePart: PagePart<typeof workflowLightManifest> = {
  manifest: workflowLightManifest,
  start(api) {
    const workflow = api.dependency(workflowPageKey);

    workflow.addWorkflow({
      id: LIGHT_WORKFLOW_ID,
      label: 'Light',
      badge: 'L',
      stages: LIGHT_PAGE_STAGES,
      draw: workflow.createWorkflowDraw(api, {
        manifest: workflowLightManifest,
        defaultLayout,
        defaultStylesheet,
        userLayout: () => api.settings().layout,
        sideTitle: 'Checklist',
      }),
      runAction: () => Promise.reject(new Error('Light has no actions')),
      progressText: checklistCount,
    });

    return { commands: {} };
  },
};
