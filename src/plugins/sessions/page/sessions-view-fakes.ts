import {
  createPartStore,
  type PartStore,
} from '../../../shared/page/contributed-parts';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { asFake, FakeElement, findAll } from '../../../shared/page/test-dom';
import type { SessionPart, SessionRow, SessionsState } from '../contract';
import { mountSessionsView } from './sessions-view';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';

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

// A sessions view over fake keys that record each anchor, a log that records
// each line as `[source] message`, `activated` recording each session a row
// click activates, the row parts its rows draw (`rowParts`, a new store
// unless one is handed in) and the bar parts its tab bars draw (`barParts`,
// likewise). Runs under `installFakeDom`.
export function sessionsViewSetup(
  rowParts: PartStore<SessionPart> = createPartStore(),
  barParts: PartStore<SessionPart> = createPartStore(),
) {
  const { anchors, keys } = recordingAnchors();
  const logged: string[] = [];
  const activated: string[] = [];
  const view = mountSessionsView({
    activate: (sessionId) => activated.push(sessionId),
    isModeShown: () => true,
    tabsChanged: () => undefined,
    keys,
    timers: { set: () => 0, clear: () => undefined },
    panesChanged: () => undefined,
    paneFocused: () => undefined,
    rowParts,
    barParts,
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
      ...NO_FENCES,
    },
    platform: 'macos',
    commands: { exists: () => true, run: () => undefined },
    log: (source, message) => logged.push(`[${source}] ${message}`),
  });
  const sideBar = asFake(view.sideBar);
  const area = asFake(view.element);
  return {
    view,
    anchors,
    logged,
    activated,
    sideBar,
    area,
    rowParts,
    barParts,
  };
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
