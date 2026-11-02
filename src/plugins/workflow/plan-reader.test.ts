import { describe, expect, it } from 'vitest';
import { type PlanProgress, readPlanProgress } from './plan-reader';

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
    { wave: null, text: '00 — Spike', done: false },
    { wave: 1, text: '01 — Reward grant seam', done: true },
    { wave: 1, text: 'Expiry clock — dropped: folded into 01', done: true },
    { wave: 2, text: '03 — Claim grants — after 01', done: false },
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

const rows: { name: string; text: string; expected: PlanProgress }[] = [
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
        { wave: 1, text: 'a', done: false },
        { wave: 1, text: 'b', done: false },
        { wave: 2, text: 'c', done: false },
        { wave: 3, text: 'd', done: false },
        { wave: 3, text: 'e', done: false },
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
        { wave: 1, text: 'a', done: true },
        { wave: 1, text: 'b', done: true },
        { wave: 2, text: 'c', done: true },
        { wave: 2, text: 'd', done: false },
        { wave: 3, text: 'e', done: false },
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
        { wave: 1, text: 'a', done: true },
        { wave: 1, text: 'b', done: true },
        { wave: 2, text: 'c', done: true },
        { wave: 3, text: 'd', done: true },
        { wave: 3, text: 'e', done: true },
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
        { wave: 1, text: 'Expiry clock — dropped: not needed', done: true },
        { wave: 1, text: 'a', done: true },
        { wave: 2, text: 'b', done: false },
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
      tasks: [{ wave: 1, text: 'a', done: true }],
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
        { wave: 1, text: 'a', done: true },
        { wave: 1, text: 'b', done: false },
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
        { wave: 1, text: 'a', done: true },
        { wave: 1, text: 'b', done: false },
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
      tasks: [{ wave: 1, text: 'a', done: true }],
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
        { wave: null, text: 'a', done: false },
        { wave: 1, text: 'b', done: true },
        { wave: 1, text: 'c', done: true },
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
        { wave: 1, text: 'a', done: false },
        { wave: 1, text: 'b', done: true },
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
      tasks: [{ wave: 1, text: 'a', done: true }],
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
      tasks: [{ wave: 1, text: 'a', done: true }],
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
      tasks: [{ wave: 1, text: 'a', done: true }],
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
      tasks: [{ wave: 1, text: 'a', done: true }],
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
  it.each(rows)('$name', ({ text, expected }) => {
    expect(readPlanProgress(text)).toEqual(expected);
  });
});
