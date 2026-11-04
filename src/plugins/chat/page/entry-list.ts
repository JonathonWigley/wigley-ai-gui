import type { Clock, Timers } from '../../../contracts/ambient';
import type { ChatEntry, ChatEntryKind } from '../../../contracts/agent';
import type { Log } from '../../../contracts/log';
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
  isStep,
  isStepsChanged,
  type ListRow,
  type ListStop,
  listRows,
  rowId,
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
  type EntryFocus,
  focusAfterChange,
  focusAfterClose,
  focusAfterScroll,
  focusAfterScrollEvent,
  focusFirst,
  focusLatest,
  isAtLastStop,
  moveFocus,
  START_FOCUS,
} from './entry-focus';
import { resultStepCount } from './working-turn';

// `layouts` are the ones every session's entries, activity lines and pending
// rows are built with, and say whether runs, steps and results show at all;
// `toastedKinds` the kinds whose failed draw has toasted since they were
// shown, shared by every session's list. `timers` and `clock` tick a live
// activity line's time. `pullBack` is what a click on a pending row calls
// with its message's id.
export interface EntryListDeps {
  layouts: ChatLayouts;
  toastedKinds: Set<ChatEntryKind>;
  kit: KitDeps;
  log: Log;
  toast(text: string, tone: ToastTone): void;
  timers: Timers;
  clock: Clock;
  pullBack(queuedId: string): void;
}

export type ToggleResult = 'expanded' | 'collapsed' | 'nothing';

// One place the entry cursor can stop: an entry, a run's activity line, or a
// pending row.
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
// or stopped on; the flag is read when the list is created and at each rebuild. The session's queued messages follow
// the last entry as pending rows, oldest first. The cursor stops on each
// entry and activity line, on each step of an open run, then on each pending
// row; the focused stop's slot is marked `is-cursor`. A following focus moves
// to the latest stop as the list changes, except one on the last row's
// activity line, which stays on it while the run is open and grows and no
// pending row follows it. After every change, and whenever the list's own box
// or any slot's box resizes, a following focus scrolls the list to its bottom;
// a hidden list does not scroll, so its tab calls `scrollToFocus` each time it
// shows. Any scroll of a shown list (wheel, trackpad, scrollbar or keys) that
// comes to rest off the bottom stops following, and one that lands on the
// bottom follows again.
// While the session works on its turn, the live run's line time ticks once a
// second.
export interface EntryList {
  element: HTMLOListElement;
  // Builds an entry new to the list that shows, or redraws the one holding
  // its id; `entries` is the session's list after the change.
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
  // The focused stop after the move; null with no stops.
  move(step: 1 | -1): EntryListStop | null;
  // Whether `move(1)` has no stop left to move to: no stops, or the focus on
  // the last stop in cursor order (the newest pending row, else the last row's
  // last stop: an open last run's last step).
  isAtLastStop(): boolean;
  // Follows the last row, the newest pending row, else an entry or a run's
  // line whether the run is open or not, and scrolls to the bottom.
  latest(): void;
  // Focuses the first stop and scrolls to the top; the focused stop, null
  // with no stops.
  first(): EntryListStop | null;
  // Scrolls to the bottom while following, else leaves the scroll alone.
  followBottom(): void;
  // Scrolls to the bottom while following, else brings the focused stop
  // into view.
  scrollToFocus(): void;
  // Scrolls the list by `step`. Scrolling up off the bottom
  // stops following, so entries that arrive leave the scroll alone; scrolling
  // down onto the bottom (within 1px) follows the latest stop again. The
  // focused stop stays either way.
  scrollBy(step: ScrollStep, direction: 1 | -1): TranscriptScroll;
  // The focused stop; null with no focused stop.
  focused(): EntryListStop | null;
  // The focused stop's slot element; null with no focused stop.
  focusedElement(): HTMLElement | null;
  // On an activity line, opens the run when it is closed, else closes it. On
  // an entry, opens every expander when any is closed, else closes them all.
  // Null with no focused stop, or on a pending row, which toggles nothing.
  toggleFocused(): { stop: ListStop; result: ToggleResult } | null;
  // Stops following the list's size and the tick, disposes every entry's kit,
  // every activity line and every pending row, and forgets the open runs; the
  // list's owner calls it when it drops the list.
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
// with the bundled default layout from then on.
interface Slot extends DrawnEntry {
  element: HTMLLIElement;
  entry: ChatEntry;
  drawsWithDefault: boolean;
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

export function createEntryList(deps: EntryListDeps): EntryList {
  const list = element('ol', 'chat-entries');
  const slots = new Map<string, Slot>();
  const runSlots = new Map<string, RunSlot>();
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

  const slotElement = (id: string) =>
    slots.get(id)?.element ??
    runSlots.get(id)?.element ??
    queuedSlots.get(id)?.element;

  // Where a new entry slot goes: before the first pending row, else last.
  const entryPlace = () => [...queuedSlots.values()].at(0)?.element ?? null;

  // The stop the list ends on: the newest pending row, else the last row's.
  const lastStopId = () => [...queuedSlots.keys()].at(-1) ?? lastRowId(rows);

  const drawFocus = (scroll: 'follow' | 'slot' | 'bottom' | 'top') => {
    for (const [id, slot] of [...slots, ...runSlots, ...queuedSlots]) {
      slot.element.classList.toggle('is-cursor', id === focus.entryId);
    }
    const isBottom = scroll === 'bottom' || focus.following;
    if (scroll === 'top') {
      list.scrollTop = 0;
    } else if (scroll === 'slot' && focus.entryId !== null) {
      slotElement(focus.entryId)?.scrollIntoView({ block: 'nearest' });
    } else if (isBottom) {
      list.scrollTop = list.scrollHeight;
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
    order = [...cursorStops(rows, openRuns), ...queuedSlots.keys()];
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

  const focusedStop = (): EntryListStop | null => {
    if (focus.entryId === null) {
      return null;
    }
    const slot = slots.get(focus.entryId);
    if (slot !== undefined) {
      return { kind: 'entry', entry: slot.entry };
    }
    const run = runSlots.get(focus.entryId);
    if (run !== undefined) {
      return { kind: 'activity', runId: run.row.runId, steps: run.row.steps };
    }
    const queued = queuedSlots.get(focus.entryId);
    return queued === undefined
      ? null
      : { kind: 'queued', message: queued.message };
  };

  const followBottom = () => {
    if (focus.following) {
      list.scrollTop = list.scrollHeight;
    }
  };
  const onListScroll = () => {
    const isHidden = list.clientHeight === 0;
    if (!isHidden) {
      focus = focusAfterScrollEvent(focus, isScrolledToEnd(list, 1));
    }
  };
  list.addEventListener('scroll', onListScroll);
  const listSize = followListSize(list, followBottom);
  const slotSizes = new ResizeObserver(followBottom);
  const observeSlot = (slot: HTMLElement) =>
    slotSizes.observe(slot, { box: 'border-box' });

  return {
    element: list,
    put(entry, next) {
      entries = transcriptEntries(next, activityInTranscript);
      const slot = slots.get(entry.id);
      const isNewSlot =
        slot === undefined && isInTranscript(entry, activityInTranscript);
      if (isNewSlot) {
        const created = buildSlot(entry, entryInput(entry, next), deps);
        slots.set(entry.id, created);
        observeSlot(created.element);
        list.insertBefore(created.element, entryPlace());
      } else if (slot !== undefined) {
        redrawSlot(slot, entry, entryInput(entry, next), deps);
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
      disposePartSlots(runSlots);
      runSlots.clear();
      disposePartSlots(queuedSlots);
      queuedSlots.clear();
      slotSizes.disconnect();
      list.replaceChildren();
      for (const entry of entries) {
        const created = buildSlot(entry, entryInput(entry, next), deps);
        created.kit.expanders.restore(openStates.get(entry.id) ?? []);
        slots.set(entry.id, created);
        observeSlot(created.element);
        list.append(created.element);
      }
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
    isAtLastStop: () => isAtLastStop(focus, order),
    latest() {
      focus = focusLatest(lastStopId());
      drawFocus('bottom');
    },
    first() {
      focus = focusFirst(order);
      drawFocus('top');
      return focusedStop();
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
      focus.entryId === null ? null : (slotElement(focus.entryId) ?? null),
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

// What a layout draws `entry` from: the entry, a result with its turn's step
// count from the session's `entries`, steps out of the transcript included.
function entryInput(
  entry: ChatEntry,
  entries: readonly ChatEntry[],
): EntryInput<EntryKind> {
  return entry.kind === 'result'
    ? { ...entry, stepCount: resultStepCount(entries, entry.id) }
    : entry;
}

function lastRowId(rows: readonly ListRow[]): string | null {
  const last = rows.at(-1);
  return last === undefined ? null : rowId(last);
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
    deps.log('chat', `default layout ${part} failed: ${errorText(error)}`);
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
    ...drawEntry(slot, entry, input, deps, false),
    drawsWithDefault: false,
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
  slot.kit.update(entry);
  const { view } = slot;
  if (view?.update !== undefined) {
    try {
      view.update(input);
      return;
    } catch (error) {
      if (slot.isBundledView) {
        deps.log(
          'chat',
          `default layout ${entry.kind} entry update failed: ${errorText(error)}`,
        );
      } else {
        const { name } = pickEntry(deps.layouts.shown(), entry.kind);
        deps.log(
          'chat',
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
      logSource: 'chat',
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
    deps.log(
      'chat',
      `default layout ${entry.kind} entry failed: ${errorText(error)}`,
    );
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
