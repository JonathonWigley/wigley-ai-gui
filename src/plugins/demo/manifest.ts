import { definePlugin } from '../../shared/define-plugin';

// The demo: a walk through every feature of the app, one step at a time, on
// sample data with a caption. Its main names `chat` for the demo sessions and
// `scoped-agents` for the step agents; its page names `sessions` for the Demo
// section and `scoped-agents` for the step agent's pane. Every command runs in
// the page; `cursorDown`, `cursorUp`, `goToCursor` and `askAgent` act on the
// focused Demo panel, in scope `panel`. No command is risky: a risky confirm
// shows through the side bar, which leaves out the step agent's own row.
// `layout` names the layout the panel and the caption draw with.
export const demoManifest = definePlugin({
  id: 'demo',
  label: 'Demo',
  description:
    'Walks through every feature of the app, one step at a time, on sample data with a caption.',
  dependsOn: {
    main: ['chat', 'scoped-agents'],
    page: ['sessions', 'scoped-agents'],
  },
  reads: { main: [], page: [] },
  commands: {
    togglePanel: {
      label: 'show or hide the demo',
      group: 'demo',
      runsIn: 'page',
    },
    next: { label: 'next beat or step', group: 'demo', runsIn: 'page' },
    previous: {
      label: 'previous beat or step',
      group: 'demo',
      runsIn: 'page',
    },
    goTo: {
      label: 'go to a demo step',
      group: 'demo',
      runsIn: 'page',
      arg: 'string',
    },
    autoplay: {
      label: 'autoplay the demo on or off',
      group: 'demo',
      runsIn: 'page',
    },
    reset: {
      label: 'set the demo step up again',
      group: 'demo',
      runsIn: 'page',
    },
    showReal: {
      label: 'show or hide the real sessions',
      group: 'demo',
      runsIn: 'page',
    },
    stop: { label: 'stop the demo', group: 'demo', runsIn: 'page' },
    cursorDown: { label: 'next step', group: 'panel', runsIn: 'page' },
    cursorUp: { label: 'previous step', group: 'panel', runsIn: 'page' },
    goToCursor: { label: 'go to the step', group: 'panel', runsIn: 'page' },
    askAgent: { label: 'ask the step agent', group: 'panel', runsIn: 'page' },
  },
  scopes: { panel: 'In the Demo panel' },
  settings: { layout: 'default', autoplaySeconds: 5 },
  settingControls: { layout: 'layout' },
  settingInfo: {
    autoplaySeconds: {
      label: 'Demo autoplay',
      description:
        'How long autoplay shows each beat of a demo step, in seconds; at least 1. A beat that needs longer keeps its own longer time.',
    },
    layout: {
      label: 'Demo layout',
      description:
        'The layout that draws the Demo panel and the caption: a folder in the layouts/demo folder, or default.',
    },
  },
  themeTokens: {},
});
