import { describe, expect, it } from 'vitest';
import {
  buildProgress,
  type PlanProgress,
  readPlanProgress,
  readTaskStatus,
} from './plan-progress';

// A plan.md in the plan-folder.md skeleton, with `tasks` as the `## Tasks`
// body and `runLog` after the Run log's Review base line.
function plan(tasks: string, runLog = ''): string {
  return `# Claim grants — plan

Feature: claim-grants · Implements: none · Ticket: none
Target: main · Written: 2026-10-31

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal
## Architecture
## Preconditions
## Docs written ahead
## Mandatory Reads
## Design Overview
## File Structure

## Tasks

> \`wigley:make\` ticks a box once its group is committed and proved.

${tasks}
## Run log

Review base: c95c7eb

${runLog}`;
}

// The `file`, `status` and `verification` of a task line with no link.
const UNLINKED = { file: null, status: null, verification: false } as const;

// The `file`, `status` and `verification` of a task line linking `file`, no
// text read for it.
function linked(file: string) {
  return { file, status: null, verification: false };
}

// Progress of one wave-1 plan whose task lines are `tasks`, all open.
function openWaveOne(tasks: PlanProgress['tasks']): PlanProgress {
  return {
    checked: 0,
    total: tasks.length,
    wave: 1,
    reviewRounds: 0,
    title: 'Claim grants',
    tasks,
  };
}

const TWO_WAVE_TASKS = `- [ ] [00 — Spike](00-spike.md)

### Wave 1
- [x] [01 — Reward grant seam](01-reward-grant-seam.md)
- [x] ~~[Expiry clock](02-expiry-clock.md)~~ — dropped: folded into 01

### Wave 2
- [ ] [03 — Claim grants](03-claim-grants.md) — after 01
`;

const TWO_WAVE_PLAN = plan(TWO_WAVE_TASKS);

const TWO_WAVE_PROGRESS: PlanProgress = {
  checked: 2,
  total: 4,
  wave: 2,
  reviewRounds: 0,
  title: 'Claim grants',
  tasks: [
    { wave: null, text: '00 — Spike', done: false, ...linked('00-spike.md') },
    {
      wave: 1,
      text: '01 — Reward grant seam',
      done: true,
      ...linked('01-reward-grant-seam.md'),
    },
    {
      wave: 1,
      text: 'Expiry clock — dropped: folded into 01',
      done: true,
      ...linked('02-expiry-clock.md'),
    },
    {
      wave: 2,
      text: '03 — Claim grants — after 01',
      done: false,
      ...linked('03-claim-grants.md'),
    },
  ],
};

const REVIEW_ROUNDS_LOG = `### Groups
- 01 · 1a2b3c4 · done
### Review rounds
- 1 · 5d6e7f8 · findings
- 2 · 9a0b1c2 · clean
### Test gate
- x
`;

const rows: {
  name: string;
  text: string;
  taskTexts?: ReadonlyMap<string, string>;
  expected: PlanProgress;
}[] = [
  {
    name: 'every box open in three waves',
    text: plan(`### Wave 1
- [ ] a
- [ ] b
### Wave 2
- [ ] c
### Wave 3
- [ ] d
- [ ] e
`),
    expected: {
      checked: 0,
      total: 5,
      wave: 1,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [
        { wave: 1, text: 'a', done: false, ...UNLINKED },
        { wave: 1, text: 'b', done: false, ...UNLINKED },
        { wave: 2, text: 'c', done: false, ...UNLINKED },
        { wave: 3, text: 'd', done: false, ...UNLINKED },
        { wave: 3, text: 'e', done: false, ...UNLINKED },
      ],
    },
  },
  {
    name: 'Wave 1 ticked and Wave 2 half ticked puts the plan on wave 2',
    text: plan(`### Wave 1
- [x] a
- [x] b
### Wave 2
- [x] c
- [ ] d
### Wave 3
- [ ] e
`),
    expected: {
      checked: 3,
      total: 5,
      wave: 2,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [
        { wave: 1, text: 'a', done: true, ...UNLINKED },
        { wave: 1, text: 'b', done: true, ...UNLINKED },
        { wave: 2, text: 'c', done: true, ...UNLINKED },
        { wave: 2, text: 'd', done: false, ...UNLINKED },
        { wave: 3, text: 'e', done: false, ...UNLINKED },
      ],
    },
  },
  {
    name: 'every box ticked, one with [X], leaves no wave',
    text: plan(`### Wave 1
- [x] a
- [X] b
### Wave 2
- [x] c
### Wave 3
- [x] d
- [x] e
`),
    expected: {
      checked: 5,
      total: 5,
      wave: null,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [
        { wave: 1, text: 'a', done: true, ...UNLINKED },
        { wave: 1, text: 'b', done: true, ...UNLINKED },
        { wave: 2, text: 'c', done: true, ...UNLINKED },
        { wave: 3, text: 'd', done: true, ...UNLINKED },
        { wave: 3, text: 'e', done: true, ...UNLINKED },
      ],
    },
  },
  {
    name: 'a struck dropped box counts as checked',
    text: plan(`### Wave 1
- [x] ~~[Expiry clock](02-expiry-clock.md)~~ — dropped: not needed
- [x] a
### Wave 2
- [ ] b
`),
    expected: {
      checked: 2,
      total: 3,
      wave: 2,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [
        {
          wave: 1,
          text: 'Expiry clock — dropped: not needed',
          done: true,
          ...linked('02-expiry-clock.md'),
        },
        { wave: 1, text: 'a', done: true, ...UNLINKED },
        { wave: 2, text: 'b', done: false, ...UNLINKED },
      ],
    },
  },
  {
    name: 'a box in a backtick fence under Tasks does not count',
    text: plan(`### Wave 1
- [x] a
\`\`\`markdown
- [ ] fake
\`\`\`
`),
    expected: {
      checked: 1,
      total: 1,
      wave: null,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [{ wave: 1, text: 'a', done: true, ...UNLINKED }],
    },
  },
  {
    name: 'a backtick line inside a tilde fence does not close it',
    text: plan(`### Wave 1
- [x] a
~~~
\`\`\`
- [ ] fake
~~~
- [ ] b
`),
    expected: {
      checked: 1,
      total: 2,
      wave: 1,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [
        { wave: 1, text: 'a', done: true, ...UNLINKED },
        { wave: 1, text: 'b', done: false, ...UNLINKED },
      ],
    },
  },
  {
    name: 'a backtick run with a backtick after it is inline code, not a fence',
    text: plan(`### Wave 1
- [x] a
\`\`\`code\` span
- [ ] b
`),
    expected: {
      checked: 1,
      total: 2,
      wave: 1,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [
        { wave: 1, text: 'a', done: true, ...UNLINKED },
        { wave: 1, text: 'b', done: false, ...UNLINKED },
      ],
    },
  },
  {
    name: 'a box under Preconditions does not count',
    text: plan(`### Wave 1
- [x] a
`).replace('## Preconditions', '## Preconditions\n\n- [ ] the base is clean'),
    expected: {
      checked: 1,
      total: 1,
      wave: null,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [{ wave: 1, text: 'a', done: true, ...UNLINKED }],
    },
  },
  {
    name: 'an open box before any wave counts and belongs to no wave',
    text: plan(`- [ ] a
### Wave 1
- [x] b
- [x] c
`),
    expected: {
      checked: 2,
      total: 3,
      wave: null,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [
        { wave: null, text: 'a', done: false, ...UNLINKED },
        { wave: 1, text: 'b', done: true, ...UNLINKED },
        { wave: 1, text: 'c', done: true, ...UNLINKED },
      ],
    },
  },
  {
    name: 'a star box and an indented box both count',
    text: plan(`### Wave 1
* [ ] a
  - [x] b
`),
    expected: {
      checked: 1,
      total: 2,
      wave: 1,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [
        { wave: 1, text: 'a', done: false, ...UNLINKED },
        { wave: 1, text: 'b', done: true, ...UNLINKED },
      ],
    },
  },
  {
    name: 'only the Review rounds lines count as rounds',
    text: plan(
      `### Wave 1
- [x] a
`,
      REVIEW_ROUNDS_LOG,
    ),
    expected: {
      checked: 1,
      total: 1,
      wave: null,
      reviewRounds: 2,
      title: 'Claim grants',
      tasks: [{ wave: 1, text: 'a', done: true, ...UNLINKED }],
    },
  },
  {
    name: 'Review rounds outside a Run log count no rounds',
    text: plan(
      `### Wave 1
- [x] a
`,
      REVIEW_ROUNDS_LOG,
    ).replace('## Run log\n', ''),
    expected: {
      checked: 1,
      total: 1,
      wave: null,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [{ wave: 1, text: 'a', done: true, ...UNLINKED }],
    },
  },
  {
    name: 'a title with no plan suffix reads whole',
    text: plan(`### Wave 1
- [x] a
`).replace('# Claim grants — plan', '# Claim grants'),
    expected: {
      checked: 1,
      total: 1,
      wave: null,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [{ wave: 1, text: 'a', done: true, ...UNLINKED }],
    },
  },
  {
    name: 'a heading in a fence before the title is not the title',
    text: `\`\`\`\n# Not the title\n\`\`\`\n${plan(`### Wave 1
- [x] a
`)}`,
    expected: {
      checked: 1,
      total: 1,
      wave: null,
      reviewRounds: 0,
      title: 'Claim grants',
      tasks: [{ wave: 1, text: 'a', done: true, ...UNLINKED }],
    },
  },
  {
    name: 'task lines drop their links and strikes',
    text: TWO_WAVE_PLAN,
    expected: TWO_WAVE_PROGRESS,
  },
  {
    name: 'CRLF line ends read as LF',
    text: TWO_WAVE_PLAN.replaceAll('\n', '\r\n'),
    expected: TWO_WAVE_PROGRESS,
  },
  {
    name: "a linked task document's Status line is the line's status",
    text: plan(`### Wave 1
- [ ] [01 — A](01-a.md)
- [ ] [02 — B](02-b.md) — after 01
`),
    taskTexts: new Map([
      ['01-a.md', '# 01 — A\n\nStatus: done\n'],
      ['02-b.md', '# 02 — B\n\n**Status:** in progress\n'],
    ]),
    expected: openWaveOne([
      {
        wave: 1,
        text: '01 — A',
        done: false,
        file: '01-a.md',
        status: 'done',
        verification: false,
      },
      {
        wave: 1,
        text: '02 — B — after 01',
        done: false,
        file: '02-b.md',
        status: 'in progress',
        verification: true,
      },
    ]),
  },
  {
    name: 'a linked file the texts lack has a null status',
    text: plan(`### Wave 1
- [ ] [01 — A](01-a.md)
`),
    taskTexts: new Map([['02-b.md', 'Status: done\n']]),
    expected: openWaveOne([
      { wave: 1, text: '01 — A', done: false, ...linked('01-a.md') },
    ]),
  },
  {
    name: 'a task line with no link has a null file',
    text: plan(`### Wave 1
- [ ] 01-a.md
`),
    taskTexts: new Map([['01-a.md', 'Status: done\n']]),
    expected: openWaveOne([
      { wave: 1, text: '01-a.md', done: false, ...UNLINKED },
    ]),
  },
  {
    name: 'a link target with a folder, a colon or a fragment has a null file',
    text: plan(`### Wave 1
- [ ] [A](../a.md)
- [ ] [B](https://x.md)
- [ ] [C](03-c.md#proof)
`),
    expected: openWaveOne([
      { wave: 1, text: 'A', done: false, ...UNLINKED },
      { wave: 1, text: 'B', done: false, ...UNLINKED },
      { wave: 1, text: 'C', done: false, ...UNLINKED },
    ]),
  },
  {
    name: 'a link target that is not a .md file name has a null file',
    text: plan(`### Wave 1
- [ ] [D](03-d.txt)
- [ ] [E](03-e)
- [ ] [F](a\\b.md)
`),
    expected: openWaveOne([
      { wave: 1, text: 'D', done: false, ...UNLINKED },
      { wave: 1, text: 'E', done: false, ...UNLINKED },
      { wave: 1, text: 'F', done: false, ...UNLINKED },
    ]),
  },
  {
    name: 'only the first link of a line is its file',
    text: plan(`### Wave 1
- [ ] [A](01-a.md) see [B](02-b.md)
`),
    expected: openWaveOne([
      { wave: 1, text: 'A see B', done: false, ...linked('01-a.md') },
    ]),
  },
  {
    name: 'the last read task document with no Rung field is the verification task',
    text: plan(`### Wave 1
- [x] [01 — A](01-a.md)
- [ ] [02 — B](02-b.md)
- [ ] [03 — Final verification](03-final.md)
- [ ] [04 — C](04-c.md)
`),
    taskTexts: new Map([
      ['01-a.md', 'Rung: standard\n'],
      ['02-b.md', 'Rung (unity): hard\n'],
      ['03-final.md', '```\nRung: standard\n```\n'],
      ['04-c.md', 'Rung: rote\n'],
    ]),
    expected: {
      ...openWaveOne([
        { wave: 1, text: '01 — A', done: true, ...linked('01-a.md') },
        { wave: 1, text: '02 — B', done: false, ...linked('02-b.md') },
        {
          wave: 1,
          text: '03 — Final verification',
          done: false,
          ...linked('03-final.md'),
          verification: true,
        },
        { wave: 1, text: '04 — C', done: false, ...linked('04-c.md') },
      ]),
      checked: 1,
    },
  },
  {
    name: 'a plan whose task documents all hold a Rung has no verification task',
    text: plan(`### Wave 1
- [ ] [01 — A](01-a.md)
`),
    taskTexts: new Map([['01-a.md', 'Rung: standard\n']]),
    expected: openWaveOne([
      { wave: 1, text: '01 — A', done: false, ...linked('01-a.md') },
    ]),
  },
  {
    name: 'empty text',
    text: '',
    expected: {
      checked: 0,
      total: 0,
      wave: null,
      reviewRounds: 0,
      title: '',
      tasks: [],
    },
  },
];

describe('readPlanProgress', () => {
  it.each(rows)('$name', ({ text, taskTexts = new Map(), expected }) => {
    expect(readPlanProgress(text, taskTexts)).toEqual(expected);
  });
});

describe('buildProgress', () => {
  it.each([
    {
      name: 'the verification task is left out of both counts',
      verification: [false, false, true],
      done: [true, false, false],
      expected: { checked: 1, total: 2 },
    },
    {
      name: 'every box counts when no task is the verification task',
      verification: [false, false, false],
      done: [true, false, true],
      expected: { checked: 2, total: 3 },
    },
  ])('$name', ({ verification, done, expected }) => {
    const tasks = verification.map((isVerification, index) => ({
      wave: 1,
      text: `task ${index}`,
      done: done[index],
      ...UNLINKED,
      verification: isVerification,
    }));
    expect(buildProgress(openWaveOne(tasks))).toEqual(expected);
  });
});

// `count` filler lines, then `rest`.
function after(count: number, rest: string): string {
  return `${'x\n'.repeat(count)}${rest}`;
}

describe('readTaskStatus', () => {
  it.each<{ name: string; text: string; expected: string | null }>([
    {
      name: 'Status on line 3',
      text: '# 03 — A\n\nStatus: in progress\n',
      expected: 'in progress',
    },
    { name: 'bold Status', text: '**Status:** done', expected: 'done' },
    { name: 'no space', text: 'Status:not started', expected: 'not started' },
    { name: 'trailing spaces', text: 'Status: done   ', expected: 'done' },
    { name: 'CRLF', text: 'Status: done\r\nx', expected: 'done' },
    { name: 'case-sensitive', text: 'Status: Done', expected: null },
    { name: 'not a task status', text: 'Status: blocked', expected: null },
    {
      name: 'only the first match counts',
      text: 'Status: blocked\nStatus: done',
      expected: null,
    },
    { name: 'leading space', text: ' Status: done', expected: null },
    {
      name: 'inside a fence only',
      text: '```\nStatus: done\n```\n',
      expected: null,
    },
    {
      name: 'inside a fence, then after it',
      text: '```\nStatus: done\n```\nStatus: in progress\n',
      expected: 'in progress',
    },
    { name: 'on line 16', text: after(15, 'Status: done'), expected: null },
    { name: 'on line 15', text: after(14, 'Status: done'), expected: 'done' },
    {
      name: 'a closed fence on lines 1 to 3, then line 17',
      text: '```\na\n```\n' + after(13, 'Status: done'),
      expected: null,
    },
    { name: 'empty text', text: '', expected: null },
  ])(
    'readTaskStatus_FirstStatusLine_ReadsOneOfThreeValues ($name)',
    ({ text, expected }) => {
      expect(readTaskStatus(text)).toBe(expected);
    },
  );
});
