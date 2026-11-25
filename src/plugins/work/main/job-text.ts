import type {
  WorkColumnSetting,
  WorkItem,
  WorkJiraCard,
  WorkJob,
} from '../contract';
import type { WorkFile } from './store';
import {
  READ_WORK_STATE_TOOL,
  RECORD_WORK_ITEMS_TOOL,
  RECORD_WORK_TICKETS_TOOL,
  REPORT_WORK_JOB_TOOL,
} from './work-tools';

// The work settings a job's message reads, `columns` already read through `readColumns`, and `detailComments` and
// `threadReplies` through `detailCaps`.
export interface JobTextSettings {
  lookbackHours: number;
  channels: readonly string[];
  broadcastChannels: readonly string[];
  keywords: readonly string[];
  stallHours: number;
  jiraQuery: string;
  columns: readonly WorkColumnSetting[];
  detailComments: number;
  threadReplies: number;
}

const READ = READ_WORK_STATE_TOOL.name;
const ITEMS = RECORD_WORK_ITEMS_TOOL.name;
const TICKETS = RECORD_WORK_TICKETS_TOOL.name;
const REPORT = REPORT_WORK_JOB_TOOL.name;

// The worker session's standing instructions, the same for every job.
export const WORKER_INSTRUCTIONS = [
  `You are the Auri work worker: a background session the Auri app runs for the user, one job at a time. Each job arrives as one message from the app. You read the user's Slack through your Slack tools and the user's Jira through your Jira tools, and you record what you find only through the app's work tools: ${READ} shows what the app holds, ${ITEMS} records Slack conversations, ${TICKETS} records Jira tickets, and ${REPORT} ends the job. You edit no files, start no other sessions, and ask nothing: no one answers this session.`,
  `If your Slack or Jira tools are not loaded yet, find and load them first. If one is missing or not signed in, call ${REPORT} with ok false and a note naming which, and stop.`,
  "Writes: a SWEEP job is read only, so post, react, edit, transition and comment nothing in Slack or Jira. Every other job is the user's own press in the app and carries exactly one write: make that write exactly as its message says, and nothing else in Slack or Jira.",
  `End every job by calling ${REPORT} once, last.`,
].join('\n\n');

function namesOrNone(names: readonly string[]): string {
  return names.length === 0 ? 'none' : names.join(', ');
}

function columnsText(columns: readonly WorkColumnSetting[]): string {
  if (columns.length === 0) {
    return 'none';
  }
  return columns
    .map((column) => `${column.name} = ${column.jiraStatuses.join(' / ')}`)
    .join('; ');
}

function sinceText(lookbackHours: number, lastSweepAt: string | null): string {
  return lastSweepAt === null
    ? `the last ${lookbackHours} hours`
    : `${lastSweepAt} (read a little before it, to catch late replies)`;
}

function sweepMessage(
  settings: JobTextSettings,
  lastSweepAt: string | null,
): string {
  const since = sinceText(settings.lookbackHours, lastSweepAt);
  return [
    `SWEEP. Gather the user's Slack since ${since}, and the user's Jira tickets. Read only.`,
    '',
    `- Watched channels: ${namesOrNone(settings.channels)}`,
    `- Broadcast channels: ${namesOrNone(settings.broadcastChannels)}`,
    `- Keywords: ${namesOrNone(settings.keywords)}`,
    `- Waiting threshold: ${settings.stallHours} hours`,
    `- Jira query: ${settings.jiraQuery}`,
    `- Board columns: ${columnsText(settings.columns)}`,
    `- Detail: the newest ${settings.detailComments} comments of a ticket, the newest ${settings.threadReplies} replies of a thread`,
    '',
    `1. Call ${READ}.`,
    `2. Jira: run the query with your Jira tools. For each ticket, read its status, the statuses its transitions reach now, and its updated time. When the updated time differs from the ticket's stamp in ${READ}, or it has no stamp, also read its type, assignee, reporter, description, newest comments, subtasks and linked issues, and give them as its detail; else leave detail out. Call ${TICKETS} with every ticket and replace true. If the query fails, call ${REPORT} with ok false and a note on the error, and stop. If it returns no tickets, skip ${TICKETS}.`,
    "3. Slack: read the user's DMs and mentions, the threads the user posted in, the watched and broadcast channels, and search for the open ticket keys and the keywords. An item is one conversation, its id the permalink of its root message. Sort each into one section:",
    '   - needs_you: a DM to the user, or a message that mentions the user or asks the user something directly, not yet answered.',
    '   - promised: something the user said they would do ("I\'ll send that tomorrow") and has not done yet.',
    `   - waiting: a question the user asked, or a reply owed to the user, with no answer for more than ${settings.stallHours} hours.`,
    '   - my_threads: a thread the user posted in that has new replies.',
    "   - around: a post in a watched channel, or found by the search, tied to the user's tickets or keywords. Set why to one line on why it matters to the user. Leave out anything unrelated.",
    '   - worth_knowing: an important post in a broadcast channel that matters to anyone on the team, such as a release freeze, a process change or an outage. Set why. Leave out chatter and routine notices.',
    '   Give each item a two-sentence summary, the latest reply as "Name: text", the participants, and every Jira key it names or plainly concerns; set link_reason for a key it does not name.',
    `   For each item you record, read the Slack ts of its newest message. When it differs from the item's stamp in ${READ}, or it has no stamp, read the root message and the newest replies, each with author, time and text, and give them as its thread with latest_ts and the thread's reply count; else leave thread out.`,
    '   Write each description, comment and message text as markdown: convert Jira markup and Slack formatting to markdown, and keep every word.',
    `4. Call ${ITEMS} with every new or changed item, and in clear the ids of items the user has since replied or reacted to. An item ${READ} shows cleared or dismissed goes in items only when someone other than the user has posted in it since its time; a conversation whose newer messages are only the user's own goes in clear, not items.`,
    `5. Call ${REPORT} with ok true and a one-line note on what changed.`,
  ].join('\n');
}

function postMessage(
  label: 'SEND' | 'NUDGE',
  what: string,
  item: WorkItem,
  text: string,
): string {
  return [
    `${label}. The user pressed Send in the app on ${what} for "${item.title}" (${item.channel}).`,
    `Post exactly the text below once, as the user, in the conversation ${item.url}: as a reply in its thread for a channel message, or in the DM. Change nothing in it.`,
    '',
    text,
    '',
    `Make no other post, reaction or edit in Slack, and change nothing in Jira. Then call ${REPORT}: ok true once it is posted, or ok false with what stopped it.`,
  ].join('\n');
}

function moveMessage(key: string, column: WorkColumnSetting): string {
  return [
    `MOVE. The user moved Jira ticket ${key} to the ${column.name} column in the app.`,
    `Read the transitions ${key} can take now, and take the first status in this list that one reaches: ${column.jiraStatuses.join(', ')}.`,
    'Make that one transition and nothing else: no comment and no other field. If none of those statuses is reachable, change nothing.',
    `Then call ${TICKETS} with ${key}'s status now and the statuses it can reach, replace false, and call ${REPORT}: ok true once it moved, or ok false with a note naming the statuses it can reach.`,
  ].join('\n');
}

function commentMessage(card: WorkJiraCard, text: string): string {
  return [
    `COMMENT. The user wrote a comment in the app on Jira ticket ${card.key} ("${card.title}").`,
    `Add exactly the text below once, as the user, as one new comment on ${card.key}. The text is markdown: where your Jira tool takes another format, convert the formatting only and keep every word.`,
    '',
    text,
    '',
    `Make no other comment, transition or field change in Jira, and change nothing in Slack. Then call ${REPORT}: ok true once it is posted, or ok false with what stopped it.`,
  ].join('\n');
}

// The message that starts `job` in the worker session; null when the job's item, Jira card or column is gone, so
// the runner fails it.
export function jobMessage(
  job: WorkJob,
  settings: JobTextSettings,
  file: Pick<WorkFile, 'items' | 'cards' | 'lastSweepAt'>,
): string | null {
  switch (job.kind) {
    case 'sweep':
      return sweepMessage(settings, file.lastSweepAt);
    case 'send':
    case 'nudge': {
      const item = file.items.find((candidate) => candidate.id === job.itemId);
      if (item === undefined) {
        return null;
      }
      return job.kind === 'send'
        ? postMessage('SEND', 'a reply', item, job.text)
        : postMessage('NUDGE', 'a nudge', item, job.text);
    }
    case 'move': {
      const hasJiraCard = file.cards.some(
        (card) => card.kind === 'jira' && card.key === job.key,
      );
      const column = settings.columns.find(
        (candidate) => candidate.name === job.column,
      );
      if (!hasJiraCard || column === undefined) {
        return null;
      }
      return moveMessage(job.key, column);
    }
    case 'comment': {
      const card = file.cards.find(
        (candidate): candidate is WorkJiraCard =>
          candidate.kind === 'jira' && candidate.key === job.key,
      );
      if (card === undefined) {
        return null;
      }
      return commentMessage(card, job.text);
    }
  }
}
