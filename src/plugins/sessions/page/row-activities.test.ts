import { describe, expect, it } from 'vitest';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  NEEDS_YOU_ACTIVITY,
  type RowActivity,
  sessionsActivitySlot,
} from '../contract';
import { createRowActivities } from './row-activities';

const WORKING: RowActivity = { word: 'working', tone: 'running', rank: 20 };
const DONE: RowActivity = { word: 'done', tone: 'success', rank: 10 };
const LOOKED: RowActivity = { word: 'looked', tone: 'warning', rank: 10 };

type Step = { set: [string, string, RowActivity | null] } | { forget: string };

// Row activities over a real slot store's writer.
function activitiesOnSlot() {
  const slot = createSlotStore(() => undefined).publish(sessionsActivitySlot);
  return { slot, activities: createRowActivities(slot) };
}

describe('createRowActivities', () => {
  it.each<{
    case: string;
    steps: Step[];
    top: string | null;
    lastChanged: boolean;
    // The sources of `s1` the slot holds, in order.
    sources: string[];
  }>([
    {
      case: 'highest rank shows',
      steps: [
        { set: ['s1', 'chat', WORKING] },
        { set: ['s1', 'forms', NEEDS_YOU_ACTIVITY] },
      ],
      top: 'needs you',
      lastChanged: true,
      sources: ['chat', 'forms'],
    },
    {
      case: 'a lower rank set later leaves the top',
      steps: [
        { set: ['s1', 'forms', NEEDS_YOU_ACTIVITY] },
        { set: ['s1', 'chat', WORKING] },
      ],
      top: 'needs you',
      lastChanged: false,
      sources: ['forms', 'chat'],
    },
    {
      case: 'tie goes to the last set',
      steps: [{ set: ['s1', 'chat', DONE] }, { set: ['s1', 'notes', LOOKED] }],
      top: 'looked',
      lastChanged: true,
      sources: ['chat', 'notes'],
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
      sources: ['notes', 'chat'],
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
      sources: ['chat'],
    },
    {
      case: 'the same activity again is unchanged',
      steps: [
        { set: ['s1', 'chat', WORKING] },
        { set: ['s1', 'chat', WORKING] },
      ],
      top: 'working',
      lastChanged: false,
      sources: ['chat'],
    },
    {
      case: 'the same word and tone with another emphasis is a change',
      steps: [
        { set: ['s1', 'chat', DONE] },
        { set: ['s1', 'chat', { ...DONE, emphasis: 'raised' }] },
      ],
      top: 'done',
      lastChanged: true,
      sources: ['chat'],
    },
    {
      case: 'null for a source holding none is unchanged',
      steps: [{ set: ['s1', 'chat', WORKING] }, { set: ['s1', 'forms', null] }],
      top: 'working',
      lastChanged: false,
      sources: ['chat'],
    },
    {
      case: 'another session is untouched',
      steps: [
        { set: ['s1', 'chat', WORKING] },
        { set: ['s2', 'chat', NEEDS_YOU_ACTIVITY] },
      ],
      top: 'working',
      lastChanged: true,
      sources: ['chat'],
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
      sources: [],
    },
  ])('set_Sequence_TopIsHighestRankLatestOnTie ($case)', (row) => {
    const { slot, activities } = activitiesOnSlot();
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
    expect((slot.get('s1') ?? []).map((source) => source.sourceId)).toEqual(
      row.sources,
    );
  });

  it('rowActivities_NoSourcesLeft_HoldsNoKey', () => {
    const { slot, activities } = activitiesOnSlot();
    activities.set('s1', 'chat', WORKING);
    activities.set('s2', 'chat', DONE);

    activities.set('s1', 'chat', null);

    expect([...slot.all().keys()]).toEqual(['s2']);
  });

  it('rowActivities_Forget_HoldsNoKey', () => {
    const { slot, activities } = activitiesOnSlot();
    activities.set('s1', 'chat', WORKING);
    activities.set('s1', 'forms', NEEDS_YOU_ACTIVITY);
    activities.set('s2', 'chat', DONE);

    activities.forget('s1');

    expect([...slot.all().keys()]).toEqual(['s2']);
  });
});
