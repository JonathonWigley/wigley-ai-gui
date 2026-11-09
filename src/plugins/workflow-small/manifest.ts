import { definePlugin } from '../../shared/define-plugin';

// Small, the workflow of a small change — scope, build, check, land, done — over the
// workflow engine. `wigley:small` claims a session, the agent reports each later step
// through `set_workflow_step`, and the engine draws the agent's own checklist. It has
// no actions. `chat` and `sessions` serve only its self-test.
export const workflowSmallManifest = definePlugin({
  id: 'workflow-small',
  label: 'Small workflow',
  description: 'Tracks a small change through scope, build, check and land.',
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
  settingInfo: {
    layout: {
      label: 'Small workflow layout',
      description:
        "The layout that draws Small's status chip, composer strip and side pane: a folder in the layouts/workflow-small folder, or default.",
    },
  },
  themeTokens: {
    badge: { kind: 'color', default: 'var(--wg-status-info)' },
  },
});
