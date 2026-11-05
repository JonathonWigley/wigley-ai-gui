import { describe, expect, it } from 'vitest';
import { coreWindowFocusedSlot } from '../../contracts/core-state';
import { createSlotStore } from '../../shared/state/slot-store';
import { startWindowFocusSlot } from './window-focus-slot';

describe('startWindowFocusSlot', () => {
  it.each([
    { row: 'first value, focused', isFocused: true, changes: [], last: true },
    { row: 'first value, blurred', isFocused: false, changes: [], last: false },
    { row: 'focus', isFocused: false, changes: [true], last: true },
    { row: 'blur', isFocused: true, changes: [false], last: false },
  ])(
    'startWindowFocusSlot_WritesNowThenEachChange: $row',
    ({ isFocused, changes, last }) => {
      const store = createSlotStore(() => {});
      let tell = (_focused: boolean) => {};

      startWindowFocusSlot(store, {
        isFocused: () => isFocused,
        onFocusChange(listener) {
          tell = listener;
        },
      });
      changes.forEach(tell);

      expect(store.read(coreWindowFocusedSlot, 'test').get()).toBe(last);
    },
  );
});
