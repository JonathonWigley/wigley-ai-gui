import { definePlugin } from '../../shared/define-plugin';

// The system stats panel in the right bar: CPU, GPU, RAM, network and disk meters, each with a sparkline, over one
// process list grouped by app, every Chat session a row in the Claude group. Main samples the machine only while a page shows the panel. It
// reads `chat` for each session's process pid and `sessions` for its title.
export const systemStatsManifest = definePlugin({
  id: 'system-stats',
  label: 'System stats',
  description:
    'Shows CPU, GPU, RAM, network and disk use, and what uses them, in the right bar.',
  dependsOn: { main: [], page: [] },
  reads: { main: ['chat', 'sessions'], page: [] },
  commands: {
    togglePanel: {
      label: 'hide or show system stats',
      group: 'view',
      runsIn: 'page',
    },
    cursorDown: { label: 'next process', group: 'panel', runsIn: 'page' },
    cursorUp: { label: 'previous process', group: 'panel', runsIn: 'page' },
    cursorTop: { label: 'first process', group: 'panel', runsIn: 'page' },
    cursorBottom: { label: 'last process', group: 'panel', runsIn: 'page' },
    cycleSort: {
      label: 'sort by the next column',
      group: 'panel',
      runsIn: 'page',
    },
    openGroup: { label: 'open the group', group: 'panel', runsIn: 'page' },
    closeGroup: { label: 'close the group', group: 'panel', runsIn: 'page' },
  },
  scopes: { panel: 'In the system stats panel' },
  settings: { refreshSeconds: 2, processRows: 5, layout: 'default' },
  settingControls: { layout: 'layout' },
  settingInfo: {
    refreshSeconds: {
      label: 'System stats refresh',
      description:
        'How often the panel reads the machine while it shows, in seconds; at least 1. A change moves the next read.',
    },
    processRows: {
      label: 'Process rows',
      description:
        'How many rows the process list shows with its groups closed, groups and the Other row included.',
    },
    layout: {
      label: 'System stats layout',
      description:
        'The layout that draws the system stats panel: a folder in the layouts/system-stats folder, or default.',
    },
  },
  themeTokens: {
    'column-width': { kind: 'length', default: '56px' },
  },
});
