import type { Timers } from '../../../contracts/ambient';
import type { PluginLog } from '../../../contracts/log';
import type { PaneDirection } from '../../../contracts/panes';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import {
  blurFocusedElement,
  element,
  moveConnected,
} from '../../../shared/page/dom';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { type PlaceWrites, placeWrites } from '../../../shared/page/place-slot';
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import {
  createSplitDivider,
  type SplitDivider,
} from '../../../shared/page/ui/split';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeyHints } from '../../../contracts/plugin';
import type { KeyedSlotWriter } from '../../../contracts/state';
import type { UiState } from '../../../contracts/ui-state';
import type {
  SessionDrawerHandle,
  SessionDrawerView,
  SessionPopupHandle,
  SessionPopupView,
  SessionsPlace,
  SessionsState,
  SessionTabHandle,
  SessionTabView,
} from '../contract';
import type {
  DrawerPart,
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
  tabsAfterRemove,
  tabsAfterRestoredAdd,
  tabsAfterSelect,
} from './tabs';

interface Tab {
  view: SessionTabView;
}

// A tab's drawn `tab` part and the title and icon it drew with.
interface DrawnTab {
  part: DrawnPart<SessionsPart>;
  title: string;
  icon: string;
}

// A hidden popup's entry in its frame's drawn bar: the popup's view id and
// what the entry drew.
interface PopupBarEntry {
  id: string;
  title: string;
  icon: string;
  status: string;
}

// A popup with the status it last set, whether it is open, and its drawn
// `popup` part, whose body holds its element.
interface Popup {
  view: SessionPopupView;
  status: string;
  isOpen: boolean;
  part: DrawnPart<PopupPart>;
}

// A session's drawer: its view, its drawn `drawer` part, whose body holds the
// view's element, the divider on the part's handle, whether it is open, and
// whether `shown` has run and the drawer has not stopped being visible since.
interface Drawer {
  view: SessionDrawerView;
  part: DrawnPart<DrawerPart>;
  divider: SplitDivider;
  isOpen: boolean;
  isShown: boolean;
}

// A session's frame: its session, its tab bar over the sheet holding its
// tabs' body, the text saying why no tab shows and the popup layer over them,
// then the host of its drawer, hidden while the drawer is closed or absent,
// and the host of its hidden popups' bar; its drawer, null for none; its tab
// ids and selection, and its
// tabs by id, both in strip order; its popups, the one opened or hidden last
// at the end; the place the last page saved for its session, or the one its
// selected tab left when removed, null for none; the tab that place had
// selected while that tab has not come back and no pick moved the selection
// since that place was taken (null once either happened), the popups
// that place had hidden that have not been added again since the load, and the
// writes of its place.
interface Frame {
  sessionId: string;
  element: HTMLElement;
  barHost: HTMLElement;
  bar: DrawnPart<DrawnTabBar>;
  bodies: HTMLElement;
  body: HTMLElement;
  tabs: TabsState;
  entries: Map<string, Tab>;
  saved: SessionsPlace | null;
  awaitedSelectedTabId: string | null;
  awaitedHiddenPopupIds: Set<string>;
  placeWrites: PlaceWrites<SessionsPlace>;
  // The drawn tabs by tab id.
  drawnTabs: Map<string, DrawnTab>;
  // The selected tab the strip last scrolled into view.
  scrolledTabId: string | null;
  text: DrawnPart<SessionsPart> | null;
  popupLayer: HTMLElement;
  drawerHost: HTMLElement;
  drawer: Drawer | null;
  popupBarHost: HTMLElement;
  popups: Popup[];
  popupBar: DrawnPart<PopupBarPart> | null;
  // The entries the drawn bar holds, newest hidden first; empty while no bar
  // is drawn.
  popupBarEntries: PopupBarEntry[];
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
// change to a session's tabs or their selection, or to its popups, which is
// open or their statuses; `popupOpenedFromBar` runs after a click on a hidden
// popup's bar entry opened it, after `changed`; `keys` draws the key beside the
// text asking for a session to be picked; `parts` draws the panes, the tab bars
// with the bar parts other plugins added, the tabs, that text, the popups and
// their bars and the drawers; `selectTab` runs on a tab's click. `places`
// holds each session's place: a new frame reads the last page's, and each
// change writes it. `uiState` holds the one drawer height every drawer shows,
// `timers` runs a drawer handle's prompt linger, `log` records a drawer's
// throwing `shown`, and `drawerLeft` hands the keys from a drawer holding
// focus to the focused pane's selected tab.
export interface SessionTabsDeps {
  isModeShown(): boolean;
  changed(): void;
  selectTab(sessionId: string, tabId: string): void;
  popupOpenedFromBar(sessionId: string, popup: SessionPopupView): void;
  keys: Pick<KeyHints, 'anchor'>;
  parts: SessionsParts;
  places: Pick<KeyedSlotWriter<SessionsPlace>, 'get' | 'set'>;
  uiState: UiState;
  timers: Timers;
  log: PluginLog;
  drawerLeft(): void;
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
  // Draws every pane, tab bar, popup and drawer again with the parts' current
  // layouts, then the tabs and the texts; the tab bodies and their elements
  // stay as they are.
  redrawPane(): void;
  // Draws every tab bar again, then the tabs and the texts, for a bar part
  // added or removed; the panes, the tab bodies and their elements stay as
  // they are.
  redrawBars(): void;
  // Scrolls each pane's strip to its selected tab again, for a strip that
  // had no width when the selection changed: the mode was hidden.
  rescroll(): void;
  add(sessionId: string, view: SessionTabView): SessionTabHandle;
  // Adds and opens the popup, or a restored one hidden, as
  // `SessionsPageExports.addPopup` says.
  addPopup(
    sessionId: string,
    view: SessionPopupView,
    options?: { restored?: boolean },
  ): SessionPopupHandle;
  // Drops the session's frame, its tabs, its popups, its drawer and their
  // elements; their handles then do nothing. Runs no `changed`, and no
  // drawer's `shown` or `drawerLeft`.
  drop(sessionId: string): void;
  // Drops every frame as `drop` does, then every pane with its part and text,
  // a throw not skipping the rest.
  dropAll(): void;
  // The session's tabs, in strip order.
  tabsOf(sessionId: string): SessionTabView[];
  // The session's popups, the one opened or hidden last at the end.
  popupsOf(sessionId: string): SessionPopupView[];
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
  // Adds the session's drawer, closed, as `SessionsPageExports.addDrawer`
  // says.
  addDrawer(sessionId: string, view: SessionDrawerView): SessionDrawerHandle;
  // Runs `shown` on each drawer that became visible since its last `shown`,
  // and marks each drawer no longer visible; a throwing `shown` is logged and
  // skips no other drawer. Every draw ends with it; the owner runs it when
  // Sessions mode shows or hides.
  checkDrawers(): void;
  // Moves focus into or out of the focused pane's session's drawer: `down`
  // into a visible drawer not holding focus, `up` out of one holding it.
  // Returns false, moving nothing, for every other case.
  moveDrawerFocus(direction: PaneDirection): boolean;
  // Nudges the focused pane's session's drawer divider while the drawer holds
  // focus, returning what the divider does; false otherwise.
  nudgeDrawer(direction: PaneDirection): boolean;
}

// Sessions mode's chat panes, drawn through the sessions layout. Each pane is
// the `pane` part, whose body holds the frame of the session it shows: the
// `tabBar` (the session's tab strip between its previous and next tab
// prompts, the bar parts other plugins added, the close prompt, the split
// prompts and the close-pane control at the bar's end) on the top edge of a
// sheet holding the session's tabs, only its selected tab showing, or the
// `emptyText` saying why no tab shows. An empty pane's body holds a sheet with
// the empty text alone. The tab prompts hide while the session has no other
// tab, and every tab bar's prompts and the close-pane control's key hide
// outside the focused pane, whose keys they are. A tab's element fills its frame's sheet, and a frame moves between panes, the
// holder and a pane part drawn again as the same element, by a connected move that
// keeps a visual in it loaded; a closing pane's frame moves to the holder
// (`vacate`) before its slot leaves the document. The strip follows each tab's
// `order` (`tabsAfterAdd`). A frame no pane shows, a session's with no row yet
// included, waits in the hidden holder. Over the sheet lies the frame's popup
// layer: each popup's `popup` part, drawn once on add and again on a layout
// redraw, holds the plugin's element; only the session's top open popup shows
// (`is-open`), the rest hidden and `inert`, and the band of the tab body above
// it is dimmed. A popup's root carries `is-entering` from its add until its
// first slide up ends or it hides, so the layout's slide up on add runs once.
// Under the sheet the `popupBar` lists the hidden popups, newest hidden first,
// a click on an entry opening it; it is absent while none is hidden. A popup
// that opens takes focus from a text box in the frame's tabs; sessions focuses
// nothing in it. Between the sheet and that bar, outside the popup layer, sits
// the frame's drawer row: the `drawer` part, drawn on add and again on a
// layout redraw, holds the plugin's element, shown while the drawer is open,
// at the one height every drawer keeps in `uiState` and drags on the part's
// handle; the drawer's `shown` runs each time it becomes visible (open, its
// frame in a pane and the mode shown). Each frame writes its place (selected tab, selection count,
// hidden popups) to `places` on each change, and a new frame starts from the
// place the last page wrote: a tab added late takes back the selection it had
// while no pick moved it since (`tabsAfterRestoredAdd`), and until then the
// place keeps naming that tab as the selected one. A selected tab removed
// while no tab is awaited is awaited the same way, so a tab its plugin's
// restart removes and adds again takes the selection back; a tab still awaited
// stays the one named. A restored popup the place
// had hidden comes back hidden, and until it comes back the place keeps it
// hidden. Until `render` hands it main's first state, it shows no text either.
// The view keeps each tab's click, which runs `selectTab`, its tooltip and the
// active tab's mark. A draw keeps each tab element whose title and icon are
// unchanged, and the popup bar while its entries are, so the first click in an
// unfocused pane, whose release moves pane focus and draws, reaches its target;
// a layout redraw draws them all again.
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
    const drawerHost = element('div', 'session-drawer-host');
    drawerHost.hidden = true;
    const popupBarHost = element('div', 'session-popup-bar-host');
    popupBarHost.style.display = 'contents';
    frameElement.append(barHost, bodies, drawerHost, popupBarHost);
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
      saved,
      awaitedSelectedTabId: saved?.selectedTabId ?? null,
      awaitedHiddenPopupIds: new Set(saved?.hiddenPopupIds),
      placeWrites: placeWrites((place) => deps.places.set(sessionId, place)),
      drawnTabs: new Map(),
      scrolledTabId: null,
      text: null,
      popupLayer,
      drawerHost,
      drawer: null,
      popupBarHost,
      popups: [],
      popupBar: null,
      popupBarEntries: [],
    };
    frames.set(sessionId, created);
    return created;
  };

  // Cleared first, so a later redraw never disposes the same tabs again.
  const disposeTabs = (frame: Frame) => {
    const held = [...frame.drawnTabs.values()];
    frame.drawnTabs.clear();
    callEach(held, (tab) => tab.part.dispose());
  };

  const disposeText = (drawn: { text: DrawnPart<SessionsPart> | null }) => {
    const { text } = drawn;
    drawn.text = null;
    if (text === null) {
      return;
    }
    callEach<() => void>(
      [() => text.dispose(), () => text.built.element.remove()],
      (step) => step(),
    );
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

  // Draws the drawer's `drawer` part into the frame's host, the view's
  // element moved into the part's body by a connected move.
  const drawDrawer = (
    frame: Frame,
    view: SessionDrawerView,
  ): DrawnPart<DrawerPart> => {
    const part = parts.drawer(frame.drawerHost, { id: view.id });
    moveConnected(part.built.body, view.element);
    return part;
  };

  // The divider on `handle` that drags the frame's drawer row, sized from the
  // bottom of the box the tab body and the drawer rows share; it shows the
  // height through the frame's grid tracks.
  const drawerDivider = (frame: Frame, handle: HTMLElement): SplitDivider =>
    createSplitDivider({
      ...DRAWER_SPLIT,
      uiState: deps.uiState,
      stateKey: DRAWER_HEIGHT_KEY,
      axis: 'column',
      sizedPane: 'end',
      handle,
      measure() {
        const { top } = frame.bodies.getBoundingClientRect();
        const { bottom } = frame.drawerHost.getBoundingClientRect();
        return { left: top, span: bottom - top };
      },
      show(height) {
        frame.element.style.setProperty(
          '--session-drawer-height',
          String(height),
        );
      },
      anchor: (node, command) => deps.keys.anchor(node, command),
      timers: deps.timers,
    });

  // Draws the frame's drawer part again, its element and a new divider moving
  // to it, so the next check runs `shown` again while it is visible.
  const redrawDrawer = (frame: Frame) => {
    const { drawer } = frame;
    if (drawer === null) {
      return;
    }
    const old = drawer.part;
    drawer.part = drawDrawer(frame, drawer.view);
    drawer.divider.dispose();
    drawer.divider = drawerDivider(frame, drawer.part.built.handle);
    disposePart(old);
    drawer.isShown = false;
  };

  const isDrawerVisible = (frame: Frame, drawer: Drawer) => {
    const isFrameInPane = frame.element.parentNode !== holder;
    return drawer.isOpen && isFrameInPane && deps.isModeShown();
  };

  const checkDrawers = () => {
    for (const frame of frames.values()) {
      const { drawer } = frame;
      if (drawer === null) {
        continue;
      }
      if (!isDrawerVisible(frame, drawer)) {
        drawer.isShown = false;
        continue;
      }
      if (drawer.isShown) {
        continue;
      }
      drawer.isShown = true;
      try {
        drawer.view.shown();
      } catch (error) {
        deps.log(`drawer ${drawer.view.id} shown failed: ${errorText(error)}`);
      }
    }
  };

  // Hands the keys back to the focused pane's selected tab while the frame's
  // drawer holds focus; a focus elsewhere, the Chat box's, stays.
  const handBackDrawerFocus = (frame: Frame) => {
    if (frame.drawerHost.contains(document.activeElement)) {
      deps.drawerLeft();
    }
  };

  // The focused pane's session's frame and its drawer; null while the pane is
  // empty or the session has no drawer.
  const focusedDrawer = (): { frame: Frame; drawer: Drawer } | null => {
    const sessionId = focusedSessionId();
    const frame = sessionId === null ? undefined : frames.get(sessionId);
    const drawer = frame?.drawer ?? null;
    return frame === undefined || drawer === null ? null : { frame, drawer };
  };

  // Shows the top open popup, every other popup hidden, inert and done
  // entering, and dims the band of the tab body above it.
  const showTopPopup = (frame: Frame) => {
    const shown = topOpenPopup(frame.popups);
    for (const popup of frame.popups) {
      const root = popup.part.built.element;
      root.classList.toggle('is-open', popup === shown);
      root.inert = popup !== shown;
      if (popup !== shown) {
        root.classList.remove(ENTERING);
      }
    }
    frame.popupLayer.classList.toggle('has-open', shown !== undefined);
  };

  // Keeps the drawn bar and its entry elements while its entries are
  // unchanged, so a release that moved pane focus keeps its click's target in
  // the document; else draws it again, or none while no popup is hidden. An
  // entry's click finds its popup by id, doing nothing once none is held.
  const drawPopupBar = (frame: Frame) => {
    const entries = hiddenNewestFirst(frame.popups).map(
      (popup): PopupBarEntry => ({
        id: popup.view.id,
        title: popup.view.title,
        icon: popup.view.icon,
        status: popup.status,
      }),
    );
    const isDrawnBarCurrent =
      frame.popupBar !== null && isSamePopupBar(frame.popupBarEntries, entries);
    if (isDrawnBarCurrent) {
      return;
    }
    disposePopupBar(frame);
    if (entries.length === 0) {
      return;
    }
    frame.popupBar = parts.popupBar(frame.popupBarHost, {
      entries: entries.map(({ title, icon, status }) => ({
        title,
        icon,
        status,
      })),
    });
    frame.popupBarEntries = entries;
    frame.popupBar.built.entries.forEach((entry, index) => {
      const { id, title } = entries[index];
      entry.setAttribute('aria-label', title);
      rowAction(entry, () => {
        const popup = frame.popups.find((each) => each.view.id === id);
        if (popup !== undefined && openPopup(frame.sessionId, popup)) {
          deps.popupOpenedFromBar(frame.sessionId, popup.view);
        }
      });
    });
  };

  // The pane's part leaves its slot, which the pane tree owns.
  const dropPane = (paneId: string, pane: DrawnPane) => {
    panes.delete(paneId);
    callEach<() => void>(
      [
        () => disposeText(pane),
        () => pane.part?.dispose(),
        () => pane.part?.built.element.remove(),
      ],
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
    const tab =
      selectedId === null
        ? undefined
        : frame.drawnTabs.get(selectedId)?.part.built.element;
    if (tab !== undefined) {
      strip.scrollLeft = scrollLeftShowing(strip, tab);
    }
  };

  // Keeps each drawn tab whose title and icon are unchanged, only marking
  // whether it is active, so a release that moved pane focus keeps its click's
  // target in the document; draws the rest afresh, drops those of tabs gone,
  // and moves a tab element only when the strip holds another at its index.
  const drawStrip = (frame: Frame) => {
    const strip = frame.bar.built.strip;
    for (const [tabId, drawn] of frame.drawnTabs) {
      const view = frame.entries.get(tabId)?.view;
      const isDrawnCurrent =
        view !== undefined &&
        view.title === drawn.title &&
        view.icon === drawn.icon;
      if (!isDrawnCurrent) {
        disposePart(drawn.part);
        frame.drawnTabs.delete(tabId);
      }
    }
    let index = 0;
    for (const { view } of frame.entries.values()) {
      let drawn = frame.drawnTabs.get(view.id);
      if (drawn === undefined) {
        drawn = drawTab(parts, strip, view, () =>
          deps.selectTab(frame.sessionId, view.id),
        );
        frame.drawnTabs.set(view.id, drawn);
      }
      const entry = drawn.part.built.element;
      markActive(entry, view.id === frame.tabs.selectedTabId);
      const atIndex = strip.children[index] ?? null;
      if (atIndex !== entry) {
        strip.insertBefore(entry, atIndex);
      }
      index++;
    }
  };

  const drawFrame = (sessionId: string, frame: Frame, isFocused: boolean) => {
    for (const tab of frame.entries.values()) {
      tab.view.element.hidden = tab.view.id !== frame.tabs.selectedTabId;
    }
    drawStrip(frame);
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
    const text = textFor(state, sessionId, frame.entries.size, false);
    frame.text =
      text === null ? null : parts.emptyText(frame.bodies, text, pickHint);
    showTopPopup(frame);
    drawPopupBar(frame);
  };

  // Draws every frame and empty pane, then checks the drawers; every text is
  // dropped before any draws, so the one pick hint is free for whichever text
  // takes it.
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
    checkDrawers();
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
  // still awaited, and the saved hidden popups beside the hidden ones while
  // they are, so a reload before they come back keeps them.
  const writePlace = (frame: Frame) => {
    const isPickedSinceSaved =
      frame.saved !== null && frame.tabs.selections !== frame.saved.selections;
    if (isPickedSinceSaved) {
      frame.awaitedSelectedTabId = null;
    }
    frame.placeWrites.write({
      selectedTabId: frame.awaitedSelectedTabId ?? frame.tabs.selectedTabId,
      selections: frame.tabs.selections,
      hiddenPopupIds: hiddenPopupIds(frame),
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
    writePlace(frame);
    changed();
  };

  // Makes the live popup its session's top open popup and returns true;
  // nothing, returning false, when it is or is no longer live.
  const openPopup = (sessionId: string, popup: Popup): boolean => {
    const frame = livePopup(sessionId, popup);
    if (frame === undefined || topOpenPopup(frame.popups) === popup) {
      return false;
    }
    setPopupOpen(frame, popup, true);
    return true;
  };

  const removePopup = (frame: Frame, popup: Popup) => {
    disposePart(popup.part);
    popup.view.element.remove();
    frame.popups = frame.popups.filter((held) => held !== popup);
    writePlace(frame);
    changed();
  };

  // The live tab's frame, or undefined once the tab was dropped or removed.
  const liveTab = (sessionId: string, tab: Tab): Frame | undefined => {
    const frame = frames.get(sessionId);
    return frame?.entries.get(tab.view.id) === tab ? frame : undefined;
  };

  // A selected tab removed while none is awaited becomes the awaited one, its
  // place taken at the selection count now.
  const remove = (frame: Frame, tab: Tab) => {
    tab.view.element.remove();
    const tabId = tab.view.id;
    if (
      frame.tabs.selectedTabId === tabId &&
      frame.awaitedSelectedTabId === null
    ) {
      frame.awaitedSelectedTabId = tabId;
      frame.saved = {
        selectedTabId: tabId,
        selections: frame.tabs.selections,
        hiddenPopupIds: frame.saved?.hiddenPopupIds ?? [],
      };
    }
    frame.tabs = tabsAfterRemove(frame.tabs, tabId);
    frame.entries.delete(tab.view.id);
    writePlace(frame);
    changed();
  };

  // The frame leaves the map and the page first, so a throwing dispose
  // leaves no half-disposed frame, and the bar still redraws.
  const drop = (sessionId: string) => {
    const frame = frames.get(sessionId);
    if (frame === undefined) {
      return;
    }
    frames.delete(sessionId);
    frame.element.remove();
    try {
      callEach<() => void>(
        [
          () => disposeTabs(frame),
          () => disposeText(frame),
          () => frame.bar.dispose(),
          ...frame.popups.map((popup) => () => popup.part.dispose()),
          () => frame.popupBar?.dispose(),
          () => frame.drawer?.divider.dispose(),
          () => frame.drawer?.part.dispose(),
        ],
        (step) => step(),
      );
    } finally {
      draw();
    }
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
        disposePopupBar(frame);
        redrawDrawer(frame);
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
        disposePopupBar(frame);
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
        dispose() {
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
    addPopup(sessionId, view, options) {
      const frame = frameOf(sessionId);
      if (frame.popups.some((held) => held.view.id === view.id)) {
        throw new Error(
          `Session ${sessionId} already has a popup "${view.id}"`,
        );
      }
      const isSavedHidden = frame.awaitedHiddenPopupIds.delete(view.id);
      const isOpen = !(options?.restored === true && isSavedHidden);
      const popup: Popup = {
        view,
        status: '',
        isOpen,
        part: drawPopup(frame, view),
      };
      frame.popups = [...frame.popups, popup];
      if (isOpen) {
        markEntering(popup.part.built.element);
        blurFocusInTabs(frame);
      }
      writePlace(frame);
      changed();
      return {
        setStatus(status) {
          if (livePopup(sessionId, popup) !== undefined) {
            popup.status = status;
            changed();
          }
        },
        open() {
          openPopup(sessionId, popup);
        },
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
    addDrawer(sessionId, view) {
      const frame = frameOf(sessionId);
      if (frame.drawer !== null) {
        throw new Error(`Session ${sessionId} already has a drawer`);
      }
      const part = drawDrawer(frame, view);
      frame.element.style.setProperty(
        '--session-drawer-end-min',
        String(DRAWER_SPLIT.endMin),
      );
      const drawer: Drawer = {
        view,
        part,
        divider: drawerDivider(frame, part.built.handle),
        isOpen: false,
        isShown: false,
      };
      frame.drawer = drawer;
      // The drawer's frame, or undefined once it was disposed or dropped.
      const liveFrame = (): Frame | undefined => {
        const live = frames.get(sessionId);
        return live?.drawer === drawer ? live : undefined;
      };
      return {
        open({ focus }) {
          const live = liveFrame();
          if (live === undefined) {
            return;
          }
          if (!drawer.isOpen) {
            drawer.isOpen = true;
            live.drawerHost.hidden = false;
            checkDrawers();
          }
          if (focus && isDrawerVisible(live, drawer)) {
            drawer.view.focus();
          }
        },
        close() {
          const live = liveFrame();
          if (live === undefined || !drawer.isOpen) {
            return;
          }
          handBackDrawerFocus(live);
          drawer.isOpen = false;
          drawer.isShown = false;
          live.drawerHost.hidden = true;
        },
        isOpen: () => liveFrame() !== undefined && drawer.isOpen,
        returnFocus() {
          const live = liveFrame();
          if (live !== undefined) {
            handBackDrawerFocus(live);
          }
        },
        dispose() {
          const live = liveFrame();
          if (live === undefined) {
            return;
          }
          handBackDrawerFocus(live);
          live.drawer = null;
          live.drawerHost.hidden = true;
          callEach<() => void>(
            [
              () => drawer.divider.dispose(),
              () => disposePart(drawer.part),
              () => view.element.remove(),
            ],
            (step) => step(),
          );
        },
      };
    },
    checkDrawers,
    moveDrawerFocus(direction) {
      const focused = focusedDrawer();
      if (focused === null) {
        return false;
      }
      const { frame, drawer } = focused;
      const holdsFocus = frame.drawerHost.contains(document.activeElement);
      const canFocusDrawer =
        direction === 'down' && !holdsFocus && isDrawerVisible(frame, drawer);
      if (canFocusDrawer) {
        drawer.view.focus();
        return true;
      }
      if (direction === 'up' && holdsFocus) {
        deps.drawerLeft();
        return true;
      }
      return false;
    },
    nudgeDrawer(direction) {
      const focused = focusedDrawer();
      const holdsFocus =
        focused !== null &&
        focused.frame.drawerHost.contains(document.activeElement);
      return holdsFocus && focused.drawer.divider.nudge(direction);
    },
  };
}

const ENTERING = 'is-entering';

// The uiState key of the one height every drawer shows.
const DRAWER_HEIGHT_KEY = 'drawer-height';

// The drawer's opening and least height, and the least height it leaves the
// tab body, in px.
const DRAWER_SPLIT = { initial: 240, min: 160, endMin: 160 } as const;

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

// The ids of the frame's hidden popups, then of the saved hidden ones not yet
// added again.
function hiddenPopupIds(frame: Frame): string[] {
  const hidden = frame.popups
    .filter((popup) => !popup.isOpen)
    .map((popup) => popup.view.id);
  return [...hidden, ...frame.awaitedHiddenPopupIds];
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
  select: () => void,
): DrawnTab {
  const { title, icon } = view;
  const part = parts.tab(strip, { title, icon });
  const entry = part.built.element;
  rowAction(entry, select);
  entry.title = title;
  entry.setAttribute('aria-label', title);
  return { part, title, icon };
}

function markActive(entry: HTMLElement, isActive: boolean): void {
  entry.classList.toggle('is-active', isActive);
  entry.setAttribute('aria-current', String(isActive));
}

// Whether the two bars list the same popups in the same order, each entry
// drawn alike.
function isSamePopupBar(
  drawn: readonly PopupBarEntry[],
  next: readonly PopupBarEntry[],
): boolean {
  return (
    drawn.length === next.length &&
    drawn.every((entry, index) => {
      const other = next[index];
      return (
        entry.id === other.id &&
        entry.title === other.title &&
        entry.icon === other.icon &&
        entry.status === other.status
      );
    })
  );
}

function disposePopupBar(frame: Frame): void {
  if (frame.popupBar !== null) {
    disposePart(frame.popupBar);
    frame.popupBar = null;
  }
  frame.popupBarEntries = [];
}

// Marks a popup's root `is-entering` until its own transition ends or is
// cancelled, as `openFloatingPanel` marks a panel `is-opening`.
function markEntering(root: HTMLElement): void {
  root.classList.add(ENTERING);
  const settle = (event: Event) => {
    if (event.target !== root) {
      return;
    }
    root.classList.remove(ENTERING);
    root.removeEventListener('transitionend', settle);
    root.removeEventListener('transitioncancel', settle);
  };
  root.addEventListener('transitionend', settle);
  root.addEventListener('transitioncancel', settle);
}
