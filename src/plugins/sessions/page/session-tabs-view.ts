import type { PaneDirection } from '../../../contracts/panes';
import { callEach } from '../../../shared/call-each';
import { element, moveConnected } from '../../../shared/page/dom';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { type PlaceWrites, placeWrites } from '../../../shared/page/place-slot';
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeyHints } from '../../../contracts/plugin';
import type { KeyedSlotWriter } from '../../../contracts/state';
import type {
  SessionsPlace,
  SessionsState,
  SessionTabHandle,
  SessionTabView,
  TakeOver,
} from '../contract';
import type {
  EmptyTextInput,
  PaneInput,
  SessionsPart,
} from '../layouts/layout';
import { sessionsManifest } from '../manifest';
import type {
  DrawnPanePart,
  DrawnTabBar,
  SessionsParts,
} from './layout/sessions-parts';
import { scrollLeftShowing } from './strip-scroll';
import {
  hasOtherTab,
  NO_TABS,
  showsEmptyText,
  showsNoSelectionText,
  type TabsState,
  tabsAfterAdd,
  tabsAfterRelease,
  tabsAfterRemove,
  tabsAfterRestoredAdd,
  tabsAfterSelect,
  tabsAfterTakeOver,
  takeOversAfterRelease,
  takeOversWithLiveTabs,
} from './tabs';

interface Tab {
  view: SessionTabView;
}

// A session's frame: its session, its tab bar over the sheet holding its
// tabs' body and the text saying why no tab shows; its tab ids and selection,
// and its tabs by id, both in strip order; the take overs its tabs hold, one
// per tab; the place the last page saved for its session, null for none, the
// tabs whose take over came from that place and no take over of this page has
// claimed, the tab that place had selected while that tab has not come back and
// no pick moved the selection since the load (null once either happened), and
// the writes of its place.
interface Frame {
  sessionId: string;
  element: HTMLElement;
  barHost: HTMLElement;
  bar: DrawnPart<DrawnTabBar>;
  bodies: HTMLElement;
  body: HTMLElement;
  tabs: TabsState;
  entries: Map<string, Tab>;
  takeOvers: TakeOver[];
  saved: SessionsPlace | null;
  savedTakeOverTabIds: Set<string>;
  awaitedSelectedTabId: string | null;
  placeWrites: PlaceWrites<SessionsPlace>;
  drawnTabs: DrawnPart<SessionsPart>[];
  // The selected tab the strip last scrolled into view.
  scrolledTabId: string | null;
  text: DrawnPart<SessionsPart> | null;
}

// One chat pane as the owner places it: its pane tree slot and the session it
// shows, null for none.
export interface PanePlace {
  id: string;
  slot: HTMLElement;
  sessionId: string | null;
}

// A pane drawn: its `pane` part and the input it drew with, and the sheet an
// empty pane shows its text in.
interface DrawnPane {
  slot: HTMLElement;
  sessionId: string | null;
  input: PaneInput | null;
  part: DrawnPart<DrawnPanePart> | null;
  empty: HTMLElement;
  text: DrawnPart<SessionsPart> | null;
}

// `isModeShown` reads whether Sessions mode shows; `changed` runs after any
// change to a session's tabs or their selection; `keys`
// draws the key beside the text asking for a session to be picked; `parts`
// draws the panes, the tab bars with the bar parts other plugins added, the
// tabs and that text; `selectTab` runs on a tab's click. `places` holds each
// session's place: a new frame reads the last page's, and each change writes it.
export interface SessionTabsDeps {
  isModeShown(): boolean;
  changed(): void;
  selectTab(sessionId: string, tabId: string): void;
  keys: Pick<KeyHints, 'anchor'>;
  parts: SessionsParts;
  places: Pick<KeyedSlotWriter<SessionsPlace>, 'get' | 'set'>;
}

export interface SessionTabsView {
  // The hidden holder of every frame no pane shows; the owner keeps it in the
  // document.
  holder: HTMLElement;
  render(state: SessionsState): void;
  // Draws each pane's `pane` part into its slot, updates it when its input
  // changed, and moves each session's frame into the body of the pane that
  // shows it, the rest into the holder. `edges` are the focused pane's.
  place(
    panes: readonly PanePlace[],
    focusedPaneId: string,
    edges: readonly PaneDirection[],
  ): void;
  // Moves the frames panes `paneIds` show into the holder, while their slots
  // are still in the document, ahead of those slots leaving it.
  vacate(paneIds: readonly string[]): void;
  // Draws every pane and tab bar again with the parts' current layouts, then
  // the tabs and the texts; the tab bodies and their elements stay as they are.
  redrawPane(): void;
  // Draws every tab bar again, then the tabs and the texts, for a bar part
  // added or removed; the panes, the tab bodies and their elements stay as
  // they are.
  redrawBars(): void;
  // Scrolls each pane's strip to its selected tab again, for a strip that
  // had no width when the selection changed: the mode was hidden.
  rescroll(): void;
  add(sessionId: string, view: SessionTabView): SessionTabHandle;
  // Drops the session's frame, its tabs and their elements; their handles
  // then do nothing. Runs no `changed`.
  drop(sessionId: string): void;
  // Drops every frame as `drop` does, then every pane with its part and text,
  // a throw not skipping the rest.
  dropAll(): void;
  // The session's tabs, in strip order.
  tabsOf(sessionId: string): SessionTabView[];
  selectedTabOf(sessionId: string): SessionTabView | null;
  select(sessionId: string, tabId: string): void;
}

// Sessions mode's chat panes, drawn through the sessions layout. Each pane is
// the `pane` part, whose body holds the frame of the session it shows: the
// `tabBar` (the session's tab strip between its previous and next tab
// prompts, the bar parts other plugins added, the close prompt and the pane
// controls at the bar's end) on the top edge of a sheet holding the session's
// tabs, only its selected tab showing, or the `emptyText` saying why no tab
// shows. An empty pane's body holds a sheet with the empty text alone. The tab
// prompts hide while the session has no other tab, and every tab bar's prompts
// and pane control keys hide outside the focused pane, whose keys they are. A
// tab's element fills its frame's sheet, and a frame moves between panes, the
// holder and a pane part drawn again as the same element, by a connected move that
// keeps a visual in it loaded; a closing pane's frame moves to the holder
// (`vacate`) before its slot leaves the document. The strip follows each tab's
// `order` (`tabsAfterAdd`). A frame no pane shows, a session's with no row yet
// included, waits in the hidden holder. Each frame writes its place (selected
// tab, selection count, take overs) to `places` on each change, and a new frame
// starts from the place the last page wrote: a tab added late takes back the
// selection it had while no pick moved it since (`tabsAfterRestoredAdd`), and
// until then the place keeps naming that tab as the selected one.
// Until `render` hands it main's first state, it shows no text either. The
// view keeps each tab's click, which runs `selectTab`, its tooltip and the
// active tab's mark.
export function mountSessionTabsView(deps: SessionTabsDeps): SessionTabsView {
  const { parts } = deps;
  const holder = element('div', 'session-frame-holder');
  holder.hidden = true;
  const pickHint = element('span', 'sessions-pick-hint');
  deps.keys.anchor(pickHint, qualify(sessionsManifest.id, 'nextSession'));
  const frames = new Map<string, Frame>();
  const panes = new Map<string, DrawnPane>();
  let focusedPaneId: string | null = null;
  let focusedEdges: readonly PaneDirection[] = [];
  let state: SessionsState | null = null;

  const focusedSessionId = () =>
    focusedPaneId === null
      ? null
      : (panes.get(focusedPaneId)?.sessionId ?? null);

  const drawBar = (
    frame: Pick<Frame, 'sessionId' | 'barHost'>,
  ): DrawnPart<DrawnTabBar> => {
    frame.barHost.replaceChildren();
    return parts.tabBar(frame.barHost, frame.sessionId);
  };

  const redrawBar = (frame: Frame) => {
    disposeTabs(frame);
    frame.bar.dispose();
    frame.bar = drawBar(frame);
    frame.scrolledTabId = null;
  };

  const frameOf = (sessionId: string): Frame => {
    const existing = frames.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const frameElement = element('div', 'session-area');
    const barHost = element('div', 'session-tabs-host');
    barHost.style.display = 'contents';
    const bodies = sheet();
    bodies.classList.add('session-bodies');
    const body = element('div', 'session-body');
    bodies.append(body);
    frameElement.append(barHost, bodies);
    holder.append(frameElement);
    const saved = deps.places.get(sessionId) ?? null;
    const created: Frame = {
      sessionId,
      element: frameElement,
      barHost,
      bar: drawBar({ sessionId, barHost }),
      bodies,
      body,
      tabs:
        saved === null ? NO_TABS : { ...NO_TABS, selections: saved.selections },
      entries: new Map(),
      takeOvers: saved?.takeOvers ?? [],
      saved,
      savedTakeOverTabIds: new Set(
        saved?.takeOvers.map((takeOver) => takeOver.tabId),
      ),
      awaitedSelectedTabId: saved?.selectedTabId ?? null,
      placeWrites: placeWrites((place) => deps.places.set(sessionId, place)),
      drawnTabs: [],
      scrolledTabId: null,
      text: null,
    };
    frames.set(sessionId, created);
    return created;
  };

  const disposeTabs = (frame: Frame) => {
    for (const tab of frame.drawnTabs) {
      tab.dispose();
    }
    frame.drawnTabs = [];
  };

  const disposeText = (drawn: { text: DrawnPart<SessionsPart> | null }) => {
    drawn.text?.dispose();
    drawn.text?.built.element.remove();
    drawn.text = null;
  };

  const dropPane = (paneId: string, pane: DrawnPane) => {
    panes.delete(paneId);
    callEach<() => void>(
      [() => disposeText(pane), () => pane.part?.dispose()],
      (step) => step(),
    );
  };

  // Scrolls the strip alone to the selected tab once each time the selection
  // changes, so a tab the user scrolled past stays put. A strip with no width,
  // in the holder or a hidden mode, waits until a draw finds it laid out or
  // the mode shows again (`rescroll`).
  const scrollSelectedIntoView = (frame: Frame) => {
    const selectedId = frame.tabs.selectedTabId;
    const strip = frame.bar.built.strip;
    if (selectedId === frame.scrolledTabId || strip.clientWidth === 0) {
      return;
    }
    frame.scrolledTabId = selectedId;
    const index = [...frame.entries.keys()].indexOf(selectedId ?? '');
    const tab = frame.drawnTabs[index]?.built.element;
    if (tab !== undefined) {
      strip.scrollLeft = scrollLeftShowing(strip, tab);
    }
  };

  const drawFrame = (sessionId: string, frame: Frame, isFocused: boolean) => {
    for (const tab of frame.entries.values()) {
      tab.view.element.hidden = tab.view.id !== frame.tabs.selectedTabId;
    }
    const tabs = [...frame.entries.values()];
    disposeTabs(frame);
    const strip = frame.bar.built.strip;
    strip.replaceChildren();
    frame.drawnTabs = tabs.map((tab) =>
      drawTab(
        parts,
        strip,
        tab.view,
        tab.view.id === frame.tabs.selectedTabId,
        () => deps.selectTab(sessionId, tab.view.id),
      ),
    );
    scrollSelectedIntoView(frame);
    const isTabStepping =
      isFocused && hasOtherTab(frame.tabs.tabIds, frame.tabs.selectedTabId);
    const { previous, next, close, splitRight, splitDown, closePane } =
      frame.bar.built;
    previous?.classList.toggle('is-no-target', !isTabStepping);
    next?.classList.toggle('is-no-target', !isTabStepping);
    for (const prompt of [close, splitRight, splitDown, closePane]) {
      prompt?.classList.toggle('is-no-target', !isFocused);
    }
    const text = textFor(state, sessionId, tabs.length, false);
    frame.text =
      text === null ? null : parts.emptyText(frame.bodies, text, pickHint);
  };

  // Draws every frame and empty pane; every text is dropped before any draws,
  // so the one pick hint is free for whichever text takes it.
  const draw = () => {
    for (const frame of frames.values()) {
      disposeText(frame);
    }
    for (const pane of panes.values()) {
      disposeText(pane);
    }
    const focusedSession = focusedSessionId();
    for (const [sessionId, frame] of frames) {
      drawFrame(sessionId, frame, sessionId === focusedSession);
    }
    for (const [paneId, pane] of panes) {
      if (pane.sessionId === null) {
        const text = textFor(state, null, 0, paneId === focusedPaneId);
        pane.text =
          text === null ? null : parts.emptyText(pane.empty, text, pickHint);
      }
    }
  };

  // Updates `pane`'s part in place when `input` differs from the one it drew
  // with, so the elements under a release that focused the pane stay in the
  // document for its click. Draws the part again when it has no working
  // `update`, or when it was marked for a redraw: the new part draws beside the
  // old one, takes the old body's content by a connected move, then the old
  // part leaves, so a visual in the content stays loaded.
  const drawPanePart = (pane: DrawnPane, input: PaneInput) => {
    if (pane.part !== null && pane.input !== null) {
      const isCurrent =
        isSameInput(pane.input, input) || pane.part.built.update(input);
      if (isCurrent) {
        pane.input = input;
        return pane.part.built.body;
      }
    }
    const old = pane.part;
    pane.part = parts.pane(pane.slot, input);
    pane.input = input;
    const { element: drawn, body } = pane.part.built;
    if (old !== null) {
      // `children` is live: each move shrinks it.
      for (const content of Array.from(old.built.body.children)) {
        moveConnected(body, content);
      }
      old.dispose();
    }
    removeChildrenExcept(pane.slot, drawn);
    return body;
  };

  const place = (
    placed: readonly PanePlace[],
    focused: string,
    edges: readonly PaneDirection[],
  ) => {
    focusedPaneId = focused;
    focusedEdges = edges;
    const placedIds = new Set(placed.map((pane) => pane.id));
    for (const [paneId, pane] of panes) {
      if (!placedIds.has(paneId)) {
        dropPane(paneId, pane);
      }
    }
    const shown = new Map<HTMLElement, HTMLElement>();
    for (const { id, slot, sessionId } of placed) {
      let pane = panes.get(id);
      if (pane === undefined || pane.slot !== slot) {
        pane = {
          slot,
          sessionId,
          input: null,
          part: null,
          empty: sheet(),
          text: null,
        };
        pane.empty.classList.add('session-bodies');
        panes.set(id, pane);
      }
      pane.sessionId = sessionId;
      const isFocused = id === focused;
      const body = drawPanePart(pane, {
        isFocused: isFocused && placed.length > 1,
        edges: isFocused ? [...edges] : [],
      });
      const content =
        sessionId === null ? pane.empty : frameOf(sessionId).element;
      shown.set(content, body);
      if (content.parentNode !== body) {
        moveConnected(body, content);
      }
    }
    for (const frame of frames.values()) {
      if (!shown.has(frame.element) && frame.element.parentNode !== holder) {
        moveConnected(holder, frame.element);
      }
    }
    for (const [content, body] of shown) {
      removeChildrenExcept(body, content);
    }
    draw();
  };

  const vacate = (paneIds: readonly string[]) => {
    for (const paneId of paneIds) {
      const pane = panes.get(paneId);
      if (pane === undefined || pane.sessionId === null) {
        continue;
      }
      const frame = frames.get(pane.sessionId);
      const isShownInPane =
        frame !== undefined &&
        frame.element.parentNode === pane.part?.built.body;
      if (isShownInPane) {
        moveConnected(holder, frame.element);
      }
    }
  };

  const changed = () => {
    draw();
    deps.changed();
  };

  // Writes the saved selected tab in place of the shown one while that tab is
  // still awaited, so a reload before it comes back keeps it.
  const writePlace = (frame: Frame) => {
    const isPickedSinceLoad =
      frame.saved !== null && frame.tabs.selections !== frame.saved.selections;
    if (isPickedSinceLoad) {
      frame.awaitedSelectedTabId = null;
    }
    frame.placeWrites.write({
      selectedTabId: frame.awaitedSelectedTabId ?? frame.tabs.selectedTabId,
      selections: frame.tabs.selections,
      takeOvers: frame.takeOvers,
    });
  };

  // Stores the session's next tabs and writes its place, running `changed` only
  // when the tabs changed.
  const setTabs = (frame: Frame, tabs: TabsState) => {
    const isChanged = tabs !== frame.tabs;
    frame.tabs = tabs;
    writePlace(frame);
    if (isChanged) {
      changed();
    }
  };

  // Drops each take over whose tab the session no longer holds.
  const dropDeadTakeOvers = (frame: Frame) => {
    frame.takeOvers = takeOversWithLiveTabs(frame.takeOvers, frame.tabs.tabIds);
  };

  const select = (sessionId: string, tabId: string) => {
    const frame = frames.get(sessionId);
    if (frame !== undefined) {
      setTabs(frame, tabsAfterSelect(frame.tabs, tabId));
    }
  };

  // The live tab's frame, or undefined once the tab was dropped or removed.
  const liveTab = (sessionId: string, tab: Tab): Frame | undefined => {
    const frame = frames.get(sessionId);
    return frame?.entries.get(tab.view.id) === tab ? frame : undefined;
  };

  // Gives back the take over `tabId` holds, if any, as its release does.
  const release = (frame: Frame, tabId: string) => {
    dropDeadTakeOvers(frame);
    frame.savedTakeOverTabIds.delete(tabId);
    const held = frame.takeOvers.find((takeOver) => takeOver.tabId === tabId);
    if (held === undefined) {
      writePlace(frame);
      return;
    }
    frame.takeOvers = takeOversAfterRelease(frame.takeOvers, held);
    setTabs(frame, tabsAfterRelease(frame.tabs, held));
  };

  // Takes over with `tabId`: the take overs whose tab left drop, and a take over
  // the last page saved for `tabId` gives way to this one, which remembers the
  // saved one's tab when only the restored add selected `tabId`.
  const takeOverFresh = (frame: Frame, tabId: string) => {
    dropDeadTakeOvers(frame);
    const savedTakeOver = frame.savedTakeOverTabIds.delete(tabId)
      ? frame.takeOvers.find((takeOver) => takeOver.tabId === tabId)
      : undefined;
    if (savedTakeOver !== undefined) {
      frame.takeOvers = frame.takeOvers.filter(
        (takeOver) => takeOver !== savedTakeOver,
      );
    }
    const isSelectedByRestoredAdd =
      frame.saved?.selectedTabId === tabId &&
      frame.tabs.selectedTabId === tabId &&
      frame.tabs.selections === frame.saved.selections;
    const taken = tabsAfterTakeOver(frame.tabs, tabId);
    const takeOver =
      savedTakeOver !== undefined && isSelectedByRestoredAdd
        ? { ...taken.takeOver, previousTabId: savedTakeOver.previousTabId }
        : taken.takeOver;
    const isHeld = frame.takeOvers.some((held) => held.tabId === tabId);
    if (!isHeld) {
      frame.takeOvers = [...frame.takeOvers, takeOver];
    }
    setTabs(frame, taken.tabs);
  };

  // Adopts the take over the last page saved for `tabId`, selecting nothing;
  // false when it saved none.
  const takeOverRestored = (frame: Frame, tabId: string): boolean => {
    frame.savedTakeOverTabIds.delete(tabId);
    return frame.takeOvers.some((takeOver) => takeOver.tabId === tabId);
  };

  const remove = (frame: Frame, tab: Tab) => {
    tab.view.element.remove();
    frame.tabs = tabsAfterRemove(frame.tabs, tab.view.id);
    frame.entries.delete(tab.view.id);
    writePlace(frame);
    changed();
  };

  const drop = (sessionId: string) => {
    const frame = frames.get(sessionId);
    if (frame === undefined) {
      return;
    }
    disposeTabs(frame);
    disposeText(frame);
    frame.bar.dispose();
    frame.element.remove();
    frames.delete(sessionId);
    draw();
  };

  return {
    holder,
    render(next) {
      state = next;
      draw();
    },
    place,
    vacate,
    redrawPane() {
      for (const frame of frames.values()) {
        redrawBar(frame);
      }
      const placed = [...panes].map(([id, pane]) => {
        pane.input = null;
        return { id, slot: pane.slot, sessionId: pane.sessionId };
      });
      if (focusedPaneId === null) {
        draw();
        return;
      }
      place(placed, focusedPaneId, focusedEdges);
    },
    redrawBars() {
      for (const frame of frames.values()) {
        redrawBar(frame);
      }
      draw();
    },
    rescroll() {
      for (const pane of panes.values()) {
        const frame =
          pane.sessionId === null ? undefined : frames.get(pane.sessionId);
        if (frame !== undefined) {
          frame.scrolledTabId = null;
          scrollSelectedIntoView(frame);
        }
      }
    },
    add(sessionId, view) {
      const frame = frameOf(sessionId);
      if (view.id === frame.awaitedSelectedTabId) {
        frame.awaitedSelectedTabId = null;
      }
      const tab: Tab = { view };
      const entries = new Map(frame.entries).set(view.id, tab);
      const added = tabsAfterAdd(
        frame.tabs,
        sessionId,
        view.id,
        (id) => entries.get(id)?.view.order,
      );
      frame.tabs =
        frame.saved === null
          ? added
          : tabsAfterRestoredAdd(added, view.id, frame.saved);
      frame.entries = new Map(
        frame.tabs.tabIds.map((id) => [id, entries.get(id)!]),
      );
      frame.body.append(view.element);
      writePlace(frame);
      changed();
      return {
        select() {
          if (liveTab(sessionId, tab) !== undefined) {
            select(sessionId, view.id);
          }
        },
        takeOver(options) {
          const live = liveTab(sessionId, tab);
          if (live === undefined) {
            return { release() {} };
          }
          if (options?.restored === true) {
            if (!takeOverRestored(live, view.id)) {
              return { release() {} };
            }
          } else {
            takeOverFresh(live, view.id);
          }
          // A handle releases once, so a stale one leaves a later take over.
          let isReleased = false;
          return {
            release() {
              const stillLive = liveTab(sessionId, tab);
              if (isReleased || stillLive === undefined) {
                return;
              }
              isReleased = true;
              release(stillLive, view.id);
            },
          };
        },
        dispose() {
          const live = liveTab(sessionId, tab);
          if (live !== undefined) {
            release(live, view.id);
            remove(live, tab);
          }
        },
        isVisible: () =>
          deps.isModeShown() &&
          focusedSessionId() === sessionId &&
          liveTab(sessionId, tab)?.tabs.selectedTabId === view.id,
      };
    },
    drop,
    // Panes last: each `drop` draws the empty panes' text again.
    dropAll: () =>
      callEach<() => void>(
        [
          () => callEach([...frames.keys()], drop),
          () => callEach([...panes], ([id, pane]) => dropPane(id, pane)),
        ],
        (step) => step(),
      ),
    tabsOf: (sessionId) =>
      [...(frames.get(sessionId)?.entries.values() ?? [])].map(
        (tab) => tab.view,
      ),
    selectedTabOf(sessionId) {
      const frame = frames.get(sessionId);
      const selectedTabId = frame?.tabs.selectedTabId ?? null;
      return selectedTabId === null
        ? null
        : (frame?.entries.get(selectedTabId)?.view ?? null);
    },
    select,
  };
}

function removeChildrenExcept(parent: HTMLElement, kept: HTMLElement): void {
  for (const child of Array.from(parent.children)) {
    if (child !== kept) {
      child.remove();
    }
  }
}

function isSameInput(a: PaneInput, b: PaneInput): boolean {
  return (
    a.isFocused === b.isFocused &&
    a.edges.length === b.edges.length &&
    a.edges.every((edge, index) => edge === b.edges[index])
  );
}

const EMPTY_TEXT: EmptyTextInput = {
  text: "No sessions yet: one shows here when its agent's relay connects",
  hasHint: false,
};

const NO_SELECTION_TEXT: EmptyTextInput = {
  text: 'Pick a session in the side bar',
  hasHint: true,
};

const NOTHING_OPEN_TEXT: EmptyTextInput = {
  text: 'Nothing open in this session yet',
  hasHint: false,
};

// Why a pane showing `sessionId` (null for an empty pane) shows no tab, or
// null when it shows one or main's first state has not arrived. The pick
// hint, whose key steps the focused pane, draws only when `isFocusedPane`.
function textFor(
  state: SessionsState | null,
  sessionId: string | null,
  tabCount: number,
  isFocusedPane: boolean,
): EmptyTextInput | null {
  const shown =
    state === null ? null : { ...state, selectedSessionId: sessionId };
  if (showsEmptyText(shown)) {
    return EMPTY_TEXT;
  }
  if (showsNoSelectionText(shown)) {
    return { ...NO_SELECTION_TEXT, hasHint: isFocusedPane };
  }
  const isNothingOpen = shown !== null && sessionId !== null && tabCount === 0;
  return isNothingOpen ? NOTHING_OPEN_TEXT : null;
}

function drawTab(
  parts: SessionsParts,
  strip: HTMLElement,
  view: SessionTabView,
  isActive: boolean,
  select: () => void,
): DrawnPart<SessionsPart> {
  const drawn = parts.tab(strip, { title: view.title, icon: view.icon });
  const entry = drawn.built.element;
  rowAction(entry, select);
  entry.title = view.title;
  entry.setAttribute('aria-label', view.title);
  entry.classList.toggle('is-active', isActive);
  entry.setAttribute('aria-current', String(isActive));
  return drawn;
}
