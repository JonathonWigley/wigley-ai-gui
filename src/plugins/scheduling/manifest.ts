import { definePlugin } from '../../shared/define-plugin';

// Scheduling: holds the user's scheduled tasks in the shared task file, plans each active task's next run, prepares
// it through chat's launch and hands it to the session host, which starts it as a new headless session at its time,
// also while the app is closed; each run the host started opens as a row in the side bar's Scheduled runs section.
// It names `chat` for preparing and adopting a run, the profiles and projects, and the turn and row events, and
// `sessions` for the rows, the Scheduled runs section, the offline tool answers and the row selection.
export const schedulingManifest = definePlugin({
  id: 'scheduling',
  label: 'Scheduled tasks',
  description:
    'Runs agent tasks on a schedule as new headless sessions, also while the app is closed.',
  dependsOn: { main: ['chat', 'sessions'], page: ['sessions'] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The scheduling layout Schedules mode draws in: a folder name in scheduling's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
