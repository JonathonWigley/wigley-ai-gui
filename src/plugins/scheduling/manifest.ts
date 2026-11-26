import { definePlugin } from '../../shared/define-plugin';
import { LIST_PICKER_COMMANDS } from '../../shared/list-picker-commands';

// Scheduling: holds the user's scheduled tasks in the shared task file, plans each active task's next run, prepares
// it through chat's launch and hands it to the session host, which starts it as a new session at its time, headless
// unless the task is attended, and, for an unattended task, also while the app is closed; each run the host started
// opens as a row in the side bar's Scheduled runs section.
// It names `chat` for preparing and adopting a run, the profiles and projects, and the turn and row events, and
// `sessions` for the rows, the Scheduled runs section, the offline tool answers and the row selection; its page
// names `sessions` to open a run's row from Schedules mode. `layout` names the layout Schedules mode draws with.
// `selectTask` is the click on a list row, naming its task id (`new` for the "+ New task" row), and `openRunRow` the
// click on a linked history row, naming its run row's session id, so they have no key.
export const schedulingManifest = definePlugin({
  id: 'scheduling',
  label: 'Scheduled tasks',
  description:
    'Runs agent tasks on a schedule as new sessions, headless unless a task is attended; an unattended task also runs while the app is closed.',
  dependsOn: { main: ['chat', 'sessions'], page: ['sessions'] },
  reads: { main: [], page: [] },
  commands: {
    showMode: {
      label: 'schedules (again: toggle the side bar)',
      group: 'modes',
      runsIn: 'page',
    },
    listDown: { label: 'next row', group: 'list', runsIn: 'page' },
    listUp: { label: 'previous row', group: 'list', runsIn: 'page' },
    listTop: { label: 'first row', group: 'list', runsIn: 'page' },
    listBottom: { label: 'last row', group: 'list', runsIn: 'page' },
    open: { label: 'open the task', group: 'list', runsIn: 'page' },
    openKeepingFocus: {
      label: 'open the task, staying in the list',
      group: 'list',
      runsIn: 'page',
    },
    newTask: { label: 'new task', group: 'task', runsIn: 'page' },
    edit: { label: 'edit', group: 'task', runsIn: 'page' },
    togglePaused: { label: 'pause or resume', group: 'task', runsIn: 'page' },
    runNow: { label: 'run now', group: 'task', runsIn: 'page' },
    remove: { label: 'remove', group: 'task', runsIn: 'page' },
    historyDown: { label: 'next run', group: 'history', runsIn: 'page' },
    historyUp: { label: 'previous run', group: 'history', runsIn: 'page' },
    historyTop: { label: 'newest run', group: 'history', runsIn: 'page' },
    historyBottom: { label: 'oldest run', group: 'history', runsIn: 'page' },
    openRun: { label: "open the run's row", group: 'history', runsIn: 'page' },
    lineDown: { label: 'scroll a line down', group: 'pane', runsIn: 'page' },
    lineUp: { label: 'scroll a line up', group: 'pane', runsIn: 'page' },
    halfPageDown: {
      label: 'scroll half a page down',
      group: 'pane',
      runsIn: 'page',
    },
    halfPageUp: {
      label: 'scroll half a page up',
      group: 'pane',
      runsIn: 'page',
    },
    fieldDown: { label: 'next field', group: 'editor', runsIn: 'page' },
    fieldUp: { label: 'previous field', group: 'editor', runsIn: 'page' },
    editField: { label: 'edit the field', group: 'editor', runsIn: 'page' },
    nextField: { label: 'next box', group: 'box', runsIn: 'page' },
    previousField: { label: 'previous box', group: 'box', runsIn: 'page' },
    save: { label: 'save the task', group: 'editor', runsIn: 'page' },
    cancelEdit: { label: 'cancel', group: 'editor', runsIn: 'page' },
    leaveBox: { label: 'leave the box', group: 'box', runsIn: 'page' },
    confirmYes: { label: 'confirm', group: 'confirm', runsIn: 'page' },
    confirmNo: { label: 'keep it', group: 'confirm', runsIn: 'page' },
    ...LIST_PICKER_COMMANDS,
    selectTask: {
      label: 'select this task',
      group: 'list',
      runsIn: 'page',
      arg: 'string',
    },
    openRunRow: {
      label: "open this run's row",
      group: 'history',
      runsIn: 'page',
      arg: 'string',
    },
  },
  scopes: {
    list: 'In the scheduled task list',
    detail: 'In a scheduled task',
    editor: 'In the task editor',
    picker: 'In a task editor list picker',
    confirm: 'In a task confirmation',
  },
  settings: { layout: 'default' },
  settingControls: { layout: 'layout' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The Schedules layout: a folder name in scheduling's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
