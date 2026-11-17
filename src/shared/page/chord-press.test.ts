import { describe, expect, it } from 'vitest';
import { isChordPress } from './chord-press';

// A keydown holding the modifiers `held` sets, with AltGr down when `altGraph`.
function keydown(
  held: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey'>>,
  altGraph: boolean,
): KeyboardEvent {
  return {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...held,
    getModifierState: (name: string) => name === 'AltGraph' && altGraph,
  } as KeyboardEvent;
}

describe('isChordPress', () => {
  it.each([
    {
      case: 'Ctrl+Alt with AltGraph',
      held: { ctrlKey: true, altKey: true },
      altGraph: true,
      expected: false,
    },
    {
      case: 'Ctrl+Alt without AltGraph',
      held: { ctrlKey: true, altKey: true },
      altGraph: false,
      expected: true,
    },
    { case: 'Meta', held: { metaKey: true }, altGraph: false, expected: true },
    { case: 'plain', held: {}, altGraph: false, expected: false },
  ])('$case is a chord: $expected', ({ held, altGraph, expected }) => {
    expect(isChordPress(keydown(held, altGraph))).toBe(expected);
  });
});
