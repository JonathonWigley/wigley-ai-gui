import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type {
  Roster,
  RosterAgent,
  RosterOutcome,
  RosterTask,
} from '../../agents/contract';
import {
  agentMeta,
  boxLook,
  entryIndex,
  orderStripBoxes,
  reselect,
  type StripBox,
  stepIndex,
  taskOwner,
} from './strip-boxes';

function agent(
  agentId: string,
  startedAt: number,
  outcome: RosterOutcome = 'running',
  fields: Partial<RosterAgent> = {},
): RosterAgent {
  return {
    agentId,
    agentType: 'Explore',
    name: `name-${agentId}`,
    description: 'Map the callers',
    startedAt,
    model: null,
    effort: null,
    spendUsd: null,
    tools: [],
    outcome,
    ...fields,
  };
}

function task(
  taskId: string,
  startedAt: number,
  outcome: RosterOutcome = 'running',
  agentId: string = MAIN_AGENT_ID,
): RosterTask {
  return {
    taskId,
    agentId,
    description: 'npm test',
    command: null,
    startedAt,
    outcome,
  };
}

const boxesOf = (roster: Roster): StripBox[] => orderStripBoxes(roster);
const keysOf = (boxes: readonly StripBox[]) => boxes.map((box) => box.key);

describe('orderStripBoxes', () => {
  it.each<{ name: string; roster: Roster; keys: string[] }>([
    {
      name: 'start order across kinds',
      roster: {
        agents: [agent('a1', 300), agent('a2', 100)],
        tasks: [task('t1', 200), task('t2', 50)],
      },
      keys: ['t2', 'a2', 't1', 'a1'],
    },
    {
      name: 'equal start keeps the agent first',
      roster: { agents: [agent('a1', 100)], tasks: [task('t1', 100)] },
      keys: ['a1', 't1'],
    },
    { name: 'empty roster', roster: { agents: [], tasks: [] }, keys: [] },
  ])('$name', ({ roster, keys }) => {
    expect(keysOf(orderStripBoxes(roster))).toEqual(keys);
  });
});

describe('entryIndex', () => {
  it.each<{ name: string; roster: Roster; index: number | null }>([
    {
      name: 'first running in the middle',
      roster: {
        agents: [agent('a1', 100, 'done'), agent('a2', 200)],
        tasks: [task('t1', 300)],
      },
      index: 1,
    },
    {
      name: 'none running',
      roster: {
        agents: [agent('a1', 100, 'failed')],
        tasks: [task('t1', 200, 'done')],
      },
      index: 0,
    },
    { name: 'no boxes', roster: { agents: [], tasks: [] }, index: null },
  ])('$name', ({ roster, index }) => {
    expect(entryIndex(boxesOf(roster))).toBe(index);
  });
});

describe('stepIndex', () => {
  it.each<{ index: number; delta: -1 | 1; count: number; next: number }>([
    { index: 0, delta: -1, count: 4, next: 0 },
    { index: 3, delta: 1, count: 4, next: 3 },
    { index: 1, delta: 1, count: 4, next: 2 },
    { index: 2, delta: -1, count: 4, next: 1 },
  ])('$index by $delta of $count -> $next', ({ index, delta, count, next }) => {
    expect(stepIndex(index, delta, count)).toBe(next);
  });
});

describe('reselect', () => {
  const three = boxesOf({
    agents: [agent('a1', 100), agent('a2', 200)],
    tasks: [task('t1', 300)],
  });
  it.each<{
    name: string;
    key: string;
    lastIndex: number;
    boxes: StripBox[];
    index: number | null;
  }>([
    {
      name: 'key kept at a new index',
      key: 'a2',
      lastIndex: 0,
      boxes: three,
      index: 1,
    },
    {
      name: 'key gone, last index past the end',
      key: 'gone',
      lastIndex: 5,
      boxes: three,
      index: 2,
    },
    {
      name: 'key gone, last index inside',
      key: 'gone',
      lastIndex: 1,
      boxes: three,
      index: 1,
    },
    { name: 'empty', key: 'a1', lastIndex: 0, boxes: [], index: null },
  ])('$name', ({ key, lastIndex, boxes, index }) => {
    expect(reselect(key, lastIndex, boxes)).toBe(index);
  });
});

describe('boxLook', () => {
  it.each<{ outcome: RosterOutcome; dot: string; isDimmed: boolean }>([
    { outcome: 'running', dot: 'running', isDimmed: false },
    { outcome: 'done', dot: 'success', isDimmed: true },
    { outcome: 'failed', dot: 'error', isDimmed: true },
  ])('$outcome', ({ outcome, dot, isDimmed }) => {
    expect(boxLook(outcome)).toEqual({ dot, isDimmed });
  });
});

describe('agentMeta', () => {
  it.each<{ name: string; fields: Partial<RosterAgent>; meta: string }>([
    {
      name: 'all three',
      fields: { model: 'claude-sonnet-4-5', effort: 'high', spendUsd: 0.4213 },
      meta: 'claude-sonnet-4-5 · high · $0.42',
    },
    {
      name: 'no effort',
      fields: { model: 'claude-sonnet-4-5', spendUsd: 0.4213 },
      meta: 'claude-sonnet-4-5 · $0.42',
    },
    { name: 'all null', fields: {}, meta: '' },
  ])('$name', ({ fields, meta }) => {
    expect(agentMeta(agent('a1', 100, 'running', fields))).toBe(meta);
  });
});

describe('taskOwner', () => {
  const agents = [agent('a1', 100), agent('a2', 200)];
  it.each<{ name: string; agentId: string; owner: string }>([
    { name: 'main', agentId: MAIN_AGENT_ID, owner: 'main' },
    { name: 'a listed subagent', agentId: 'a2', owner: 'name-a2' },
    { name: 'an unlisted id', agentId: 'gone', owner: 'subagent' },
  ])('$name', ({ agentId, owner }) => {
    expect(taskOwner(task('t1', 300, 'running', agentId), agents)).toBe(owner);
  });
});
