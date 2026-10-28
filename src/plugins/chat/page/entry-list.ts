import type { ChatEntry, ChatEntryKind } from '../../../contracts/agent';
import type { Log } from '../../../contracts/log';
import type { ContentScroll, ScrollStep } from '../../../contracts/editor';
import type { ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { drawPart } from '../../../shared/page/layout-host/draw-part';
import { textLineHeightPx } from '../../../shared/page/text-line';
import { isScrolledToEnd, scrollContent } from '../../../shared/content-scroll';
import defaultLayout from '../layouts/default/layout.js';
import type {
  ChatLayout,
  EntryBuilder,
  EntryKind,
  EntryView,
} from '../layouts/layout';
import { createEntryKit, type EntryKit, type KitDeps } from './chat-kit';
import {
  type ChatLayouts,
  DEFAULT_ENTRY_PICK,
  pickEntry,
} from './chat-layouts';
import {
  type EntryFocus,
  focusAfterChange,
  focusAfterScroll,
  focusFirst,
  focusLatest,
  moveFocus,
  START_FOCUS,
} from './entry-focus';

// `layouts` are the ones every session's entries are built with;
// `toastedKinds` the kinds whose failed draw has toasted since they were
// shown, shared by every session's list.
export interface EntryListDeps {
  layouts: Pick<ChatLayouts, 'shown'>;
  toastedKinds: Set<ChatEntryKind>;
  kit: KitDeps;
  log: Log;
  toast(text: string, tone: ToastTone): void;
}

export type ToggleResult = 'expanded' | 'collapsed' | 'nothing';

// A scroll, and whether the list follows the latest entry after it.
export interface TranscriptScroll extends ContentScroll {
  following: boolean;
}

// One session's entries, one slot per entry in the session's order, the
// focused slot marked `is-cursor`. After every change, and whenever the
// list's own box resizes, a following focus scrolls the list to its bottom; a
// hidden list does not scroll, so its tab calls `scrollToFocus` each time it
// shows.
export interface EntryList {
  element: HTMLOListElement;
  // Builds an entry new to the list, or redraws the one holding its id;
  // `entries` is the session's list after the change.
  put(entry: ChatEntry, entries: readonly ChatEntry[]): void;
  // Builds every entry again with the shown layouts, keeping the focus and each
  // entry's open expanders by id.
  rebuild(entries: readonly ChatEntry[]): void;
  // The focused entry after the move; null with no entries.
  move(step: 1 | -1): ChatEntry | null;
  // Follows the latest entry and scrolls to the bottom.
  latest(): void;
  // Focuses the first entry and scrolls to the top; the focused entry, null
  // with no entries.
  first(): ChatEntry | null;
  // Scrolls to the bottom while following, else leaves the scroll alone.
  followBottom(): void;
  // Scrolls to the bottom while following, else brings the focused entry
  // into view.
  scrollToFocus(): void;
  // Scrolls the list by `step`. Scrolling up off the bottom
  // stops following, so entries that arrive leave the scroll alone; scrolling
  // down onto the bottom (within 1px) follows the latest entry again. The
  // focused entry stays either way.
  scrollBy(step: ScrollStep, direction: 1 | -1): TranscriptScroll;
  // The focused entry; null with no focused entry.
  focused(): ChatEntry | null;
  // Opens every expander of the focused entry when any is closed, else
  // closes them all; null with no focused entry.
  toggleFocused(): { entry: ChatEntry; result: ToggleResult } | null;
  // Stops following the list's size and disposes every entry's kit; the
  // list's owner calls it when it drops the list.
  dispose(): void;
}

// One entry as drawn into its slot: the view the layout returned (null for
// the bare line), the kit made for it, and the dispose of what the draw
// recorded, which disposes the kit. `isDefaultView` holds while the view is
// the default layout's (or the bare line).
interface DrawnEntry {
  view: EntryView | null;
  kit: EntryKit;
  isDefaultView: boolean;
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

export function createEntryList(deps: EntryListDeps): EntryList {
  const list = element('ol', 'chat-entries');
  const slots = new Map<string, Slot>();
  let order: string[] = [];
  let focus: EntryFocus = START_FOCUS;

  const drawFocus = (scroll: 'follow' | 'slot' | 'bottom' | 'top') => {
    for (const [id, slot] of slots) {
      slot.element.classList.toggle('is-cursor', id === focus.entryId);
    }
    const isBottom = scroll === 'bottom' || focus.following;
    if (scroll === 'top') {
      list.scrollTop = 0;
    } else if (scroll === 'slot' && focus.entryId !== null) {
      slots.get(focus.entryId)?.element.scrollIntoView({ block: 'nearest' });
    } else if (isBottom) {
      list.scrollTop = list.scrollHeight;
    }
  };

  const changed = (entries: readonly ChatEntry[]) => {
    order = entries.map((entry) => entry.id);
    focus = focusAfterChange(focus, order);
    drawFocus('follow');
  };

  const followBottom = () => {
    if (focus.following) {
      list.scrollTop = list.scrollHeight;
    }
  };
  const listSize = followListSize(list, followBottom);

  return {
    element: list,
    put(entry, entries) {
      const slot = slots.get(entry.id);
      if (slot === undefined) {
        const created = buildSlot(entry, deps);
        slots.set(entry.id, created);
        list.append(created.element);
      } else {
        redrawSlot(slot, entry, deps);
      }
      changed(entries);
    },
    rebuild(entries) {
      const openStates = new Map(
        [...slots].map(([id, slot]) => [id, slot.kit.expanders.openStates()]),
      );
      disposeSlots(slots);
      slots.clear();
      list.replaceChildren();
      for (const entry of entries) {
        const created = buildSlot(entry, deps);
        created.kit.expanders.restore(openStates.get(entry.id) ?? []);
        slots.set(entry.id, created);
        list.append(created.element);
      }
      changed(entries);
    },
    move(step) {
      focus = moveFocus(focus, order, step);
      drawFocus('slot');
      return focusedEntry(focus, slots);
    },
    latest() {
      focus = focusLatest(order);
      drawFocus('bottom');
    },
    first() {
      focus = focusFirst(order);
      drawFocus('top');
      return focusedEntry(focus, slots);
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
    focused: () => focusedEntry(focus, slots),
    toggleFocused() {
      const slot =
        focus.entryId === null ? undefined : slots.get(focus.entryId);
      if (slot === undefined) {
        return null;
      }
      const { expanders } = slot.kit;
      if (expanders.count() === 0) {
        return { entry: slot.entry, result: 'nothing' };
      }
      const opens = expanders.isAnyClosed();
      expanders.setAllOpen(opens);
      return { entry: slot.entry, result: opens ? 'expanded' : 'collapsed' };
    },
    dispose() {
      listSize.disconnect();
      disposeSlots(slots);
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

function focusedEntry(
  focus: EntryFocus,
  slots: Map<string, Slot>,
): ChatEntry | null {
  return focus.entryId === null
    ? null
    : (slots.get(focus.entryId)?.entry ?? null);
}

function buildSlot(entry: ChatEntry, deps: EntryListDeps): Slot {
  const slot = element('li', 'chat-entry-slot');
  return {
    element: slot,
    entry,
    ...buildEntry(slot, entry, deps, false),
    drawsWithDefault: false,
  };
}

// A view with an update runs it after the kit's own parts updated; a view
// with none is drawn again, its new expanders opening as the old ones were.
// A user layout's update that throws is logged and toasted as a failed
// draw, and the slot is drawn with the default layout from then on; the
// default layout's is logged and the entry drawn again.
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
        toastKindOnce(entry.kind, deps, drawnWithDefaultText(name, entry.kind));
        slot.drawsWithDefault = true;
      }
    }
  }
  const openStates = slot.kit.expanders.openStates();
  slot.dispose();
  slot.element.replaceChildren();
  const drawn = buildEntry(slot.element, entry, deps, slot.drawsWithDefault);
  drawn.kit.expanders.restore(openStates);
  slot.view = drawn.view;
  slot.kit = drawn.kit;
  slot.isDefaultView = drawn.isDefaultView;
  slot.dispose = drawn.dispose;
}

// The entry drawn into `slot` through the page host, with the user's layout
// when it defines the kind, unless `drawsWithDefault`; the host logs a user
// builder's failure and draws with the default layout, and chat toasts the
// first such fallback per kind. A default builder that fails leaves a bare
// line naming the kind, toasted once per kind.
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
    const isDefaultView = drawn.layoutName === DEFAULT_ENTRY_PICK.name;
    if (isDefaultView && pick.name !== DEFAULT_ENTRY_PICK.name) {
      toastKindOnce(
        entry.kind,
        deps,
        drawnWithDefaultText(pick.name, entry.kind),
      );
    }
    return {
      view: drawn.built.view,
      kit: drawn.built.kit,
      isDefaultView,
      dispose: drawn.dispose,
    };
  } catch (error) {
    deps.log(
      'chat',
      `default layout ${entry.kind} entry failed: ${errorText(error)}`,
    );
    toastKindOnce(
      entry.kind,
      deps,
      `Chat layout ${pick.name}: ${entry.kind} entries drawn as bare lines`,
    );
    slot.append(element('div', 'chat-entry chat-raw', entry.kind));
    const kit = createEntryKit(entry, deps.kit);
    return {
      view: null,
      kit,
      isDefaultView: true,
      dispose: () => kit.dispose(),
    };
  }
}

function drawnWithDefaultText(name: string, kind: ChatEntryKind): string {
  return `Chat layout ${name}: ${kind} entries drawn with default`;
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
