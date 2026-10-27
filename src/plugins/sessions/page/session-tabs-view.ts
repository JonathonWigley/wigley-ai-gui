import { element } from '../../../shared/page/dom';
import { emptyState } from '../../../shared/page/ui/empty-state';
import { keyChevron, keyEdge } from '../../../shared/page/ui/key-anchors';
import { sheet } from '../../../shared/page/ui/sheet';
import { tab as tabButton, tabStrip } from '../../../shared/page/ui/tabs';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsState,
  SessionTabHandle,
  SessionTabView,
} from '../contract';
import { sessionsManifest } from '../manifest';
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
// draws the strip's edge prompts and the key beside the text asking for a
// session to be picked.
export interface SessionTabsDeps {
  isModeShown(): boolean;
  changed(): void;
  keys: Pick<KeysPageExports, 'anchor'>;
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

// The tab area of Sessions mode: the selected session's tab strip, between
// its previous and next tab edge prompts and with the close prompt at the
// bar's end, on the top edge of one sheet holding a body per session, only
// the selected session's body showing and in it only its selected tab, or
// the text saying why nothing shows. The tab prompts hide while the selected
// session has no other tab, and the close prompt while none is selected. A
// tab's element fills its body. A tab added for a session with no row yet
// waits in a hidden body. Until `render` hands it main's first state, it
// shows no text either.
export function mountSessionTabsView(deps: SessionTabsDeps): SessionTabsView {
  const area = element('div', 'session-area');
  const strip = tabStrip([]);
  strip.classList.add('session-tabs');
  strip.setAttribute('aria-label', 'Tabs');
  const bar = buildTabsBar(strip, deps.keys);
  const bodies = sheet();
  bodies.classList.add('session-bodies');
  const text = buildText();
  bodies.append(text.element);
  area.append(bar.element, bodies);
  const pickHint = element('span', 'sessions-pick-hint');
  deps.keys.anchor(pickHint, qualify(sessionsManifest.id, 'nextSession'));
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
    bodies.insertBefore(created.body, text.element);
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
    strip.replaceChildren(
      ...selectedTabs.map((tab) =>
        buildTab(tab.view, tab.view.id === selected?.tabs.selectedTabId, () => {
          if (selectedSessionId !== null) {
            select(selectedSessionId, tab.view.id);
          }
        }),
      ),
    );
    const isTabStepping = hasOtherTab(
      selected?.tabs.tabIds ?? [],
      selected?.tabs.selectedTabId ?? null,
    );
    bar.previous.classList.toggle('is-no-target', !isTabStepping);
    bar.next.classList.toggle('is-no-target', !isTabStepping);
    bar.close.classList.toggle('is-no-target', selectedSessionId === null);
    const shown = textFor(state, selectedTabs.length);
    text.show(shown, shown?.hasHint ? pickHint : null);
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

interface Text {
  text: string;
  hasHint: boolean;
}

const EMPTY_TEXT: Text = {
  text: "No sessions yet: one shows here when its agent's relay connects",
  hasHint: false,
};

const NO_SELECTION_TEXT: Text = {
  text: 'Pick a session in the side bar',
  hasHint: true,
};

const NOTHING_OPEN_TEXT: Text = {
  text: "Nothing open yet: this session's first round opens a Form tab here",
  hasHint: false,
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
  const entry = tabButton(view.title, select);
  entry.title = view.title;
  entry.classList.toggle('is-active', isActive);
  entry.setAttribute('aria-current', String(isActive));
  return entry;
}

// The bar over the tab area: `⌥I ‹`, the strip, `› ⌥O`, then `⌘W close` at
// its end. `previous` and `next` are each an anchor with its chevron, and
// `close` the close anchor, so the view can hide each with no target.
function buildTabsBar(
  strip: HTMLElement,
  keys: Pick<KeysPageExports, 'anchor'>,
): {
  element: HTMLElement;
  previous: HTMLElement;
  next: HTMLElement;
  close: HTMLElement;
} {
  const previousKeys = element('span');
  const nextKeys = element('span');
  const close = element('span', 'session-tabs-close');
  keys.anchor(previousKeys, qualify(sessionsManifest.id, 'prevTab'));
  keys.anchor(nextKeys, qualify(sessionsManifest.id, 'nextTab'));
  keys.anchor(close, qualify(sessionsManifest.id, 'closeSession'), {
    label: 'close',
  });
  const previous = keyEdge('session-tabs-edge', [
    previousKeys,
    keyChevron('‹'),
  ]);
  const next = keyEdge('session-tabs-edge', [keyChevron('›'), nextKeys]);
  const bar = element('div', 'session-tabs-bar');
  bar.append(previous, strip, next, close);
  return { element: bar, previous, next, close };
}

// The slot saying why the tab area shows no tab, `hint` after its text;
// `show(null, null)` hides it and empties it.
function buildText(): {
  element: HTMLElement;
  show(text: Text | null, hint: HTMLElement | null): void;
} {
  const slot = element('div', 'sessions-empty');
  return {
    element: slot,
    show(text, hint) {
      slot.hidden = text === null;
      slot.replaceChildren(
        ...(text === null ? [] : [emptyState(text.text, hint)]),
      );
    },
  };
}
