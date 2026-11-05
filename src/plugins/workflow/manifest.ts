import { definePlugin } from '../../shared/define-plugin';

// The engine of the user's workflows: each Chat-tab session's flow through the
// workflow that claimed it, on its session row, in a strip above the Chat composer
// and in a side pane beside the transcript, with the main action on `<Leader>ww`.
// Main folds the agent events and the steps `set_workflow_step` reports into each
// session's flow. Each workflow is its own plugin, which names its stages, its
// layouts and its commands.
export const workflowManifest = definePlugin({
  id: 'workflow',
  dependsOn: {
    main: ['chat', 'sessions'],
    page: ['chat', 'sessions'],
  },
  reads: { main: [], page: [] },
  commands: {
    mainAction: {
      label: "run the stage's next step",
      group: 'workflow',
      runsIn: 'page',
    },
    toggleSidePane: {
      label: 'show or hide the side pane',
      group: 'workflow',
      runsIn: 'page',
    },
    toggleFinishedWaves: {
      label: 'open or fold finished waves',
      group: 'workflow',
      runsIn: 'page',
    },
    openPreview: {
      label: 'show the workflow layout preview',
      group: 'debug',
      runsIn: 'page',
    },
  },
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});
