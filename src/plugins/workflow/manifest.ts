import { definePlugin } from '../../shared/define-plugin';
import { WORKFLOW_LIST_CONTROL_KIND } from '../contributions/contract';
import type { AutoStartSetting } from './contract';

// The engine of the user's workflows: each Chat-tab session's flow through the
// workflow that claimed it, on its session row, in a strip above the Chat composer
// and in a side pane beside the transcript, with the main action on `<Leader>ww`.
// Main folds the agent events and the steps `set_workflow_step` reports into each
// session's flow. Each workflow is a declaration an agent plugin's `auri.json`
// contributes (`declared/`), with the built-in Checklist flow, and the plan
// capability in `plan/`. Every flow starts on the Checklist flow. `cancelCountdown` stops the auto-start countdown of the
// session it targets. `toggleHeadless` turns the headless flag of the
// session Sessions mode shows on or off, as the strip's Headless chip does. `stageAction` runs
// a stage action for the session and action its arg names; every stage button,
// fold, Headless chip and stage key runs it, and it has no key of its own.
export const workflowManifest = definePlugin({
  id: 'workflow',
  label: 'Workflow',
  description:
    "Shows each session's workflow on its row, above the composer and in a side pane.",
  dependsOn: {
    main: ['chat', 'sessions', 'contributions'],
    page: ['chat', 'sessions', 'docs'],
  },
  reads: { main: [], page: [] },
  commands: {
    mainAction: {
      label: "run the stage's next step",
      group: 'workflow',
      runsIn: 'page',
      risky: true,
      targets: true,
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
    toggleHeadless: {
      label: 'turn headless on or off',
      group: 'workflow',
      runsIn: 'page',
      targets: true,
    },
    stageAction: {
      label: 'run a stage action for a session',
      group: 'workflow',
      runsIn: 'page',
      arg: { sessionId: 'string', action: 'string' },
      risky: true,
    },
    openPreview: {
      label: 'show the workflow layout preview',
      group: 'debug',
      runsIn: 'page',
    },
    cancelCountdown: {
      label: 'cancel the auto-start',
      group: 'workflow',
      runsIn: 'page',
      targets: true,
    },
  },
  scopes: {},
  settings: {
    off: [] as string[],
    autoStart: [] as AutoStartSetting[],
    layout: 'default',
  },
  settingControls: {
    off: WORKFLOW_LIST_CONTROL_KIND,
    autoStart: 'json',
    layout: 'layout',
  },
  settingInfo: {
    off: {
      label: 'Workflows off',
      description:
        'The declared workflows that do not run, each as plugin:workflow.',
    },
    autoStart: {
      label: 'Auto-start',
      description:
        'The declared workflows whose ready stage runs its action by itself after a countdown: a list of { "workflow", "seconds" }, seconds at least 1.',
    },
    layout: {
      label: 'Workflow layout',
      description:
        "The layout that draws every declared workflow's chip, composer strip and side pane: a folder in the layouts/workflow folder, or default.",
    },
  },
  themeTokens: {},
});
