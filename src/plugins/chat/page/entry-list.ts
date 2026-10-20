import type { ChatEntry, ChatEntryKind } from '../../../contracts/agent';
import type { Log } from '../../../contracts/log';
import type { ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
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

// One session's entries, one slot per entry in the session's order, the
// focused slot marked `is-focused`. After every change a following focus
// scrolls the list to its bottom; a hidden list does not scroll, so its tab
// calls `scrollToFocus` each time it shows.
export interface EntryList {
  element: HTMLOListElement;
  // Builds an entry new to the list, or redraws the one holding its id;
  // `entries` is the session's list after the change.
  put(entry: ChatEntry, entries: readonly ChatEntry[]): void;
  // Builds every entry again with the shown layout, keeping the focus by id.
  rebuild(entries: readonly ChatEntry[]): void;
  // The focused entry after the move; null with no entries.
  move(step: 1 | -1): ChatEntry | null;
  // Follows the latest entry and scrolls to the bottom.
  latest(): void;
  // Scrolls to the bottom while following, else brings the focused entry
  // into view.
  scrollToFocus(): void;
  // Opens every expander of the focused entry when any is closed, else
  // closes them all; null with no focused entry.
  toggleFocused(): { entry: ChatEntry; result: ToggleResult } | null;
}

// One drawn entry: its slot, the view the layout returned and the kit made
// for it. `updateFailed` holds once the view's update has thrown and been
// logged.
interface Slot {
  element: HTMLLIElement;
  entry: ChatEntry;
  view: EntryView | null;
  kit: EntryKit;
  updateFailed: boolean;
}

type AnyBuilder = (input: EntryInput<EntryKind>, kit: ChatKit) => EntryView;

export function createEntryList(deps: EntryListDeps): EntryList {
  const list = element('ol', 'chat-entries');
  const slots = new Map<string, Slot>();
  let order: string[] = [];
  let focus: EntryFocus = START_FOCUS;

  const drawFocus = (scroll: 'follow' | 'slot' | 'bottom') => {
    for (const [id, slot] of slots) {
      slot.element.classList.toggle('is-focused', id === focus.entryId);
    }
    const isBottom = scroll === 'bottom' || focus.following;
    if (scroll === 'slot' && focus.entryId !== null) {
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
      slots.clear();
      list.replaceChildren();
      for (const entry of entries) {
        const created = buildSlot(entry, deps);
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
    scrollToFocus() {
      drawFocus(focus.following ? 'bottom' : 'slot');
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
  };
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
    updateFailed: false,
  };
}

// A view with an update runs it after the kit's own parts updated, its first
// throw logged and its element kept; a view with none is built again, its new
// expanders opening as the old ones were.
function redrawSlot(slot: Slot, entry: ChatEntry, deps: EntryListDeps) {
  slot.entry = entry;
  slot.kit.update(entry);
  const { view } = slot;
  if (view?.update !== undefined) {
    try {
      view.update(entry);
    } catch (error) {
      if (!slot.updateFailed) {
        slot.updateFailed = true;
        deps.log(
          'chat',
          `layout ${deps.shown.name} ${entry.kind} entry update failed: ${errorText(error)}`,
        );
      }
    }
    return;
  }
  const openStates = slot.kit.expanders.openStates();
  const built = buildEntry(entry, deps);
  built.kit.expanders.restore(openStates);
  slot.view = built.view;
  slot.kit = built.kit;
  slot.updateFailed = false;
  slot.element.replaceChildren(built.element);
}

// The entry built with the shown layout. A builder that throws or returns no
// element is logged, the first such failure per kind under the shown layout
// toasted, and the entry built with the default layout and a fresh kit; a
// default builder that fails too leaves a bare line naming the kind.
function buildEntry(
  entry: ChatEntry,
  deps: EntryListDeps,
): { element: HTMLElement; view: EntryView | null; kit: EntryKit } {
  const { shown } = deps;
  const isDefaultShown = shown.layout === defaultLayout;
  if (!isDefaultShown) {
    const kit = createEntryKit(entry, deps.kit);
    try {
      const view = buildView(shown.layout, entry, kit.kit);
      return { element: view.element, view, kit };
    } catch (error) {
      deps.log(
        'chat',
        `layout ${shown.name} ${entry.kind} entry failed: ${errorText(error)}`,
      );
      if (!shown.toastedKinds.has(entry.kind)) {
        shown.toastedKinds.add(entry.kind);
        deps.toast(
          `Chat layout ${shown.name}: ${entry.kind} entries drawn with default`,
          'error',
        );
      }
    }
  }
  const kit = createEntryKit(entry, deps.kit);
  try {
    const view = buildView(defaultLayout, entry, kit.kit);
    return { element: view.element, view, kit };
  } catch (error) {
    deps.log(
      'chat',
      `default layout ${entry.kind} entry failed: ${errorText(error)}`,
    );
    const bare = element('div', 'chat-entry chat-raw', entry.kind);
    return { element: bare, view: null, kit };
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
