import { describe, expect, it } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type { Roster, RosterAgent, RosterTask } from '../../agents/contract';
import {
  entryIndex,
  orderStripBoxes,
  reselect,
  type StripBox,
  stepIndex,
} from './strip-boxes';

function agent(agentId: string, startedAt: number): RosterAgent {
  return {
    agentId,
    agentType: 'Explore',
    name: `name-${agentId}`,
    description: 'Map the callers',
    startedAt,
    model: null,
    effort: null,
    spendUsd: null,
    isBackground: false,
    contextTokens: null,
    contextWindow: null,
    tools: [],
  };
}

function task(taskId: string, startedAt: number): RosterTask {
  return {
    taskId,
    agentId: MAIN_AGENT_ID,
    ownerName: 'main',
    description: 'npm test',
    command: null,
    startedAt,
  };
}

const boxesOf = (roster: Roster): StripBox[] => orderStripBoxes(roster);
const keysOf = (boxes: readonly StripBox[]) => boxes.map((box) => box.key);

describe('orderStripBoxes', () => {
  it.each<{ name: string; roster: Roster; keys: string[] }>([
    {
      name: 'the agent, then the tasks in start order',
      roster: {
        agents: [agent('a1', 300)],
        tasks: [task('t200', 200), task('t100', 100)],
        skills: [],
      },
      keys: ['a1', 't100', 't200'],
    },
    {
      name: 'equal starts keep roster order',
      roster: {
        agents: [],
        tasks: [task('t1', 100), task('t2', 100)],
        skills: [],
      },
      keys: ['t1', 't2'],
    },
    {
      name: 'an agent that started after a task sorts first',
      roster: {
        agents: [agent('a1', 300), agent('a2', 50)],
        tasks: [task('t1', 100)],
        skills: [],
      },
      keys: ['a2', 'a1', 't1'],
    },
    {
      name: 'empty roster',
      roster: { agents: [], tasks: [], skills: [] },
      keys: [],
    },
  ])('$name', ({ roster, keys }) => {
    expect(keysOf(orderStripBoxes(roster))).toEqual(keys);
  });
});

describe('entryIndex', () => {
  it.each<{ name: string; roster: Roster; index: number | null }>([
    {
      name: 'the first of several',
      roster: {
        agents: [agent('a1', 100), agent('a2', 200)],
        tasks: [task('t1', 300)],
        skills: [],
      },
      index: 0,
    },
    {
      name: 'no boxes',
      roster: { agents: [], tasks: [], skills: [] },
      index: null,
    },
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
    skills: [],
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
