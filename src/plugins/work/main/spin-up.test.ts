import { describe, expect, it } from 'vitest';
import type { ChatProject, LaunchRequest } from '../../chat/contract';
import type {
  WorkCard,
  WorkItem,
  WorkProjectSetting,
  WorkStartArg,
} from '../contract';
import { jiraCard, localCard, workItem } from '../contract.test-support';
import {
  linkSession,
  SPIN_UP_THREADS,
  spinUpCardIds,
  spinUpMessage,
  startFromWork,
} from './spin-up';
import { EMPTY_WORK_FILE, type WorkFile } from './store';

const gamma: ChatProject = {
  kind: 'folder',
  name: 'gamma',
  folder: '~/dev/gamma',
  profile: null,
};
const delta: ChatProject = {
  kind: 'pool',
  name: 'delta',
  pool: 'delta-clones',
  profile: 'personal',
};

function fileWith(parts: Partial<WorkFile> = {}): WorkFile {
  return { ...EMPTY_WORK_FILE, ...parts };
}

// The deps over a fake chat listing `chatProjects`, whose launches are recorded and answered by `launch`.
function depsOver(
  options: {
    projects?: WorkProjectSetting[];
    chatProjects?: ChatProject[];
    defaultProfile?: string | null;
    launch?: () => Promise<string>;
  } = {},
) {
  const launches: LaunchRequest[] = [];
  const logs: string[] = [];
  const deps = {
    chat: {
      launch: (request: LaunchRequest) => {
        launches.push(request);
        return options.launch?.() ?? Promise.resolve('row-7');
      },
      projects: () => options.chatProjects ?? [gamma, delta],
      defaultProfile: () =>
        options.defaultProfile === undefined ? 'work' : options.defaultProfile,
    },
    projects: () =>
      options.projects ?? [
        { jiraProject: 'ABC', project: 'gamma' },
        { jiraProject: 'DEF', project: 'delta' },
        { jiraProject: 'GHI', project: 'gone' },
      ],
    log: (line: string) => logs.push(line),
  };
  return { deps, launches, logs };
}

const board: WorkCard[] = [
  jiraCard('ABC-12', 'To Do', { title: 'Fix login' }),
  jiraCard('XYZ-3', 'To Do'),
  jiraCard('GHI-4', 'To Do'),
  jiraCard('DEF-5', 'To Do'),
  localCard('local-1', 'Todo', { sourceItemId: 'p2' }),
];
const withTicket = workItem('p1', { ticketKeys: ['ABC-7', 'XYZ-3'] });
const withNone = workItem('p2');
const file = fileWith({ items: [withTicket, withNone], cards: board });

const card = (id: string): WorkStartArg => ({ source: 'card', id });
const item = (id: string): WorkStartArg => ({ source: 'item', id });

describe('startFromWork', () => {
  it('launches a mapped Jira card visibly in its project', async () => {
    const { deps, launches } = depsOver();

    const result = await startFromWork(deps, file, card('ABC-12'));

    expect(result).toEqual({
      kind: 'launched',
      rowId: 'row-7',
      toast: 'Session started in gamma',
      cardIds: ['ABC-12'],
    });
    expect(launches).toStrictEqual([
      {
        project: 'gamma',
        profile: 'work',
        message: {
          text: 'Work on ABC-12: Fix login\nhttps://jira.example/browse/ABC-12',
          images: [],
        },
      },
    ]);
  });

  it.each<{
    name: string;
    arg: WorkStartArg;
    options?: Parameters<typeof depsOver>[0];
    expected:
      | { kind: 'launched'; project: string; profile: string }
      | { kind: 'prompt'; cardIds: string[] }
      | { refused: string };
  }>([
    {
      name: 'mapping matched with jiraProject " abc "',
      arg: card('ABC-12'),
      options: { projects: [{ jiraProject: ' abc ', project: 'gamma' }] },
      expected: { kind: 'launched', project: 'gamma', profile: 'work' },
    },
    {
      name: "the project's own profile",
      arg: card('DEF-5'),
      expected: { kind: 'launched', project: 'delta', profile: 'personal' },
    },
    {
      name: 'unmapped key',
      arg: card('XYZ-3'),
      expected: { kind: 'prompt', cardIds: ['XYZ-3'] },
    },
    {
      name: 'mapped name chat does not list',
      arg: card('GHI-4'),
      expected: { kind: 'prompt', cardIds: ['GHI-4'] },
    },
    {
      name: 'local task',
      arg: card('local-1'),
      expected: { kind: 'prompt', cardIds: ['local-1'] },
    },
    {
      name: 'item with a ticket',
      arg: item('p1'),
      expected: { kind: 'launched', project: 'gamma', profile: 'work' },
    },
    {
      name: 'item with none',
      arg: item('p2'),
      expected: { kind: 'prompt', cardIds: ['local-1'] },
    },
    {
      name: 'source wave',
      arg: { source: 'wave', id: 'ABC-12' },
      expected: { refused: 'No source wave' },
    },
    {
      name: 'unknown card',
      arg: card('ABC-99'),
      expected: { refused: 'No card ABC-99' },
    },
    {
      name: 'unknown item',
      arg: item('p9'),
      expected: { refused: 'No item p9' },
    },
    {
      name: 'no profile',
      arg: card('ABC-12'),
      options: { defaultProfile: null },
      expected: { refused: 'Chat has no profiles' },
    },
    {
      name: 'launch rejects',
      arg: card('ABC-12'),
      options: { launch: () => Promise.reject(new Error('no project gamma')) },
      expected: { refused: 'no project gamma' },
    },
  ])('target table ($name)', async ({ arg, options, expected }) => {
    const { deps, launches } = depsOver(options);

    const result = await startFromWork(deps, file, arg);

    if ('refused' in expected) {
      expect(result).toEqual(expected);
      return;
    }
    if (expected.kind === 'prompt') {
      expect(result).toEqual({
        kind: 'prompt',
        message: expect.any(String),
        cardIds: expected.cardIds,
      });
      expect(launches).toEqual([]);
      return;
    }
    expect(result).toMatchObject({ kind: 'launched', rowId: 'row-7' });
    expect(launches).toEqual([
      expect.objectContaining({
        project: expected.project,
        profile: expected.profile,
      }),
    ]);
  });

  it('logs a launch that rejects', async () => {
    const { deps, logs } = depsOver({
      launch: () => Promise.reject(new Error('no project gamma')),
    });

    await startFromWork(deps, file, card('ABC-12'));

    expect(logs).toEqual(['session not started: no project gamma']);
  });
});

describe('spinUpMessage', () => {
  const thread = (id: string, at: string, keys: string[]) =>
    workItem(id, { at, ticketKeys: keys });
  const line = (item: WorkItem) =>
    `- ${item.title}: ${item.summary} (${item.url})`;

  it.each<{
    name: string;
    target: WorkCard | WorkItem;
    items: WorkItem[];
    cards?: WorkCard[];
    text: string;
  }>([
    {
      name: 'a Jira card with threads, newest first',
      target: jiraCard('ABC-12', 'To Do', { title: 'Fix login' }),
      items: [
        thread('a', '2026-11-23T10:00:00.000Z', ['ABC-12']),
        thread('b', '2026-11-23T11:00:00.000Z', ['abc-12', 'XYZ-1']),
        thread('c', '2026-11-23T12:00:00.000Z', ['XYZ-1']),
      ],
      text: [
        'Work on ABC-12: Fix login',
        'https://jira.example/browse/ABC-12',
        '',
        'Slack threads about it:',
        '- Thread b: Ann asks for a review. (https://slack.example/b)',
        '- Thread a: Ann asks for a review. (https://slack.example/a)',
      ].join('\n'),
    },
    {
      name: 'a Jira card with no threads and no url',
      target: jiraCard('ABC-12', 'To Do', { title: 'Fix login', url: null }),
      items: [thread('c', '2026-11-23T12:00:00.000Z', ['XYZ-1'])],
      text: 'Work on ABC-12: Fix login',
    },
    {
      name: 'a local task with its source thread',
      target: localCard('local-1', 'Todo', {
        title: 'Write docs',
        url: 'https://slack.example/p1',
        sourceItemId: 'p1',
      }),
      items: [workItem('p1'), workItem('p2')],
      text: [
        'Work on: Write docs',
        'https://slack.example/p1',
        '',
        'Follow up on this Slack thread: Thread p1',
        'https://slack.example/p1',
        '',
        'Ann asks for a review.',
        'Latest: Ann: any news?',
      ].join('\n'),
    },
    {
      name: 'a local task whose source is gone',
      target: localCard('local-1', 'Todo', {
        title: 'Write docs',
        sourceItemId: 'p9',
      }),
      items: [workItem('p1')],
      text: 'Work on: Write docs',
    },
    {
      name: 'an item with no ticket',
      target: workItem('p1'),
      items: [workItem('p1')],
      text: [
        'Follow up on this Slack thread: Thread p1',
        'https://slack.example/p1',
        '',
        'Ann asks for a review.',
        'Latest: Ann: any news?',
      ].join('\n'),
    },
    {
      name: 'an item whose key names a board card takes its title and url',
      target: thread('p1', '2026-11-23T08:00:00.000Z', ['ABC-12', 'XYZ-1']),
      items: [
        thread('a', '2026-11-23T10:00:00.000Z', ['ABC-12']),
        thread('p1', '2026-11-23T08:00:00.000Z', ['ABC-12', 'XYZ-1']),
      ],
      cards: [jiraCard('ABC-12', 'To Do', { title: 'Fix login' })],
      text: [
        'Work on ABC-12: Fix login',
        'https://jira.example/browse/ABC-12',
        '',
        'Slack threads about it:',
        '- Thread p1: Ann asks for a review. (https://slack.example/p1)',
        '- Thread a: Ann asks for a review. (https://slack.example/a)',
      ].join('\n'),
    },
    {
      name: 'an item whose key names no card takes its own title and url',
      target: thread('p1', '2026-11-23T08:00:00.000Z', ['ABC-12']),
      items: [thread('p1', '2026-11-23T08:00:00.000Z', ['ABC-12'])],
      cards: [jiraCard('XYZ-1', 'To Do')],
      text: [
        'Work on ABC-12: Thread p1',
        'https://slack.example/p1',
        '',
        'Slack threads about it:',
        '- Thread p1: Ann asks for a review. (https://slack.example/p1)',
      ].join('\n'),
    },
  ])('$name', ({ target, items, cards, text }) => {
    expect(spinUpMessage(target, items, cards ?? [])).toBe(text);
  });

  // `count` threads t0 (oldest) onwards, one hour apart, each naming ABC-12.
  const threads = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      thread(
        `t${index}`,
        new Date(Date.UTC(2026, 10, 23, index)).toISOString(),
        ['ABC-12'],
      ),
    );
  const threadLines = (text: string) =>
    text.split('\n').filter((entry) => entry.startsWith('- '));

  it('lists at most SPIN_UP_THREADS threads, newest first', () => {
    const items = threads(SPIN_UP_THREADS + 2);
    const newest = [...items].reverse().slice(0, SPIN_UP_THREADS);

    const text = spinUpMessage(jiraCard('ABC-12', 'To Do'), items, []);

    expect(threadLines(text)).toEqual(newest.map(line));
  });

  it('lists the item first, not repeated, counting toward the cap', () => {
    const others = threads(SPIN_UP_THREADS + 1);
    const target = thread('p1', '2026-11-22T00:00:00.000Z', ['ABC-12']);
    const items = [...others, target];
    const newest = [...others].reverse().slice(0, SPIN_UP_THREADS - 1);

    const text = spinUpMessage(target, items, [jiraCard('ABC-12', 'To Do')]);

    expect(threadLines(text)).toEqual([target, ...newest].map(line));
  });
});

describe('spinUpCardIds', () => {
  const cards: WorkCard[] = [
    jiraCard('ABC-12', 'To Do'),
    jiraCard('XYZ-1', 'To Do'),
    localCard('local-1', 'Todo', { sourceItemId: 'p1' }),
    localCard('local-2', 'Todo', { sourceItemId: 'p2' }),
  ];

  it.each<{ name: string; target: WorkCard | WorkItem; ids: string[] }>([
    {
      name: 'a card itself',
      target: localCard('local-2', 'Todo'),
      ids: ['local-2'],
    },
    {
      name: "an item's Jira cards and local task",
      target: workItem('p1', { ticketKeys: ['abc-12', 'QRS-9'] }),
      ids: ['ABC-12', 'local-1'],
    },
  ])('$name', ({ target, ids }) => {
    expect(spinUpCardIds(target, cards)).toEqual(ids);
  });
});

describe('linkSession', () => {
  it('appends the session to each listed card once, skipping unknown ids', () => {
    const before = fileWith({
      cards: [
        jiraCard('ABC-12', 'To Do', { linkedSessionIds: ['row-1'] }),
        localCard('local-1', 'Todo'),
        jiraCard('XYZ-1', 'To Do'),
      ],
    });

    const linked = linkSession(before, {
      cardIds: ['ABC-12', 'local-1', 'gone'],
      sessionId: 'row-2',
    });

    expect(linked).toEqual(
      fileWith({
        cards: [
          jiraCard('ABC-12', 'To Do', { linkedSessionIds: ['row-1', 'row-2'] }),
          localCard('local-1', 'Todo', { linkedSessionIds: ['row-2'] }),
          jiraCard('XYZ-1', 'To Do'),
        ],
      }),
    );
    expect(
      linkSession(linked, {
        cardIds: ['ABC-12', 'local-1'],
        sessionId: 'row-2',
      }),
    ).toBe(linked);
  });
});
