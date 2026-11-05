import { coreWindowFocusedSlot } from '../../contracts/core-state';
import type { SlotStore } from '../../shared/state/slot-store';

// Writes whether the window has focus now, then each change. The writer lives as
// long as `store`.
export function startWindowFocusSlot(
  store: SlotStore,
  focus: {
    isFocused(): boolean;
    onFocusChange(listener: (focused: boolean) => void): void;
  },
): void {
  const focused = store.publish(coreWindowFocusedSlot);
  focused.set(focus.isFocused());
  focus.onFocusChange((next) => focused.set(next));
}
