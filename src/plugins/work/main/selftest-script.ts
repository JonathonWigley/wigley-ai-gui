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
];

// Drives work's commands through its own binds under `<Leader>zw` and checks main's `[work]` lines. `open` seeds the
// fixture on every run, so a second page load's run starts from the same data, and each group seeds it again first.
export function workSelfTestScript(deps: WorkSelfTestDeps): SelfTestScript {
  return {
    pageBinds: PAGE_BINDS,
    settings: {},
    scrollsItself: [],
    open() {
      return { shownLine: SEEDED_LINE, result: deps.seed() };
    },
    groups: GROUPS,
    problems: (result) => result as string[],
  };
}
