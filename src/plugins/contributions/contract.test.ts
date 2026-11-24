import { describe, expect, it } from 'vitest';
import {
  pickProblemText,
  pickStrategy,
  type Strategy,
  type StrategyPick,
  strategyControlKind,
} from './contract';

function strategy(id: string): Strategy<null> {
  return {
    id,
    label: id,
    source: {
      pluginName: id,
      pluginKey: `${id}@market`,
      version: '1.0.0',
      root: `/plugins/${id}`,
      harnessId: 'fake',
    },
    value: null,
  };
}

const WIGLEY = strategy('wigley');
const A = strategy('a');
const B = strategy('b');

describe('pickStrategy', () => {
  // Catches a pick rule that drifts from design.md § Picking a strategy.
  it.each<{
    setting: string;
    strategies: Strategy<null>[];
    pick: StrategyPick<null>;
  }>([
    {
      setting: 'wigley',
      strategies: [WIGLEY],
      pick: { kind: 'picked', strategy: WIGLEY },
    },
    {
      setting: '',
      strategies: [WIGLEY],
      pick: { kind: 'picked', strategy: WIGLEY },
    },
    { setting: '', strategies: [], pick: { kind: 'none' } },
    {
      setting: '',
      strategies: [A, B],
      pick: { kind: 'choose', ids: ['a', 'b'] },
    },
    { setting: 'gone', strategies: [A], pick: { kind: 'missing', id: 'gone' } },
  ])(
    'setting $setting over $strategies.length strategies picks $pick.kind',
    ({ setting, strategies, pick }) => {
      expect(pickStrategy(strategies, setting)).toEqual(pick);
    },
  );
});

describe('pickProblemText', () => {
  // Catches an empty state worded for the wrong case.
  it.each<{ pick: StrategyPick<unknown>; text: string | null }>([
    { pick: { kind: 'none' }, text: 'No installed plugin binds Retro.' },
    {
      pick: { kind: 'choose', ids: ['a', 'b'] },
      text: 'Several plugins bind Retro: pick one in Settings.',
    },
    {
      pick: { kind: 'missing', id: 'gone' },
      text: 'Retro is set to gone, which is not installed.',
    },
    { pick: { kind: 'picked', strategy: WIGLEY }, text: null },
  ])('$pick.kind gives its text', ({ pick, text }) => {
    expect(pickProblemText('Retro', pick)).toBe(text);
  });
});

describe('strategyControlKind', () => {
  it("names the feature's kind", () => {
    expect(strategyControlKind('retro')).toBe('strategy:retro');
  });
});
