import { definePlugin } from '../../shared/define-plugin';
import type {
  WorkColumnSetting,
  WorkProjectSetting,
  WorkSignalSetting,
} from './contract';

// Work: the user's Slack and Jira work, kept in `work.json` in the plugin data and published as `work.state` for the
// Inbox and Board views. Every card action is a page command that hands its argument to main over the channel, so a
// reporting run sees main's refusal. It names `chat` for the worker and spin-up launches and `sessions` for the rows
// and tools, chat's page for the new-session prompt a spin-up with no mapped project opens, and reads `unity-pool` for
// the pool clones detection watches.
export const workManifest = definePlugin({
  id: 'work',
  label: 'Work',
  description:
    "Brings the user's Slack and Jira work into the app: the store, the worker jobs, work detection and every card action, for the Inbox and Board views.",
  dependsOn: { main: ['chat', 'sessions'], page: ['chat'] },
  reads: { main: ['unity-pool'], page: [] },
  commands: {
    sweep: {
      label: 'sweep Slack and Jira now',
      group: 'work',
      runsIn: 'page',
    },
    send: {
      label: 'send the reply or nudge',
      group: 'work',
      runsIn: 'page',
      arg: { itemId: 'string', text: 'string' },
    },
    dismiss: {
      label: 'dismiss the item',
      group: 'work',
      runsIn: 'page',
      arg: 'string',
    },
    restore: {
      label: 'restore the item',
      group: 'work',
      runsIn: 'page',
      arg: 'string',
    },
    snooze: {
      label: 'snooze the item for a day',
      group: 'work',
      runsIn: 'page',
      arg: 'string',
    },
    addToBoard: {
      label: 'add the item to the Board as a local task',
      group: 'work',
      runsIn: 'page',
      arg: 'string',
    },
    moveCard: {
      label: 'move the card to a column',
      group: 'work',
      runsIn: 'page',
      arg: { cardId: 'string', column: 'string' },
    },
    acceptSuggestion: {
      label: 'accept the suggested move',
      group: 'work',
      runsIn: 'page',
      arg: 'string',
    },
    notYet: {
      label: 'hide the suggested move until a newer signal',
      group: 'work',
      runsIn: 'page',
      arg: 'string',
    },
    deleteTask: {
      label: 'delete the local task',
      group: 'work',
      runsIn: 'page',
      arg: 'string',
    },
    startSession: {
      label: 'start a session from the item or card',
      group: 'work',
      runsIn: 'page',
      arg: { source: 'string', id: 'string' },
    },
    openJobRow: {
      label: "open the worker job's transcript",
      group: 'work',
      runsIn: 'page',
    },
  },
  scopes: {},
  settings: {
    profile: '',
    intervalMinutes: 10,
    lookbackHours: 48,
    channels: [] as string[],
    broadcastChannels: ['general', 'announcements'] as string[],
    keywords: [] as string[],
    stallHours: 24,
    jiraQuery:
      'assignee = currentUser() AND (statusCategory != Done OR resolved >= -14d) ORDER BY updated DESC',
    columns: [
      { name: 'Backlog', jiraStatuses: ['Backlog'] },
      {
        name: 'Todo',
        jiraStatuses: ['To Do', 'Selected for Development', 'Open'],
      },
      { name: 'In Progress', jiraStatuses: ['In Progress'] },
      {
        name: 'In QA',
        jiraStatuses: ['In QA', 'QA', 'In Review', 'Ready for QA'],
      },
      { name: 'Done', jiraStatuses: ['Done', 'Closed', 'Resolved'] },
    ] as WorkColumnSetting[],
    signals: {
      branch: 'In Progress',
      commit: 'In Progress',
      pr_opened: 'In QA',
      pr_merged: 'Done',
      session: 'In Progress',
    } as WorkSignalSetting,
    repoFolders: [] as string[],
    projects: [] as WorkProjectSetting[],
  },
  settingInfo: {
    profile: {
      label: 'Worker profile',
      description:
        "The profile worker jobs run on; empty for chat's default profile.",
    },
    intervalMinutes: {
      label: 'Sweep interval (minutes)',
      description: 'Minutes between sweeps while the app runs; 0 for never.',
    },
    lookbackHours: {
      label: 'First look back (hours)',
      description: 'How far back the first sweep reads Slack.',
    },
    channels: {
      label: 'Watched channels',
      description: 'Slack channels (no #) read for Around Slack.',
    },
    broadcastChannels: {
      label: 'Broadcast channels',
      description:
        'Slack channels (no #) whose important posts go to Worth knowing.',
    },
    keywords: {
      label: 'Keywords',
      description: 'Words that make a Slack post relevant.',
    },
    stallHours: {
      label: 'Stall hours',
      description:
        'Hours of quiet before a thread counts as Waiting on others.',
    },
    jiraQuery: {
      label: 'Jira query',
      description: "The JQL for the Board's tickets.",
    },
    columns: {
      label: 'Board columns',
      description:
        'The Board\'s columns in order, each { "name", "jiraStatuses" }: the Jira statuses the column stands for.',
    },
    'signals.branch': {
      label: 'Branch signal',
      description:
        "The column a branch with the ticket's key suggests, or off.",
    },
    'signals.commit': {
      label: 'Commit signal',
      description:
        "The column a commit with the ticket's key suggests, or off.",
    },
    'signals.pr_opened': {
      label: 'PR opened signal',
      description:
        'The column an open pull request for the ticket suggests, or off.',
    },
    'signals.pr_merged': {
      label: 'PR merged signal',
      description:
        'The column a merged pull request, with none open, suggests, or off.',
    },
    'signals.session': {
      label: 'Session signal',
      description: 'The column a session linked to the card suggests, or off.',
    },
    repoFolders: {
      label: 'Repo folders',
      description:
        "Folders watched beyond chat's projects and their pool clones.",
    },
    projects: {
      label: 'Projects',
      description:
        'The Auri project each Jira project starts sessions in: a list of { "jiraProject", "project" }.',
    },
  },
  themeTokens: {},
  demoSkip:
    'A data plugin: the Inbox and Board views draw its state, and their demo steps show it.',
});
