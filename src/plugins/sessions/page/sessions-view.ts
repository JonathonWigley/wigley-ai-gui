import type { Area } from '../../../contracts/plugin';
import { button, element } from '../../../shared/page/dom';
import type { SessionsState, SessionTab, SessionView } from '../contract';
import {
  keepsPane,
  showsEmptyText,
  showsIdleText,
  tabText,
  tabTitle,
} from './tabs';

// What fills a session's view, with the title it last set.
interface Fill {
  view: SessionView;
  title: string;
}

interface SessionPane {
  element: HTMLElement;
  idle: HTMLElement;
  fills: Fill[];
}

export interface SessionsView {
  render(state: SessionsState): void;
  // Attaches the view's element before returning; fills keep call order.
  fill(
    sessionId: string,
    view: SessionView,
  ): { setTitle(title: string): void; remove(): void };
  fillsOf(sessionId: string): SessionView[];
}

// The tab strip, one view per session holding what other plugins fill it
// with, and the empty state, in the main area. Only the active session's view
// shows; a session with no fill shows its idle text. Until `render` hands
// it main's first state, it shows no empty state either.
export function mountSessionsView(
  main: Area,
  activate: (sessionId: string) => void,
): SessionsView {
  const root = element('div', 'sessions');
  const strip = element('nav', 'session-tabs');
  strip.setAttribute('aria-label', 'Sessions');
  const views = element('div', 'session-views');
  const empty = buildEmpty();
  root.append(strip, views, empty);
  main.contribute(root);
  const panes = new Map<string, SessionPane>();
  let state: SessionsState | null = null;

  const paneOf = (sessionId: string): SessionPane => {
    const existing = panes.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const pane = buildPane();
    panes.set(sessionId, pane);
    views.append(pane.element);
    return pane;
  };

  const render = () => {
    const tabs = state?.tabs ?? [];
    const activeSessionId = state?.activeSessionId ?? null;
    const hasTabs = tabs.length > 0;
    for (const tab of tabs) {
      paneOf(tab.sessionId);
    }
    for (const [sessionId, pane] of panes) {
      const hasTab = tabs.some((tab) => tab.sessionId === sessionId);
      if (!keepsPane(hasTab, pane.fills.length)) {
        pane.element.remove();
        panes.delete(sessionId);
        continue;
      }
      pane.element.hidden = sessionId !== activeSessionId;
      pane.idle.hidden = !showsIdleText(pane.fills.length);
    }
    strip.hidden = !hasTabs;
    views.hidden = !hasTabs;
    empty.hidden = !showsEmptyText(state);
    strip.replaceChildren(
      ...tabs.map((tab) =>
        buildTab(
          tab,
          activeSessionId,
          tabTitle(
            panes.get(tab.sessionId)?.fills.map((fill) => fill.title) ?? [],
          ),
          activate,
        ),
      ),
    );
  };

  render();
  return {
    render(next) {
      state = next;
      render();
    },
    fill(sessionId, view) {
      const pane = paneOf(sessionId);
      const entry: Fill = { view, title: view.title };
      pane.element.insertBefore(view.element, pane.idle);
      pane.fills.push(entry);
      render();
      return {
        setTitle(title) {
          entry.title = title;
          render();
        },
        remove() {
          view.element.remove();
          pane.fills = pane.fills.filter((fill) => fill !== entry);
          render();
        },
      };
    },
    fillsOf: (sessionId) =>
      panes.get(sessionId)?.fills.map((fill) => fill.view) ?? [],
  };
}

function buildTab(
  tab: SessionTab,
  activeSessionId: string | null,
  title: string | null,
  activate: (sessionId: string) => void,
): HTMLElement {
  const isActive = tab.sessionId === activeSessionId;
  const text = tabText(tab.label, title);
  const entry = button('session-tab', '', () => activate(tab.sessionId));
  entry.title = text;
  entry.classList.toggle('is-active', isActive);
  entry.setAttribute('aria-current', String(isActive));
  const marker = element('span', 'session-tab-marker', '●');
  marker.hidden = !tab.marked;
  entry.append(element('span', 'session-tab-label', text), marker);
  return entry;
}

function buildPane(): SessionPane {
  const pane = element('div', 'session-view');
  const idle = element('section', 'session-idle');
  idle.append(
    element('h1', 'session-idle-title', 'No round open'),
    element(
      'p',
      'session-idle-text',
      "This session has no round for you now. Its agent's next round opens here.",
    ),
  );
  pane.append(idle);
  return { element: pane, idle, fills: [] };
}

function buildEmpty(): HTMLElement {
  const empty = element('section', 'sessions-empty');
  empty.append(
    element('h1', 'sessions-empty-title', 'No sessions'),
    element(
      'p',
      'sessions-empty-text',
      'When an agent asks you a round, its session opens here as a tab and the app icon counts the round.',
    ),
  );
  return empty;
}
