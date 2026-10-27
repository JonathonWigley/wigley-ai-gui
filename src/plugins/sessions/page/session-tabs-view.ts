import { element } from '../../../shared/page/dom';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { sheet } from '../../../shared/page/ui/sheet';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsState,
  SessionTabHandle,
  SessionTabView,
} from '../contract';
import type { EmptyTextInput, SessionsPart } from '../layouts/layout';
import { sessionsManifest } from '../manifest';
import {
  type DrawnTabBar,
  onPartClick,
  type SessionsParts,
} from './layout/sessions-parts';
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

// A session's tab ids and selection, its tabs by id in add order, and the
// body holding their elements.
interface SessionTabs {
  body: HTMLElement;
  tabs: TabsState;
  entries: Map<string, Tab>;
}

// `isModeShown` reads whether Sessions mode shows; `changed` runs after any
// change to a session's tabs, their selection or their statuses; `keys`
// draws the key beside the text asking for a session to be picked; `parts`
// draws the tab bar, the tabs and that text.
export interface SessionTabsDeps {
  isModeShown(): boolean;
  changed(): void;
  keys: Pick<KeysPageExports, 'anchor'>;
  parts: SessionsParts;
}

export interface SessionTabsView {
  element: HTMLElement;
  render(state: SessionsState): void;
  // Draws the tab bar again with the parts' current layouts, then the tabs
  // and the text; the tab bodies and their elements stay as they are.
  redrawPane(): void;
  add(sessionId: string, view: SessionTabView): SessionTabHandle;
  // Drops the session's tabs and their elements; their handles then do
  // nothing. Runs no `changed`.
  drop(sessionId: string): void;
  // The session's tabs, in add order.
  tabsOf(sessionId: string): SessionTabView[];
  statusesOf(sessionId: string): string[];
  selectedTabOf(sessionId: string): SessionTabView | null;
  select(sessionId: string, tabId: string): void;
}

// The tab area of Sessions mode, its bar, tabs and text drawn through the
// sessions layout: the `tabBar` pane (the selected session's tab strip,
// between its previous and next tab prompts and with the close prompt at the
// bar's end) on the top edge of one sheet holding a body per session, only
// the selected session's body showing and in it only its selected tab, or
// the `emptyText` saying why nothing shows. The tab prompts hide while the
// selected session has no other tab, and the close prompt while none is
// selected. A tab's element fills its body. A tab added for a session with no
// row yet waits in a hidden body. Until `render` hands it main's first state,
// it shows no text either. The view keeps each tab's click, its tooltip and
// the active tab's mark.
export function mountSessionTabsView(deps: SessionTabsDeps): SessionTabsView {
  const { parts } = deps;
  const area = element('div', 'session-area');
  const barHost = element('div', 'session-tabs-host');
  barHost.style.display = 'contents';
  const bodies = sheet();
  bodies.classList.add('session-bodies');
  area.append(barHost, bodies);
  const pickHint = element('span', 'sessions-pick-hint');
  deps.keys.anchor(pickHint, qualify(sessionsManifest.id, 'nextSession'));
  const sessions = new Map<string, SessionTabs>();
  let state: SessionsState | null = null;

  const drawBar = (): DrawnPart<DrawnTabBar> => {
    barHost.replaceChildren();
    return parts.tabBar(barHost);
  };
  let bar = drawBar();
  let tabs: DrawnPart<SessionsPart>[] = [];
  let text: DrawnPart<SessionsPart> | null = null;

  const disposeTabs = () => {
    for (const tab of tabs) {
      tab.dispose();
    }
    tabs = [];
  };

  // Drops the drawn text, then draws `shown` after the bodies when not null.
  const showText = (shown: EmptyTextInput | null) => {
    text?.dispose();
    text?.built.element.remove();
    text = shown === null ? null : parts.emptyText(bodies, shown, pickHint);
  };

  const sessionOf = (sessionId: string): SessionTabs => {
    const existing = sessions.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const created: SessionTabs = {
      body: element('div', 'session-body'),
      tabs: NO_TABS,
      entries: new Map(),
    };
    sessions.set(sessionId, created);
    bodies.append(created.body);
    return created;
  };

  const draw = () => {
    const selectedSessionId = state?.selectedSessionId ?? null;
    for (const [sessionId, session] of sessions) {
      session.body.hidden = sessionId !== selectedSessionId;
      for (const tab of session.entries.values()) {
        tab.view.element.hidden = tab.view.id !== session.tabs.selectedTabId;
      }
    }
    const selected =
      selectedSessionId === null ? undefined : sessions.get(selectedSessionId);
    const selectedTabs = [...(selected?.entries.values() ?? [])];
    disposeTabs();
    const strip = bar.built.strip;
    strip.replaceChildren();
    tabs = selectedTabs.map((tab) =>
      drawTab(
        parts,
        strip,
        tab.view,
        tab.view.id === selected?.tabs.selectedTabId,
        () => {
          if (selectedSessionId !== null) {
            select(selectedSessionId, tab.view.id);
          }
        },
      ),
    );
    const isTabStepping = hasOtherTab(
      selected?.tabs.tabIds ?? [],
      selected?.tabs.selectedTabId ?? null,
    );
    const { previous, next, close } = bar.built;
    previous?.classList.toggle('is-no-target', !isTabStepping);
    next?.classList.toggle('is-no-target', !isTabStepping);
    close?.classList.toggle('is-no-target', selectedSessionId === null);
    showText(textFor(state, selectedTabs.length));
  };

  const changed = () => {
    draw();
    deps.changed();
  };

  // Stores the session's next tabs, running `changed` only when they changed.
  const setTabs = (session: SessionTabs, tabs: TabsState) => {
    if (tabs === session.tabs) {
      return;
    }
    session.tabs = tabs;
    changed();
  };

  const select = (sessionId: string, tabId: string) => {
    const session = sessions.get(sessionId);
    if (session !== undefined) {
      setTabs(session, tabsAfterSelect(session.tabs, tabId));
    }
  };

  // The live tab entry, or undefined once it was dropped or removed.
  const liveTab = (sessionId: string, tab: Tab): SessionTabs | undefined => {
    const session = sessions.get(sessionId);
    return session?.entries.get(tab.view.id) === tab ? session : undefined;
  };

  const remove = (session: SessionTabs, tab: Tab) => {
    tab.view.element.remove();
    session.tabs = tabsAfterRemove(session.tabs, tab.view.id);
    session.entries.delete(tab.view.id);
    changed();
  };

  draw();
  return {
    element: area,
    render(next) {
      state = next;
      draw();
    },
    redrawPane() {
      disposeTabs();
      bar.dispose();
      bar = drawBar();
      draw();
    },
    add(sessionId, view) {
      const session = sessionOf(sessionId);
      session.tabs = tabsAfterAdd(session.tabs, sessionId, view.id);
      const tab: Tab = { view, status: '' };
      session.entries.set(view.id, tab);
      session.body.append(view.element);
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
          state?.selectedSessionId === sessionId &&
          liveTab(sessionId, tab)?.tabs.selectedTabId === view.id,
      };
    },
    drop(sessionId) {
      sessions.get(sessionId)?.body.remove();
      sessions.delete(sessionId);
      draw();
    },
    tabsOf: (sessionId) =>
      [...(sessions.get(sessionId)?.entries.values() ?? [])].map(
        (tab) => tab.view,
      ),
    statusesOf: (sessionId) =>
      [...(sessions.get(sessionId)?.entries.values() ?? [])].map(
        (tab) => tab.status,
      ),
    selectedTabOf(sessionId) {
      const session = sessions.get(sessionId);
      const selectedTabId = session?.tabs.selectedTabId ?? null;
      return selectedTabId === null
        ? null
        : (session?.entries.get(selectedTabId)?.view ?? null);
    },
    select,
  };
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

// Why the tab area shows no tab, or null when it shows one or main's first
// state has not arrived.
function textFor(
  state: SessionsState | null,
  selectedTabCount: number,
): EmptyTextInput | null {
  if (showsEmptyText(state)) {
    return EMPTY_TEXT;
  }
  if (showsNoSelectionText(state)) {
    return NO_SELECTION_TEXT;
  }
  const isNothingOpen =
    state !== null &&
    state.selectedSessionId !== null &&
    selectedTabCount === 0;
  return isNothingOpen ? NOTHING_OPEN_TEXT : null;
}

function drawTab(
  parts: SessionsParts,
  strip: HTMLElement,
  view: SessionTabView,
  isActive: boolean,
  select: () => void,
): DrawnPart<SessionsPart> {
  const drawn = parts.tab(strip, { title: view.title });
  const entry = drawn.built.element;
  onPartClick(entry, select);
  entry.title = view.title;
  entry.classList.toggle('is-active', isActive);
  entry.setAttribute('aria-current', String(isActive));
  return drawn;
}
