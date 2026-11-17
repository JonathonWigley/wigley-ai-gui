import {
  createPartStore,
  type PartStore,
} from '../../../shared/page/contributed-parts';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { asFake, FakeElement, findAll } from '../../../shared/page/test-dom';
import type { Clock, Timers } from '../../../contracts/ambient';
import type { KeyedSlotWriter } from '../../../contracts/state';
import type { UiState } from '../../../contracts/ui-state';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type SessionPart,
  sessionsActivitySlot,
  sessionsClaimedSlot,
  type SessionsPlace,
  sessionsPlaceSlot,
  type SessionsState,
  type SidebarSection,
} from '../contract';
import { createSessionsParts } from './layout/sessions-parts';
import { createProjectFavorites } from './project-favorites';
import { sessionRow } from '../contract.test-support';
import { fakeUiState } from './session-fakes';
import { createSessionRecency } from './session-recency';
import { mountSessionsView } from './sessions-view';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

export function stateOf(
  sessionIds: string[],
  selectedSessionId: string | null,
): SessionsState {
  return { rows: sessionIds.map((id) => sessionRow(id)), selectedSessionId };
}

// The page services the sessions parts read: fake keys that record each anchor
// in `anchors` and a log that records each line in `logged`.
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
    state: noLayoutState,
    commands: {
      exists: () => true,
      argShape: () => undefined,
      run: () => undefined,
    },
    log: (message: string) => {
      logged.push(message);
    },
  };
  return { anchors, logged, services };
}

// The sessions parts alone, over the fake services `sessionsViewSetup` uses and
// no row or bar parts, for a part the view does not draw, with the anchors its
// kits drew. Runs under
// `installFakeDom`.
export function sessionsPartsSetup() {
  const { anchors, logged, services } = fakeKitServices();
  const parts = createSessionsParts({
    ...services,
    rowParts: createPartStore(),
    barParts: createPartStore(),
  });
  return { parts, logged, anchors };
}

// What `sessionsViewSetup` runs on beyond its stores: `uiState` holds the
// favorites and recency stamps, `clock` stamps them, a fixed time unless handed
// in, so rows keep main's order, `timers` never runs a timer unless handed in,
// `places` holds the sessions' places, a new empty slot unless handed in,
// `tabsChanged` runs on each change to a session's tabs or popups, and
// `sections` holds the side bar's registered sections, a new store unless
// handed in.
export interface SessionsViewOptions {
  uiState?: UiState;
  clock?: Clock;
  timers?: Timers;
  places?: KeyedSlotWriter<SessionsPlace>;
  tabsChanged?: () => void;
  sections?: PartStore<SidebarSection>;
}

// A sessions view over fake keys that record each anchor, a log that records
// each line, `activated` recording each session a row click activates, `runs`
// each command a row's, star's or tab's click runs with its arg (a star's and a
// tab's run then act as their commands do), `cursorMoves` each row
// `cursorMoved` reports (null for none), the row parts its rows draw
// (`rowParts`, a new store unless one is handed in) and the bar parts its tab
// bars draw (`barParts`,
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
    places = createSlotStore(() => undefined).publish(sessionsPlaceSlot),
    tabsChanged = () => undefined,
    sections = createPartStore(),
  }: SessionsViewOptions = {},
) {
  const { anchors, logged, services } = fakeKitServices();
  const activated: string[] = [];
  const cursorMoves: (string | null)[] = [];
  const runs: [string, unknown][] = [];
  const view = mountSessionsView({
    ...services,
    activate(sessionId) {
      runs.push(['sessions.selectRow', sessionId]);
      activated.push(sessionId);
    },
    runFavorite(project) {
      runs.push(['sessions.favoriteProjectAt', project]);
      view.toggleFavorite(project);
    },
    selectTab(sessionId, tab) {
      runs.push(['sessions.selectTab', { sessionId, tab }]);
      view.tabs.select(sessionId, tab);
    },
    isModeShown: () => true,
    tabsChanged,
    popupOpenedFromBar: () => undefined,
    timers,
    panesChanged: () => undefined,
    paneFocused: () => undefined,
    panePressed: () => undefined,
    paneKeyFocused: () => undefined,
    cursorMoved: (row) => cursorMoves.push(row?.sessionId ?? null),
    rowParts,
    barParts,
    sections,
    titleMaxLength,
    recency: createSessionRecency(clock, uiState),
    favorites: createProjectFavorites(uiState),
    activities: createSlotStore(() => undefined).publish(sessionsActivitySlot),
    places,
    claimed: createSlotStore(() => undefined).publish(sessionsClaimedSlot),
  });
  const sideBar = asFake(view.sideBar);
  const area = asFake(view.element);
  return {
    view,
    anchors,
    logged,
    activated,
    cursorMoves,
    runs,
    sideBar,
    area,
    rowParts,
    barParts,
    sections,
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

// The rows in the `default` side bar's groups, then in its plugin sections, in
// drawn order, by their place since a user layout's row need not carry the
// `default` row's class.
export function drawnRows(sideBar: FakeElement): FakeElement[] {
  const pluginBoxes = findAll(sideBar, 'session-section--plugin').flatMap(
    (section) => findAll(section, 'session-section-groups'),
  );
  return [...findAll(sideBar, 'session-group-rows'), ...pluginBoxes].flatMap(
    (box) => box.children,
  );
}
