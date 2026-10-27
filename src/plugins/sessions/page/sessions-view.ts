import { element } from '../../../shared/page/dom';
import type { KeysPageExports } from '../../keys/contract';
import type { SessionsState } from '../contract';
import {
  mountSessionTabsView,
  type SessionTabsView,
} from './session-tabs-view';
import { mountSidebarView } from './sidebar-view';
import { rowStatus } from './tabs';

// `activate` runs on a row click; `isModeShown` reads whether Sessions mode
// shows; `tabsChanged` runs after any change to a session's tabs, their
// selection or their statuses; `keys` draws the session and tab prompts.
export interface SessionsViewDeps {
  activate(sessionId: string): void;
  isModeShown(): boolean;
  tabsChanged(): void;
  keys: Pick<KeysPageExports, 'anchor'>;
}

// `element` is the mode's root, the selected session's tab area; `sideBar` is
// the mode's side bar, the session list's header over its rows.
export interface SessionsView {
  element: HTMLElement;
  sideBar: HTMLElement;
  tabs: SessionTabsView;
  render(state: SessionsState): void;
}

// Sessions mode's two parts: the side bar of session rows, which the shell
// draws in its side bar, and the root holding the selected session's tab
// area. Each row's second line follows its tabs' statuses.
export function mountSessionsView(deps: SessionsViewDeps): SessionsView {
  const root = element('div', 'sessions');
  const sidebar = mountSidebarView(deps.activate, deps.keys);
  let state: SessionsState | null = null;
  const drawSidebar = () =>
    sidebar.render(state, (sessionId) => rowStatus(tabs.statusesOf(sessionId)));
  const tabs = mountSessionTabsView({
    isModeShown: deps.isModeShown,
    keys: deps.keys,
    changed() {
      drawSidebar();
      deps.tabsChanged();
    },
  });
  root.append(tabs.element);
  return {
    element: root,
    sideBar: sidebar.element,
    tabs,
    render(next) {
      state = next;
      drawSidebar();
      tabs.render(next);
    },
  };
}
