import { definePlugin } from '../../shared/define-plugin';
import { LARGE_COMMANDS } from './stages';

// Large, the workflow of a planned run — idle, primer, explore, interview, plan,
// cold read, plan ready, make, review, fix, closed — over the workflow engine, with
// each stage's actions on `<Leader>w` keys and the moves from the feature run to make
// and from make to retro also as buttons. Main watches each flow's plan folder and
// runs Clear & make, by itself after a countdown when `autoClearAndMake` is on.
export const workflowLargeManifest = definePlugin({
  id: 'workflow-large',
  label: 'Large workflow',
  description:
    'Tracks a planned run from primer to close, with its stage actions and Clear & make.',
  dependsOn: {
    main: ['workflow', 'chat', 'sessions'],
    page: ['workflow', 'docs', 'sessions'],
  },
  reads: { main: [], page: [] },
  commands: LARGE_COMMANDS,
  scopes: {},
  settings: {
    layout: 'default',
    autoClearAndMake: false,
    autoStartSeconds: 10,
  },
  settingControls: { layout: 'layout' },
  settingInfo: {
    layout: {
      label: 'Large workflow layout',
      description:
        "The layout that draws Large's status chip, composer strip and side pane: a folder in the layouts/workflow-large folder, or default.",
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
  themeTokens: {
    badge: { kind: 'color', default: 'var(--wg-status-warning)' },
  },
});
