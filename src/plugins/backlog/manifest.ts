import { definePlugin } from '../../shared/define-plugin';
import { LIST_PICKER_COMMANDS } from '../../shared/list-picker-commands';

// Backlog mode: every features home's follow-ups (create, edit, delete, tags),
// plans and primed features (read-only), grouped by repo. `tags` is the list
// the tag picker offers; a tag a file holds that the list lacks still shows.
// `layout` names the layout Backlog draws with.
export const backlogManifest = definePlugin({
  id: 'backlog',
  dependsOn: { main: ['docs'], page: ['docs'] },
  reads: { main: [], page: [] },
  commands: {
    showMode: {
      label: 'backlog (again: toggle the side bar)',
      group: 'modes',
      runsIn: 'page',
    },
    listDown: { label: 'next row', group: 'list', runsIn: 'page' },
    listUp: { label: 'previous row', group: 'list', runsIn: 'page' },
    listTop: { label: 'first row', group: 'list', runsIn: 'page' },
    listBottom: { label: 'last row', group: 'list', runsIn: 'page' },
    open: { label: 'open or step in', group: 'list', runsIn: 'page' },
    back: { label: 'go back', group: 'list', runsIn: 'page' },
    toggle: {
      label: 'open and focus, expand or collapse',
      group: 'list',
      runsIn: 'page',
    },
    filter: {
      label: 'filter by title, one line or tag',
      group: 'list',
      runsIn: 'page',
    },
    rescan: { label: 'rescan the backlog', group: 'list', runsIn: 'page' },
    create: { label: 'new follow-up', group: 'change', runsIn: 'page' },
    edit: { label: 'edit the follow-up', group: 'change', runsIn: 'page' },
    delete: { label: 'delete the follow-up', group: 'change', runsIn: 'page' },
    toggleAgentReady: {
      label: 'toggle agent-ready',
      group: 'change',
      runsIn: 'page',
    },
    pickTag: { label: 'pick a tag', group: 'change', runsIn: 'page' },
    commit: {
      label: "commit the home's follow-up files",
      group: 'change',
      runsIn: 'page',
    },
    toggleDone: {
      label: 'show or hide done follow-ups',
      group: 'view',
      runsIn: 'page',
    },
    toggleAgentReadyOnly: {
      label: 'show only agent-ready follow-ups',
      group: 'view',
      runsIn: 'page',
    },
    openInDocs: { label: 'open in Docs mode', group: 'view', runsIn: 'page' },
    lineDown: { label: 'scroll a line down', group: 'detail', runsIn: 'page' },
    lineUp: { label: 'scroll a line up', group: 'detail', runsIn: 'page' },
    halfPageDown: {
      label: 'scroll half a page down',
      group: 'detail',
      runsIn: 'page',
    },
    halfPageUp: {
      label: 'scroll half a page up',
      group: 'detail',
      runsIn: 'page',
    },
    scrollTop: { label: 'scroll to the top', group: 'detail', runsIn: 'page' },
    scrollEnd: { label: 'scroll to the end', group: 'detail', runsIn: 'page' },
    save: { label: 'save the follow-up', group: 'editor', runsIn: 'page' },
    cancelEdit: { label: 'cancel the edit', group: 'editor', runsIn: 'page' },
    leaveBox: { label: 'leave the box', group: 'editor', runsIn: 'page' },
    nextField: { label: 'next field', group: 'editor', runsIn: 'page' },
    previousField: { label: 'previous field', group: 'editor', runsIn: 'page' },
    ...LIST_PICKER_COMMANDS,
    boxAccept: { label: 'accept', group: 'box', runsIn: 'page' },
    boxCancel: { label: 'cancel', group: 'box', runsIn: 'page' },
    confirmYes: {
      label: 'yes',
      group: 'confirm',
      runsIn: 'page',
    },
    confirmNo: { label: 'keep it', group: 'confirm', runsIn: 'page' },
  },
  scopes: {
    homes: 'In the backlog homes',
    list: 'In the backlog list',
    detail: 'In a backlog detail',
    editor: 'In the follow-up editor',
    box: 'In the backlog filter box',
    confirm: 'In a backlog confirmation',
    picker: 'In a backlog list picker',
  },
  settings: {
    tags: ['agent-ready', 'needs a feature plan'],
    layout: 'default',
  },
  settingInfo: {
    tags: {
      label: 'Tags',
      description: "The tags Backlog's tag picker offers.",
    },
    layout: {
      label: 'Layout',
      description:
        "The Backlog layout: a folder name in backlog's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
