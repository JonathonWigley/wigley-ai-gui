import type { EntryFocus } from '../contract';

export const START_FOCUS: EntryFocus = {
  stopId: null,
  following: true,
  anchorId: null,
};

const BLOCK_SUFFIX = /#\d+$/;

export function blockStopId(entryId: string, blockIndex: number): string {
  return `${entryId}#${blockIndex}`;
}

// The entry a stop belongs to: the id without a trailing `#<digits>`.
export function entryIdOfStop(stopId: string): string {
  return stopId.replace(BLOCK_SUFFIX, '');
}

function stopsOfEntry(ids: readonly string[], entryId: string): string[] {
  return ids.filter((id) => entryIdOfStop(id) === entryId);
}

// One place by `step`, clamped at both ends; from no stop, the last one for
// either step.
export function moveFocus(
  focus: EntryFocus,
  ids: readonly string[],
  step: 1 | -1,
): EntryFocus {
  if (ids.length === 0) {
    return START_FOCUS;
  }
  const index = focus.stopId === null ? -1 : ids.indexOf(focus.stopId);
  const last = ids.length - 1;
  const next = index < 0 ? last : Math.min(last, Math.max(0, index + step));
  return focusStop(focus, ids, ids[next]);
}

// On `stopId`, following only when it is the last of `ids`.
export function focusStop(
  focus: EntryFocus,
  ids: readonly string[],
  stopId: string,
): EntryFocus {
  return { ...focus, stopId, following: stopId === ids[ids.length - 1] };
}

// To the first stop of the next or previous message, skipping every stop of the
// current one; `messageIds` names the message entries. No message that way
// leaves the focus as it is.
export function moveToMessage(
  focus: EntryFocus,
  ids: readonly string[],
  messageIds: readonly string[],
  step: 1 | -1,
): EntryFocus {
  const { stopId } = focus;
  const currentEntry = stopId === null ? null : entryIdOfStop(stopId);
  const index = stopId === null ? -1 : ids.indexOf(stopId);
  const isOtherMessage = (id: string) => {
    const entryId = entryIdOfStop(id);
    return entryId !== currentEntry && messageIds.includes(entryId);
  };
  const nearest =
    step === 1
      ? ids.slice(index + 1).find(isOtherMessage)
      : ids.slice(0, Math.max(index, 0)).findLast(isOtherMessage);
  return nearest === undefined
    ? focus
    : focusStop(focus, ids, stopsOfEntry(ids, entryIdOfStop(nearest))[0]);
}

// Opens a range at the cursor, or closes the open one; from no stop, no change.
export function toggleAnchor(focus: EntryFocus): EntryFocus {
  if (focus.stopId === null) {
    return focus;
  }
  return { ...focus, anchorId: focus.anchorId === null ? focus.stopId : null };
}

export function clearAnchor(focus: EntryFocus): EntryFocus {
  return { ...focus, anchorId: null };
}

// The ids from anchor to cursor in list order, inclusive; the cursor alone when
// no anchor pairs with it in `ids`, and nothing from no cursor.
export function rangeStops(
  focus: EntryFocus,
  ids: readonly string[],
): string[] {
  const { stopId, anchorId } = focus;
  if (stopId === null) {
    return [];
  }
  const cursorIndex = ids.indexOf(stopId);
  const anchorIndex = anchorId === null ? -1 : ids.indexOf(anchorId);
  if (cursorIndex < 0 || anchorIndex < 0) {
    return [stopId];
  }
  return ids.slice(
    Math.min(cursorIndex, anchorIndex),
    Math.max(cursorIndex, anchorIndex) + 1,
  );
}

// The stop to land on when `current` is hidden: the first visible one walking
// from it in `direction`, then the other way. Null when `current` is visible or
// no stop is.
export function nearestVisibleStop(
  ids: readonly string[],
  current: string,
  direction: 1 | -1,
  isVisible: (id: string) => boolean,
): string | null {
  if (isVisible(current)) {
    return null;
  }
  const index = ids.indexOf(current);
  for (const step of [direction, -direction]) {
    for (let i = index + step; i >= 0 && i < ids.length; i += step) {
      if (isVisible(ids[i])) {
        return ids[i];
      }
    }
  }
  return null;
}

// Whether `j` has no stop left to move to: no stops at all, or the focus on the
// last of `ids`. From no stop it has not, since `j` focuses the last stop.
export function isAtLastStop(
  focus: EntryFocus,
  ids: readonly string[],
): boolean {
  return ids.length === 0 || focus.stopId === ids[ids.length - 1];
}

// The first stop, following only when it is also the last.
export function focusFirst(
  ids: readonly string[],
  anchorId: string | null,
): EntryFocus {
  const first = ids.at(0);
  return first === undefined
    ? START_FOCUS
    : { stopId: first, following: ids.length === 1, anchorId };
}

// Following on `latestId`; from no id, the start.
export function focusLatest(
  latestId: string | null,
  anchorId: string | null,
): EntryFocus {
  return latestId === null
    ? START_FOCUS
    : { stopId: latestId, following: true, anchorId };
}

// After the list scrolled by `direction` and came to rest `isAtBottom` or not:
// scrolling up off the bottom stops following, scrolling down onto it follows
// again; the focused stop stays.
export function focusAfterScroll(
  focus: EntryFocus,
  direction: 1 | -1,
  isAtBottom: boolean,
): EntryFocus {
  const following =
    direction === 1
      ? focus.following || isAtBottom
      : focus.following && isAtBottom;
  return { ...focus, following };
}

// After the list scrolled by any means (wheel, trackpad, scrollbar, keys) and
// came to rest `isAtBottom` or not: it follows only at the bottom; the focused
// stop stays.
export function focusAfterScrollEvent(
  focus: EntryFocus,
  isAtBottom: boolean,
): EntryFocus {
  return { ...focus, following: isAtBottom };
}

// After the list changed, with `lastStopId` the stop a following focus may rest
// on (the newest pending row, else the last cursor row's stop: an open run's
// line, or the last block of an entry with blocks). A listed stop stays unless
// it follows off `lastStopId`, which moves to the last of `ids`. A gone stop
// not following moves within its entry: to the first stop when the entry gained
// blocks, the last when it lost them. Any other focus follows `lastStopId`. An
// anchor no longer in `ids` clears.
export function focusAfterChange(
  focus: EntryFocus,
  ids: readonly string[],
  lastStopId: string | null,
): EntryFocus {
  const { stopId, following } = focus;
  const anchorId =
    focus.anchorId !== null && ids.includes(focus.anchorId)
      ? focus.anchorId
      : null;
  if (stopId === null) {
    return focusLatest(lastStopId, anchorId);
  }
  if (ids.includes(stopId)) {
    return !following || stopId === lastStopId
      ? { ...focus, anchorId }
      : focusLatest(ids[ids.length - 1], anchorId);
  }
  const entryId = entryIdOfStop(stopId);
  const entryStops = stopsOfEntry(ids, entryId);
  if (following || entryStops.length === 0) {
    return focusLatest(lastStopId, anchorId);
  }
  const entryLostBlocks = entryId !== stopId;
  return {
    stopId: entryLostBlocks ? entryStops[entryStops.length - 1] : entryStops[0],
    following,
    anchorId,
  };
}

// After run `runId` closed: a focus on one of its `stepIds` moves to the run's
// line, keeping whether it follows; any other focus stays.
export function focusAfterClose(
  focus: EntryFocus,
  runId: string,
  stepIds: readonly string[],
): EntryFocus {
  const isOnStep = focus.stopId !== null && stepIds.includes(focus.stopId);
  return isOnStep ? { ...focus, stopId: runId } : focus;
}
