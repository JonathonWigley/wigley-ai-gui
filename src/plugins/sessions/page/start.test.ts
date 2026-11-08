import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvents } from '../../../contracts/core-state';
import type {
  PageApi,
  PagePart,
  PluginManifest,
  QualifiedEvents,
} from '../../../contracts/plugin';
import type { UiState } from '../../../contracts/ui-state';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import {
  asFake,
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
  sessionsRowsSlot,
  sessionsSelectionSlot,
} from '../contract';
import { fakeUiState, sessionRow } from './session-fakes';
import { sessionsPagePart } from './start';

// Lets a queued microtask and a settled read's `then` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const hostRow = (sessionId: string) => ({
  ...sessionRow(sessionId),
  hostSessionId: `host-${sessionId}`,
});

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

// The part on the harness, its rows and selection written, up to the first
// state's focus. `activations` holds each session the page asks main to activate.
async function startApplied(
  rowIds: string[],
  selected: string | null,
  uiState: UiState = fakeUiState(),
) {
  const activations: unknown[] = [];
  const harness = startPagePart(sessionsPagePart, {
    invoke: async (method, sessionId) => {
      if (method === 'activate') {
        activations.push(sessionId);
      }
      return true;
    },
    services: { picker: fakeListPickerService(), uiState },
  });
  const rows = harness.state.publish(sessionsRowsSlot);
  const selection = harness.state.publish(sessionsSelectionSlot);
  for (const sessionId of rowIds) {
    rows.set(sessionId, hostRow(sessionId));
  }
  selection.set(selected);
  harness.emit('core.pageReady', null);
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
  return {
    harness,
    rows,
    selection,
    active,
    activeNotices,
    activations,
    exports,
    addTab,
    uiState,
  };
}

// The sessions the panes hold as uiState saved them last.
function savedPaneSessions(uiState: UiState): (string | null)[] {
  const panes = uiState.get('panes') as { sessions: Record<string, unknown> };
  return Object.values(panes.sessions) as (string | null)[];
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

  it('addTab_TabAdded_FiresTabAdded', async () => {
    const setup = await startApplied(['s1'], 's1');

    setup.addTab('s1');

    expect(dataEmitted(setup.harness, 'sessions.tabAdded')).toEqual([
      { sessionId: 's1', tabId: 'tab' },
    ]);
    await setup.harness.stop();
  });

  it('pageReady_AppliesOnceFromTheStore', async () => {
    const uiState = fakeUiState();
    const written = vi.spyOn(uiState, 'set');
    const harness = startPagePart(sessionsPagePart, {
      services: { picker: fakeListPickerService(), uiState },
    });
    harness.state.publish(sessionsRowsSlot).set('s1', hostRow('s1'));
    harness.state.publish(sessionsSelectionSlot).set('s1');
    await settle();
    expect(written).not.toHaveBeenCalled();

    harness.emit('core.pageReady', null);
    await settle();

    expect(harness.state.read(sessionsActiveSlot, 'test').get()).toBe('s1');
    expect(
      harness.logs.filter((line) => line.message === 'activated label s1'),
    ).toHaveLength(1);
    await harness.stop();
  });

  it('pageReady_SessionsAppliesBeforeAReaderAdded', async () => {
    // A row part's builds, then what they held as each `added` arrived.
    const drawn: string[] = [];
    const drawnWhenAdded: string[][] = [];
    const reader: PagePart<PluginManifest> = {
      manifest: {
        ...sessionsPagePart.manifest,
        id: 'reader',
        dependsOn: { main: [], page: ['sessions'] },
      },
      start(
        api: PageApi<
          PluginManifest,
          never,
          Record<never, never>,
          QualifiedEvents<'core', CoreEvents>
        >,
      ) {
        api.dependency(sessionsPageKey).addRowPart({
          id: 'reader.row',
          build(_parent, sessionId) {
            drawn.push(sessionId);
            return {};
          },
        });
        api.events.on('core.pageReady', () => {
          followRows(api.state.read(sessionsRowsSlot), {
            added: () => drawnWhenAdded.push([...drawn]),
          });
        });
        return { commands: {} };
      },
    } as unknown as PagePart<PluginManifest>;
    const harness = startPagePart(reader, {
      parts: [sessionsPagePart],
      services: { picker: fakeListPickerService() },
    });
    harness.state.publish(sessionsRowsSlot).set('s1', hostRow('s1'));
    harness.state.publish(sessionsSelectionSlot).set('s1');

    harness.emit('core.pageReady', null);

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
});

describe('the sessions list in the page part', () => {
  beforeEach(() => {
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const MODE_ID = 'sessions.sessions';

  // The part with `rowIds` applied and `selected` shown, its side bar shown.
  async function startWithList(
    rowIds: string[],
    selected: string | null,
    uiState?: UiState,
  ) {
    const setup = await startApplied(rowIds, selected, uiState);
    setup.harness.setSideBarShown(true);
    const mode = setup.harness.mode(MODE_ID);
    const { commands } = setup.harness.started();
    const linesFrom = (start: number) =>
      setup.harness.logs.slice(start).map((line) => line.message);
    return { ...setup, mode, commands, linesFrom };
  }

  it('listShow_KeepsTheListScope_WhileTheVisibleTabChanges', async () => {
    const setup = await startWithList(['s1', 's2'], 's1');
    setup.addTab('s1');
    const shownS2 = setup.addTab('s2');
    setup.mode.focusSideBar?.();
    setup.commands.listDown({ arg: undefined });

    setup.commands.listShow({ arg: undefined });

    expect(setup.active.get()).toBe('s2');
    expect(shownS2).not.toHaveBeenCalled();
    expect(setup.harness.scope()).toBe('sessions.sidebar');
    await setup.harness.stop();
  });

  it('focusMain_SetsIdle_WhenThePaneShowsNoTab', async () => {
    const setup = await startWithList(['s1'], 's1');
    setup.mode.focusSideBar?.();
    const start = setup.harness.logs.length;

    setup.mode.focusMain();

    expect(setup.harness.scope()).toBe('sessions.idle');
    expect(setup.harness.picks).toEqual([MODE_ID]);
    expect(setup.linesFrom(start)).toContain('list left');
    await setup.harness.stop();
  });

  it('paneKeyFocused_ReshowsTheTab', async () => {
    const setup = await startWithList(['s1', 's2'], 's1', savedSplit('a'));
    setup.addTab('s1');
    const shownS2 = setup.addTab('s2');
    const start = setup.harness.logs.length;

    setup.harness.outerPanes()?.focus.move('right');

    // Once as the visible tab changes, once more as the keys reach the pane.
    expect(shownS2).toHaveBeenCalledTimes(2);
    expect(setup.linesFrom(start)).toContain('keys to pane label s2');
    expect(
      setup.harness.commandRuns.some((run) => run.id === 'chat.focusBox'),
    ).toBe(false);
    await setup.harness.stop();
  });

  it.each<{
    case: string;
    act: (setup: Awaited<ReturnType<typeof startWithList>>) => void;
    lines: string[];
    scope: string;
  }>([
    {
      case: 'a press in the chat panes',
      act: ({ mode }) => asFake(mode.element).fire('pointerdown'),
      lines: ['list left'],
      scope: 'sessions.idle',
    },
    {
      case: 'a focus in the chat panes',
      act: ({ mode }) => asFake(mode.element).fire('focusin'),
      lines: ['list left'],
      scope: 'sessions.idle',
    },
    {
      case: 'the side bar hiding',
      act: ({ mode }) => mode.sideBarHidden?.(),
      lines: ['list left', 'keys to pane label s1'],
      scope: 'sessions.idle',
    },
    {
      case: 'the mode hiding, then showing again',
      act: ({ mode }) => {
        mode.hidden();
        mode.shown();
      },
      lines: [],
      scope: 'sessions.idle',
    },
  ])('listTurn_EndsWithoutPicked: $case', async ({ act, lines, scope }) => {
    const setup = await startWithList(['s1'], 's1');
    setup.mode.focusSideBar?.();
    const start = setup.harness.logs.length;

    act(setup);

    const shown = setup
      .linesFrom(start)
      .filter((line) => line === 'list left' || line.startsWith('keys to'));
    expect(shown).toEqual(lines);
    expect(setup.harness.scope()).toBe(scope);
    expect(setup.harness.picks).toEqual([]);
    await setup.harness.stop();
  });

  it('listKey_DoesNothing_WhileTheSideBarIsHidden', async () => {
    const setup = await startWithList(['s1', 's2'], 's1');
    setup.mode.focusSideBar?.();
    setup.harness.setSideBarShown(false);
    const start = setup.harness.logs.length;

    setup.commands.listDown({ arg: undefined });

    expect(setup.linesFrom(start)).toEqual([
      'list keys ignored: the side bar is hidden',
    ]);
    await setup.harness.stop();
  });
});
