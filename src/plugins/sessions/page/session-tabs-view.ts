import type { PaneDirection } from '../../../contracts/panes';
import { element } from '../../../shared/page/dom';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { rowAction } from '../../../shared/page/ui/row';
import { sheet } from '../../../shared/page/ui/sheet';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsState,
  SessionTabHandle,
  SessionTabView,
} from '../contract';
import type {
  EmptyTextInput,
  PaneInput,
  PanePart,
  SessionsPart,
} from '../layouts/layout';
import { sessionsManifest } from '../manifest';
import type { DrawnTabBar, SessionsParts } from './layout/sessions-parts';
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

// A session's frame: its tab bar over the sheet holding its tabs' body and
// the text saying why no tab shows; its tab ids and selection, and its tabs
// by id in add order.
interface Frame {
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
  part: DrawnPart<PanePart> | null;
  empty: HTMLElement;
  text: DrawnPart<SessionsPart> | null;
}

// `isModeShown` reads whether Sessions mode shows; `changed` runs after any
// change to a session's tabs, their selection or their statuses; `keys`
// draws the key beside the text asking for a session to be picked; `parts`
// draws the panes, the tab bars, the tabs and that text.
export interface SessionTabsDeps {
  isModeShown(): boolean;
  changed(): void;
  keys: Pick<KeysPageExports, 'anchor'>;
  parts: SessionsParts;
}

export interface SessionTabsView {
  // The hidden holder of every frame no pane shows; the owner keeps it in the
  // document.
  holder: HTMLElement;
  render(state: SessionsState): void;
  // Draws each pane's `pane` part into its slot, again when its input
  // changed, and moves each session's frame into the body of the pane that
  // shows it, the rest into the holder. `edges` are the focused pane's.
  place(
    panes: readonly PanePlace[],
    focusedPaneId: string,
    edges: readonly PaneDirection[],
  ): void;
  // Draws every pane and tab bar again with the parts' current layouts, then
  // the tabs and the texts; the tab bodies and their elements stay as they are.
  redrawPane(): void;
  add(sessionId: string, view: SessionTabView): SessionTabHandle;
  // Drops the session's frame, its tabs and their elements; their handles
  // then do nothing. Runs no `changed`.
  drop(sessionId: string): void;
  // The session's tabs, in add order.
  tabsOf(sessionId: string): SessionTabView[];
  statusesOf(sessionId: string): string[];
  selectedTabOf(sessionId: string): SessionTabView | null;
  select(sessionId: string, tabId: string): void;
}

// Sessions mode's chat panes, drawn through the sessions layout. Each pane is
// the `pane` part, whose body holds the frame of the session it shows: the
// `tabBar` (the session's tab strip between its previous and next tab
// prompts, the close prompt and the pane controls at the bar's end) on the top
// edge of a sheet holding the session's tabs, only its selected tab showing,
// or the `emptyText` saying why no tab shows. An empty pane's body holds a
// sheet with the empty text alone. The tab prompts hide while the session has
// no other tab, and every tab bar's prompts and pane control keys hide outside
// the focused pane, whose keys they are. A tab's element fills its frame's
// sheet, and a frame moves between panes as the same element. A frame no pane
// shows, a session's with no row yet included, waits in the hidden holder.
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

  const drawBar = (frame: Pick<Frame, 'barHost'>): DrawnPart<DrawnTabBar> => {
    frame.barHost.replaceChildren();
    return parts.tabBar(frame.barHost);
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
    const created: Frame = {
      element: frameElement,
      barHost,
      bar: drawBar({ barHost }),
      bodies,
      body,
      tabs: NO_TABS,
      entries: new Map(),
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

  // Scrolls the strip, and nothing around it, to the selected tab once each
  // time the selection changes, so a tab the user scrolled past stays put.
  const scrollSelectedIntoView = (frame: Frame) => {
    const selectedId = frame.tabs.selectedTabId;
    if (selectedId === frame.scrolledTabId) {
      return;
    }
    frame.scrolledTabId = selectedId;
    const index = [...frame.entries.keys()].indexOf(selectedId ?? '');
    frame.drawnTabs[index]?.built.element.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    });
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

  // Draws `pane`'s part again when `input` differs from the one it drew with,
  // or when it was marked for a redraw.
  const drawPanePart = (pane: DrawnPane, input: PaneInput) => {
    if (
      pane.part !== null &&
      pane.input !== null &&
      isSameInput(pane.input, input)
    ) {
      return pane.part.built.body;
    }
    pane.part?.dispose();
    pane.slot.replaceChildren();
    pane.part = parts.pane(pane.slot, input);
    pane.input = input;
    return pane.part.built.body;
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
        disposeText(pane);
        pane.part?.dispose();
        panes.delete(paneId);
      }
    }
    const shown = new Set<HTMLElement>();
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
      shown.add(content);
      if (body.children[0] !== content || body.children.length !== 1) {
        body.replaceChildren(content);
      }
    }
    for (const frame of frames.values()) {
      if (!shown.has(frame.element) && frame.element.parentNode !== holder) {
        holder.append(frame.element);
      }
    }
    draw();
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

  return {
    holder,
    render(next) {
      state = next;
      draw();
    },
    place,
    redrawPane() {
      for (const frame of frames.values()) {
        disposeTabs(frame);
        frame.bar.dispose();
        frame.bar = drawBar(frame);
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
    add(sessionId, view) {
      const frame = frameOf(sessionId);
      frame.tabs = tabsAfterAdd(frame.tabs, sessionId, view.id);
      const tab: Tab = { view, status: '' };
      frame.entries.set(view.id, tab);
      frame.body.append(view.element);
      changed();
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
          return {
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
        },
        remove() {
          const live = liveTab(sessionId, tab);
          if (live !== undefined) {
            remove(live, tab);
          }
        },
        isVisible: () =>
          deps.isModeShown() &&
          focusedSessionId() === sessionId &&
          liveTab(sessionId, tab)?.tabs.selectedTabId === view.id,
      };
    },
    drop(sessionId) {
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
    },
    tabsOf: (sessionId) =>
      [...(frames.get(sessionId)?.entries.values() ?? [])].map(
        (tab) => tab.view,
      ),
    statusesOf: (sessionId) =>
      [...(frames.get(sessionId)?.entries.values() ?? [])].map(
        (tab) => tab.status,
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
  text: "Nothing open yet: this session's first round opens a Form tab here",
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
