import { element } from '../../../shared/page/dom';
import type { SessionsState } from '../contract';
import {
  mountSessionTabsView,
  type SessionTabsView,
} from './session-tabs-view';
import { mountSidebarView } from './sidebar-view';
import { rowStatus, type SidebarLayout } from './tabs';

// `activate` runs on a row click; `isModeShown` reads whether Sessions mode
// shows; `tabsChanged` runs after any change to a session's tabs, their
// selection or their statuses.
export interface SessionsViewDeps {
  activate(sessionId: string): void;
  isModeShown(): boolean;
  tabsChanged(): void;
}

export interface SessionsView {
  element: HTMLElement;
  tabs: SessionTabsView;
  render(state: SessionsState): void;
  layOut(layout: SidebarLayout): void;
}

// Sessions mode's root: the sidebar of session rows beside the selected
// session's tab area. The sidebar sits beside the tab area, over it, or
// hidden, as `layOut` says; each row's second line follows its tabs'
// statuses.
export function mountSessionsView(deps: SessionsViewDeps): SessionsView {
  const root = element('div', 'sessions');
  const sidebar = mountSidebarView(deps.activate);
  let state: SessionsState | null = null;
  const drawSidebar = () =>
    sidebar.render(state, (sessionId) => rowStatus(tabs.statusesOf(sessionId)));
  const tabs = mountSessionTabsView({
    isModeShown: deps.isModeShown,
    changed() {
      drawSidebar();
      deps.tabsChanged();
    },
  });
  root.append(sidebar.element, tabs.element);
  return {
    element: root,
    tabs,
    render(next) {
      state = next;
      drawSidebar();
      tabs.render(next);
    },
    layOut(layout) {
      root.classList.toggle('is-sidebar-hidden', layout === 'hidden');
      root.classList.toggle('is-sidebar-over', layout === 'over');
      sidebar.element.hidden = layout === 'hidden';
    },
  };
}
