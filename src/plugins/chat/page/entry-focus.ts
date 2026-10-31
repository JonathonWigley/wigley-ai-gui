// Which entry of a session's list the entry keys act on. A following focus
// stays on the latest entry as entries arrive.
export interface EntryFocus {
  entryId: string | null;
  following: boolean;
}

export const START_FOCUS: EntryFocus = { entryId: null, following: true };

// One place by `step`, clamped at both ends; from no entry, the last one for
// either step.
export function moveFocus(
  focus: EntryFocus,
  ids: readonly string[],
  step: 1 | -1,
): EntryFocus {
  if (ids.length === 0) {
    return START_FOCUS;
  }
  const index = focus.entryId === null ? -1 : ids.indexOf(focus.entryId);
  const last = ids.length - 1;
  const next = index < 0 ? last : Math.min(last, Math.max(0, index + step));
  return { entryId: ids[next], following: next === last };
}

// The first entry, following only when it is also the last.
export function focusFirst(ids: readonly string[]): EntryFocus {
  const first = ids.at(0);
  return first === undefined
    ? START_FOCUS
    : { entryId: first, following: ids.length === 1 };
}

export function focusLatest(ids: readonly string[]): EntryFocus {
  const last = ids.at(-1);
  return last === undefined ? START_FOCUS : { entryId: last, following: true };
}

// After the list scrolled by `direction` and came to rest `isAtBottom` or not:
// scrolling up off the bottom stops following, scrolling down onto it follows
// again; the focused entry stays.
export function focusAfterScroll(
  focus: EntryFocus,
  direction: 1 | -1,
  isAtBottom: boolean,
): EntryFocus {
  const following =
    direction === 1
      ? focus.following || isAtBottom
      : focus.following && isAtBottom;
  return { entryId: focus.entryId, following };
}

// After the list changed: a following focus moves to the new last entry, a
// focus on an entry still listed stays, and one whose entry is gone follows
// the latest.
export function focusAfterChange(
  focus: EntryFocus,
  ids: readonly string[],
): EntryFocus {
  const isKept =
    !focus.following && focus.entryId !== null && ids.includes(focus.entryId);
  return isKept ? focus : focusLatest(ids);
}

// After run `runId` closed: a focus on one of its `stepIds` moves to the run's
// line, keeping whether it follows; any other focus stays.
export function focusAfterClose(
  focus: EntryFocus,
  runId: string,
  stepIds: readonly string[],
): EntryFocus {
  const isOnStep = focus.entryId !== null && stepIds.includes(focus.entryId);
  return isOnStep ? { entryId: runId, following: focus.following } : focus;
}
