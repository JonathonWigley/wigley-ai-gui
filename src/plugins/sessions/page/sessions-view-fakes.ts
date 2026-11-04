import {
  createPartStore,
  type PartStore,
} from '../../../shared/page/contributed-parts';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { asFake, FakeElement, findAll } from '../../../shared/page/test-dom';
import type { Clock, Timers } from '../../../contracts/ambient';
import type { UiState } from '../../../contracts/ui-state';
import type { SessionPart, SessionRow, SessionsState } from '../contract';
import { createSessionsParts } from './layout/sessions-parts';
import { createProjectFavorites } from './project-favorites';
import { createSessionRecency } from './session-recency';
import { mountSessionsView } from './sessions-view';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';

export function sessionRow(sessionId: string): SessionRow {
  return {
    sessionId,
    label: `label ${sessionId}`,
    project: 'project',
    harness: 'claude',
    marked: false,
    projectDir: null,
    hostSessionId: null,
    titles: { user: null, agent: null, firstMessage: null },
  };
}

export function stateOf(
  sessionIds: string[],
  selectedSessionId: string | null,
): SessionsState {
  return { rows: sessionIds.map(sessionRow), selectedSessionId };
}

// The page services the sessions parts read: fake keys that record each anchor
// in `anchors` and a log that records each line as `[source] message` in
// `logged`.
function fakeKitServices() {
  const { anchors, keys } = recordingAnchors();
  const logged: string[] = [];
  const services = {
    keys,
    markdown: {
      block: (text: string) => text,
      inline: (text: string) => text,
      document: async (text: string) => text,
      ...NO_FENCES,
    },
    platform: 'macos' as const,
    commands: { exists: () => true, run: () => undefined },
    log: (source: string, message: string) => {
      logged.push(`[${source}] ${message}`);
    },
  };
  return { anchors, logged, services };
}

// The sessions parts alone, over the fake services `sessionsViewSetup` uses and
// no row or bar parts, for a part the view does not draw. Runs under
// `installFakeDom`.
export function sessionsPartsSetup() {
  const { logged, services } = fakeKitServices();
  const parts = createSessionsParts({
    ...services,
    rowParts: createPartStore(),
    barParts: createPartStore(),
  });
  return { parts, logged };
}

// A uiState over a map holding `entries`.
export function fakeUiState(entries: [string, unknown][] = []): UiState {
  const values = new Map(entries);
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
}

// What `sessionsViewSetup` runs on beyond its stores: `uiState` holds the
// favorites and recency stamps, `clock` stamps them, a fixed time unless handed
// in, so rows keep main's order, and `timers` never runs a timer unless handed in.
export interface SessionsViewOptions {
  uiState?: UiState;
  clock?: Clock;
  timers?: Timers;
}

// A sessions view over fake keys that record each anchor, a log that records
// each line as `[source] message`, `activated` recording each session a row
// click activates, the row parts its rows draw (`rowParts`, a new store
// unless one is handed in) and the bar parts its tab bars draw (`barParts`,
// likewise), and the title length `titleMaxLength` reads (40 unless one is
// handed in). Runs under `installFakeDom`.
export function sessionsViewSetup(
  rowParts: PartStore<SessionPart> = createPartStore(),
  barParts: PartStore<SessionPart> = createPartStore(),
  titleMaxLength: () => number = () => 40,
  {
    uiState = fakeUiState(),
    clock = { now: () => 0 },
    timers = { set: () => 0, clear: () => undefined },
  }: SessionsViewOptions = {},
) {
  const { anchors, logged, services } = fakeKitServices();
  const activated: string[] = [];
  const view = mountSessionsView({
    ...services,
    activate: (sessionId) => activated.push(sessionId),
    isModeShown: () => true,
    tabsChanged: () => undefined,
    timers,
    panesChanged: () => undefined,
    paneFocused: () => undefined,
    rowParts,
    barParts,
    titleMaxLength,
    recency: createSessionRecency(clock, uiState),
    favorites: createProjectFavorites(uiState),
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

// The first of `rows` whose text or tooltip holds `text`: the tooltip names
// the folder label a titled row does not draw.
export function rowNamed(rows: FakeElement[], text: string): FakeElement {
  const found = rows.find(
    (row) => row.textContent.includes(text) || row.title.includes(text),
  );
  if (found === undefined) {
    throw new Error(`no row holds ${text}`);
  }
  return found;
}

// The rows in the `default` side bar's groups, in drawn order, by their place
// since a user layout's row need not carry the `default` row's class.
export function drawnRows(sideBar: FakeElement): FakeElement[] {
  return findAll(sideBar, 'session-group-rows').flatMap((box) => box.children);
}
