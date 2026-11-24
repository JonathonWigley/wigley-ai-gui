import { definePlugin } from '../../shared/define-plugin';

// Inbox mode: the work plugin's Slack threads, sorted into sections by what needs the user, in a side bar of
// sections and a sheet of cards, with the cursor card's thread and its draft reply in a detail pane beside the cards.
// It reads `work.state` and `work.details` and runs `work` commands only, each through its own commands, so a refusal
// toasts. `layout` names the layout Inbox draws with. The commands taking an arg are the clicks on the detail pane's
// buttons and chips, on a card and on a row, and the run from another view (`filterTicket`), so they have no key.
export const workInboxManifest = definePlugin({
  id: 'work-inbox',
  label: 'Inbox',
  description:
    'Adds Inbox mode: Slack threads sorted by what needs you, with each thread and its draft reply in a detail pane beside the cards.',
  dependsOn: { main: [], page: ['work'] },
  reads: { main: [], page: [] },
  commands: {
    showMode: { label: 'inbox', group: 'modes', runsIn: 'page' },
    sectionDown: { label: 'next section', group: 'sections', runsIn: 'page' },
    sectionUp: {
      label: 'previous section',
      group: 'sections',
      runsIn: 'page',
    },
    sectionTop: { label: 'first section', group: 'sections', runsIn: 'page' },
    sectionBottom: {
      label: 'last section',
      group: 'sections',
      runsIn: 'page',
    },
    openSection: {
      label: 'open the section',
      group: 'sections',
      runsIn: 'page',
    },
    peekSection: {
      label: 'show the section, keeping focus',
      group: 'sections',
      runsIn: 'page',
    },
    listDown: { label: 'next card', group: 'list', runsIn: 'page' },
    listUp: { label: 'previous card', group: 'list', runsIn: 'page' },
    listTop: { label: 'first card', group: 'list', runsIn: 'page' },
    listBottom: { label: 'last card', group: 'list', runsIn: 'page' },
    openSlack: { label: 'open in Slack', group: 'card', runsIn: 'page' },
    editDraft: { label: 'write a reply', group: 'card', runsIn: 'page' },
    send: { label: 'send the reply', group: 'card', runsIn: 'page' },
    leaveBox: { label: 'leave the reply box', group: 'box', runsIn: 'page' },
    togglePane: {
      label: 'open or close the detail pane',
      group: 'pane',
      runsIn: 'page',
    },
    paneLineDown: {
      label: 'scroll the detail a line down',
      group: 'pane',
      runsIn: 'page',
    },
    paneLineUp: {
      label: 'scroll the detail a line up',
      group: 'pane',
      runsIn: 'page',
    },
    paneHalfPageDown: {
      label: 'scroll the detail half a page down',
      group: 'pane',
      runsIn: 'page',
    },
    paneHalfPageUp: {
      label: 'scroll the detail half a page up',
      group: 'pane',
      runsIn: 'page',
    },
    dismiss: { label: 'dismiss', group: 'card', runsIn: 'page' },
    snooze: { label: 'snooze 1 day', group: 'card', runsIn: 'page' },
    restore: { label: 'restore', group: 'card', runsIn: 'page' },
    addToBoard: { label: 'add to Board', group: 'card', runsIn: 'page' },
    startSession: { label: 'start a session', group: 'card', runsIn: 'page' },
    ticketOnBoard: {
      label: 'show its ticket on the Board',
      group: 'card',
      runsIn: 'page',
    },
    clearFilter: {
      label: 'clear the ticket filter',
      group: 'list',
      runsIn: 'page',
    },
    sweep: { label: 'sweep Slack and Jira', group: 'work', runsIn: 'page' },
    showJobRow: {
      label: "show the last job's transcript",
      group: 'work',
      runsIn: 'page',
    },
    filterTicket: {
      label: 'show the threads of a ticket',
      group: 'list',
      runsIn: 'page',
      arg: 'string',
    },
    selectItem: {
      label: 'select this card',
      group: 'list',
      runsIn: 'page',
      arg: 'string',
    },
    selectSection: {
      label: 'show this section',
      group: 'sections',
      runsIn: 'page',
      arg: 'string',
    },
    sendItem: {
      label: "send this card's draft",
      group: 'card',
      runsIn: 'page',
      arg: 'string',
    },
    openTicket: {
      label: 'show this ticket on the Board',
      group: 'card',
      runsIn: 'page',
      arg: 'string',
    },
    dismissItem: {
      label: 'dismiss this card',
      group: 'card',
      runsIn: 'page',
      arg: 'string',
    },
    restoreItem: {
      label: 'restore this card',
      group: 'card',
      runsIn: 'page',
      arg: 'string',
    },
    snoozeItem: {
      label: 'snooze this card 1 day',
      group: 'card',
      runsIn: 'page',
      arg: 'string',
    },
    addItemToBoard: {
      label: 'add this card to the Board',
      group: 'card',
      runsIn: 'page',
      arg: 'string',
    },
    startItemSession: {
      label: 'start a session from this card',
      group: 'card',
      runsIn: 'page',
      arg: 'string',
    },
  },
  scopes: {
    sections: 'In the Inbox sections',
    list: 'In the Inbox list',
    box: 'In an Inbox reply box',
  },
  settings: { layout: 'default' },
  settingControls: { layout: 'layout' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The Inbox layout: a folder name in work-inbox's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
