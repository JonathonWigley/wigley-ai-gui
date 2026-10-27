import { describe, expect, it } from 'vitest';
import { createMarkupHistory } from './markup-history';

describe('createMarkupHistory', () => {
  it('undo_AfterTwoPushes_ReturnsPrevious', () => {
    const history = createMarkupHistory('a');
    history.push('b');
    history.push('c');

    expect(history.undo()).toBe('b');
    expect(history.current()).toBe('b');
  });

  it('push_AfterUndo_ClearsRedo', () => {
    const history = createMarkupHistory('a');
    history.push('b');
    history.push('c');
    history.undo();

    history.push('d');

    expect(history.redo()).toBeNull();
    expect(history.current()).toBe('d');
  });

  it('undo_AtStart_ReturnsNull', () => {
    const history = createMarkupHistory('a');

    expect(history.undo()).toBeNull();
    expect(history.current()).toBe('a');
  });

  it('push_SameAsCurrent_AddsNoStep', () => {
    const history = createMarkupHistory('a');

    history.push('a');

    expect(history.undo()).toBeNull();
  });

  it('push_PastLimit_DropsOldest', () => {
    const history = createMarkupHistory('s0');
    for (let index = 1; index <= 100; index += 1) {
      history.push(`s${index}`);
    }

    const undone: (string | null)[] = [];
    for (let index = 0; index < 100; index += 1) {
      undone.push(history.undo());
    }

    expect(undone[98]).toBe('s1');
    expect(undone[99]).toBeNull();
  });
});
