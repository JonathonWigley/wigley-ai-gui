import type { Clock, Timers } from '../../../contracts/ambient';
import type { ChatEntry, ChatEntryKind } from '../../../contracts/agent';
import type { PluginLog } from '../../../contracts/log';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import {
  type DrawnPart,
  drawPart,
} from '../../../shared/page/layout-host/draw-part';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { isScrolledToEnd, scrollContent } from '../../../shared/content-scroll';
import type { QueuedMessage } from '../contract';
import { chatCommand, chatScope } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type {
  ActivityInput,
  ChatLayout,
  EntryBuilder,
  EntryInput,
  EntryKind,
  EntryView,
  PartView,
  QueuedMessageInput,
} from '../layouts/layout';
import type { BaseKit } from '../../../shared/page/layout-host/kit';
import {
  cursorStops,
  isCursorRow,
  isStep,
  isStepsChanged,
  type ListRow,
  type ListStop,
  listRows,
  rowStops,
} from './activity-runs';
import { createEntryKit, type EntryKit, type KitDeps } from './chat-kit';
import {
  type ChatLayouts,
  type ChatPartDraws,
  chatPartDraws,
  DEFAULT_ENTRY_PICK,
  isActivityInTranscript,
  pickEntry,
  surfaceBaseKit,
} from './chat-layouts';
import {
  blockStopId,
  clearAnchor,
  type EntryFocus,
  entryIdOfStop,
  focusAfterChange,
  focusAfterClose,
  focusAfterScroll,
  focusAfterScrollEvent,
  focusFirst,
  focusLatest,
  focusStop,
  isAtLastStop,
  moveFocus,
  moveToMessage,
  nearestVisibleStop,
  rangeStops,
  START_FOCUS,
  toggleAnchor,
} from './entry-focus';
import { resultStepCount } from './working-turn';

// `layouts` are the ones every session's entries, activity lines and pending
// rows are built with, and say whether runs, steps and results show at all;
// `toastedKinds` the kinds whose failed draw has toasted since they were
// shown, shared by every session's list. `timers` and `clock` tick a live
// activity line's time. `pullBack` is what a click on a pending row calls
// with its message's id. `turnLine` is the element the list keeps as its row after
// the last entry; its owner draws and hides it.
export interface EntryListDeps {
  layouts: ChatLayouts;
  toastedKinds: Set<ChatEntryKind>;
  kit: KitDeps;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
  timers: Timers;
  clock: Clock;
  pullBack(queuedId: string): void;
  turnLine: HTMLElement;
}

export type ToggleResult = 'expanded' | 'collapsed' | 'nothing';

// What the entry cursor is on: an entry (for a block stop, the entry holding the
// block), a run's activity line, or a pending row.
export type EntryListStop =
  | ListStop
  | { kind: 'queued'; message: QueuedMessage };

// A scroll, and whether the list follows the latest entry after it.
export interface TranscriptScroll extends ContentScroll {
  following: boolean;
}

// One session's entries, one slot per entry in the session's order, each run
// of steps also drawn as one activity line slot right before its first step's
// slot; a closed run's step slots are hidden. While the shown layouts leave
// activity out of the transcript, steps get no slot, so no run or step is drawn
// or stopped on; the flag is read when the list is created and at each rebuild.
// The turn line follows the last entry and is no stop; the session's queued
// messages follow it as pending rows, oldest first. The cursor stops on each block a user or assistant entry drew (its
// `[data-md-lines]` elements, read as the slot builds and redraws), on any other
// entry but a turn or compaction divider, on each activity line, on each step of
// an open run, then on each pending row; the focused block, else the focused
// stop's slot, is marked `is-cursor`. A range opens at an anchor and runs to the
// cursor, each of its stops marked `is-range`, and can cross messages. A following
// focus moves to the latest stop as the list changes, except one on the last
// row's activity line, which stays on it while the run is open and grows, no
// pending row follows it and the line stays on screen. After every change, and
// whenever the list's own box or any slot's box resizes, a following focus
// scrolls the list to its bottom;
// a hidden list does not scroll, so its tab calls `scrollToFocus` each time it
// shows. Any scroll of a shown list (wheel, trackpad, scrollbar or keys) that
// comes to rest off the bottom stops following, and one that lands on the
// bottom follows again; a cursor it leaves outside the visible band (the list's
// box less its bottom scroll padding) moves to the nearest stop inside it, a
// stop being inside once it lies wholly in the band, or overlaps a band it is
// too tall to fit, and with no such stop to the nearest that overlaps the band.
// So a run that overflows moves a following cursor off its line. `latest` makes
// the same move, since a list already at its bottom fires no scroll. A plain click
// moves the cursor to the block or slot under it without scrolling; a click
// ending a text selection, on a link, control or pending row, or on what has no
// stop leaves it.
// While the session works on its turn, the live run's line time ticks once a
// second.
export interface EntryList {
  element: HTMLOListElement;
  // Builds an entry new to the list that shows, or redraws the one holding
  // its id; a user put also redraws other user entries whose input changed.
  // `entries` is the session's list after the change.
  put(entry: ChatEntry, entries: readonly ChatEntry[]): void;
  // Reads whether the shown layouts put activity in the transcript, and builds
  // every entry that shows and every pending row again with the shown layouts,
  // keeping the focus, each entry's open expanders by id and each run's open
  // state.
  rebuild(entries: readonly ChatEntry[]): void;
  // Draws one pending row per message after the last entry, in order,
  // updating a row whose message it already holds and removing the rest.
  setQueued(queued: readonly QueuedMessage[]): void;
  // Whether the session works on its turn: only then is a last run live.
  setWorking(working: boolean): void;
  // Moves one stop, a block being a stop of its own; the focused stop after the
  // move, null with no stops. A move onto the last stop scrolls to the bottom and
  // follows, unless the stop is too tall for the visible band: then it scrolls
  // to its nearest edge and follows only if that rests on the bottom.
  move(step: 1 | -1): EntryListStop | null;
  // Moves to the first stop of the next or previous user or assistant message;
  // the focused stop after the move, unchanged at the first or last message,
  // null with no stops.
  moveToMessage(step: 1 | -1): EntryListStop | null;
  // Whether `move(1)` has no stop left to move to: no stops, or the focus on
  // the last stop in cursor order (the newest pending row, else the last row's
  // last stop: an entry's last block, or an open last run's last step).
  isAtLastStop(): boolean;
  // Follows the last row, the newest pending row, else an entry's last block,
  // an entry, or a run's line whether the run is open or not, and scrolls to
  // the bottom; a cursor that leaves off screen moves into the visible band as
  // after any scroll, whether or not the scroll moved. An open range stays open.
  latest(): void;
  // Focuses the first stop and scrolls to the top; the focused stop, null
  // with no stops. An open range stays open.
  first(): EntryListStop | null;
  // Opens a range at the cursor, or closes the open one; false with no cursor,
  // which changes nothing.
  toggleRange(): boolean;
  isRangeOpen(): boolean;
  // Closes the open range; true when one was open.
  cancelRange(): boolean;
  // The source of the range, else of the cursor's stop: a block's own lines, a
  // user, assistant or notice entry's text, a pending row's message, one blank
  // line between parts; `blockCount` counts the parts. Null when no part remains,
  // as on an activity line, a step or a permission card.
  selectedSource(): { text: string; blockCount: number } | null;
  // Scrolls to the bottom while following, else leaves the scroll alone.
  followBottom(): void;
  // Scrolls to the bottom while following, else brings the focused stop
  // into view.
  scrollToFocus(): void;
  // Scrolls the list by `step`. Scrolling up off the bottom
  // stops following, so entries that arrive leave the scroll alone; scrolling
  // down onto the bottom (within 1px) follows the latest stop again. The
  // focused stop stays until the list's scroll event finds it out of view.
  scrollBy(step: ScrollStep, direction: 1 | -1): TranscriptScroll;
  // The focused stop, the entry holding it for a block stop; null with no
  // focused stop.
  focused(): EntryListStop | null;
  // The focused stop's slot element, the slot of the entry holding it for a
  // block stop; null with no focused stop.
  focusedElement(): HTMLElement | null;
  // The cursor's block element; null on a stop with no blocks.
  focusedBlock(): HTMLElement | null;
  // On an activity line, opens the run when it is closed, else closes it. On
  // an entry, opens every expander when any is closed, else closes them all.
  // Null with no focused stop, or on a pending row, which toggles nothing.
  toggleFocused(): { stop: ListStop; result: ToggleResult } | null;
  // Stops following the list's size, scrolls, clicks and the tick, disposes every
  // entry's kit, every activity line and every pending row, and forgets the open
  // runs; the list's owner calls it when it drops the list.
  dispose(): void;
}

// One entry as drawn into its slot: the view the layout returned (null for
// the bare line), the kit made for it, and the dispose of what the draw
// recorded, which disposes the kit. `isDefaultView` holds while the view is
// a `default` layout's (the bundled or a live one) or the bare line;
// `isBundledView` while it is the bundled default layout's or the bare line;
// `isBareLine` while it is the bare line.
interface DrawnEntry {
  view: EntryView | null;
  kit: EntryKit;
  isDefaultView: boolean;
  isBundledView: boolean;
  isBareLine: boolean;
  dispose(): void;
}

// One drawn entry and its slot. `drawsWithDefault` holds once an update of a
// layout other than the bundled default has thrown, and the slot is drawn
// with the bundled default layout from then on. `blocks` are the cursor's block
// elements as last read from the drawn entry. `input` is what the slot last drew
// or updated with.
interface Slot extends DrawnEntry {
  element: HTMLLIElement;
  entry: ChatEntry;
  input: EntryInput<EntryKind>;
  drawsWithDefault: boolean;
  blocks: HTMLElement[];
}

// What a builder's draw returns to `drawPart`.
interface BuiltEntry {
  element: HTMLElement;
  view: EntryView;
  kit: EntryKit;
}

type AnyBuilder = EntryBuilder<EntryKind>;

type RunRow = Extract<ListRow, { kind: 'run' }>;

// The parts a list slot of its own draws, by the input each takes.
interface SlotPartInputs {
  activity: ActivityInput;
  queuedMessage: QueuedMessageInput;
}

type SlotPartName = keyof SlotPartInputs;

type SlotPartBuilder<K extends SlotPartName> = (
  parent: HTMLElement,
  input: SlotPartInputs[K],
  kit: BaseKit,
) => PartView<SlotPartInputs[K]>;

type BuiltSlotPart<K extends SlotPartName> = {
  element: HTMLElement;
  view: PartView<SlotPartInputs[K]>;
};

// A slot drawn by one layout part: the input its part last drew or updated
// with, and the drawn part, null while the slot holds the bare line.
interface PartSlot<K extends SlotPartName> {
  element: HTMLLIElement;
  input: SlotPartInputs[K];
  drawn: DrawnPart<BuiltSlotPart<K>> | null;
}

// One run's activity line slot, with the run as last listed.
interface RunSlot extends PartSlot<'activity'> {
  row: RunRow;
}

// One pending row's slot, with the message it shows.
interface QueuedSlot extends PartSlot<'queuedMessage'> {
  message: QueuedMessage;
}

// What drawing a part into a slot needs from the list.
interface SlotPartDraws<K extends SlotPartName> {
  part: K;
  draws: ChatPartDraws<K>;
  deps: EntryListDeps;
}

const TICK_MS = 1000;

const BLOCK_SELECTOR = '[data-md-lines]';

// What a click acts on by itself, so it leaves the cursor.
const CLICK_CONTROLS =
  'a, button, summary, input, textarea, .md-fence, .chat-queued-slot';

// How far past a band edge a stop may reach and still lie inside the band: rects
// are fractional, so a `block: 'nearest'` scroll can leave a stop just past it.
const BAND_EDGE_TOLERANCE_PX = 1;

export function createEntryList(deps: EntryListDeps): EntryList {
  const list = element('ol', 'chat-entries');
  const slots = new Map<string, Slot>();
  const runSlots = new Map<string, RunSlot>();
  // Each slot's block count by entry id, as last read.
  const blockCounts = new Map<string, number>();
  // Each pending row's slot by its stop id, oldest first.
  let queuedSlots = new Map<string, QueuedSlot>();
  const openRuns = new Set<string>();
  const activity: SlotPartDraws<'activity'> = {
    part: 'activity',
    draws: chatPartDraws(deps.layouts, 'activity', deps.log),
    deps,
  };
  const queuedPart: SlotPartDraws<'queuedMessage'> = {
    part: 'queuedMessage',
    draws: chatPartDraws(deps.layouts, 'queuedMessage', deps.log),
    deps,
  };
  let activityInTranscript = isActivityInTranscript(deps.layouts.shown());
  // The session's entries that get a slot.
  let entries: readonly ChatEntry[] = [];
  let working = false;
  let rows: ListRow[] = [];
  let order: string[] = [];
  let focus: EntryFocus = START_FOCUS;
  let tick: number | null = null;
  // The elements carrying `is-cursor` or `is-range`.
  const markedElements: HTMLElement[] = [];
  let lastScrollTop = list.scrollTop;
  // Where the last scroll to the bottom landed.
  let followedTop: number | null = null;

  const slotElement = (id: string) =>
    slots.get(id)?.element ??
    runSlots.get(id)?.element ??
    queuedSlots.get(id)?.element;

  // The slot a stop belongs to: its own, or that of the entry holding its block.
  const slotOfStop = (stopId: string) =>
    slotElement(stopId) ?? slotElement(entryIdOfStop(stopId));

  // The block element of `stopId`; undefined on a stop with no blocks.
  const blockOfStop = (stopId: string) => {
    const slot = slots.get(entryIdOfStop(stopId));
    return slot?.blocks.find(
      (_block, index) => blockStopId(slot.entry.id, index) === stopId,
    );
  };

  // The element a stop draws on: its block, else its slot.
  const stopElement = (stopId: string) =>
    blockOfStop(stopId) ?? slotOfStop(stopId);

  // Reads a built or redrawn slot's blocks.
  const holdBlocks = (slot: Slot) => {
    slot.blocks = readBlocks(slot.element, slot.entry);
    blockCounts.set(slot.entry.id, slot.blocks.length);
  };

  // Redraws each user entry of `next` whose slot's input holds another delivery
  // or latest flag than its input now would.
  const redrawChangedUserEntries = (next: readonly ChatEntry[]) => {
    for (const entry of next) {
      const slot = slots.get(entry.id);
      if (slot === undefined || entry.kind !== 'user') {
        continue;
      }
      const input = entryInput(entry, next);
      if (isDeliveryChanged(slot.input, input)) {
        redrawSlot(slot, entry, input, deps);
        holdBlocks(slot);
      }
    }
  };

  // The stop the list ends on: the newest pending row, else the last row's.
  const lastStopId = () =>
    [...queuedSlots.keys()].at(-1) ?? lastRowId(rows, blockCounts);

  const markStop = (stopId: string, mark: 'is-cursor' | 'is-range') => {
    const marked = stopElement(stopId);
    if (marked !== undefined) {
      marked.classList.add(mark);
      markedElements.push(marked);
    }
  };

  const drawMarks = () => {
    for (const marked of markedElements) {
      marked.classList.remove('is-cursor', 'is-range');
    }
    markedElements.length = 0;
    if (focus.anchorId !== null) {
      for (const stopId of rangeStops(focus, order)) {
        markStop(stopId, 'is-range');
      }
    }
    if (focus.stopId !== null) {
      markStop(focus.stopId, 'is-cursor');
    }
  };

  const scrollToBottom = () => {
    list.scrollTop = list.scrollHeight;
    followedTop = list.scrollTop;
  };

  // Whether a `slot` scroll shows the stop itself, rather than the list's bottom.
  const scrollsToStop = (stop: HTMLElement) =>
    !focus.following ||
    isTallerThanBand(stop.getBoundingClientRect(), visibleBand(list));

  // `marks` draws the marks alone and leaves the scroll.
  const drawFocus = (
    scroll: 'follow' | 'slot' | 'bottom' | 'top' | 'marks',
  ) => {
    drawMarks();
    if (scroll === 'marks') {
      return;
    }
    const stop = focus.stopId === null ? undefined : stopElement(focus.stopId);
    if (scroll === 'top') {
      list.scrollTop = 0;
    } else if (scroll === 'slot' && stop !== undefined && scrollsToStop(stop)) {
      stop.scrollIntoView({ block: 'nearest' });
      // `nearest` leaves a stop filling the view where it is, and fires no scroll.
      focus = focusAfterScrollEvent(
        focus,
        focus.following && isScrolledToEnd(list, 1),
      );
    } else if (scroll === 'bottom' || focus.following) {
      scrollToBottom();
    }
  };

  // Runs the live run's part update with the time now, and arms the next tick.
  const runTick = () => {
    tick = null;
    const now = deps.clock.now();
    const live = liveRunSlot(runSlots);
    if (live !== undefined && live.drawn !== null) {
      updatePartSlot(live, { ...live.input, now }, activity);
    }
    tick = deps.timers.set(runTick, TICK_MS);
  };

  // Arms the tick while the session works on its turn, and clears it after.
  const followWorking = () => {
    if (working && tick === null) {
      tick = deps.timers.set(runTick, TICK_MS);
    } else if (!working && tick !== null) {
      deps.timers.clear(tick);
      tick = null;
    }
  };

  const changed = () => {
    rows = listRows(entries, working);
    for (const row of rows) {
      if (row.kind === 'run') {
        putRun(row);
      }
    }
    order = [
      ...cursorStops(rows, openRuns, blockCounts),
      ...queuedSlots.keys(),
    ];
    focus = focusAfterChange(focus, order, lastStopId());
    drawFocus('follow');
    followWorking();
  };

  // Draws `messages` as the pending rows, in order, after the entries.
  const putQueued = (messages: readonly QueuedMessage[]) => {
    const next = new Map<string, QueuedSlot>();
    const skipKey =
      deps.kit.keys.keysFor(chatCommand('interrupt'), chatScope('chat')) ?? '';
    for (const message of messages) {
      const id = queuedStopId(message.id);
      const input = queuedInput(message, skipKey);
      const held = queuedSlots.get(id);
      if (held === undefined) {
        const created = buildQueuedSlot(message, input, queuedPart);
        observeSlot(created.element);
        next.set(id, created);
      } else {
        if (isQueuedChanged(held.input, input)) {
          updatePartSlot(held, input, queuedPart);
        }
        held.message = message;
        next.set(id, held);
      }
    }
    for (const [id, gone] of queuedSlots) {
      if (!next.has(id)) {
        gone.drawn?.dispose();
        slotSizes.unobserve(gone.element);
        gone.element.remove();
      }
    }
    queuedSlots = next;
    list.append(...[...next.values()].map((slot) => slot.element));
  };

  // Draws a run new to the list before its first step's slot, or updates its
  // line when what it shows changed, and shows its step slots while it is
  // open.
  const putRun = (row: RunRow) => {
    const open = openRuns.has(row.runId);
    const input = activityInput(row, open, deps.clock.now());
    const held = runSlots.get(row.runId);
    if (held === undefined) {
      const created = buildRunSlot(row, input, activity, () =>
        toggleRun(row.runId),
      );
      runSlots.set(row.runId, created);
      observeSlot(created.element);
      list.insertBefore(created.element, slotElement(row.steps[0].id) ?? null);
    } else {
      if (isActivityChanged(held.input, input)) {
        updatePartSlot(held, input, activity);
      }
      held.row = row;
    }
    for (const step of row.steps) {
      const stepSlot = slots.get(step.id)?.element;
      stepSlot?.classList.add('chat-step-slot');
      if (stepSlot !== undefined) {
        stepSlot.hidden = !open;
      }
    }
  };

  // Opens run `runId` when closed, else closes it, moving a focus on one of
  // its steps to its line.
  const toggleRun = (runId: string): ToggleResult => {
    const opens = !openRuns.has(runId);
    if (opens) {
      openRuns.add(runId);
    } else {
      openRuns.delete(runId);
      const run = runSlots.get(runId);
      const stepIds = run?.row.steps.map((step) => step.id) ?? [];
      focus = focusAfterClose(focus, runId, stepIds);
    }
    changed();
    return opens ? 'expanded' : 'collapsed';
  };

  const stopAt = (stopId: string): EntryListStop | null => {
    const slot = slots.get(stopId) ?? slots.get(entryIdOfStop(stopId));
    if (slot !== undefined) {
      return { kind: 'entry', entry: slot.entry };
    }
    const run = runSlots.get(stopId);
    if (run !== undefined) {
      return { kind: 'activity', runId: run.row.runId, steps: run.row.steps };
    }
    const queued = queuedSlots.get(stopId);
    return queued === undefined
      ? null
      : { kind: 'queued', message: queued.message };
  };

  const focusedStop = () =>
    focus.stopId === null ? null : stopAt(focus.stopId);

  const followBottom = () => {
    if (focus.following) {
      scrollToBottom();
    }
  };

  // The stop nearest the cursor inside the list's visible band, else, with no
  // stop inside, nearest it overlapping the band; null when the cursor needs no
  // move, or no stop shows.
  const nearestStopInBand = (direction: 1 | -1) => {
    const { stopId } = focus;
    if (stopId === null) {
      return null;
    }
    const band = visibleBand(list);
    const stopsWhere =
      (isInBand: (box: DOMRect, band: Band) => boolean) => (id: string) => {
        const stop = stopElement(id);
        return (
          stop !== undefined && isInBand(stop.getBoundingClientRect(), band)
        );
      };
    return (
      nearestVisibleStop(order, stopId, direction, stopsWhere(isInsideBand)) ??
      nearestVisibleStop(order, stopId, direction, stopsWhere(overlapsBand))
    );
  };

  const isListHidden = () => list.clientHeight === 0;

  // Moves a cursor outside the visible band into it, and follows only at the
  // bottom. A cursor already inside stays, so running it twice moves nothing.
  const settleInBand = (direction: 1 | -1, isAtBottom: boolean) => {
    const nearest = nearestStopInBand(direction);
    if (nearest !== null) {
      focus = focusStop(focus, order, nearest);
    }
    focus = focusAfterScrollEvent(focus, isAtBottom);
    drawFocus('marks');
  };

  const onListScroll = () => {
    const { scrollTop } = list;
    if (isListHidden() || scrollTop === lastScrollTop) {
      return;
    }
    const direction = scrollTop > lastScrollTop ? 1 : -1;
    lastScrollTop = scrollTop;
    const isAtBottom = isScrolledToEnd(list, 1);
    // A scroll event fires a frame after its scroll, so a visual that took its
    // height in between has left the bottom behind with no scroll of the user's.
    const isFollowOvertaken =
      focus.following && scrollTop === followedTop && !isAtBottom;
    if (isFollowOvertaken) {
      scrollToBottom();
      return;
    }
    settleInBand(direction, isAtBottom);
  };
  list.addEventListener('scroll', onListScroll);

  // The stop a click on `target` lands on: its block, else its slot; a slot with
  // blocks has no stop of its own, so `order` refuses its padding.
  const stopIdOfTarget = (target: Element) => {
    const hit = target.closest('.chat-entry-slot');
    const slotId = [...slots, ...runSlots].find(
      ([, slot]) => slot.element === hit,
    )?.[0];
    if (slotId === undefined) {
      return null;
    }
    const block = target.closest<HTMLElement>(BLOCK_SELECTOR);
    const blockIndex =
      block === null ? -1 : (slots.get(slotId)?.blocks.indexOf(block) ?? -1);
    return blockIndex < 0 ? slotId : blockStopId(slotId, blockIndex);
  };

  const onListClick = (event: MouseEvent) => {
    const target = event.target as Element;
    const isSelecting = window.getSelection()?.isCollapsed === false;
    const isOnControl = target.closest(CLICK_CONTROLS) !== null;
    if (isSelecting || isOnControl) {
      return;
    }
    const stopId = stopIdOfTarget(target);
    if (stopId !== null && order.includes(stopId)) {
      focus = focusStop(focus, order, stopId);
      drawFocus('marks');
    }
  };
  list.addEventListener('click', onListClick);

  const listSize = followListSize(list, followBottom);
  const slotSizes = new ResizeObserver(followBottom);
  const observeSlot = (slot: HTMLElement) =>
    slotSizes.observe(slot, { box: 'border-box' });
  list.append(deps.turnLine);
  observeSlot(deps.turnLine);

  return {
    element: list,
    put(entry, next) {
      entries = transcriptEntries(next, activityInTranscript);
      const slot = slots.get(entry.id);
      const isNewSlot =
        slot === undefined && isInTranscript(entry, activityInTranscript);
      if (isNewSlot) {
        const created = buildSlot(entry, entryInput(entry, next), deps);
        holdBlocks(created);
        slots.set(entry.id, created);
        observeSlot(created.element);
        list.insertBefore(created.element, deps.turnLine);
      } else if (slot !== undefined) {
        redrawSlot(slot, entry, entryInput(entry, next), deps);
        holdBlocks(slot);
      }
      if (entry.kind === 'user') {
        redrawChangedUserEntries(next);
      }
      changed();
    },
    rebuild(next) {
      activityInTranscript = isActivityInTranscript(deps.layouts.shown());
      entries = transcriptEntries(next, activityInTranscript);
      const openStates = new Map(
        [...slots].map(([id, slot]) => [id, slot.kit.expanders.openStates()]),
      );
      const queued = [...queuedSlots.values()].map((slot) => slot.message);
      disposeSlots(slots);
      slots.clear();
      blockCounts.clear();
      disposePartSlots(runSlots);
      runSlots.clear();
      disposePartSlots(queuedSlots);
      queuedSlots.clear();
      slotSizes.disconnect();
      list.replaceChildren();
      for (const entry of entries) {
        const created = buildSlot(entry, entryInput(entry, next), deps);
        created.kit.expanders.restore(openStates.get(entry.id) ?? []);
        holdBlocks(created);
        slots.set(entry.id, created);
        observeSlot(created.element);
        list.append(created.element);
      }
      list.append(deps.turnLine);
      observeSlot(deps.turnLine);
      putQueued(queued);
      changed();
    },
    setQueued(queued) {
      putQueued(queued);
      changed();
    },
    setWorking(next) {
      working = next;
      changed();
    },
    move(step) {
      focus = moveFocus(focus, order, step);
      drawFocus('slot');
      return focusedStop();
    },
    moveToMessage(step) {
      focus = moveToMessage(focus, order, messageIds(rows), step);
      drawFocus('slot');
      return focusedStop();
    },
    isAtLastStop: () => isAtLastStop(focus, order),
    latest() {
      focus = focusLatest(lastStopId(), focus.anchorId);
      drawFocus('bottom');
      if (!isListHidden()) {
        settleInBand(1, true);
      }
    },
    first() {
      focus = focusFirst(order, focus.anchorId);
      drawFocus('top');
      return focusedStop();
    },
    toggleRange() {
      focus = toggleAnchor(focus);
      drawFocus('marks');
      return focus.stopId !== null;
    },
    isRangeOpen: () => focus.anchorId !== null,
    cancelRange() {
      const wasOpen = focus.anchorId !== null;
      focus = clearAnchor(focus);
      drawFocus('marks');
      return wasOpen;
    },
    selectedSource() {
      const parts: string[] = [];
      const wholeEntries = new Set<string>();
      for (const stopId of rangeStops(focus, order)) {
        const stop = stopAt(stopId);
        const text = stop === null ? null : stopText(stop);
        const block = blockOfStop(stopId);
        const entryId = entryIdOfStop(stopId);
        if (text === null) {
          continue;
        }
        if (block === undefined) {
          parts.push(text);
        } else if (!isAnyBlockPastText(slots.get(entryId)!.blocks, text)) {
          const [start, end] = linesOfBlock(block);
          parts.push(sourceOfLines(text, start, end));
        } else if (!wholeEntries.has(entryId)) {
          wholeEntries.add(entryId);
          parts.push(text);
        }
      }
      const kept = parts.filter((part) => part.trim() !== '');
      return kept.length === 0
        ? null
        : { text: kept.join('\n\n'), blockCount: kept.length };
    },
    followBottom,
    scrollToFocus() {
      drawFocus(focus.following ? 'bottom' : 'slot');
    },
    scrollBy(step, direction) {
      const scroll = scrollContent(
        list,
        step,
        direction,
        textLineHeightPx(list),
      );
      focus = focusAfterScroll(focus, direction, isScrolledToEnd(list, 1));
      drawFocus('follow');
      return { ...scroll, following: focus.following };
    },
    focused: focusedStop,
    focusedElement: () =>
      focus.stopId === null ? null : (slotOfStop(focus.stopId) ?? null),
    focusedBlock: () =>
      focus.stopId === null ? null : (blockOfStop(focus.stopId) ?? null),
    toggleFocused() {
      const stop = focusedStop();
      if (stop === null || stop.kind === 'queued') {
        return null;
      }
      if (stop.kind === 'activity') {
        return { stop, result: toggleRun(stop.runId) };
      }
      const { expanders } = slots.get(stop.entry.id)!.kit;
      if (expanders.count() === 0) {
        return { stop, result: 'nothing' };
      }
      const opens = expanders.isAnyClosed();
      expanders.setAllOpen(opens);
      return { stop, result: opens ? 'expanded' : 'collapsed' };
    },
    dispose() {
      list.removeEventListener('scroll', onListScroll);
      list.removeEventListener('click', onListClick);
      listSize.disconnect();
      slotSizes.disconnect();
      if (tick !== null) {
        deps.timers.clear(tick);
        tick = null;
      }
      disposeSlots(slots);
      disposePartSlots(runSlots);
      disposePartSlots(queuedSlots);
      openRuns.clear();
    },
  };
}

// Calls `followBottom` each time the list's border box resizes: the window, or
// its tab showing again. A height of 0 is the tab hidden.
function followListSize(
  list: HTMLElement,
  followBottom: () => void,
): ResizeObserver {
  const observer = new ResizeObserver(([observed]) => {
    if (observed.borderBoxSize[0].blockSize === 0) {
      return;
    }
    followBottom();
  });
  observer.observe(list, { box: 'border-box' });
  return observer;
}

function disposeSlots(slots: Map<string, Slot>) {
  for (const slot of slots.values()) {
    slot.dispose();
  }
}

function disposePartSlots(partSlots: Map<string, PartSlot<SlotPartName>>) {
  for (const slot of partSlots.values()) {
    slot.drawn?.dispose();
  }
}

// Whether `entry` gets a slot: steps only while activity shows in the transcript.
function isInTranscript(
  entry: ChatEntry,
  activityInTranscript: boolean,
): boolean {
  return activityInTranscript || !isStep(entry);
}

function transcriptEntries(
  entries: readonly ChatEntry[],
  activityInTranscript: boolean,
): readonly ChatEntry[] {
  return activityInTranscript
    ? entries
    : entries.filter((entry) => isInTranscript(entry, activityInTranscript));
}

// What a layout draws `entry` from: the entry; a result with its turn's step
// count from the session's `entries`, steps out of the transcript included; a
// user entry with whether it is the latest delivery entry.
function entryInput(
  entry: ChatEntry,
  entries: readonly ChatEntry[],
): EntryInput<EntryKind> {
  if (entry.kind === 'result') {
    return { ...entry, stepCount: resultStepCount(entries, entry.id) };
  }
  if (entry.kind === 'user') {
    return {
      ...entry,
      isLatestDelivery: isLatestDeliveryEntry(entry, entries),
    };
  }
  return entry;
}

// Whether `entry` is the last user entry of `entries` holding a delivery.
function isLatestDeliveryEntry(
  entry: ChatEntry,
  entries: readonly ChatEntry[],
): boolean {
  const latest = entries.findLast(
    (held) => held.kind === 'user' && held.delivery !== null,
  );
  return latest?.id === entry.id;
}

function isDeliveryChanged(
  last: EntryInput<EntryKind>,
  next: EntryInput<EntryKind>,
): boolean {
  return (
    last.kind === 'user' &&
    next.kind === 'user' &&
    (last.delivery !== next.delivery ||
      last.isLatestDelivery !== next.isLatestDelivery)
  );
}

// The last stop of the last row the cursor can stop on; a divider after it has
// no stop.
function lastRowId(
  rows: readonly ListRow[],
  blockCounts: ReadonlyMap<string, number>,
): string | null {
  const last = rows.findLast(isCursorRow);
  return last === undefined
    ? null
    : (rowStops(last, blockCounts).at(-1) ?? null);
}

// The ids of the user and assistant entries of `rows`.
function messageIds(rows: readonly ListRow[]): string[] {
  return rows.flatMap((row) =>
    row.kind === 'entry' && isMessage(row.entry) ? [row.entry.id] : [],
  );
}

function isMessage(entry: ChatEntry): boolean {
  return entry.kind === 'user' || entry.kind === 'assistant';
}

// The cursor's blocks of `entry` as drawn into `slot`, in document order; only a
// message has any.
function readBlocks(slot: HTMLElement, entry: ChatEntry): HTMLElement[] {
  return isMessage(entry)
    ? [...slot.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)]
    : [];
}

interface Band {
  top: number;
  bottom: number;
}

// The part of the list's box that shows entries: the composer floats over its
// bottom scroll padding.
function visibleBand(list: HTMLElement): Band {
  const box = list.getBoundingClientRect();
  const padding = parseFloat(getComputedStyle(list).scrollPaddingBottom) || 0;
  return { top: box.top, bottom: box.bottom - padding };
}

function overlapsBand(box: DOMRect, band: Band): boolean {
  return box.bottom > band.top && box.top < band.bottom;
}

function isTallerThanBand(box: DOMRect, band: Band): boolean {
  return box.height > band.bottom - band.top;
}

// Whether a stop shows: wholly in the band, or, too tall to fit, any of it.
function isInsideBand(box: DOMRect, band: Band): boolean {
  if (isTallerThanBand(box, band)) {
    return overlapsBand(box, band);
  }
  return (
    box.top >= band.top - BAND_EDGE_TOLERANCE_PX &&
    box.bottom <= band.bottom + BAND_EDGE_TOLERANCE_PX
  );
}

// The text a copy reads from a stop: a message's or notice's, or a pending row's
// message; null on a stop that gives nothing.
function stopText(stop: EntryListStop): string | null {
  if (stop.kind === 'queued') {
    return stop.message.text;
  }
  if (stop.kind === 'activity') {
    return null;
  }
  const { entry } = stop;
  return entry.kind === 'user' ||
    entry.kind === 'assistant' ||
    entry.kind === 'notice'
    ? entry.text
    : null;
}

// A block's source lines from its mark: zero-based, `end` exclusive.
function linesOfBlock(block: HTMLElement): [start: number, end: number] {
  const [start, end] = block.dataset.mdLines!.split(',').map(Number);
  return [start, end];
}

// Whether a block's lines end past `text`, as when a layout drew a longer text.
function isAnyBlockPastText(
  blocks: readonly HTMLElement[],
  text: string,
): boolean {
  const lineCount = text.split('\n').length;
  return blocks.some((block) => linesOfBlock(block)[1] > lineCount);
}

// The lines `[start, end)` of `text`, less trailing blank lines.
export function sourceOfLines(
  text: string,
  start: number,
  end: number,
): string {
  const lines = text.split('\n').slice(start, end);
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  return lines.join('\n');
}

function liveRunSlot(runSlots: Map<string, RunSlot>): RunSlot | undefined {
  return [...runSlots.values()].find((run) => run.row.live);
}

function activityInput(row: RunRow, open: boolean, now: number): ActivityInput {
  return {
    steps: row.steps,
    current: row.steps[row.steps.length - 1],
    live: row.live,
    open,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    now,
  };
}

// Whether a line drawn with `last` shows something else with `next`: any
// step replaced, added or gone, or the run's state or times. `now` changes
// only on a tick.
function isActivityChanged(last: ActivityInput, next: ActivityInput): boolean {
  return (
    isStepsChanged(last.steps, next.steps) ||
    last.live !== next.live ||
    last.open !== next.open ||
    last.startedAt !== next.startedAt ||
    last.endedAt !== next.endedAt
  );
}

// A run's slot, its line drawn, a click on it running `toggle`.
function buildRunSlot(
  row: RunRow,
  input: ActivityInput,
  activity: SlotPartDraws<'activity'>,
  toggle: () => void,
): RunSlot {
  const slot = element('li', 'chat-entry-slot chat-activity-slot');
  slot.addEventListener('click', toggle);
  return {
    element: slot,
    row,
    input,
    drawn: drawSlotPart(slot, input, activity),
  };
}

// The cursor stop a pending row is drawn as.
function queuedStopId(queuedId: string): string {
  return `queued:${queuedId}`;
}

function queuedInput(
  message: QueuedMessage,
  skipKey: string,
): QueuedMessageInput {
  return {
    text: message.text,
    imageCount: message.images.length,
    sent: message.sentEntryId !== null,
    holdReason: message.holdReason,
    skipKey,
  };
}

function isQueuedChanged(
  last: QueuedMessageInput,
  next: QueuedMessageInput,
): boolean {
  return (
    last.text !== next.text ||
    last.imageCount !== next.imageCount ||
    last.sent !== next.sent ||
    last.holdReason !== next.holdReason ||
    last.skipKey !== next.skipKey
  );
}

// A pending row's slot, its row drawn, a click on it pulling the message
// back; main refuses a row already sent.
function buildQueuedSlot(
  message: QueuedMessage,
  input: QueuedMessageInput,
  queuedPart: SlotPartDraws<'queuedMessage'>,
): QueuedSlot {
  const slot = element('li', 'chat-entry-slot chat-queued-slot');
  slot.addEventListener('click', () => queuedPart.deps.pullBack(message.id));
  return {
    element: slot,
    message,
    input,
    drawn: drawSlotPart(slot, input, queuedPart),
  };
}

// Runs the slot's part update with `input`; a slot whose part has no update,
// or whose update threw, or that holds the bare line, is drawn again.
function updatePartSlot<K extends SlotPartName>(
  slot: PartSlot<K>,
  input: SlotPartInputs[K],
  part: SlotPartDraws<K>,
) {
  slot.input = input;
  const result =
    slot.drawn === null ? 'none' : part.draws.update(slot.drawn, input);
  if (result === 'ran') {
    return;
  }
  slot.drawn?.dispose();
  slot.element.replaceChildren();
  slot.drawn = drawSlotPart(slot.element, input, part);
}

// The part drawn into `slot` with the user's layout when it defines the
// part, else with `default`; a default that fails is logged and leaves a
// bare line naming the part, null.
function drawSlotPart<K extends SlotPartName>(
  slot: HTMLElement,
  input: SlotPartInputs[K],
  { part, draws, deps }: SlotPartDraws<K>,
): DrawnPart<BuiltSlotPart<K>> | null {
  try {
    return draws.draw(slot, (builder, parent, rollback) => {
      const kit = surfaceBaseKit(deps.kit, 'chat', rollback);
      // TypeScript cannot narrow the builder to the part's own input.
      const build = builder as SlotPartBuilder<K>;
      const view = build(parent, input, kit);
      return { element: view.element, view };
    });
  } catch (error) {
    deps.log(`default layout ${part} failed: ${errorText(error)}`);
    slot.append(element('div', 'chat-entry chat-raw', part));
    return null;
  }
}

function buildSlot(
  entry: ChatEntry,
  input: EntryInput<EntryKind>,
  deps: EntryListDeps,
): Slot {
  const slot = element('li', 'chat-entry-slot');
  return {
    element: slot,
    entry,
    input,
    ...drawEntry(slot, entry, input, deps, false),
    drawsWithDefault: false,
    blocks: [],
  };
}

// A view with an update runs it after the kit's own parts updated; a view
// with none is drawn again, its new expanders opening as the old ones were.
// An update that throws from a user layout or a live default is logged, and
// the slot is drawn with the bundled default layout from then on; the bundled
// default's is logged and the entry drawn again.
function redrawSlot(
  slot: Slot,
  entry: ChatEntry,
  input: EntryInput<EntryKind>,
  deps: EntryListDeps,
) {
  slot.entry = entry;
  slot.input = input;
  slot.kit.update(entry);
  const { view } = slot;
  if (view?.update !== undefined) {
    try {
      view.update(input);
      return;
    } catch (error) {
      if (slot.isBundledView) {
        deps.log(
          `default layout ${entry.kind} entry update failed: ${errorText(error)}`,
        );
      } else {
        const { name } = pickEntry(deps.layouts.shown(), entry.kind);
        deps.log(
          `layout ${name} ${entry.kind} entry update failed: ${errorText(error)}`,
        );
        slot.drawsWithDefault = true;
      }
    }
  }
  const openStates = slot.kit.expanders.openStates();
  slot.dispose();
  slot.element.replaceChildren();
  const drawn = drawEntry(
    slot.element,
    entry,
    input,
    deps,
    slot.drawsWithDefault,
  );
  drawn.kit.expanders.restore(openStates);
  slot.view = drawn.view;
  slot.kit = drawn.kit;
  slot.isDefaultView = drawn.isDefaultView;
  slot.isBundledView = drawn.isBundledView;
  slot.isBareLine = drawn.isBareLine;
  slot.dispose = drawn.dispose;
}

// The entry drawn into `slot`, and, when the kind's shown layout did not draw
// it, a toast once per kind naming what drew it: the default layout, or a
// bare line.
function drawEntry(
  slot: HTMLElement,
  entry: ChatEntry,
  input: EntryInput<EntryKind>,
  deps: EntryListDeps,
  drawsWithDefault: boolean,
): DrawnEntry {
  const drawn = buildEntry(slot, entry, input, deps, drawsWithDefault);
  const { name } = pickEntry(deps.layouts.shown(), entry.kind);
  const isFallback = name !== DEFAULT_ENTRY_PICK.name && drawn.isDefaultView;
  if (drawn.isBareLine) {
    toastKindOnce(
      entry.kind,
      deps,
      `Chat layout ${name}: ${entry.kind} entries drawn as bare lines`,
    );
  } else if (isFallback) {
    toastKindOnce(
      entry.kind,
      deps,
      `Chat layout ${name}: ${entry.kind} entries drawn with default`,
    );
  }
  return drawn;
}

// The entry drawn into `slot` through the page host, with the user's layout
// when it defines the kind, unless `drawsWithDefault`; the host logs a user
// builder's failure and draws with the default layout. A default builder that
// fails is logged and leaves a bare line naming the kind.
function buildEntry(
  slot: HTMLElement,
  entry: ChatEntry,
  input: EntryInput<EntryKind>,
  deps: EntryListDeps,
  drawsWithDefault: boolean,
): DrawnEntry {
  const pick = drawsWithDefault
    ? DEFAULT_ENTRY_PICK
    : pickEntry(deps.layouts.shown(), entry.kind);
  try {
    const drawn = drawPart<ChatLayout, AnyBuilder, BuiltEntry>({
      owner: 'chat',
      parent: slot,
      pick,
      defaultLayout,
      // TypeScript cannot narrow the builder to the entry's own kind.
      part: (layout) => layout.entries?.[entry.kind] as AnyBuilder | undefined,
      build(builder, parent, rollback) {
        const kit = createEntryKit(entry, deps.kit);
        rollback.recordBox(() => kit.dispose());
        const view = builder(parent, input, kit.kit);
        return { element: view.element, view, kit };
      },
      log: deps.log,
      partName: `${entry.kind} entry`,
    });
    return {
      view: drawn.built.view,
      kit: drawn.built.kit,
      isDefaultView: drawn.layoutName === DEFAULT_ENTRY_PICK.name,
      isBundledView: !drawn.drewPick || pick.layout === defaultLayout,
      isBareLine: false,
      dispose: drawn.dispose,
    };
  } catch (error) {
    deps.log(`default layout ${entry.kind} entry failed: ${errorText(error)}`);
    slot.append(element('div', 'chat-entry chat-raw', entry.kind));
    const kit = createEntryKit(entry, deps.kit);
    return {
      view: null,
      kit,
      isDefaultView: true,
      isBundledView: true,
      isBareLine: true,
      dispose: () => kit.dispose(),
    };
  }
}

function toastKindOnce(
  kind: ChatEntryKind,
  deps: Pick<EntryListDeps, 'toastedKinds' | 'toast'>,
  text: string,
) {
  if (!deps.toastedKinds.has(kind)) {
    deps.toastedKinds.add(kind);
    deps.toast(text, 'error');
  }
}
