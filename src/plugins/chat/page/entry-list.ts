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
import defaultLayout from '../layouts/default/layout.js';
import type {
  ActivityInput,
  ChatLayout,
  EntryBuilder,
  EntryKind,
  EntryView,
  PartView,
} from '../layouts/layout';
import {
  cursorStops,
  type ListRow,
  type ListStop,
  listRows,
} from './activity-runs';
import { createEntryKit, type EntryKit, type KitDeps } from './chat-kit';
import {
  type ChatLayouts,
  type ChatPartDraws,
  chatPartDraws,
  DEFAULT_ENTRY_PICK,
  pickEntry,
  surfaceBaseKit,
} from './chat-layouts';
import {
  type EntryFocus,
  focusAfterChange,
  focusAfterClose,
  focusAfterScroll,
  focusFirst,
  focusLatest,
  moveFocus,
  START_FOCUS,
} from './entry-focus';

// `layouts` are the ones every session's entries and activity lines are
// built with; `toastedKinds` the kinds whose failed draw has toasted since
// they were shown, shared by every session's list. `timers` and `clock` tick
// a live activity line's time.
export interface EntryListDeps {
  layouts: ChatLayouts;
  toastedKinds: Set<ChatEntryKind>;
  kit: KitDeps;
  log: Log;
  toast(text: string, tone: ToastTone): void;
  timers: Timers;
  clock: Clock;
}

export type ToggleResult = 'expanded' | 'collapsed' | 'nothing';

// A scroll, and whether the list follows the latest entry after it.
export interface TranscriptScroll extends ContentScroll {
  following: boolean;
}

// One session's entries, one slot per entry in the session's order, each run
// of steps also drawn as one activity line slot right before its first step's
// slot; a closed run's step slots are hidden. The cursor stops on each entry
// and activity line, and on each step of an open run; the focused stop's slot
// is marked `is-cursor`. After every change, and whenever the list's own box
// resizes, a following focus scrolls the list to its bottom; a hidden list
// does not scroll, so its tab calls `scrollToFocus` each time it shows. While
// a live run is drawn its line's time ticks once a second.
export interface EntryList {
  element: HTMLOListElement;
  // Builds an entry new to the list, or redraws the one holding its id;
  // `entries` is the session's list after the change.
  put(entry: ChatEntry, entries: readonly ChatEntry[]): void;
  // Builds every entry again with the shown layouts, keeping the focus, each
  // entry's open expanders by id and each run's open state.
  rebuild(entries: readonly ChatEntry[]): void;
  // Whether the session works on its turn: only then is a last run live.
  setWorking(working: boolean): void;
  // The focused stop after the move; null with no entries.
  move(step: 1 | -1): ListStop | null;
  // Follows the latest stop and scrolls to the bottom.
  latest(): void;
  // Focuses the first stop and scrolls to the top; the focused stop, null
  // with no entries.
  first(): ListStop | null;
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
  focused(): ListStop | null;
  // On an activity line, opens the run when it is closed, else closes it. On
  // an entry, opens every expander when any is closed, else closes them all.
  // Null with no focused stop.
  toggleFocused(): { stop: ListStop; result: ToggleResult } | null;
  // Stops following the list's size and the tick, disposes every entry's kit
  // and every activity line, and forgets the open runs; the list's owner
  // calls it when it drops the list.
  dispose(): void;
}

// One entry as drawn into its slot: the view the layout returned (null for
// the bare line), the kit made for it, and the dispose of what the draw
// recorded, which disposes the kit. `isDefaultView` holds while the view is
// the default layout's or the bare line; `isBareLine` while it is the bare
// line.
interface DrawnEntry {
  view: EntryView | null;
  kit: EntryKit;
  isDefaultView: boolean;
  isBareLine: boolean;
  dispose(): void;
}

// One drawn entry and its slot. `drawsWithDefault` holds once a user
// layout's update has thrown, and the slot is drawn with the default layout
// from then on.
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

type BuiltActivity = { element: HTMLElement; view: PartView<ActivityInput> };

// One run's activity line slot: the run as last listed, the input its part
// last drew or updated with, and the drawn part, null while the slot holds
// the bare line.
interface RunSlot {
  element: HTMLLIElement;
  row: RunRow;
  input: ActivityInput;
  drawn: DrawnPart<BuiltActivity> | null;
}

// What drawing an activity line needs from the list.
interface ActivityDraws {
  draws: ChatPartDraws<'activity'>;
  deps: EntryListDeps;
}

const TICK_MS = 1000;

export function createEntryList(deps: EntryListDeps): EntryList {
  const list = element('ol', 'chat-entries');
  const slots = new Map<string, Slot>();
  const runSlots = new Map<string, RunSlot>();
  const openRuns = new Set<string>();
  const activity: ActivityDraws = {
    draws: chatPartDraws(deps.layouts, 'activity', deps.log),
    deps,
  };
  let entries: readonly ChatEntry[] = [];
  let working = false;
  let rows: ListRow[] = [];
  let order: string[] = [];
  let focus: EntryFocus = START_FOCUS;
  let tick: number | null = null;

  const slotElement = (id: string) =>
    slots.get(id)?.element ?? runSlots.get(id)?.element;

  const drawFocus = (scroll: 'follow' | 'slot' | 'bottom' | 'top') => {
    for (const [id, slot] of [...slots, ...runSlots]) {
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

  // Runs the live run's part update with the time now, and arms the next
  // tick.
  const runTick = () => {
    tick = null;
    const live = liveRunSlot(runSlots);
    if (live === undefined) {
      return;
    }
    if (live.drawn !== null) {
      updateRunSlot(live, { ...live.input, now: deps.clock.now() }, activity);
    }
    tick = deps.timers.set(runTick, TICK_MS);
  };

  const followLiveRun = () => {
    const hasLive = rows.some((row) => row.kind === 'run' && row.live);
    if (hasLive && tick === null) {
      tick = deps.timers.set(runTick, TICK_MS);
    } else if (!hasLive && tick !== null) {
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
    order = cursorStops(rows, openRuns);
    focus = focusAfterChange(focus, order);
    drawFocus('follow');
    followLiveRun();
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
      list.insertBefore(created.element, slotElement(row.steps[0].id) ?? null);
    } else {
      if (isActivityChanged(held.input, input)) {
        updateRunSlot(held, input, activity);
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

  const focusedStop = (): ListStop | null => {
    if (focus.entryId === null) {
      return null;
    }
    const slot = slots.get(focus.entryId);
    if (slot !== undefined) {
      return { kind: 'entry', entry: slot.entry };
    }
    const run = runSlots.get(focus.entryId);
    return run === undefined
      ? null
      : { kind: 'activity', runId: run.row.runId, steps: run.row.steps };
  };

  const followBottom = () => {
    if (focus.following) {
      list.scrollTop = list.scrollHeight;
    }
  };
  const listSize = followListSize(list, followBottom);

  return {
    element: list,
    put(entry, next) {
      entries = next;
      const slot = slots.get(entry.id);
      if (slot === undefined) {
        const created = buildSlot(entry, deps);
        slots.set(entry.id, created);
        list.append(created.element);
      } else {
        redrawSlot(slot, entry, deps);
      }
      changed();
    },
    rebuild(next) {
      entries = next;
      const openStates = new Map(
        [...slots].map(([id, slot]) => [id, slot.kit.expanders.openStates()]),
      );
      disposeSlots(slots);
      slots.clear();
      disposeRunSlots(runSlots);
      runSlots.clear();
      list.replaceChildren();
      for (const entry of next) {
        const created = buildSlot(entry, deps);
        created.kit.expanders.restore(openStates.get(entry.id) ?? []);
        slots.set(entry.id, created);
        list.append(created.element);
      }
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
    latest() {
      focus = focusLatest(order);
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
    toggleFocused() {
      const stop = focusedStop();
      if (stop === null) {
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
      listSize.disconnect();
      if (tick !== null) {
        deps.timers.clear(tick);
        tick = null;
      }
      disposeSlots(slots);
      disposeRunSlots(runSlots);
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

function disposeRunSlots(runSlots: Map<string, RunSlot>) {
  for (const run of runSlots.values()) {
    run.drawn?.dispose();
  }
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
  const isStepsChanged =
    last.steps.length !== next.steps.length ||
    last.steps.some((step, index) => step !== next.steps[index]);
  return (
    isStepsChanged ||
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
  activity: ActivityDraws,
  toggle: () => void,
): RunSlot {
  const slot = element('li', 'chat-entry-slot chat-activity-slot');
  slot.addEventListener('click', toggle);
  return {
    element: slot,
    row,
    input,
    drawn: drawActivity(slot, input, activity),
  };
}

// Runs the line's update with `input`; a line whose part has no update, or
// whose update threw, or that is the bare line, is drawn again.
function updateRunSlot(
  run: RunSlot,
  input: ActivityInput,
  activity: ActivityDraws,
) {
  run.input = input;
  const result =
    run.drawn === null ? 'none' : activity.draws.update(run.drawn, input);
  if (result === 'ran') {
    return;
  }
  run.drawn?.dispose();
  run.element.replaceChildren();
  run.drawn = drawActivity(run.element, input, activity);
}

// The line drawn into `slot` with the user's layout when it defines the
// part, else with `default`; a default that fails is logged and leaves a
// bare line, null.
function drawActivity(
  slot: HTMLElement,
  input: ActivityInput,
  { draws, deps }: ActivityDraws,
): DrawnPart<BuiltActivity> | null {
  try {
    return draws.draw(slot, (builder, parent, rollback) => {
      const kit = surfaceBaseKit(deps.kit, 'chat', rollback);
      const view = builder(parent, input, kit);
      return { element: view.element, view };
    });
  } catch (error) {
    deps.log('chat', `default layout activity failed: ${errorText(error)}`);
    slot.append(element('div', 'chat-entry chat-raw', 'activity'));
    return null;
  }
}

function buildSlot(entry: ChatEntry, deps: EntryListDeps): Slot {
  const slot = element('li', 'chat-entry-slot');
  return {
    element: slot,
    entry,
    ...drawEntry(slot, entry, deps, false),
    drawsWithDefault: false,
  };
}

// A view with an update runs it after the kit's own parts updated; a view
// with none is drawn again, its new expanders opening as the old ones were.
// A user layout's update that throws is logged, and the slot is drawn with
// the default layout from then on; the default layout's is logged and the
// entry drawn again.
function redrawSlot(slot: Slot, entry: ChatEntry, deps: EntryListDeps) {
  slot.entry = entry;
  slot.kit.update(entry);
  const { view } = slot;
  if (view?.update !== undefined) {
    try {
      view.update(entry);
      return;
    } catch (error) {
      if (slot.isDefaultView) {
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
  const drawn = drawEntry(slot.element, entry, deps, slot.drawsWithDefault);
  drawn.kit.expanders.restore(openStates);
  slot.view = drawn.view;
  slot.kit = drawn.kit;
  slot.isDefaultView = drawn.isDefaultView;
  slot.isBareLine = drawn.isBareLine;
  slot.dispose = drawn.dispose;
}

// The entry drawn into `slot`, and, when the kind's shown layout did not draw
// it, a toast once per kind naming what drew it: the default layout, or a
// bare line.
function drawEntry(
  slot: HTMLElement,
  entry: ChatEntry,
  deps: EntryListDeps,
  drawsWithDefault: boolean,
): DrawnEntry {
  const drawn = buildEntry(slot, entry, deps, drawsWithDefault);
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
        const view = builder(parent, entry, kit.kit);
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
