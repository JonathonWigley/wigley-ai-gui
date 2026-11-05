import { definePlugin } from '../../shared/define-plugin';

// Medium, the workflow of a change that earns one review — interview, build, review,
// fix, land, done — over the workflow engine. `wigley:medium` claims a session, the
// agent reports each later step through `set_workflow_step`, and the engine draws the
// agent's own checklist. It has no actions. `chat` and `sessions` serve only its
// self-test.
export const workflowMediumManifest = definePlugin({
  id: 'workflow-medium',
  dependsOn: {
    main: ['workflow', 'chat', 'sessions'],
    page: ['workflow'],
  },
  commands: {},
  scopes: {},
  settings: {
    layout: 'default',
  },
  settingInfo: {
    layout: {
      label: 'Medium workflow layout',
      description:
        "The layout that draws Medium's status chip, composer strip and side pane: a folder in the layouts/workflow-medium folder, or default.",
    },
  },
  themeTokens: {
    badge: { kind: 'color', default: 'var(--wg-accent)' },
  },
});
