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

// The media query of a window below 680 px wide, one of the two ways the
// window is narrow: the side bar has no room beside the content, so it lies
// over the content instead; the left bar crowding the side bar is the other.
export const SIDE_BAR_OVER_QUERY = '(max-width: 679px)';

// Whether the window is narrow: `isNarrowWindow` (`SIDE_BAR_OVER_QUERY`) or
// `isCrowded` (the left bar crowding the side bar). `update` reads both again
// after either may have changed and tells `changed` only when their union
// did, so neither cause widens the side bar while the other holds.
export interface SideBarRoom {
  isNarrow(): boolean;
  update(): void;
}

export function watchSideBarRoom(
  isNarrowWindow: () => boolean,
  isCrowded: () => boolean,
  changed: (isNarrow: boolean) => void,
): SideBarRoom {
  const read = () => isNarrowWindow() || isCrowded();
  let isNarrow = read();
  return {
    isNarrow: () => isNarrow,
    update() {
      const next = read();
      if (next !== isNarrow) {
        isNarrow = next;
        changed(next);
      }
    },
  };
}

// A mode's side bar choice: hidden by the user while the window is wide, and
// open over the content while it is narrow (`SIDE_BAR_OVER_QUERY`, or the
// left bar crowding the side bar).
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

// The window widening, or the left bar's crowding ending, ends the overlay;
// the user's hidden choice always stays.
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
// `add`, and the `Disposable` it returns takes them out; `marked` marks the shown mode in the activity bar; `counted`
// sets a placed mode's count on its activity item; `layOutSideBar`
// lays out the side bar area; `showContext` shows the title bar's context;
// `isNarrow` is whether the side bar starts with no room beside the content
// (`SIDE_BAR_OVER_QUERY`, or crowded by the left bar);
// `sideBarOpened` runs after a mode with `focusSideBar` has heard its side bar
// open over the content (`sideBarOpenedOver`), so the core holds that side
// bar as the area with the keys.
export interface ModesDeps {
  place(mode: Mode, handle: ModeHandle): Disposable;
  marked(modeId: string): void;
  counted(modeId: string, count: number | null): void;
  layOutSideBar(layout: SideBarLayout): void;
  showContext(context: ModeContext | null): void;
  sideBarOpened(): void;
  isNarrow: boolean;
  log: Log;
}

// The core's own view of the registry: `narrowChanged` hears the side bar lose
// or regain its room beside the content (the window crossing the 680 px
// breakpoint, or the shell's left bar crowding it), closing every mode's
// overlay on widening and laying out the shown mode's side bar again. It
// tells the mode `sideBarHidden` only when widening closes its open overlay
// onto a side bar the user hid, and `sideBarNarrowed` only when narrowing
// hides its side bar from beside the content. `focusSideBar` calls the shown
// mode's `focusSideBar` and returns true when the mode has one and its side
// bar lies beside or over the content; otherwise it calls nothing and returns
// false, with no mode shown too. `focusMain` calls the shown mode's
// `focusMain`, and does nothing with no mode shown.
export interface CoreModes extends Modes {
  narrowChanged(isNarrow: boolean): void;
  focusSideBar(): boolean;
  focusMain(): void;
}

interface AddedMode {
  mode: Mode;
  sideBar: SideBarState;
  context: ModeContext | null;
}

// The core's mode registry: each mode is placed once, and showing a mode only
// toggles `hidden`, so a hidden mode keeps its DOM and state. Each mode keeps
// its own side bar choice and title bar context, applied while it shows. A
// disposed shown mode gives way to the remaining mode whose id was first added
// earliest. A count passes straight to `counted`, which the activity bar keeps.
// With no mode left, the title bar context
// and the side bar clear.
export function createModes(deps: ModesDeps): CoreModes {
  const { log } = deps;
  const added = new Map<string, AddedMode>();
  // Each mode id ever added, by the order of its first add.
  const firstAddOrders = new Map<string, number>();
  const listeners = createListeners<string>();
  let shownMode: AddedMode | null = null;
  // The id of the shown mode a `dispose` took away, shown again at its next
  // `add`, until a `show` changes the shown mode. A fallback shown in its
  // place that gives way too keeps the older id.
  let gaveWayId: string | null = null;
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
      if (mode.focusSideBar !== undefined) {
        deps.sideBarOpened();
      }
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

  // Hides the shown mode, telling it, and shows `entry`, telling listeners.
  const showInstead = (entry: AddedMode) => {
    if (shownMode !== null) {
      setHidden(shownMode.mode, true);
      shownMode.mode.hidden();
    }
    reveal(entry);
    listeners.tell(entry.mode.id);
  };

  const showFirstRemaining = () => {
    let first: AddedMode | undefined;
    for (const [id, entry] of added) {
      const isEarlier =
        first === undefined ||
        (firstAddOrders.get(id) ?? 0) <
          (firstAddOrders.get(first.mode.id) ?? 0);
      if (isEarlier) {
        first = entry;
      }
    }
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
      if (!firstAddOrders.has(mode.id)) {
        firstAddOrders.set(mode.id, firstAddOrders.size);
      }
      const isDisposed = () => added.get(mode.id) !== entry;
      const handle: ModeHandle = {
        show() {
          if (shownMode === entry || isDisposed()) {
            return;
          }
          gaveWayId = null;
          showInstead(entry);
        },
        isShown: () => shownMode === entry,
        setContext(context) {
          entry.context = context;
          if (shownMode === entry) {
            deps.showContext(context);
          }
        },
        setCount(count) {
          if (!isDisposed()) {
            deps.counted(mode.id, count);
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
            gaveWayId ??= mode.id;
            shownMode = null;
            showFirstRemaining();
          }
        },
      };
      const placement = deps.place(mode, handle);
      if (gaveWayId === mode.id) {
        gaveWayId = null;
        showInstead(entry);
      } else if (shownMode === null) {
        showInstead(entry);
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
    stepTab: (by) => shownMode?.mode.stepTab?.(by) ?? false,
    onChanged: (listener) => listeners.add(listener),
    focusSideBar() {
      const mode = shownMode?.mode;
      const isSideBarShown =
        shownMode !== null && layoutOf(shownMode) !== 'hidden';
      if (mode?.focusSideBar === undefined || !isSideBarShown) {
        return false;
      }
      mode.focusSideBar();
      return true;
    },
    focusMain() {
      shownMode?.mode.focusMain();
    },
    narrowChanged(next) {
      const before = shownMode === null ? null : layoutOf(shownMode);
      isNarrow = next;
      for (const entry of added.values()) {
        entry.sideBar = sideBarAfterResize(entry.sideBar, isNarrow);
      }
      if (shownMode !== null) {
        const layout = layoutOf(shownMode);
        deps.layOutSideBar(layout);
        // A narrowing tells the shown mode only through `sideBarNarrowed`,
        // which moves no focus, so focus stays across a narrow-and-widen round
        // trip.
        if (before === 'over') {
          tellSideBarChanged(shownMode, before);
        } else if (before === 'beside' && layout === 'hidden') {
          shownMode.mode.sideBarNarrowed?.();
        }
      }
    },
  };
}
