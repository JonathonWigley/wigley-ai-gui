import type { CommandArg } from '../../../contracts/commands';
import type { PageBind } from '../../../contracts/keymap';
import type {
  SelfTestGroup,
  SelfTestScript,
  SelfTestStep,
} from '../../../contracts/plugin';
import { FIXTURE_ITEM_IDS, FIXTURE_TASK_ID } from './selftest-fixture';

// `seed` replaces the work store with the fixture and seeds its signals, resolving to the problems found.
export interface WorkSelfTestDeps {
  seed(): Promise<string[]>;
}

// `<Leader>zw`: the debug group's `w` for work, the prefix of the self-test's own binds.
export const WORK_SELFTEST_KEYS: readonly string[] = [' ', 'z', 'w'];

// Written into work's plugin data to make main seed the fixture again.
export const RESEED_FILE = 'selftest-reseed.txt';

const line = (text: string) => `[work] ${text}`;

const SEEDED_LINE = line('fixture seeded: 7 items, 7 cards, 3 suggestions');

// A group's first step: it writes the reseed file, and main seeds the fixture again.
export function reseedStep(group: string): SelfTestStep {
  return {
    writeFile: { path: `plugin-data/work/${RESEED_FILE}`, text: group },
    keys: [],
    expect: SEEDED_LINE,
    why: 'Each group starts from the fixture.',
  };
}

const keysOf = (key: string) => [...WORK_SELFTEST_KEYS, key];

const bind = (key: string, command: string, arg?: CommandArg): PageBind => ({
  keys: keysOf(key),
  scope: 'any',
  command,
  ...(arg === undefined ? {} : { arg }),
});

const SEND_TEXT = "Yes, I'll take a look today.";

const PAGE_BINDS: PageBind[] = [
  bind('d', 'work.dismiss', FIXTURE_ITEM_IDS.needsYou),
  bind('r', 'work.restore', FIXTURE_ITEM_IDS.needsYou),
  bind('z', 'work.snooze', FIXTURE_ITEM_IDS.waiting),
  bind('s', 'work.send', {
    itemId: FIXTURE_ITEM_IDS.needsYou,
    text: SEND_TEXT,
  }),
  bind('a', 'work.addToBoard', FIXTURE_ITEM_IDS.myThread),
  bind('A', 'work.addToBoard', FIXTURE_ITEM_IDS.around),
  bind('m', 'work.moveCard', {
    cardId: FIXTURE_TASK_ID,
    column: 'In Progress',
  }),
  bind('n', 'work.notYet', 'WRK-2'),
  bind('y', 'work.acceptSuggestion', 'WRK-3'),
  bind('x', 'work.deleteTask', FIXTURE_TASK_ID),
  bind('X', 'work.deleteTask', 'WRK-1'),
  bind('w', 'work.sweep'),
];

const press = (
  key: string,
  expect: string,
  alsoExpect?: RegExp[],
): SelfTestStep => ({
  keys: keysOf(key),
  expect: line(expect),
  ...(alsoExpect === undefined ? {} : { alsoExpect }),
});

const needsYouLine = (count: number) =>
  new RegExp(`^\\[work\\] needs you: ${count}$`);

const inboxLine = (text: string) => `[work-inbox] ${text}`;
const boardLine = (text: string) => `[work-board] ${text}`;

// Titles from `selftest-fixture.ts`: the newest item, the second and the oldest.
const NEEDS_YOU_TITLE = 'Can you look at WRK-1?';
const SECOND_TITLE = 'Notes from the planning call';
const DISMISSED_TITLE = 'Lunch order';

// A key typed in a view once its mode shows: raw presses, the line they log, and optionally more lines and a why.
const viewStep = (
  keys: string[],
  expect: string,
  alsoExpect?: RegExp[],
  why?: string,
): SelfTestStep => ({
  keys,
  expect,
  ...(alsoExpect === undefined ? {} : { alsoExpect }),
  ...(why === undefined ? {} : { why }),
});

const GROUPS: SelfTestGroup[] = [
  {
    name: 'inbox',
    why: 'Each Inbox press changes the item in main and logs it, the badge follows Needs you, and a sending item stays open and takes no other press.',
    steps: [
      reseedStep('inbox'),
      press('d', `dismissed ${FIXTURE_ITEM_IDS.needsYou}`, [needsYouLine(0)]),
      press('r', `restored ${FIXTURE_ITEM_IDS.needsYou}`, [needsYouLine(1)]),
      press('z', `snoozed ${FIXTURE_ITEM_IDS.waiting} for 1 day`),
      press('s', `send queued ${FIXTURE_ITEM_IDS.needsYou}`),
      press('d', `refused dismiss: ${FIXTURE_ITEM_IDS.needsYou} is sending`),
    ],
  },
  {
    name: 'board',
    why: 'A local task moves at once, Not yet hides a suggestion, Accept queues a Jira move, and a Jira card refuses delete.',
    steps: [
      reseedStep('board'),
      press('a', `added ${FIXTURE_ITEM_IDS.myThread} to the board`),
      press('A', 'refused addToBoard: Already on the board as WRK-3'),
      press('m', `moved ${FIXTURE_TASK_ID} to In Progress`),
      press('n', 'not yet WRK-2'),
      press('y', 'moving WRK-3 to In QA'),
      press('x', `deleted ${FIXTURE_TASK_ID}`),
      press('X', 'refused deleteTask: Only a local task can be deleted'),
    ],
  },
  {
    name: 'sweep',
    why: 'In the self-test a sweep queues and no worker launches.',
    steps: [reseedStep('sweep'), press('w', 'sweep queued')],
  },
  {
    name: 'inbox keys',
    why: 'The Inbox opens on Needs you at its first card, its keys move the sections and the list, and each card key reaches main.',
    steps: [
      reseedStep('inbox keys'),
      {
        keys: [' ', 'k', 'i'],
        expect: inboxLine('shown'),
        checksFit: true,
        alsoExpect: [
          /^\[work-inbox\] section Needs you$/,
          /^\[work-inbox\] selected Can you look at WRK-1\?$/,
        ],
        why: 'The self-test home has no saved place, so the first show is Needs you at its one open card.',
      },
      viewStep(['i'], inboxLine('box focused')),
      viewStep(['Escape', 'Escape'], inboxLine('list focused')),
      viewStep(
        ['t'],
        boardLine('shown'),
        [/^\[work-board\] flash WRK-1$/],
        "The card's ticket key shows its ticket on the Board.",
      ),
      viewStep([' ', 'k', 'i'], inboxLine('shown')),
      viewStep(['d'], line(`dismissed ${FIXTURE_ITEM_IDS.needsYou}`)),
      viewStep(['<A-h>'], inboxLine('sections focused')),
      viewStep(
        ['G'],
        inboxLine('section cursor All'),
        undefined,
        'All is the last section row.',
      ),
      viewStep(['Enter'], inboxLine('section All'), [
        /^\[work-inbox\] list focused$/,
      ]),
      viewStep(
        ['G'],
        inboxLine(`selected ${DISMISSED_TITLE}`),
        undefined,
        'All lists newest first, so the dismissed item, the oldest, ends it.',
      ),
      viewStep(['g', 'g'], inboxLine(`selected ${NEEDS_YOU_TITLE}`)),
      viewStep(['j'], inboxLine(`selected ${SECOND_TITLE}`)),
      viewStep(['G'], inboxLine(`selected ${DISMISSED_TITLE}`)),
      viewStep(['u'], line(`restored ${FIXTURE_ITEM_IDS.dismissed}`)),
      viewStep(['<A-h>'], inboxLine('sections focused')),
      viewStep(['g', 'g'], inboxLine('section cursor Needs you')),
      viewStep(['j'], inboxLine('section cursor You promised')),
      viewStep(['Enter'], inboxLine('section You promised'), [
        /^\[work-inbox\] list focused$/,
      ]),
      viewStep(
        ['W'],
        line('sweep queued'),
        undefined,
        "The bind runs work-inbox.sweep, which reaches main through the view's reporting run.",
      ),
      viewStep(['<C-n>'], '[chat] picker shown: Folder'),
      viewStep(
        ['Escape'],
        '[chat] picker closed: Folder',
        undefined,
        "Closing the picker keeps the next group's keys out of it.",
      ),
    ],
  },
  {
    name: 'board keys',
    why: 'The Board opens on its first card, its keys move the cursor and the cards, and each card key reaches main.',
    steps: [
      reseedStep('board keys'),
      {
        keys: [' ', 'k', 'j'],
        expect: boardLine('shown'),
        checksFit: true,
        why: 'The first show leaves the cursor on the first card of the first column that has cards: the next step moves it to WRK-2 from there. The cursor line itself is not expected, since the inbox keys group already flashed WRK-1 and the Board logs a cursor only when it changes.',
      },
      viewStep(['l'], boardLine('selected WRK-2')),
      viewStep(['j'], boardLine(`selected ${FIXTURE_TASK_ID}`)),
      viewStep(
        ['L'],
        line(`moved ${FIXTURE_TASK_ID} to In Progress`),
        undefined,
        'A local task moves at once, so the cursor stays on it, now below WRK-3.',
      ),
      viewStep(['k'], boardLine('selected WRK-3')),
      viewStep(['t'], inboxLine('shown'), [/^\[work-inbox\] filter WRK-3$/]),
      viewStep(['Escape'], inboxLine('filter cleared')),
      viewStep(
        [' ', 'k', 'j'],
        boardLine('shown'),
        undefined,
        'The Board keeps its cursor on WRK-3.',
      ),
      viewStep(['y'], line('moving WRK-3 to In QA')),
      viewStep(['h'], boardLine('selected WRK-2')),
      viewStep(['n'], line('not yet WRK-2')),
    ],
  },
];

// Drives work's commands through its own binds under `<Leader>zw` and checks main's `[work]` lines. `open` seeds the
// fixture on every run, so a second page load's run starts from the same data, and each group seeds it again first.
export function workSelfTestScript(deps: WorkSelfTestDeps): SelfTestScript {
  return {
    pageBinds: PAGE_BINDS,
    settings: {},
    scrollsItself: ['.work-board-columns'],
    open() {
      return { shownLine: SEEDED_LINE, result: deps.seed() };
    },
    groups: GROUPS,
    problems: (result) => result as string[],
  };
}
