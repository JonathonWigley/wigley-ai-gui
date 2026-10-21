// A picker's list: `cursor` is an index into `labels`, −1 when nothing is
// visible.
export interface PickerState {
  labels: readonly string[];
  filter: string;
  cursor: number;
}

// The cursor starts on `selected` when it is in range, else on the first
// label.
export function openPicker(
  labels: readonly string[],
  selected: number,
): PickerState {
  const isInRange = selected >= 0 && selected < labels.length;
  const fallback = labels.length > 0 ? 0 : -1;
  return { labels, filter: '', cursor: isInRange ? selected : fallback };
}

// The indexes, in order, whose label holds the trimmed filter, compared
// lower-cased; every index for an empty filter.
export function visibleIndexes(state: PickerState): number[] {
  const needle = state.filter.trim().toLowerCase();
  const indexes: number[] = [];
  state.labels.forEach((label, index) => {
    if (label.toLowerCase().includes(needle)) {
      indexes.push(index);
    }
  });
  return indexes;
}

// The next or previous visible index, clamped at the ends.
export function movePicker(state: PickerState, step: 1 | -1): PickerState {
  const visible = visibleIndexes(state);
  if (visible.length === 0) {
    return state;
  }
  const position = visible.indexOf(state.cursor);
  const next = Math.min(visible.length - 1, Math.max(0, position + step));
  return { ...state, cursor: visible[next] };
}

// The cursor stays while its label is visible, else moves to the first
// visible one.
export function filterPicker(state: PickerState, filter: string): PickerState {
  const filtered = { ...state, filter };
  const visible = visibleIndexes(filtered);
  const cursor = visible.includes(state.cursor)
    ? state.cursor
    : (visible[0] ?? -1);
  return { ...filtered, cursor };
}
