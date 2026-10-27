import type { ShownLayouts } from '../../../contracts/plugin';
import { asFake, FakeElement, findAll } from '../../../shared/page/test-dom';
import type { SessionRow, SessionsState } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { mountSessionsView } from './sessions-view';

export const USER_LAYOUT = 'mine';

// A key anchor the fake keys export made, and whether it was disposed.
export interface MadeAnchor {
  command: string;
  isDisposed: boolean;
}

export function sessionRow(sessionId: string): SessionRow {
  return {
    sessionId,
    label: `label ${sessionId}`,
    harness: 'claude',
    marked: false,
    projectDir: null,
    hostSessionId: null,
  };
}

export function stateOf(
  sessionIds: string[],
  selectedSessionId: string | null,
): SessionsState {
  return { rows: sessionIds.map(sessionRow), selectedSessionId };
}

// The shown layouts with `layout` as the user's, beside `default`.
export function withUser(layout: Layout): ShownLayouts<Layout> {
  return {
    layouts: new Map<string, Layout>([
      ['default', defaultLayout],
      [USER_LAYOUT, layout],
    ]),
    user: USER_LAYOUT,
  };
}

// A sessions view over fake keys that record each anchor, a log that records
// each line as `[source] message`, and `activated` recording each session a
// row click activates. Runs under `installFakeDom`.
export function sessionsViewSetup() {
  const anchors: MadeAnchor[] = [];
  const logged: string[] = [];
  const activated: string[] = [];
  const view = mountSessionsView({
    activate: (sessionId) => activated.push(sessionId),
    isModeShown: () => true,
    tabsChanged: () => undefined,
    keys: {
      keysFor: () => null,
      anchor: (_element, command) => {
        const anchor: MadeAnchor = { command, isDisposed: false };
        anchors.push(anchor);
        return {
          dispose: () => {
            anchor.isDisposed = true;
          },
        };
      },
    },
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
    },
    platform: 'macos',
    commands: { exists: () => true, run: () => undefined },
    log: (source, message) => logged.push(`[${source}] ${message}`),
  });
  const sideBar = asFake(view.sideBar);
  const area = asFake(view.element);
  return { view, anchors, logged, activated, sideBar, area };
}

// The first of `rows` whose text holds `text`.
export function rowNamed(rows: FakeElement[], text: string): FakeElement {
  const found = rows.find((row) => row.textContent.includes(text));
  if (found === undefined) {
    throw new Error(`no row holds ${text}`);
  }
  return found;
}

// The rows in the `default` side bar's list.
export function drawnRows(sideBar: FakeElement): FakeElement[] {
  return findAll(sideBar, 'session-sidebar')[0]?.children ?? [];
}
