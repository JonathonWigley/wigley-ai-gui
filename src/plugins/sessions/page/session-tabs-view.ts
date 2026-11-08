import type { PaneDirection } from '../../../contracts/panes';
import { callEach } from '../../../shared/call-each';
import {
  blurFocusedElement,
  element,
  moveConnected,
} from '../../../shared/page/dom';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeyHints } from '../../../contracts/plugin';
import type {
  SessionPopupHandle,
  SessionPopupView,
  SessionsState,
  SessionTabHandle,
  SessionTabView,
} from '../contract';
import type {
  EmptyTextInput,
  PaneInput,
  PopupBarPart,
  PopupPart,
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
  tabsAfterSelect,
  tabsAfterTakeOver,
} from './tabs';

// A tab with the status it last set.
interface Tab {
  view: SessionTabView;
  status: string;
}

// A popup with the status it last set, whether it is open, whether the
// animation frame after its add ran (until then it draws closed, so its slide
// up runs), and its drawn `popup` part, whose body holds its element.
interface Popup {
  view: SessionPopupView;
  status: string;
  isOpen: boolean;
  hasEntered: boolean;
  part: DrawnPart<PopupPart>;
}

// A session's frame: its session, its tab bar over the sheet holding its
// tabs' body, the text saying why no tab shows and the popup layer over them,
// then the host of its hidden popups' bar; its tab ids and selection, and its
// tabs by id, both in strip order; its popups, the one opened or hidden last
// at the end.
interface Frame {
  sessionId: string;
  element: HTMLElement;
  barHost: HTMLElement;
  bar: DrawnPart<DrawnTabBar>;
  bodies: HTMLElement;
  body: HTMLElement;
  tabs: TabsState;
  entries: Map<string, Tab>;
  drawnTabs: DrawnPart<SessionsPart>[];
  // The selected tab the strip last scrolled into view.
  scrolledTabId: string | null;
  text: DrawnPart<SessionsPart> | null;
  popupLayer: HTMLElement;
  popupBarHost: HTMLElement;
  popups: Popup[];
  popupBar: DrawnPart<PopupBarPart> | null;
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
// change to a session's tabs, their selection or their statuses, or to its
// popups, which is open or their statuses; `keys` draws the key beside the
// text asking for a session to be picked; `parts` draws the panes, the tab
// bars with the bar parts other plugins added, the tabs, that text, the
// popups and their bars.
export interface SessionTabsDeps {
  isModeShown(): boolean;
  changed(): void;
  keys: Pick<KeyHints, 'anchor'>;
  parts: SessionsParts;
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
  // Adds and opens the popup, as `SessionsPageExports.addPopup` says.
  addPopup(sessionId: string, view: SessionPopupView): SessionPopupHandle;
  // Drops the session's frame, its tabs, its popups and their elements; their
  // handles then do nothing. Runs no `changed`.
  drop(sessionId: string): void;
  // Drops every frame as `drop` does, then every pane with its part and text,
  // a throw not skipping the rest.
  dropAll(): void;
  // The session's tabs, in strip order.
  tabsOf(sessionId: string): SessionTabView[];
  // The session's popups, the one opened or hidden last at the end.
  popupsOf(sessionId: string): SessionPopupView[];
  // Its tabs' statuses in strip order, then its popups' in `popupsOf` order.
  statusesOf(sessionId: string): string[];
  selectedTabOf(sessionId: string): SessionTabView | null;
  // The session's top open popup, the open one opened last; null for none.
  openPopupOf(sessionId: string): SessionPopupView | null;
  select(sessionId: string, tabId: string): void;
  // Hides the session's top open popup; with none open, opens the popup
  // hidden last. Returns that popup and whether it is now open; null when the
  // session holds no popup.
  togglePopup(
    sessionId: string,
  ): { popup: SessionPopupView; isOpen: boolean } | null;
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
// included, waits in the hidden holder. Over the sheet lies the frame's popup
// layer: each popup's `popup` part, drawn once on add and again on a layout
// redraw, holds the plugin's element; only the session's top open popup shows
// (`is-open`), sliding up on the animation frame after its add, the rest
// hidden and `inert`, and the strip above it is dimmed. Under the sheet the
// `popupBar` lists the hidden popups, newest hidden first, a click on an entry
// opening it; it is absent while none is hidden. A popup that opens takes
// focus from a text box in the frame's tabs; sessions focuses nothing in it.
// Until `render` hands it main's first state, it shows no text either. The
// view keeps each tab's click, its tooltip and the active tab's mark.
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
    const popupLayer = element('div', 'session-popups');
    popupLayer.append(element('div', 'session-popup-scrim'));
    bodies.append(body, popupLayer);
    const popupBarHost = element('div', 'session-popup-bar-host');
    popupBarHost.style.display = 'contents';
    frameElement.append(barHost, bodies, popupBarHost);
    holder.append(frameElement);
    const created: Frame = {
      sessionId,
      element: frameElement,
      barHost,
      bar: drawBar({ sessionId, barHost }),
      bodies,
      body,
      tabs: NO_TABS,
      entries: new Map(),
      drawnTabs: [],
      scrolledTabId: null,
      text: null,
      popupLayer,
      popupBarHost,
      popups: [],
      popupBar: null,
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

  // Draws the popup's `popup` part into the frame's layer, its element moved
  // into the part's body by a connected move.
  const drawPopup = (
    frame: Frame,
    view: SessionPopupView,
  ): DrawnPart<PopupPart> => {
    const part = parts.popup(frame.popupLayer, {
      title: view.title,
      icon: view.icon,
    });
    moveConnected(part.built.body, view.element);
    return part;
  };

  const redrawPopups = (frame: Frame) => {
    for (const popup of frame.popups) {
      const old = popup.part;
      popup.part = drawPopup(frame, popup.view);
      disposePart(old);
    }
  };

  // Shows the top open popup once it entered, every other popup hidden and
  // inert, and dims the strip above it.
  const showTopPopup = (frame: Frame) => {
    const top = topOpenPopup(frame.popups);
    const shown = top?.hasEntered === true ? top : undefined;
    for (const popup of frame.popups) {
      const root = popup.part.built.element;
      root.classList.toggle('is-open', popup === shown);
      root.inert = popup !== shown;
    }
    frame.popupLayer.classList.toggle('has-open', shown !== undefined);
  };

  const drawPopupBar = (frame: Frame) => {
    if (frame.popupBar !== null) {
      disposePart(frame.popupBar);
      frame.popupBar = null;
    }
    const hidden = hiddenNewestFirst(frame.popups);
    if (hidden.length === 0) {
      return;
    }
    frame.popupBar = parts.popupBar(frame.popupBarHost, {
      entries: hidden.map((popup) => ({
        title: popup.view.title,
        icon: popup.view.icon,
        status: popup.status,
      })),
    });
    frame.popupBar.built.entries.forEach((entry, index) => {
      const popup = hidden[index];
      entry.setAttribute('aria-label', popup.view.title);
      rowAction(entry, () => openPopup(frame.sessionId, popup));
    });
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
        () => select(sessionId, tab.view.id),
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
    showTopPopup(frame);
    drawPopupBar(frame);
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

  // Stores the session's next tabs, running `changed` only when they changed.
  const setTabs = (frame: Frame, tabs: TabsState) => {
    if (tabs === frame.tabs) {
      return;
    }
    frame.tabs = tabs;
    changed();
  };

  const select = (sessionId: string, tabId: string) => {
    const frame = frames.get(sessionId);
    if (frame !== undefined) {
      setTabs(frame, tabsAfterSelect(frame.tabs, tabId));
    }
  };

  // The live popup's frame, or undefined once the popup was dropped or removed.
  const livePopup = (sessionId: string, popup: Popup): Frame | undefined => {
    const frame = frames.get(sessionId);
    return frame?.popups.includes(popup) === true ? frame : undefined;
  };

  // Moves the popup to the end of its session's popups, open or hidden; an
  // opening popup takes focus from a text box in the frame's tabs first.
  const setPopupOpen = (frame: Frame, popup: Popup, isOpen: boolean) => {
    frame.popups = [...frame.popups.filter((held) => held !== popup), popup];
    popup.isOpen = isOpen;
    if (isOpen) {
      blurFocusInTabs(frame);
    }
    changed();
  };

  // Makes the live popup its session's top open popup; nothing when it is.
  const openPopup = (sessionId: string, popup: Popup) => {
    const frame = livePopup(sessionId, popup);
    if (frame !== undefined && topOpenPopup(frame.popups) !== popup) {
      setPopupOpen(frame, popup, true);
    }
  };

  const removePopup = (frame: Frame, popup: Popup) => {
    disposePart(popup.part);
    popup.view.element.remove();
    frame.popups = frame.popups.filter((held) => held !== popup);
    changed();
  };

  // The live tab's frame, or undefined once the tab was dropped or removed.
  const liveTab = (sessionId: string, tab: Tab): Frame | undefined => {
    const frame = frames.get(sessionId);
    return frame?.entries.get(tab.view.id) === tab ? frame : undefined;
  };

  const remove = (frame: Frame, tab: Tab) => {
    tab.view.element.remove();
    frame.tabs = tabsAfterRemove(frame.tabs, tab.view.id);
    frame.entries.delete(tab.view.id);
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
    for (const popup of frame.popups) {
      popup.part.dispose();
    }
    frame.popupBar?.dispose();
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
        redrawPopups(frame);
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
      const tab: Tab = { view, status: '' };
      const entries = new Map(frame.entries).set(view.id, tab);
      frame.tabs = tabsAfterAdd(
        frame.tabs,
        sessionId,
        view.id,
        (id) => entries.get(id)?.view.order,
      );
      frame.entries = new Map(
        frame.tabs.tabIds.map((id) => [id, entries.get(id)!]),
      );
      frame.body.append(view.element);
      changed();
      let latestTakeOver: { release(): void } | null = null;
      return {
        setStatus(status) {
          if (liveTab(sessionId, tab) !== undefined) {
            tab.status = status;
            changed();
          }
        },
        select() {
          if (liveTab(sessionId, tab) !== undefined) {
            select(sessionId, view.id);
          }
        },
        takeOver() {
          const live = liveTab(sessionId, tab);
          if (live === undefined) {
            return { release() {} };
          }
          const taken = tabsAfterTakeOver(live.tabs, view.id);
          setTabs(live, taken.tabs);
          let isReleased = false;
          latestTakeOver = {
            release() {
              const stillLive = liveTab(sessionId, tab);
              if (isReleased || stillLive === undefined) {
                return;
              }
              isReleased = true;
              setTabs(
                stillLive,
                tabsAfterRelease(stillLive.tabs, taken.takeOver),
              );
            },
          };
          return latestTakeOver;
        },
        dispose() {
          latestTakeOver?.release();
          const live = liveTab(sessionId, tab);
          if (live !== undefined) {
            remove(live, tab);
          }
        },
        isVisible() {
          const live = liveTab(sessionId, tab);
          const isSelectedInFocusedPane =
            deps.isModeShown() &&
            focusedSessionId() === sessionId &&
            live?.tabs.selectedTabId === view.id;
          return (
            isSelectedInFocusedPane && topOpenPopup(live.popups) === undefined
          );
        },
      };
    },
    addPopup(sessionId, view) {
      const frame = frameOf(sessionId);
      if (frame.popups.some((held) => held.view.id === view.id)) {
        throw new Error(
          `Session ${sessionId} already has a popup "${view.id}"`,
        );
      }
      const popup: Popup = {
        view,
        status: '',
        isOpen: true,
        hasEntered: false,
        part: drawPopup(frame, view),
      };
      frame.popups = [...frame.popups, popup];
      blurFocusInTabs(frame);
      changed();
      requestAnimationFrame(() => {
        const live = livePopup(sessionId, popup);
        if (live !== undefined) {
          popup.hasEntered = true;
          showTopPopup(live);
        }
      });
      return {
        setStatus(status) {
          if (livePopup(sessionId, popup) !== undefined) {
            popup.status = status;
            changed();
          }
        },
        open: () => openPopup(sessionId, popup),
        hide() {
          const live = livePopup(sessionId, popup);
          if (live !== undefined && popup.isOpen) {
            setPopupOpen(live, popup, false);
          }
        },
        isVisible() {
          const live = livePopup(sessionId, popup);
          return (
            deps.isModeShown() &&
            focusedSessionId() === sessionId &&
            live !== undefined &&
            topOpenPopup(live.popups) === popup
          );
        },
        dispose() {
          const live = livePopup(sessionId, popup);
          if (live !== undefined) {
            removePopup(live, popup);
          }
        },
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
    popupsOf: (sessionId) =>
      (frames.get(sessionId)?.popups ?? []).map((popup) => popup.view),
    statusesOf(sessionId) {
      const frame = frames.get(sessionId);
      return [...(frame?.entries.values() ?? []), ...(frame?.popups ?? [])].map(
        (shown) => shown.status,
      );
    },
    selectedTabOf(sessionId) {
      const frame = frames.get(sessionId);
      const selectedTabId = frame?.tabs.selectedTabId ?? null;
      return selectedTabId === null
        ? null
        : (frame?.entries.get(selectedTabId)?.view ?? null);
    },
    openPopupOf(sessionId) {
      const popups = frames.get(sessionId)?.popups ?? [];
      return topOpenPopup(popups)?.view ?? null;
    },
    select,
    togglePopup(sessionId) {
      const frame = frames.get(sessionId);
      if (frame === undefined) {
        return null;
      }
      const top = topOpenPopup(frame.popups);
      const toggled = top ?? hiddenNewestFirst(frame.popups)[0];
      if (toggled === undefined) {
        return null;
      }
      setPopupOpen(frame, toggled, top === undefined);
      return { popup: toggled.view, isOpen: toggled.isOpen };
    },
  };
}

function disposePart(part: DrawnPart<SessionsPart>): void {
  part.dispose();
  part.built.element.remove();
}

// The open popup opened last, the one that shows; undefined with none open.
function topOpenPopup(popups: readonly Popup[]): Popup | undefined {
  return popups.findLast((popup) => popup.isOpen);
}

function hiddenNewestFirst(popups: readonly Popup[]): Popup[] {
  return popups.filter((popup) => !popup.isOpen).reverse();
}

// Takes focus from an element in the frame's tabs, so typing never lands in a
// box a popup covers.
function blurFocusInTabs(frame: Frame): void {
  if (frame.body.contains(document.activeElement)) {
    blurFocusedElement();
  }
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
  text: "Nothing open yet: this session's first round opens here",
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
