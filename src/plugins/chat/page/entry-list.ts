import type { ChatEntry, ChatEntryKind } from '../../../contracts/agent';
import type { Log } from '../../../contracts/log';
import type { HalfPageScroll } from '../../../contracts/editor';
import type { ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { isScrolledToEnd, scrollHalfPage } from '../../../shared/half-page';
import defaultLayout from '../layouts/default/layout.js';
import type {
  ChatKit,
  ChatLayout,
  EntryInput,
  EntryKind,
  EntryView,
} from '../layouts/layout';
import { createEntryKit, type EntryKit, type KitDeps } from './chat-kit';
import {
  type EntryFocus,
  focusAfterChange,
  focusAfterScroll,
  focusFirst,
  focusLatest,
  moveFocus,
  START_FOCUS,
} from './entry-focus';

// The layout every session's entries are built with, and the kinds whose
// fallback to the default layout has toasted since it was shown; shared by
// every session's list.
export interface ShownLayout {
  layout: ChatLayout;
  name: string;
  toastedKinds: Set<ChatEntryKind>;
}

export interface EntryListDeps {
  shown: ShownLayout;
  kit: KitDeps;
  log: Log;
  toast(text: string, tone: ToastTone): void;
}

export type ToggleResult = 'expanded' | 'collapsed' | 'nothing';

// A half-page scroll, and whether the list follows the latest entry after it.
export interface TranscriptScroll extends HalfPageScroll {
  following: boolean;
}

// One session's entries, one slot per entry in the session's order, the
// focused slot marked `is-cursor`. After every change a following focus
// scrolls the list to its bottom; a hidden list does not scroll, so its tab
// calls `scrollToFocus` each time it shows.
export interface EntryList {
  element: HTMLOListElement;
  // Builds an entry new to the list, or redraws the one holding its id;
  // `entries` is the session's list after the change.
  put(entry: ChatEntry, entries: readonly ChatEntry[]): void;
  // Builds every entry again with the shown layout, keeping the focus and each
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
  // Scrolls the list by half its visible height. Scrolling up off the bottom
  // stops following, so entries that arrive leave the scroll alone; scrolling
  // down onto the bottom (within 1px) follows the latest entry again. The
  // focused entry stays either way.
  scrollHalfPage(direction: 1 | -1): TranscriptScroll;
  // Opens every expander of the focused entry when any is closed, else
  // closes them all; null with no focused entry.
  toggleFocused(): { entry: ChatEntry; result: ToggleResult } | null;
  // Disposes every entry's kit; the list's owner calls it when it drops the
  // list.
  dispose(): void;
}

// One drawn entry: its slot, the view the layout returned and the kit made
// for it. `isDefaultView` holds while the view is the default layout's (or
// the bare line); `drawsWithDefault` holds once the shown layout's update has
// thrown, and the slot is drawn with the default layout from then on.
interface Slot {
  element: HTMLLIElement;
  entry: ChatEntry;
  view: EntryView | null;
  kit: EntryKit;
  isDefaultView: boolean;
  drawsWithDefault: boolean;
}

interface BuiltEntry {
  element: HTMLElement;
  view: EntryView | null;
  kit: EntryKit;
  isDefaultView: boolean;
}

type AnyBuilder = (input: EntryInput<EntryKind>, kit: ChatKit) => EntryView;

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
      disposeKits(slots);
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
    followBottom() {
      if (focus.following) {
        list.scrollTop = list.scrollHeight;
      }
    },
    scrollToFocus() {
      drawFocus(focus.following ? 'bottom' : 'slot');
    },
    scrollHalfPage(direction) {
      const scroll = scrollHalfPage(list, direction);
      focus = focusAfterScroll(focus, direction, isScrolledToEnd(list, 1));
      drawFocus('follow');
      return { ...scroll, following: focus.following };
    },
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
      disposeKits(slots);
    },
  };
}

function disposeKits(slots: Map<string, Slot>) {
  for (const slot of slots.values()) {
    slot.kit.dispose();
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
  const built = buildEntry(entry, deps);
  slot.append(built.element);
  return {
    element: slot,
    entry,
    view: built.view,
    kit: built.kit,
    isDefaultView: built.isDefaultView,
    drawsWithDefault: false,
  };
}

// A view with an update runs it after the kit's own parts updated; a view
// with none is built again, its new expanders opening as the old ones were.
// A shown layout's update that throws is logged and toasted as a failed
// build, and the slot is drawn with the default layout from then on; the
// default layout's is logged and the entry built again.
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
        reportLayoutFailure(entry, deps, 'entry update failed', error);
        slot.drawsWithDefault = true;
      }
    }
  }
  const openStates = slot.kit.expanders.openStates();
  const built = slot.drawsWithDefault
    ? buildDefaultEntry(entry, deps)
    : buildEntry(entry, deps);
  built.kit.expanders.restore(openStates);
  slot.kit.dispose();
  slot.view = built.view;
  slot.kit = built.kit;
  slot.isDefaultView = built.isDefaultView;
  slot.element.replaceChildren(built.element);
}

// The entry built with the shown layout. A builder that throws or returns no
// element is logged, the first failure per kind under the shown layout
// toasted, and the entry built with the default layout.
function buildEntry(entry: ChatEntry, deps: EntryListDeps): BuiltEntry {
  const { shown } = deps;
  if (shown.layout !== defaultLayout) {
    const kit = createEntryKit(entry, deps.kit);
    try {
      const view = buildView(shown.layout, entry, kit.kit);
      return { element: view.element, view, kit, isDefaultView: false };
    } catch (error) {
      kit.dispose();
      reportLayoutFailure(entry, deps, 'entry failed', error);
    }
  }
  return buildDefaultEntry(entry, deps);
}

// The entry built with the default layout and a fresh kit; a default builder
// that fails leaves a bare line naming the kind, toasted once per kind when
// the default layout is the shown one (another shown layout toasted already).
function buildDefaultEntry(entry: ChatEntry, deps: EntryListDeps): BuiltEntry {
  const kit = createEntryKit(entry, deps.kit);
  try {
    const view = buildView(defaultLayout, entry, kit.kit);
    return { element: view.element, view, kit, isDefaultView: true };
  } catch (error) {
    deps.log(
      'chat',
      `default layout ${entry.kind} entry failed: ${errorText(error)}`,
    );
    if (deps.shown.layout === defaultLayout) {
      toastKindOnce(
        entry.kind,
        deps,
        `Chat layout default: ${entry.kind} entries drawn as bare lines`,
      );
    }
    const bare = element('div', 'chat-entry chat-raw', entry.kind);
    return { element: bare, view: null, kit, isDefaultView: true };
  }
}

// Logs the shown layout's failure on an entry and toasts the first per kind.
function reportLayoutFailure(
  entry: ChatEntry,
  deps: EntryListDeps,
  failure: string,
  error: unknown,
) {
  const { name } = deps.shown;
  deps.log(
    'chat',
    `layout ${name} ${entry.kind} ${failure}: ${errorText(error)}`,
  );
  toastKindOnce(
    entry.kind,
    deps,
    `Chat layout ${name}: ${entry.kind} entries drawn with default`,
  );
}

function toastKindOnce(kind: ChatEntryKind, deps: EntryListDeps, text: string) {
  if (!deps.shown.toastedKinds.has(kind)) {
    deps.shown.toastedKinds.add(kind);
    deps.toast(text, 'error');
  }
}

// Throws when the builder throws or hands back no element.
function buildView(
  layout: ChatLayout,
  entry: ChatEntry,
  kit: ChatKit,
): EntryView {
  const build = layout.entries[entry.kind] as AnyBuilder;
  const view = build(entry, kit) as EntryView | undefined;
  if (view === undefined || !(view.element instanceof HTMLElement)) {
    throw new Error('the builder returned no HTMLElement in `element`');
  }
  return view;
}
