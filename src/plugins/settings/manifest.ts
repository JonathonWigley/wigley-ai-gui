import { definePlugin } from '../../shared/define-plugin';

// Settings mode: every setting and key bind the user config holds, browsed by
// section and edited in place, each edit written to the user's
// `settings.json` or `keymap.json` layer. `show` runs in main so the app menu
// accelerator `Cmd+,` reaches it.
export const settingsManifest = definePlugin({
  id: 'settings',
  dependsOn: { main: [], page: ['keys'] },
  reads: { main: [], page: [] },
  commands: {
    show: { label: 'settings', group: 'modes', runsIn: 'main' },
    showMode: {
      label: 'settings (again: toggle the sections)',
      group: 'modes',
      runsIn: 'page',
    },
    down: { label: 'next row', group: 'settings', runsIn: 'page' },
    up: { label: 'previous row', group: 'settings', runsIn: 'page' },
    top: { label: 'first row', group: 'settings', runsIn: 'page' },
    bottom: { label: 'last row', group: 'settings', runsIn: 'page' },
    open: {
      label: 'open the section or edit the row',
      group: 'settings',
      runsIn: 'page',
    },
    edit: { label: 'edit the row', group: 'settings', runsIn: 'page' },
    reset: { label: 'reset to the default', group: 'settings', runsIn: 'page' },
    addBind: { label: 'add a key', group: 'settings', runsIn: 'page' },
    removeBind: { label: 'remove a key', group: 'settings', runsIn: 'page' },
    filter: { label: 'filter the rows', group: 'settings', runsIn: 'page' },
    clearFilter: {
      label: 'clear the filter',
      group: 'settings',
      runsIn: 'page',
    },
    boxAccept: { label: 'save the value', group: 'box', runsIn: 'page' },
    boxCancel: { label: 'cancel the edit', group: 'box', runsIn: 'page' },
    pickerDown: { label: 'next choice', group: 'picker', runsIn: 'page' },
    pickerUp: { label: 'previous choice', group: 'picker', runsIn: 'page' },
    pickerChoose: { label: 'choose', group: 'picker', runsIn: 'page' },
    pickerCancel: { label: 'cancel', group: 'picker', runsIn: 'page' },
  },
  scopes: {
    sections: 'In settings sections',
    rows: 'In settings',
    box: 'In a settings box',
    picker: 'In a settings list',
  },
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The Settings mode layout: a folder name in settings' layouts folder, or default.",
    },
  },
  themeTokens: {},
});
