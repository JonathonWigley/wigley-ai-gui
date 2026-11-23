import { definePlugin } from '../../shared/define-plugin';

// Board mode: the work plugin's Jira tickets and local tasks in the `work.columns` columns, with the moves work
// detection suggests. It reads `work.state` and runs `work` commands only, each through its own commands, so a refusal
// toasts. `layout` names the layout the Board draws with. The commands taking an arg are the clicks on a card's
// buttons, chip and root, a drop, and the run from another view (`showTicket`), so they have no key.
export const workBoardManifest = definePlugin({
  id: 'work-board',
  label: 'Board',
  description:
    'Adds Board mode: your Jira tickets and local tasks in columns, with suggested moves.',
  dependsOn: { main: [], page: ['work'] },
  reads: { main: [], page: [] },
  commands: {
    showMode: { label: 'board', group: 'modes', runsIn: 'page' },
    cardDown: { label: 'next card', group: 'board', runsIn: 'page' },
    cardUp: { label: 'previous card', group: 'board', runsIn: 'page' },
    cardTop: { label: 'first card', group: 'board', runsIn: 'page' },
    cardBottom: { label: 'last card', group: 'board', runsIn: 'page' },
    columnLeft: { label: 'previous column', group: 'board', runsIn: 'page' },
    columnRight: { label: 'next column', group: 'board', runsIn: 'page' },
    moveLeft: {
      label: 'move to the previous column',
      group: 'card',
      runsIn: 'page',
    },
    moveRight: {
      label: 'move to the next column',
      group: 'card',
      runsIn: 'page',
    },
    openCard: {
      label: "open the ticket, or the task's thread",
      group: 'card',
      runsIn: 'page',
    },
    accept: {
      label: 'accept the suggested move',
      group: 'card',
      runsIn: 'page',
    },
    notYet: { label: 'not yet', group: 'card', runsIn: 'page' },
    threads: {
      label: 'show its threads in the Inbox',
      group: 'card',
      runsIn: 'page',
    },
    startSession: { label: 'start a session', group: 'card', runsIn: 'page' },
    deleteTask: {
      label: 'delete the local task',
      group: 'card',
      runsIn: 'page',
    },
    sweep: { label: 'sweep Slack and Jira', group: 'work', runsIn: 'page' },
    showJobRow: {
      label: "show the last job's transcript",
      group: 'work',
      runsIn: 'page',
    },
    showTicket: {
      label: 'show a ticket on the Board',
      group: 'board',
      runsIn: 'page',
      arg: 'string',
    },
    selectCard: {
      label: 'select this card',
      group: 'board',
      runsIn: 'page',
      arg: 'string',
    },
    openThreads: {
      label: "show this ticket's threads in the Inbox",
      group: 'card',
      runsIn: 'page',
      arg: 'string',
    },
    moveCardTo: {
      label: 'move this card to a column',
      group: 'card',
      runsIn: 'page',
      arg: { cardId: 'string', column: 'string' },
    },
    acceptCard: {
      label: "accept this card's suggested move",
      group: 'card',
      runsIn: 'page',
      arg: 'string',
    },
    notYetCard: {
      label: 'not yet for this card',
      group: 'card',
      runsIn: 'page',
      arg: 'string',
    },
    deleteCard: {
      label: 'delete this local task',
      group: 'card',
      runsIn: 'page',
      arg: 'string',
    },
    startCardSession: {
      label: 'start a session from this card',
      group: 'card',
      runsIn: 'page',
      arg: 'string',
    },
  },
  scopes: {
    board: 'On the Board',
  },
  settings: {
    layout: 'default',
  },
  settingControls: { layout: 'layout' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The Board layout: a folder name in work-board's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
