import { describe, expect, it } from 'vitest';
import type { WorkJob } from '../contract';
import { jiraCard, localCard, workItem } from '../contract.test-support';
import { workManifest } from '../manifest';
import {
  type JobTextSettings,
  jobMessage,
  WORKER_INSTRUCTIONS,
} from './job-text';
import { EMPTY_WORK_FILE, type WorkFile } from './store';
import {
  READ_WORK_STATE_TOOL,
  RECORD_WORK_TICKETS_TOOL,
  REPORT_WORK_JOB_TOOL,
  WORK_TOOLS,
} from './work-tools';

const DEFAULTS = workManifest.settings;

const SETTINGS: JobTextSettings = {
  lookbackHours: DEFAULTS.lookbackHours,
  channels: DEFAULTS.channels,
  broadcastChannels: DEFAULTS.broadcastChannels,
  keywords: DEFAULTS.keywords,
  stallHours: DEFAULTS.stallHours,
  jiraQuery: DEFAULTS.jiraQuery,
  columns: DEFAULTS.columns,
  detailComments: 10,
  threadReplies: 5,
};

const ITEM = workItem('a', {
  title: 'Release freeze',
  channel: '#eng',
  url: 'https://slack.example/a-reply',
});

const FILE: WorkFile = {
  ...EMPTY_WORK_FILE,
  items: [ITEM],
  cards: [jiraCard('WS-12', 'To Do'), localCard('local-1', 'Todo')],
};

const TEXT = 'Thanks, I will look today.\n\nCheers';

const JOBS: WorkJob[] = [
  { kind: 'sweep' },
  { kind: 'send', itemId: 'a', text: TEXT },
  { kind: 'nudge', itemId: 'a', text: TEXT },
  { kind: 'move', key: 'WS-12', column: 'In QA' },
  { kind: 'comment', key: 'WS-12', text: TEXT },
];

function messageOf(
  job: WorkJob,
  settings: JobTextSettings = SETTINGS,
  file: WorkFile = FILE,
): string {
  const message = jobMessage(job, settings, file);
  if (message === null) {
    throw new Error(`no message for ${job.kind}`);
  }
  return message;
}

describe('sweep message', () => {
  it.each([
    [null, 48, 'since the last 48 hours,'],
    [
      '2026-11-23T09:00:00.000Z',
      48,
      'since 2026-11-23T09:00:00.000Z (read a little before it, to catch late replies),',
    ],
  ])('sweep_since: lastSweepAt %s', (lastSweepAt, lookbackHours, expected) => {
    const message = messageOf(
      { kind: 'sweep' },
      { ...SETTINGS, lookbackHours },
      { ...FILE, lastSweepAt },
    );

    expect(message).toContain(expected);
  });

  it('sweep_lists', () => {
    const message = messageOf(
      { kind: 'sweep' },
      { ...SETTINGS, channels: [], broadcastChannels: [], keywords: [] },
    );

    expect(message).toContain('- Watched channels: none\n');
    expect(message).toContain('- Broadcast channels: none\n');
    expect(message).toContain('- Keywords: none\n');
    expect(message).toContain(
      '; Todo = To Do / Selected for Development / Open;',
    );
    expect(message).toContain(
      '- Detail: the newest 10 comments of a ticket, the newest 5 replies of a thread\n',
    );
  });

  it('sweep_detailOnlyWhenStampMoved', () => {
    const message = messageOf({ kind: 'sweep' });

    expect(message).toContain(
      `When the updated time differs from the ticket's stamp in ${READ_WORK_STATE_TOOL.name}`,
    );
    expect(message).toContain(
      `When it differs from the item's stamp in ${READ_WORK_STATE_TOOL.name}`,
    );
    expect(message).toContain(
      'convert Jira markup and Slack formatting to markdown',
    );
  });

  it('sweep_guardsJiraAndOwnReplies', () => {
    const message = messageOf({ kind: 'sweep' });

    expect(message).toContain(
      `If the query fails, call ${REPORT_WORK_JOB_TOOL.name} with ok false`,
    );
    expect(message).toContain(
      `If it returns no tickets, skip ${RECORD_WORK_TICKETS_TOOL.name}.`,
    );
    expect(message).toContain(
      "a conversation whose newer messages are only the user's own goes in clear, not items.",
    );
  });
});

describe('send, move and comment messages', () => {
  it.each([
    ['send', 'SEND', 'a reply'],
    ['nudge', 'NUDGE', 'a nudge'],
  ] as const)('send_and_nudge: %s', (kind, label, what) => {
    const message = messageOf({ kind, itemId: 'a', text: TEXT });

    expect(message.startsWith(`${label}. `)).toBe(true);
    expect(message).toContain(`on ${what} for "Release freeze" (#eng).`);
    expect(message).toContain(
      'in the conversation https://slack.example/a-reply:',
    );
    expect(message).toContain(`\n\n${TEXT}\n\n`);
  });

  it('move_statusesInOrder', () => {
    const message = messageOf({ kind: 'move', key: 'WS-12', column: 'In QA' });

    expect(message).toContain(
      'take the first status in this list that one reaches: In QA, QA, In Review, Ready for QA.',
    );
  });

  it('comment_postsTextOnce', () => {
    const message = messageOf({ kind: 'comment', key: 'WS-12', text: TEXT });

    expect(message.startsWith('COMMENT. ')).toBe(true);
    expect(message).toContain('on Jira ticket WS-12 ("Ticket WS-12").');
    expect(message).toContain(`\n\n${TEXT}\n\n`);
  });

  it.each<[string, WorkJob]>([
    ['a send for a missing item', { kind: 'send', itemId: 'gone', text: TEXT }],
    [
      'a comment for a key with no Jira card',
      { kind: 'comment', key: 'WS-99', text: TEXT },
    ],
    [
      'a move for a key with no Jira card',
      { kind: 'move', key: 'WS-99', column: 'In QA' },
    ],
    ['a move to Other', { kind: 'move', key: 'WS-12', column: 'Other' }],
    [
      'a move to an unknown column',
      { kind: 'move', key: 'WS-12', column: 'Later' },
    ],
  ])('jobMessage_gone: %s', (_case, job) => {
    expect(jobMessage(job, SETTINGS, FILE)).toBeNull();
  });
});

describe('job text', () => {
  const texts = [WORKER_INSTRUCTIONS, ...JOBS.map((job) => messageOf(job))];

  it('text_isHarnessNeutral', () => {
    for (const text of texts) {
      expect(text).not.toMatch(/mcp__|toolsearch|claude|atlassian/i);
    }
    expect(WORKER_INSTRUCTIONS).toContain('your Slack tools');
    expect(WORKER_INSTRUCTIONS).toContain('your Jira tools');
    expect(messageOf({ kind: 'sweep' })).toContain('your Jira tools');
  });

  it('text_namesToolsByDefinition', () => {
    const names = WORK_TOOLS.map((tool) => tool.name);
    for (const name of names) {
      expect(WORKER_INSTRUCTIONS).toContain(name);
    }
    for (const job of JOBS) {
      expect(messageOf(job)).toContain(REPORT_WORK_JOB_TOOL.name);
    }
    const workWords = texts.flatMap(
      (text) => text.match(/\w*_work_\w*/g) ?? [],
    );
    expect(workWords.filter((word) => !names.includes(word))).toEqual([]);
  });
});
