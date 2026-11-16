import { definePlugin } from '../../shared/define-plugin';

// Spike, the workflow of a throwaway spike — interview, then build and check per ask,
// then land and done — over the workflow engine. `wigley:spike` claims a session, the
// agent reports each later step through `set_workflow_step`, and the engine draws the
// agent's own checklist. It has no actions. `chat` and `sessions` serve only its
// self-test.
export const workflowSpikeManifest = definePlugin({
  id: 'workflow-spike',
  label: 'Spike workflow',
  description:
    'Tracks a throwaway spike through interview, then build and check per ask, then land.',
  dependsOn: {
    main: ['workflow', 'chat', 'sessions'],
    page: ['workflow'],
  },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {
    layout: 'default',
  },
  settingControls: { layout: 'layout' },
  settingInfo: {
    layout: {
      label: 'Spike workflow layout',
      description:
        "The layout that draws Spike's status chip, composer strip and side pane: a folder in the layouts/workflow-spike folder, or default.",
    },
  },
  themeTokens: {
    badge: { kind: 'color', default: 'var(--wg-fg-secondary)' },
  },
});
