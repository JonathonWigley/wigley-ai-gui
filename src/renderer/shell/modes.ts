import type { Disposable } from '../../contracts/disposable';
import type { Log } from '../../contracts/log';
import type {
  Mode,
  ModeContext,
  ModeHandle,
  Modes,
} from '../../contracts/plugin';
import { createListeners } from '../../shared/listeners';

// Where the shown mode's side bar lies: beside the content, over it, or
// hidden.
export type SideBarLayout = 'beside' | 'over' | 'hidden';

// The media query of a narrow window, below 680 px wide, where a mode's side
// bar lies over the content instead of beside it.
export const SIDE_BAR_OVER_QUERY = '(max-width: 679px)';

// A mode's side bar choice: hidden by the user while the window is wide, and
// open over the content while it is narrow (`SIDE_BAR_OVER_QUERY`).
export interface SideBarState {
  isHiddenWide: boolean;
  isOverlayOpen: boolean;
}

const SIDE_BAR_START: SideBarState = {
  isHiddenWide: false,
  isOverlayOpen: false,
};

function sideBarLayout(state: SideBarState, isNarrow: boolean): SideBarLayout {
  if (isNarrow) {
    return state.isOverlayOpen ? 'over' : 'hidden';
  }
  return state.isHiddenWide ? 'hidden' : 'beside';
}

// The toggle key flips the hidden choice while wide and the overlay while
// narrow; the other field stays.
function toggledSideBar(state: SideBarState, isNarrow: boolean): SideBarState {
  return isNarrow
    ? { ...state, isOverlayOpen: !state.isOverlayOpen }
    : { ...state, isHiddenWide: !state.isHiddenWide };
}

// The window widening ends the overlay; the user's hidden choice always
// stays.
function sideBarAfterResize(
  state: SideBarState,
  isNarrow: boolean,
): SideBarState {
  return isNarrow ? state : { ...state, isOverlayOpen: false };
}

// A pick in the side bar ends the overlay; the user's hidden choice always
// stays.
function sideBarAfterPick(state: SideBarState): SideBarState {
  return { ...state, isOverlayOpen: false };
}

const SIDE_BAR_LOGS: Record<SideBarLayout, string> = {
  beside: 'side bar shown',
  over: 'side bar shown over the content',
  hidden: 'side bar hidden',
};

// What the mode registry drives outside itself. `place` puts a mode's element
// and side bar in the window, and its item in the activity bar, once at its
// `add`, and the `Disposable` it returns takes them out; `marked` marks the shown mode in the activity bar; `layOutSideBar`
// lays out the side bar area; `showContext` shows the title bar's context;
// `isNarrow` is whether the window starts narrow (`SIDE_BAR_OVER_QUERY`).
export interface ModesDeps {
  place(mode: Mode, handle: ModeHandle): Disposable;
  marked(modeId: string): void;
  layOutSideBar(layout: SideBarLayout): void;
  showContext(context: ModeContext | null): void;
  isNarrow: boolean;
  log: Log;
}

// The core's own view of the registry: `narrowChanged` hears the window cross
// the 680 px breakpoint, closing every mode's overlay on widening and laying
// out the shown mode's side bar again. It tells the mode only when widening
// closes its open overlay onto a side bar the user hid; a narrowing tells
// nothing.
export interface CoreModes extends Modes {
  narrowChanged(isNarrow: boolean): void;
}

interface AddedMode {
  mode: Mode;
  sideBar: SideBarState;
  context: ModeContext | null;
}

// The core's mode registry: each mode is placed once, and showing a mode only
// toggles `hidden`, so a hidden mode keeps its DOM and state. Each mode keeps
// its own side bar choice and title bar context, applied while it shows. With
// no mode left, the title bar context and the side bar clear.
export function createModes(deps: ModesDeps): CoreModes {
  const { log } = deps;
  const added = new Map<string, AddedMode>();
  const listeners = createListeners<string>();
  let shownMode: AddedMode | null = null;
  let isNarrow = deps.isNarrow;

  const layoutOf = (entry: AddedMode): SideBarLayout =>
    entry.mode.sideBar === undefined
      ? 'hidden'
      : sideBarLayout(entry.sideBar, isNarrow);

  const setHidden = (mode: Mode, hidden: boolean) => {
    mode.element.hidden = hidden;
    if (mode.sideBar !== undefined) {
      mode.sideBar.hidden = hidden;
    }
  };

  // Tells the shown mode its side bar hid or opened over the content, when
  // its layout differs from `before`: null when the mode was not shown.
  const tellSideBarChanged = (
    entry: AddedMode,
    before: SideBarLayout | null,
  ) => {
    const { mode } = entry;
    const layout = layoutOf(entry);
    if (mode.sideBar === undefined || layout === before) {
      return;
    }
    if (layout === 'hidden') {
      mode.sideBarHidden?.();
    } else if (layout === 'over') {
      mode.sideBarOpenedOver?.();
    }
  };

  const reveal = (entry: AddedMode) => {
    const { mode } = entry;
    setHidden(mode, false);
    shownMode = entry;
    deps.marked(mode.id);
    deps.layOutSideBar(layoutOf(entry));
    deps.showContext(entry.context);
    log('page', `showed ${mode.title} mode`);
    mode.shown();
    tellSideBarChanged(entry, null);
  };

  const showFirstRemaining = () => {
    const first = added.values().next().value;
    if (first === undefined) {
      deps.layOutSideBar('hidden');
      deps.showContext(null);
      listeners.tell('');
      return;
    }
    reveal(first);
    listeners.tell(first.mode.id);
  };

  return {
    add(mode) {
      if (added.has(mode.id)) {
        throw new Error(`Mode "${mode.id}" is added twice`);
      }
      const entry: AddedMode = { mode, sideBar: SIDE_BAR_START, context: null };
      added.set(mode.id, entry);
      const isDisposed = () => added.get(mode.id) !== entry;
      const handle: ModeHandle = {
        show() {
          if (shownMode === entry || isDisposed()) {
            return;
          }
          if (shownMode !== null) {
            setHidden(shownMode.mode, true);
            shownMode.mode.hidden();
          }
          reveal(entry);
          listeners.tell(mode.id);
        },
        isShown: () => shownMode === entry,
        setContext(context) {
          entry.context = context;
          if (shownMode === entry) {
            deps.showContext(context);
          }
        },
        toggleSideBar() {
          if (isDisposed()) {
            return;
          }
          if (mode.sideBar === undefined) {
            throw new Error(`Mode "${mode.id}" has no side bar`);
          }
          const before = layoutOf(entry);
          entry.sideBar = toggledSideBar(entry.sideBar, isNarrow);
          if (shownMode === entry) {
            const layout = layoutOf(entry);
            deps.layOutSideBar(layout);
            log('page', SIDE_BAR_LOGS[layout]);
            tellSideBarChanged(entry, before);
          }
        },
        picked() {
          const before = layoutOf(entry);
          entry.sideBar = sideBarAfterPick(entry.sideBar);
          const layout = layoutOf(entry);
          if (shownMode === entry && layout !== before) {
            deps.layOutSideBar(layout);
            log('page', SIDE_BAR_LOGS[layout]);
            tellSideBarChanged(entry, before);
          }
        },
        sideBarShown: () => shownMode === entry && layoutOf(entry) !== 'hidden',
        dispose() {
          if (isDisposed()) {
            return;
          }
          added.delete(mode.id);
          placement.dispose();
          if (shownMode === entry) {
            shownMode = null;
            showFirstRemaining();
          }
        },
      };
      const placement = deps.place(mode, handle);
      if (shownMode === null) {
        reveal(entry);
        listeners.tell(mode.id);
      } else {
        setHidden(mode, true);
      }
      return handle;
    },
    shown() {
      if (shownMode === null) {
        throw new Error('No mode is added yet');
      }
      return shownMode.mode.id;
    },
    onChanged: (listener) => listeners.add(listener),
    narrowChanged(next) {
      const before = shownMode === null ? null : layoutOf(shownMode);
      isNarrow = next;
      for (const entry of added.values()) {
        entry.sideBar = sideBarAfterResize(entry.sideBar, isNarrow);
      }
      if (shownMode !== null) {
        deps.layOutSideBar(layoutOf(shownMode));
        // A narrowing hides the side bar without telling the mode, so focus
        // stays across a narrow-and-widen round trip.
        if (before === 'over') {
          tellSideBarChanged(shownMode, before);
        }
      }
    },
  };
}
