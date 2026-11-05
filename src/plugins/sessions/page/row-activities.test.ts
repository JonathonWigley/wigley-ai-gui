import { describe, expect, it } from 'vitest';
import { NEEDS_YOU_ACTIVITY, type RowActivity } from '../contract';
import { createRowActivities } from './row-activities';

const WORKING: RowActivity = { word: 'working', tone: 'running', rank: 20 };
const DONE: RowActivity = { word: 'done', tone: 'success', rank: 10 };
const LOOKED: RowActivity = { word: 'looked', tone: 'warning', rank: 10 };

type Step = { set: [string, string, RowActivity | null] } | { forget: string };

describe('createRowActivities', () => {
  it.each<{
    case: string;
    steps: Step[];
    top: string | null;
    lastChanged: boolean;
  }>([
    {
      case: 'highest rank shows',
      steps: [
        { set: ['s1', 'chat', WORKING] },
        { set: ['s1', 'forms', NEEDS_YOU_ACTIVITY] },
      ],
      top: 'needs you',
      lastChanged: true,
    },
    {
      case: 'a lower rank set later leaves the top',
      steps: [
        { set: ['s1', 'forms', NEEDS_YOU_ACTIVITY] },
        { set: ['s1', 'chat', WORKING] },
      ],
      top: 'needs you',
      lastChanged: false,
    },
    {
      case: 'tie goes to the last set',
      steps: [{ set: ['s1', 'chat', DONE] }, { set: ['s1', 'notes', LOOKED] }],
      top: 'looked',
      lastChanged: true,
    },
    {
      case: 'tie goes to the last set, the first source setting again',
      steps: [
        { set: ['s1', 'chat', DONE] },
        { set: ['s1', 'notes', LOOKED] },
        { set: ['s1', 'chat', DONE] },
      ],
      top: 'done',
      lastChanged: true,
    },
    {
      case: 'null removes the source',
      steps: [
        { set: ['s1', 'chat', WORKING] },
        { set: ['s1', 'forms', NEEDS_YOU_ACTIVITY] },
        { set: ['s1', 'forms', null] },
      ],
      top: 'working',
      lastChanged: true,
    },
    {
      case: 'the same activity again is unchanged',
      steps: [
        { set: ['s1', 'chat', WORKING] },
        { set: ['s1', 'chat', WORKING] },
      ],
      top: 'working',
      lastChanged: false,
    },
    {
      case: 'the same word and tone with another emphasis is a change',
      steps: [
        { set: ['s1', 'chat', DONE] },
        { set: ['s1', 'chat', { ...DONE, emphasis: 'raised' }] },
      ],
      top: 'done',
      lastChanged: true,
    },
    {
      case: 'null for a source holding none is unchanged',
      steps: [{ set: ['s1', 'chat', WORKING] }, { set: ['s1', 'forms', null] }],
      top: 'working',
      lastChanged: false,
    },
    {
      case: 'another session is untouched',
      steps: [
        { set: ['s1', 'chat', WORKING] },
        { set: ['s2', 'chat', NEEDS_YOU_ACTIVITY] },
      ],
      top: 'working',
      lastChanged: true,
    },
    {
      case: 'forget drops every source',
      steps: [
        { set: ['s1', 'chat', WORKING] },
        { set: ['s1', 'forms', NEEDS_YOU_ACTIVITY] },
        { forget: 's1' },
        { set: ['s1', 'notes', null] },
      ],
      top: null,
      lastChanged: false,
    },
  ])('set_Sequence_TopIsHighestRankLatestOnTie ($case)', (row) => {
    const activities = createRowActivities();
    let lastChanged: boolean | null = null;
    for (const step of row.steps) {
      if ('forget' in step) {
        activities.forget(step.forget);
      } else {
        lastChanged = activities.set(...step.set);
      }
    }

    expect(activities.top('s1')?.word ?? null).toBe(row.top);
    expect(lastChanged).toBe(row.lastChanged);
  });
});
