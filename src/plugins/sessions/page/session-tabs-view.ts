import { button, element } from '../../../shared/page/dom';
import type {
  SessionsState,
  SessionTabHandle,
  SessionTabView,
} from '../contract';
import {
  NO_TABS,
  showsEmptyText,
  showsNoSelectionText,
  type TabsState,
  tabsAfterAdd,
  tabsAfterRemove,
  tabsAfterSelect,
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
// change to a session's tabs, their selection or their statuses.
export interface SessionTabsDeps {
  isModeShown(): boolean;
  changed(): void;
}

export interface SessionTabsView {
  element: HTMLElement;
  render(state: SessionsState): void;
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

// The tab area of Sessions mode: the selected session's tab strip over one
// body per session, only the selected session's body showing and in it only
// its selected tab, or the text saying why nothing shows. A tab added for a
// session with no row yet waits in a hidden body. Until `render` hands it
// main's first state, it shows no text either.
export function mountSessionTabsView(deps: SessionTabsDeps): SessionTabsView {
  const area = element('div', 'session-area');
  const strip = element('nav', 'session-tabs');
  strip.setAttribute('aria-label', 'Tabs');
  const bodies = element('div', 'session-bodies');
  const text = buildText();
  area.append(strip, bodies, text.element);
  const sessions = new Map<string, SessionTabs>();
  let state: SessionsState | null = null;

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
    strip.hidden = selectedTabs.length === 0;
    strip.replaceChildren(
      ...selectedTabs.map((tab) =>
        buildTab(tab.view, tab.view.id === selected?.tabs.selectedTabId, () => {
          if (selectedSessionId !== null) {
            select(selectedSessionId, tab.view.id);
          }
        }),
      ),
    );
    text.show(textFor(state, selectedTabs.length));
  };

  const changed = () => {
    draw();
    deps.changed();
  };

  const select = (sessionId: string, tabId: string) => {
    const session = sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    const tabs = tabsAfterSelect(session.tabs, tabId);
    if (tabs === session.tabs) {
      return;
    }
    session.tabs = tabs;
    changed();
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

interface Text {
  title: string;
  text: string;
}

const EMPTY_TEXT: Text = {
  title: 'No sessions',
  text: 'An agent session shows here once its relay connects: when it starts while the app runs, or at its first round.',
};

const NO_SELECTION_TEXT: Text = {
  title: 'No session selected',
  text: 'Pick a session in the sidebar.',
};

const NOTHING_OPEN_TEXT: Text = {
  title: 'Nothing open',
  text: 'This session has nothing open yet. Its first round opens a Form tab here.',
};

// Why the tab area shows no tab, or null when it shows one or main's first
// state has not arrived.
function textFor(
  state: SessionsState | null,
  selectedTabCount: number,
): Text | null {
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

function buildTab(
  view: SessionTabView,
  isActive: boolean,
  select: () => void,
): HTMLElement {
  const entry = button('session-tab', '', select);
  entry.title = view.title;
  entry.classList.toggle('is-active', isActive);
  entry.setAttribute('aria-current', String(isActive));
  entry.append(element('span', 'session-tab-label', view.title));
  return entry;
}

// The section saying why the tab area shows no tab; `show(null)` hides it.
function buildText(): {
  element: HTMLElement;
  show(text: Text | null): void;
} {
  const section = element('section', 'sessions-empty');
  const title = element('h1', 'sessions-empty-title');
  const body = element('p', 'sessions-empty-text');
  section.append(title, body);
  return {
    element: section,
    show(text) {
      section.hidden = text === null;
      title.textContent = text?.title ?? '';
      body.textContent = text?.text ?? '';
    },
  };
}
