import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PageApi,
  PagePart,
  PluginManifest,
} from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  type FakeElement,
  findAll,
  type FocusFakeDocument,
  installFakeDom,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import {
  dataEmitted,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  followRows,
  sessionsActiveSlot,
  sessionsActivitySlot,
  type SessionsPageExports,
  sessionsPageKey,
  type SessionsPlace,
  sessionsPlaceSlot,
  sessionsRowsSlot,
  sessionsSelectionSlot,
} from '../contract';
import { sessionRow } from '../contract.test-support';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { fakeUiState } from './session-fakes';
import { sessionsPagePart } from './start';

// Lets a queued microtask and a settled read's `then` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const hostRow = (sessionId: string) =>
  sessionRow(sessionId, { hostSessionId: `host-${sessionId}` });

function outermostAncestor(node: FakeElement): FakeElement {
  let top = node;
  while (top.parentNode !== null) {
    top = top.parentNode;
  }
  return top;
}

// Saved panes `a` and `b` side by side, showing `s1` and `s2`.
function savedSplit(focusedId: 'a' | 'b'): UiState {
  return fakeUiState([
    [
      'panes',
      {
        tree: {
          focusedId,
          root: {
            kind: 'split',
            axis: 'row',
            ratio: 0.5,
            first: { kind: 'leaf', id: 'a' },
            second: { kind: 'leaf', id: 'b' },
          },
        },
        sessions: { a: 'host-s1', b: 'host-s2' },
      },
    ],
  ]);
}

// A part whose mode `show` takes the shown mode from Sessions mode.
function otherModePart(): {
  part: PagePart<PluginManifest>;
  show(): void;
} {
  let handle: { show(): void } | null = null;
  const part = {
    manifest: {
      ...sessionsPagePart.manifest,
      id: 'other',
      dependsOn: { main: [], page: [] },
    },
    start(api: PageApi<PluginManifest, never>) {
      handle = api.modes.add({
        id: 'other',
        title: 'Other',
        icon: 'book',
        element: document.createElement('div'),
        shown: () => undefined,
        hidden: () => undefined,
      });
      return { commands: {} };
    },
  } as unknown as PagePart<PluginManifest>;
  return { part, show: () => handle?.show() };
}

interface StartOptions {
  // What main's `closeSession` answers.
  closeRefusal?: string | null;
  // Starts Sessions mode hidden, beside a mode `showOther` shows.
  withOtherMode?: boolean;
  // Real parts started before sessions.
  parts?: readonly PagePart[];
}

// The part on the harness, its rows and selection written, up to the first
// state's focus. `activations` holds each session the page asks main to
// activate, and `closes` each `closeSession` asked of main.
async function startApplied(
  rowIds: string[],
  selected: string | null,
  uiState: UiState = fakeUiState(),
  { closeRefusal = null, withOtherMode = false, parts = [] }: StartOptions = {},
) {
  const activations: unknown[] = [];
  const closes: unknown[][] = [];
  const other = otherModePart();
  const harness = startPagePart(sessionsPagePart, {
    invoke: async (method, ...args) => {
      if (method === 'activate') {
        activations.push(args[0]);
      }
      if (method === 'closeSession') {
        closes.push(args);
        return closeRefusal;
      }
      return true;
    },
    services: { picker: fakeListPickerService(), uiState },
    firstModeTaken: withOtherMode,
    parts: withOtherMode ? [other.part, ...parts] : parts,
  });
  const rows = harness.state.publish(sessionsRowsSlot);
  const selection = harness.state.publish(sessionsSelectionSlot);
  for (const sessionId of rowIds) {
    rows.set(sessionId, hostRow(sessionId));
  }
  selection.set(selected);
  harness.ready();
  await settle();
  const active = harness.state.read(sessionsActiveSlot, 'test');
  const activeNotices: (string | null | undefined)[] = [];
  active.on((value) => activeNotices.push(value));
  const exports = harness
    .started()
    .exports?.(createRegistrations()) as SessionsPageExports;
  const addTab = (sessionId: string) => {
    const shown = vi.fn();
    exports.addTab(sessionId, {
      id: 'tab',
      title: 'Tab',
      icon: 'book',
      element: document.createElement('div'),
      beforeClose: () => true,
      shown,
    });
    return shown;
  };
  // A popup `Popup` in the session; `beforeClose` answers its close guard.
  const addPopup = (sessionId: string, beforeClose = () => true) => {
    const shown = vi.fn();
    const element = document.createElement('div');
    const handle = exports.addPopup(sessionId, {
      id: 'popup',
      title: 'Popup',
      icon: 'bell',
      element,
      beforeClose,
      shown,
    });
    return { shown, handle, element };
  };
  const togglePopup = () =>
    harness.started().commands.togglePopup({ arg: undefined });
  const logsSince = (count: number) =>
    harness.logs.slice(count).map((line) => line.message);
  return {
    harness,
    rows,
    selection,
    active,
    activeNotices,
    activations,
    closes,
    exports,
    addTab,
    addPopup,
    togglePopup,
    logsSince,
    uiState,
    showOther: other.show,
  };
}

// A tab of `sessionId` with the given close answers, whose `beforeClose`,
// `shown` and `hidden` calls land in `calls` as `<id>.<call>`.
function closeTab(
  setup: Awaited<ReturnType<typeof startApplied>>,
  sessionId: string,
  id: string,
  calls: string[],
  { mayClose = true, atOnce = false } = {},
) {
  return setup.exports.addTab(sessionId, {
    id,
    title: `Tab ${id}`,
    icon: 'book',
    element: document.createElement('div'),
    closesAtOnce: () => atOnce,
    beforeClose: (isAtOnce) => {
      calls.push(`${id}.beforeClose(${isAtOnce})`);
      return mayClose;
    },
    shown: () => calls.push(`${id}.shown`),
    hidden: () => calls.push(`${id}.hidden`),
  });
}

const toasts = (setup: Awaited<ReturnType<typeof startApplied>>) =>
  setup.harness.logs
    .map((line) => line.message)
    .filter((message) => message.startsWith('toast'));

// A stand-in chat page part declaring `chat.focusBox`, run by `focusBox`.
function chatFocusBoxPart(focusBox: () => void): PagePart {
  return {
    manifest: {
      ...sessionsPagePart.manifest,
      id: 'chat',
      commands: {
        focusBox: { label: 'type a message', group: 'box', runsIn: 'page' },
      },
      dependsOn: { main: [], page: [] },
    },
    start: () => ({ commands: { focusBox } }),
  } as unknown as PagePart;
}

// The sessions the panes hold as uiState saved them last.
function savedPaneSessions(uiState: UiState): (string | null)[] {
  const panes = uiState.get('panes') as { sessions: Record<string, unknown> };
  return Object.values(panes.sessions) as (string | null)[];
}

const SAVED_PLACE: SessionsPlace = {
  selectedTabId: 'chat',
  selections: 2,
  hiddenPopupIds: [],
};

// The last page's places for `s-live` and `s-gone`, and a new page started over
// them with rows `rowIds` in the mirror.
function startOverSavedPlaces(rowIds: string[]) {
  const state = createSlotStore(() => undefined);
  const oldPage = state.publish(sessionsPlaceSlot);
  oldPage.set('s-live', SAVED_PLACE);
  oldPage.set('s-gone', SAVED_PLACE);
  oldPage.dispose();
  const rowsWriter = state.publish(sessionsRowsSlot);
  for (const sessionId of rowIds) {
    rowsWriter.set(sessionId, sessionRow(sessionId));
  }
  const harness = startPagePart(sessionsPagePart, {
    state,
    services: { picker: fakeListPickerService() },
  });
  return { state, harness, rowsWriter };
}

function placeKeys(state: ReturnType<typeof createSlotStore>): string[] {
  return [...state.read(sessionsPlaceSlot, 'test').all().keys()];
}

describe('sessions page part', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { case: 'no session', rowIds: [], selected: null, barPartDisposes: 0 },
    {
      case: 'a session held',
      rowIds: ['s1'],
      selected: 's1',
      barPartDisposes: 1,
    },
  ])(
    'stops with nothing live and starts again: $case',
    async ({ rowIds, selected, barPartDisposes }) => {
      const { harness, exports } = await startApplied(rowIds, selected);
      const dispose = vi.fn();
      exports.addBarPart({ id: 'bar-part', build: () => ({ dispose }) });

      await harness.stop();
      expect(dispose).toHaveBeenCalledTimes(barPartDisposes);
      expect(harness.counts()).toEqual(noCounts);

      await harness.restart();
      await harness.stop();
    },
  );

  it.each(['favorites', 'recent'])(
    'addSection_ReservedId_Throws (%s)',
    async (id) => {
      const setup = await startApplied(['s1'], 's1');
      const claims = vi.fn(() => true);

      expect(() =>
        setup.exports.addSection({ id, label: 'Taken', order: 0, claims }),
      ).toThrow(`section id ${id} is reserved`);
      setup.rows.set('s1', { ...hostRow('s1'), marked: true });
      await settle();

      expect(claims).not.toHaveBeenCalled();
      await setup.harness.stop();
    },
  );

  it('start_SetsActiveToNull', () => {
    const state = createSlotStore(() => undefined);
    const oldPage = state.publish(sessionsActiveSlot);
    oldPage.set('s-old');
    oldPage.dispose();

    startPagePart(sessionsPagePart, {
      state,
      services: { picker: fakeListPickerService() },
    });

    expect(state.read(sessionsActiveSlot, 'test').get()).toBeNull();
  });

  it('sessionsStart_OldPageActivities_Cleared', () => {
    const state = createSlotStore(() => undefined);
    const oldPage = state.publish(sessionsActivitySlot);
    oldPage.set('s-old', [
      {
        sourceId: 'chat',
        activity: { word: 'working', tone: 'running', rank: 20 },
      },
    ]);
    oldPage.dispose();

    startPagePart(sessionsPagePart, {
      state,
      services: { picker: fakeListPickerService() },
    });

    expect([...state.read(sessionsActivitySlot, 'test').all().keys()]).toEqual(
      [],
    );
  });

  it('row_gone_during_reload_prunes_the_sessions_place', () => {
    const { state, harness } = startOverSavedPlaces(['s-live']);

    harness.ready();

    expect(placeKeys(state)).toEqual(['s-live']);
  });

  it('prune_waits_for_ready', () => {
    const { state, harness, rowsWriter } = startOverSavedPlaces([]);

    expect(placeKeys(state)).toEqual(['s-live', 's-gone']);
    rowsWriter.set('s-live', sessionRow('s-live'));
    harness.ready();

    expect(placeKeys(state)).toEqual(['s-live']);
  });

  it('addTab_TabAdded_FiresTabAdded', async () => {
    const setup = await startApplied(['s1'], 's1');

    setup.addTab('s1');

    expect(dataEmitted(setup.harness, 'sessions.tabAdded')).toEqual([
      { sessionId: 's1', tabId: 'tab' },
    ]);
    await setup.harness.stop();
  });

  // A live restart applies once more, as the restarted part's own ready.
  it.each([
    { name: 'page load', restarts: false, activations: 1 },
    { name: 'live restart', restarts: true, activations: 2 },
  ])(
    'ready_AppliesOnceFromTheStoreAndHearsTheNext: $name',
    async ({ restarts, activations }) => {
      const uiState = fakeUiState();
      const written = vi.spyOn(uiState, 'set');
      const harness = startPagePart(sessionsPagePart, {
        services: { picker: fakeListPickerService(), uiState },
      });
      const rows = harness.state.publish(sessionsRowsSlot);
      rows.set('s1', hostRow('s1'));
      const selection = harness.state.publish(sessionsSelectionSlot);
      selection.set('s1');
      await settle();
      expect(written).not.toHaveBeenCalled();

      harness.ready();
      await settle();
      if (restarts) {
        await harness.restart();
        await settle();
      }
      const activeAtLoad = harness.state.read(sessionsActiveSlot, 'test').get();
      const activatedS1 = harness.logs.filter(
        (line) => line.message === 'activated label s1',
      ).length;
      rows.set('s2', hostRow('s2'));
      selection.set('s2');
      await settle();

      expect([
        activeAtLoad,
        activatedS1,
        harness.state.read(sessionsActiveSlot, 'test').get(),
      ]).toEqual(['s1', activations, 's2']);
      await harness.stop();
    },
  );

  // A rowless first selection is mid-operation: main's next selection write
  // settles it. A first apply that throws leaves its restore for the next
  // apply to settle.
  it.each([
    {
      case: 'first selection has its row',
      firstSelection: 's1',
      throwsFirstApply: false,
    },
    {
      case: 'first selection is rowless',
      firstSelection: 'gone',
      throwsFirstApply: false,
    },
    {
      case: 'first apply throws',
      firstSelection: 's1',
      throwsFirstApply: true,
    },
  ])(
    'ready_TracksOnlyTheRestoreUntilItsFocusFollows ($case)',
    async ({ firstSelection, throwsFirstApply }) => {
      const uiState = fakeUiState();
      if (throwsFirstApply) {
        // The first render saves the new row's recency stamp.
        vi.spyOn(uiState, 'set').mockImplementationOnce(() => {
          throw new Error('ui state write failed');
        });
      }
      const harness = startPagePart(sessionsPagePart, {
        services: { picker: fakeListPickerService(), uiState },
      });
      const rows = harness.state.publish(sessionsRowsSlot);
      rows.set('s1', hostRow('s1'));
      const selection = harness.state.publish(sessionsSelectionSlot);
      selection.set(firstSelection);

      harness.ready();
      if (throwsFirstApply) {
        harness.ready();
      }
      const [restore] = harness.restores;
      selection.set('s1');
      await restore;
      const activeAtSettle = harness.state
        .read(sessionsActiveSlot, 'test')
        .get();
      rows.set('s2', hostRow('s2'));
      await settle();

      expect([harness.restores.length, activeAtSettle]).toEqual([1, 's1']);
      await harness.stop();
    },
  );

  it('ready_SessionsAppliesBeforeAReaderAdded', async () => {
    // A row part's builds, then what they held as each `added` arrived.
    const drawn: string[] = [];
    const drawnWhenAdded: string[][] = [];
    const reader: PagePart<PluginManifest> = {
      manifest: {
        ...sessionsPagePart.manifest,
        id: 'reader',
        dependsOn: { main: [], page: ['sessions'] },
      },
      start(api: PageApi<PluginManifest, never>) {
        api.dependency(sessionsPageKey).addRowPart({
          id: 'reader.row',
          build(_parent, sessionId) {
            drawn.push(sessionId);
            return {};
          },
        });
        return {
          commands: {},
          ready() {
            followRows(api.state.read(sessionsRowsSlot), {
              added: () => drawnWhenAdded.push([...drawn]),
            });
          },
        };
      },
    } as unknown as PagePart<PluginManifest>;
    const harness = startPagePart(reader, {
      parts: [sessionsPagePart],
      services: { picker: fakeListPickerService() },
    });
    harness.state.publish(sessionsRowsSlot).set('s1', hostRow('s1'));
    harness.state.publish(sessionsSelectionSlot).set('s1');

    harness.ready();

    expect(drawnWhenAdded).toHaveLength(1);
    expect(drawnWhenAdded[0]).toContain('s1');
    await harness.stop();
  });

  it.each([{ hasNeighbourNotice: false }, { hasNeighbourNotice: true }])(
    'selectedRowRemoved_WaitsForTheSelectionNotice: a split tells main the focused pane, neighbour notice $hasNeighbourNotice',
    async ({ hasNeighbourNotice }) => {
      const uiState = savedSplit('a');
      const setup = await startApplied(['s1', 's3', 's2'], 's1', uiState);
      setup.activations.length = 0;

      setup.rows.delete('s1');
      if (hasNeighbourNotice) {
        setup.rows.set('s3', hostRow('s3'));
      }
      setup.selection.set('s3');
      await settle();

      expect(setup.activations).toContain('s2');
      expect(setup.activations).not.toContain('s3');
      expect(setup.active.get()).toBe('s2');
      expect(savedPaneSessions(uiState)).toEqual(['host-s2']);
      await setup.harness.stop();
    },
  );

  it.each([{ hasNeighbourNotice: false }, { hasNeighbourNotice: true }])(
    'selectedRowRemoved_WaitsForTheSelectionNotice: a single pane goes straight to the neighbour, neighbour notice $hasNeighbourNotice',
    async ({ hasNeighbourNotice }) => {
      const setup = await startApplied(['s1', 's2'], 's1');
      setup.addTab('s1');
      setup.addTab('s2');
      await settle();
      const logged = setup.harness.logs.length;

      setup.rows.delete('s1');
      await settle();
      if (hasNeighbourNotice) {
        setup.rows.set('s2', hostRow('s2'));
        await settle();
      }
      setup.selection.set('s2');
      await settle();

      expect(setup.activeNotices).toEqual(['s2']);
      expect(
        setup.harness.logs
          .slice(logged)
          .filter((line) => line.message.includes('nothing shown')),
      ).toEqual([]);
      await setup.harness.stop();
    },
  );

  it('selectedRowRemoved_WaitsForTheSelectionNotice: a closed pane shows the kept tab again', async () => {
    const setup = await startApplied(['s1', 's3', 's2'], 's1', savedSplit('b'));
    const shown = setup.addTab('s2');
    await settle();
    shown.mockClear();

    setup.rows.delete('s1');
    await settle();
    setup.rows.set('s3', hostRow('s3'));
    await settle();
    expect(shown).not.toHaveBeenCalled();
    setup.selection.set('s3');
    await settle();

    expect(shown).toHaveBeenCalledTimes(1);
    await setup.harness.stop();
  });

  it('rowNotice_ReachesLaterReadersBeforeActive', async () => {
    const setup = await startApplied(['s1', 's2'], 's2', savedSplit('a'));
    const heard: string[] = [];
    setup.harness.state
      .read(sessionsRowsSlot, 'test')
      .on(() => heard.push('rows'));
    setup.active.on(() => heard.push('active'));

    setup.rows.delete('s1');
    await settle();

    expect(heard).toEqual(['rows', 'active']);
    expect(setup.active.get()).toBe('s2');
    await setup.harness.stop();
  });

  it('paneChange_WritesActiveSynchronously', async () => {
    const setup = await startApplied(['s1', 's2'], 's1');

    setup.exports.activate('s2');

    expect(setup.active.get()).toBe('s2');
    await setup.harness.stop();
  });

  it('selectRow_Handler_ActivatesAndClosesTheOverlay', async () => {
    const setup = await startApplied(['s1', 's2'], 's1');
    setup.activations.length = 0;

    setup.harness.started().commands.selectRow({ arg: 's2' });

    expect(setup.active.get()).toBe('s2');
    expect(setup.activations).toEqual(['s2']);
    expect(setup.harness.picked).toEqual(['sessions.sessions']);
    await setup.harness.stop();
  });

  it('selectTab_Handler_SelectsTheTabAndLogsNoShowedLine', async () => {
    const setup = await startApplied(['s1'], 's1');
    const { commands } = setup.harness.started();
    commands.showMode({ arg: undefined });
    const tabOf = (id: string) =>
      setup.exports.addTab('s1', {
        id,
        title: `Tab ${id}`,
        icon: 'book',
        element: document.createElement('div'),
        beforeClose: () => true,
        shown: () => undefined,
      });
    const first = tabOf('first');
    const second = tabOf('second');
    const logged = setup.harness.logs.length;

    commands.selectTab({ arg: { sessionId: 's1', tab: 'second' } });

    expect([first.isVisible(), second.isVisible()]).toEqual([false, true]);
    expect(
      setup.harness.logs
        .slice(logged)
        .filter((line) => line.message.startsWith('showed')),
    ).toEqual([]);
    await setup.harness.stop();
  });

  // The focused pane's session is in project `project`; the handler acts on
  // the project it names.
  it.each([
    {
      case: 'toggles the named project',
      preview: false,
      favorites: ['other'],
      line: 'favorited other',
    },
    {
      case: 'under the preview saves nothing',
      preview: true,
      favorites: [],
      line: 'projects ignored: the layout preview shows',
    },
  ])(
    'favoriteProjectAt_Handler_TogglesTheNamedProject: $case',
    async ({ preview, favorites, line }) => {
      const uiState = fakeUiState([['favorites', []]]);
      const setup = await startApplied(['s1'], 's1', uiState);
      const { commands } = setup.harness.started();
      if (preview) {
        commands.openPreview({ arg: undefined });
      }

      commands.favoriteProjectAt({ arg: 'other' });

      expect(uiState.get('favorites')).toEqual(favorites);
      expect(setup.harness.logs.map((logged) => logged.message)).toContain(
        line,
      );
      await setup.harness.stop();
    },
  );

  it('rowNotice_LeavesWaitedEchoes: a selection write still places nothing', async () => {
    const setup = await startApplied(['s1', 's2'], 's1');
    // The page asks for s2, then back for s1, while main's selection is s1.
    setup.exports.activate('s2');
    setup.exports.activate('s1');
    await settle();

    // Main's answer to the first ask: its mark-clearing row, then the selection.
    setup.rows.set('s2', hostRow('s2'));
    setup.selection.set('s2');
    await settle();

    expect(setup.active.get()).toBe('s1');
    await setup.harness.stop();
  });

  it('refused_close_toasts_the_reason', async () => {
    const setup = await startApplied(['s1'], 's1', fakeUiState(), {
      closeRefusal: "Finish or cancel label s1's round first",
    });

    setup.harness.started().commands.closeSession({ arg: undefined });
    await settle();

    expect(toasts(setup)).toEqual([
      "toast info: Finish or cancel label s1's round first",
    ]);
    expect(setup.harness.logs.map((line) => line.message)).toContain(
      'session close kept by main: label s1',
    );
    await setup.harness.stop();
  });

  it.each([
    {
      case: 'a tab says so',
      atOnces: [false, true],
      calls: ['a.beforeClose(true)', 'b.beforeClose(true)'],
    },
    {
      case: 'no tab says so',
      atOnces: [false, false],
      calls: ['a.beforeClose(false)', 'b.beforeClose(false)'],
    },
  ])(
    'close_key_passes_at_once_only_when_a_tab_says_so: $case',
    async ({ atOnces, calls }) => {
      const setup = await startApplied(['s1'], 's1');
      const heard: string[] = [];
      closeTab(setup, 's1', 'a', heard, { atOnce: atOnces[0] });
      closeTab(setup, 's1', 'b', heard, { atOnce: atOnces[1] });
      heard.length = 0;

      setup.harness.started().commands.closeSession({ arg: undefined });
      await settle();

      expect(heard).toEqual(calls);
      expect(setup.closes).toEqual([['s1', atOnces[1]]]);
      await setup.harness.stop();
    },
  );

  it('close_key_passes_at_once_when_a_popup_says_so', async () => {
    const setup = await startApplied(['s1'], 's1');
    const heard: string[] = [];
    closeTab(setup, 's1', 'chat', heard);
    setup.exports.addPopup('s1', {
      id: 'forms',
      title: 'Forms',
      icon: 'bell',
      element: document.createElement('div'),
      closesAtOnce: () => true,
      beforeClose: (isAtOnce) => {
        heard.push(`forms.beforeClose(${isAtOnce})`);
        return true;
      },
      shown: () => undefined,
    });
    heard.length = 0;

    setup.harness.started().commands.closeSession({ arg: undefined });
    await settle();

    expect(heard).toEqual([
      'chat.beforeClose(true)',
      'forms.beforeClose(true)',
    ]);
    expect(setup.closes).toEqual([['s1', true]]);
    await setup.harness.stop();
  });

  it('refusing_tab_stops_main_being_asked', async () => {
    const setup = await startApplied(['s1'], 's1');
    const heard: string[] = [];
    closeTab(setup, 's1', 'docs', heard, { mayClose: false });
    closeTab(setup, 's1', 'forms', heard, { atOnce: true });
    heard.length = 0;

    setup.harness.started().commands.closeSession({ arg: undefined });
    await settle();

    expect(heard).toEqual(['docs.beforeClose(true)']);
    expect(setup.closes).toEqual([]);
    await setup.harness.stop();
  });

  it('tab_shown_and_hidden_run_on_a_switch_and_on_mode_hide', async () => {
    const setup = await startApplied(['s1'], 's1', fakeUiState(), {
      withOtherMode: true,
    });
    const { commands } = setup.harness.started();
    const heard: string[] = [];
    closeTab(setup, 's1', 'a', heard);
    closeTab(setup, 's1', 'b', heard);
    commands.showMode({ arg: undefined });
    commands.selectTab({ arg: { sessionId: 's1', tab: 'a' } });
    heard.length = 0;
    const emitted = setup.harness.emitted.length;

    commands.selectTab({ arg: { sessionId: 's1', tab: 'b' } });
    setup.showOther();

    expect(heard).toEqual(['a.hidden', 'b.shown', 'b.hidden']);
    expect(
      setup.harness.emitted
        .slice(emitted)
        .filter((each) => each.event === 'sessions.tabShown')
        .map((each) => each.data),
    ).toEqual([{ sessionId: 's1', tabId: 'b' }]);
    await setup.harness.stop();
  });

  it.each([
    { case: 'main opened it', isOpened: true, toasted: [] },
    {
      case: 'a mark selected it',
      isOpened: false,
      toasted: ['toast info: Round from label s1'],
    },
  ])(
    'opening_a_selected_session_with_the_mode_hidden_toasts_nothing: $case',
    async ({ isOpened, toasted }) => {
      const setup = await startApplied([], null, fakeUiState(), {
        withOtherMode: true,
      });

      if (isOpened) {
        setup.harness.send('activated', { sessionId: 's1' });
      }
      setup.rows.set('s1', {
        ...hostRow('s1'),
        markToast: { text: 'Round from label s1', action: 'answer' },
      });
      setup.selection.set('s1');
      await settle();

      expect(toasts(setup)).toEqual(toasted);
      await setup.harness.stop();
    },
  );

  it('popupOverTab_HideAndShowAgain_TellTheVisibleSurface', async () => {
    const setup = await startApplied(['s1'], 's1');
    const tabShown = setup.addTab('s1');
    await settle();
    tabShown.mockClear();

    const popup = setup.addPopup('s1');
    expect([popup.shown.mock.calls.length, tabShown.mock.calls.length]).toEqual(
      [1, 0],
    );
    setup.harness.showLayouts(withUser<Layout>(defaultLayout, {}));
    expect(popup.shown).toHaveBeenCalledTimes(2);
    popup.handle.hide();

    expect(tabShown).toHaveBeenCalledTimes(1);
    expect(popup.shown).toHaveBeenCalledTimes(2);
    await setup.harness.stop();
  });

  it.each<{
    case: string;
    rowIds: string[];
    popup: 'open' | 'hidden' | 'none';
    by: 'togglePopup' | 'bar click';
    logged: string;
  }>([
    {
      case: 'an open popup hides',
      rowIds: ['s1'],
      popup: 'open',
      by: 'togglePopup',
      logged: 'hid Popup popup in label s1',
    },
    {
      case: 'a hidden popup opens',
      rowIds: ['s1'],
      popup: 'hidden',
      by: 'togglePopup',
      logged: 'opened Popup popup in label s1',
    },
    {
      case: "a hidden popup's bar entry opens it",
      rowIds: ['s1'],
      popup: 'hidden',
      by: 'bar click',
      logged: 'opened Popup popup in label s1',
    },
    {
      case: 'a session with no popup',
      rowIds: ['s1'],
      popup: 'none',
      by: 'togglePopup',
      logged: 'no popup in label s1',
    },
    {
      case: 'no session shown',
      rowIds: [],
      popup: 'none',
      by: 'togglePopup',
      logged: 'no popup: no session shown',
    },
  ])('popupToggle_FocusedSession_LogsWhatItDid ($case)', async (test) => {
    const setup = await startApplied(test.rowIds, test.rowIds[0] ?? null);
    const added = test.popup === 'none' ? null : setup.addPopup(test.rowIds[0]);
    const popup = added?.handle ?? null;
    if (test.popup === 'hidden') {
      popup?.hide();
    }
    const logged = setup.harness.logs.length;

    if (test.by === 'bar click') {
      const [entry] = findAll(
        outermostAncestor(asFake(added!.element)),
        'session-popup-bar-entry',
      );
      entry.click();
    } else {
      setup.togglePopup();
    }

    expect(setup.logsSince(logged)).toContain(test.logged);
    expect(popup?.isVisible() ?? false).toBe(test.popup === 'hidden');
    await setup.harness.stop();
  });

  it('togglePopup_ModeHidden_ShowsTheModeThenActs', async () => {
    const setup = await startApplied(['s1'], 's1', fakeUiState(), {
      withOtherMode: true,
    });
    const { handle } = setup.addPopup('s1');
    expect(setup.exports.shownSessionId()).toBeNull();
    const logged = setup.harness.logs.length;

    setup.togglePopup();

    expect(setup.exports.shownSessionId()).toBe('s1');
    expect(setup.logsSince(logged)).toContain('hid Popup popup in label s1');
    expect(handle.isVisible()).toBe(false);
    await setup.harness.stop();
  });

  it('panePressed_PopupOpenFocusOutside_LetsGoWithNoChatBox', async () => {
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
    const focusBox = vi.fn();
    const setup = await startApplied(['s1', 's2'], 's1', savedSplit('a'), {
      parts: [chatFocusBoxPart(focusBox)],
    });
    const { element: popupElement } = setup.addPopup('s2');
    const outside = document.createElement('textarea') as unknown as {
      focus(): void;
    };
    outside.focus();
    // The harness stubs its own copy of the document the fake DOM stubbed.
    const focused = () =>
      (document as unknown as FocusFakeDocument).activeElement;
    expect(focused()).not.toBeNull();

    setup.harness.fireWindow('pointerdown', { target: popupElement });
    setup.harness.fireWindow('pointerup');

    expect(setup.exports.shownSessionId()).toBe('s2');
    expect(focused()).toBeNull();
    expect(focusBox).not.toHaveBeenCalled();
    await setup.harness.stop();
  });

  it('closeSession_PopupRefuses_KeepsTheSession', async () => {
    const setup = await startApplied(['s1'], 's1');
    setup.addTab('s1');
    setup.addPopup('s1', () => false);

    expect(await setup.exports.closeSession('s1')).toBe(false);
    await setup.harness.stop();
  });
});
