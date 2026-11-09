import type { PagePart } from '../../../contracts/plugin';
import { checklistCount, workflowPageKey } from '../../workflow/contract';
import { SPIKE_WORKFLOW_ID } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import { workflowSpikeManifest } from '../manifest';
import { SPIKE_PAGE_STAGES } from '../stages';

// Spike's page half on the engine: its stages, its layouts and its letter. The
// engine's `defaultChecklist` draws the agent's list.
export const workflowSpikePagePart: PagePart<typeof workflowSpikeManifest> = {
  manifest: workflowSpikeManifest,
  start(api) {
    const workflow = api.dependency(workflowPageKey);

    workflow.addWorkflow({
      id: SPIKE_WORKFLOW_ID,
      label: 'Spike',
      badge: 'X',
      stages: SPIKE_PAGE_STAGES,
      draw: workflow.createWorkflowDraw(api, {
        manifest: workflowSpikeManifest,
        defaultLayout,
        defaultStylesheet,
        userLayout: () => api.settings().layout,
        sideTitle: 'Checklist',
      }),
      runAction: () => Promise.reject(new Error('Spike has no actions')),
      progressText: checklistCount,
    });

    return { commands: {} };
  },
};
