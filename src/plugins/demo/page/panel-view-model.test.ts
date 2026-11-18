import { describe, expect, it } from 'vitest';
import type { DemoSection, DemoStep } from '../../../contracts/demo';
import type { StepListInput } from '../layouts/layout';
import { movedCursor, stepListInput } from './panel-view-model';
import type { RunDriverState } from './run-driver';

function step(id: string, section: DemoSection, order: number): DemoStep {
  return {
    id,
    section,
    order,
    title: `${id} title`,
    caption: '',
    files: [],
    enter: () => Promise.reject(new Error('not entered')),
  };
}

function held(stepId: string | null, beat: number): RunDriverState {
  return { stepId, beat, beatCount: 3, autoplay: false };
}

// Two shell steps, one bars step, and no step in any other section.
const STEPS = [
  step('p.bar', 'bars', 1),
  step('p.shellTwo', 'shell', 2),
  step('p.shellOne', 'shell', 1),
];

describe('stepListInput', () => {
  it.each<{
    name: string;
    state: RunDriverState;
    cursorId: string | null;
    expected: StepListInput['sections'];
  }>([
    {
      name: 'beats under the current step only, cursor on another',
      state: held('p.shellTwo', 1),
      cursorId: 'p.bar',
      expected: [
        {
          title: 'Shell',
          steps: [
            {
              id: 'p.shellOne',
              title: 'p.shellOne title',
              isCurrent: false,
              isCursor: false,
              beats: [],
            },
            {
              id: 'p.shellTwo',
              title: 'p.shellTwo title',
              isCurrent: true,
              isCursor: false,
              beats: [
                { name: 'a', isCurrent: false },
                { name: 'b', isCurrent: true },
                { name: 'c', isCurrent: false },
              ],
            },
          ],
        },
        {
          title: 'Bars',
          steps: [
            {
              id: 'p.bar',
              title: 'p.bar title',
              isCurrent: false,
              isCursor: true,
              beats: [],
            },
          ],
        },
      ],
    },
    {
      name: 'no step held',
      state: held(null, 0),
      cursorId: null,
      expected: [
        {
          title: 'Shell',
          steps: [
            {
              id: 'p.shellOne',
              title: 'p.shellOne title',
              isCurrent: false,
              isCursor: false,
              beats: [],
            },
            {
              id: 'p.shellTwo',
              title: 'p.shellTwo title',
              isCurrent: false,
              isCursor: false,
              beats: [],
            },
          ],
        },
        {
          title: 'Bars',
          steps: [
            {
              id: 'p.bar',
              title: 'p.bar title',
              isCurrent: false,
              isCursor: false,
              beats: [],
            },
          ],
        },
      ],
    },
  ])(
    'stepListInput_GroupsBySection_ListsBeatsUnderCurrentOnly: $name',
    ({ state, cursorId, expected }) => {
      const input = stepListInput(
        STEPS,
        state,
        ['a', 'b', 'c'],
        cursorId,
        true,
        false,
      );

      expect(input).toEqual({
        sections: expected,
        autoplay: true,
        realShown: false,
      });
    },
  );
});

describe('movedCursor', () => {
  it.each<{
    from: string | null;
    move: 'down' | 'up';
    expected: string;
  }>([
    { from: 'p.shellOne', move: 'down', expected: 'p.shellTwo' },
    { from: 'p.shellTwo', move: 'down', expected: 'p.bar' },
    { from: 'p.bar', move: 'down', expected: 'p.bar' },
    { from: 'p.bar', move: 'up', expected: 'p.shellTwo' },
    { from: 'p.shellOne', move: 'up', expected: 'p.shellOne' },
    { from: null, move: 'down', expected: 'p.shellOne' },
    { from: 'p.gone', move: 'up', expected: 'p.shellOne' },
  ])(
    'movedCursor_AtEnds_Stops: $from $move → $expected',
    ({ from, move, expected }) => {
      expect(movedCursor(STEPS, from, move)).toEqual(expected);
    },
  );
});
