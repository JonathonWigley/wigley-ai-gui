import { definePlugin } from '../../shared/define-plugin';
import { WORKFLOW_COMMANDS } from './stages';

// Each Chat-tab session's stage in the user's wigley workflow — idle, primer,
// feature, plan ready, make, review, closed — on its session row, in a strip
// above the Chat composer and in a side pane beside the transcript, with each
// stage's next step as a button and a `<Leader>w` key. Main folds the agent
// events into each session's flow, watches its plan folder and runs Clear &
// make, by itself after a countdown when `autoClearAndMake` is on.
export const workflowManifest = definePlugin({
  id: 'workflow',
  dependsOn: ['chat', 'sessions', 'docs', 'keys'],
  commands: {
    ...WORKFLOW_COMMANDS,
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
  settings: {
    layout: 'default',
    autoClearAndMake: false,
    autoStartSeconds: 10,
  },
  settingInfo: {
    layout: {
      label: 'Workflow layout',
      description:
        'The layout that draws the status chip, the composer strip and the side pane: a folder in the layouts/workflow folder, or default.',
    },
    autoClearAndMake: {
      label: 'Auto Clear & make',
      description:
        'Starts Clear & make by itself when a plan is ready, after a countdown the user can cancel.',
    },
    autoStartSeconds: {
      label: 'Auto-start countdown',
      description:
        'Seconds the plan-ready countdown runs before Clear & make starts by itself; at least 1.',
    },
  },
  themeTokens: {},
});
