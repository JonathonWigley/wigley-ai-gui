import type { FuzzyMatcher } from '../../contracts/fuzzy';

// A picker's list: `cursor` is an index into `labels`, −1 when nothing is
// visible. `names` holds each row's name when its label also holds a path;
// null when the labels are all there is to match.
export interface PickerState {
  labels: readonly string[];
  names: readonly string[] | null;
  filter: string;
  cursor: number;
}

// The cursor starts on `selected` when it is in range, else on the first
// label.
export function openPicker(
  labels: readonly string[],
  selected: number,
  names?: readonly string[],
): PickerState {
  const isInRange = selected >= 0 && selected < labels.length;
  const fallback = labels.length > 0 ? 0 : -1;
  return {
    labels,
    names: names ?? null,
    filter: '',
    cursor: isInRange ? selected : fallback,
  };
}

// The indexes the filter keeps, best match first, a match on a row's name
// ahead of a match on any label; every index in order for an empty trimmed
// filter.
export function visibleIndexes(
  state: PickerState,
  matcher: FuzzyMatcher,
): number[] {
  const { labels, names, filter } = state;
  const indexes = labels.map((_label, index) => index);
  if (filter.trim() === '') {
    return indexes;
  }
  return matcher.rank(indexes, filter, (index) =>
    names === null ? [[labels[index]]] : [[names[index]], [labels[index]]],
  );
}

// The next or previous visible index, clamped at the ends.
export function movePicker(
  state: PickerState,
  step: 1 | -1,
  matcher: FuzzyMatcher,
): PickerState {
  const visible = visibleIndexes(state, matcher);
  if (visible.length === 0) {
    return state;
  }
  const position = visible.indexOf(state.cursor);
  const next = Math.min(visible.length - 1, Math.max(0, position + step));
  return { ...state, cursor: visible[next] };
}

// The first or last visible index, in the shown order; the state unchanged
// when nothing is visible.
export function movePickerToEdge(
  state: PickerState,
  edge: 'first' | 'last',
  matcher: FuzzyMatcher,
): PickerState {
  const visible = visibleIndexes(state, matcher);
  if (visible.length === 0) {
    return state;
  }
  const cursor = edge === 'first' ? visible[0] : visible[visible.length - 1];
  return { ...state, cursor };
}

// With a filter, the cursor goes to the best match, so Enter picks it. With
// an empty trimmed filter it stays while it is on a row, else goes to the
// first.
export function filterPicker(
  state: PickerState,
  filter: string,
  matcher: FuzzyMatcher,
): PickerState {
  const filtered = { ...state, filter };
  const visible = visibleIndexes(filtered, matcher);
  const keepsCursor = filter.trim() === '' && visible.includes(state.cursor);
  return {
    ...filtered,
    cursor: keepsCursor ? state.cursor : (visible[0] ?? -1),
  };
}
