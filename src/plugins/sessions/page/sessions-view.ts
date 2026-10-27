import type { ShownLayouts } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import type { KeysPageExports } from '../../keys/contract';
import type { SessionsState } from '../contract';
import type { Layout } from '../layouts/layout';
import {
  createSessionsParts,
  type SessionsPartsDeps,
} from './layout/sessions-parts';
import { PREVIEW_STATE, PREVIEW_STATUSES } from './preview';
import {
  mountSessionTabsView,
  type SessionTabsView,
} from './session-tabs-view';
import { mountSidebarView } from './sidebar-view';
import { rowStatus, stepSession } from './tabs';

// `activate` runs on a row click; `isModeShown` reads whether Sessions mode
// shows; `tabsChanged` runs after any change to a session's tabs, their
// selection or their statuses; `keys` draws the session and tab prompts; the
// rest is what the sessions layout's kits read.
export interface SessionsViewDeps extends Omit<SessionsPartsDeps, 'keys'> {
  activate(sessionId: string): void;
  isModeShown(): boolean;
  tabsChanged(): void;
  keys: Pick<KeysPageExports, 'anchor' | 'keysFor'>;
}

// `element` is the mode's root, the selected session's tab area; `sideBar` is
// the mode's side bar, the session list's header over its rows.
// `setLayouts` draws the side bar and tab bar again with `shown`, then the
// rows, tabs and text from the state the view holds. `showPreview(true)`
// swaps the side bar's rows for the preview sample, whose selection a row
// click or `stepPreview` moves without activating anything; `false` draws the
// real rows again.
export interface SessionsView {
  element: HTMLElement;
  sideBar: HTMLElement;
  tabs: SessionTabsView;
  render(state: SessionsState): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  showPreview(isShown: boolean): void;
  isPreviewShown(): boolean;
  stepPreview(by: 1 | -1): void;
}

// Sessions mode's two parts: the side bar of session rows, which the shell
// draws in its side bar, and the root holding the selected session's tab
// area. Each row's second line follows its tabs' statuses. Both draw with
// `default` until the first `setLayouts`.
export function mountSessionsView(deps: SessionsViewDeps): SessionsView {
  const root = element('div', 'sessions');
  const parts = createSessionsParts(deps);
  // The preview sample while it shows, else null.
  let preview: SessionsState | null = null;
  const sidebar = mountSidebarView((sessionId) => {
    if (preview === null) {
      deps.activate(sessionId);
      return;
    }
    preview = { ...preview, selectedSessionId: sessionId };
    drawSidebar();
  }, parts);
  let state: SessionsState | null = null;
  const drawSidebar = () => {
    if (preview !== null) {
      sidebar.render(
        preview,
        (sessionId) => PREVIEW_STATUSES[sessionId] ?? null,
      );
      return;
    }
    sidebar.render(state, (sessionId) => rowStatus(tabs.statusesOf(sessionId)));
  };
  const tabs = mountSessionTabsView({
    isModeShown: deps.isModeShown,
    keys: deps.keys,
    parts,
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
    setLayouts(shown) {
      parts.setLayouts(shown);
      sidebar.redrawPane();
      drawSidebar();
      tabs.redrawPane();
    },
    showPreview(isShown) {
      preview = isShown ? PREVIEW_STATE : null;
      drawSidebar();
    },
    isPreviewShown: () => preview !== null,
    stepPreview(by) {
      if (preview === null) {
        return;
      }
      const sessionId = stepSession(preview, by);
      if (sessionId !== null) {
        preview = { ...preview, selectedSessionId: sessionId };
        drawSidebar();
      }
    },
  };
}
