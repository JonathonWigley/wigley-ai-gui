import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type { RunMode } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { uiStateOver } from '../../../shared/fake-ui-state.test-support';
import {
  FakeElement,
  installFakeDom,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import {
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type StatsMeter,
  type StatsProcessRow,
  type StatsSnapshot,
  systemStatsSnapshotSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout, PanelInput } from '../layouts/layout';
import { systemStatsPagePart } from './start';

function proc(
  id: string,
  cpuPercent: number,
  children: StatsProcessRow[] = [],
): StatsProcessRow {
  return {
    id,
    name: id,
    kind: children.length === 0 ? 'process' : 'app',
    cpuPercent,
    rssBytes: cpuPercent * 1_000_000,
    gpuPercent: null,
    children,
  };
}

// A group above a process by CPU and below it by RAM, so a sort moves the group's row.
const revealRows: StatsProcessRow[] = [
  { ...proc('g', 9, [proc('g1', 5), proc('g2', 4)]), rssBytes: 1_000_000 },
  proc('p', 2),
];

function meter(percent: number): StatsMeter {
  return { percent, tone: 'normal', history: [percent], label: `${percent}%` };
}

function snapshot(
  rows: StatsProcessRow[],
  error: string | null = null,
): StatsSnapshot {
  return {
    takenAt: 0,
    cpu: meter(40),
    gpu: meter(10),
    ram: meter(60),
    network: meter(5),
    disk: meter(2),
    memoryNote: '',
    rows,
    error,
  };
}

// The part on the harness in `runMode`, its `uiState` a map the test reads, `invoke` recording each channel call.
// `focuses` takes the right-bar `focus` of each contribution, and `disposals` counts each contribution disposed.
// `enterDemoStep` enters the registered `system-stats.panel` step.
function startOnHarness({
  runMode = 'live',
  stored = new Map<string, unknown>(),
}: { runMode?: RunMode; stored?: Map<string, unknown> } = {}) {
  const invoked: unknown[][] = [];
  const focuses: (() => void)[] = [];
  const disposals: string[] = [];
  const uiState = uiStateOver(stored);
  const part: typeof systemStatsPagePart = {
    ...systemStatsPagePart,
    start(api) {
      const contribute = api.areas.rightBar.contribute;
      vi.spyOn(api.areas.rightBar, 'contribute').mockImplementation(
        (element, options) => {
          if (options?.focus !== undefined) {
            focuses.push(options.focus);
          }
          const contribution = contribute(element, options);
          return {
            dispose() {
              disposals.push('panel');
              contribution.dispose();
            },
          };
        },
      );
      return systemStatsPagePart.start(api);
    },
  };
  const demoSteps = createDemoStepRegistry<DemoStep>();
  const harness = startPagePart(part, {
    services: { runMode, uiState, demoSteps },
    invoke: async (method, ...args) => {
      invoked.push([method, ...args]);
    },
  });
  const messages = () =>
    harness.logs
      .filter(({ source }) => source === 'system-stats')
      .map(({ message }) => message);
  const enterDemoStep = () => {
    const step = demoSteps.list().find(({ id }) => id === 'system-stats.panel');
    if (step === undefined) {
      throw new Error('system-stats registered no system-stats.panel step');
    }
    return step.enter({ scratchDir: '/scratch', sessions: {} });
  };
  return {
    harness,
    invoked,
    focuses,
    disposals,
    stored,
    messages,
    enterDemoStep,
  };
}

// A layout that records each panel drawn and draws a row per row, titled with its name and marked `is-cursor` as the
// contract asks, and the harness showing it.
function captureLayout(harness: ReturnType<typeof startOnHarness>['harness']) {
  const panels: PanelInput[] = [];
  const capture: Layout = {
    panel(parent, input) {
      panels.push(input);
      const root = document.createElement('div');
      for (const { name, isCursor } of input.rows) {
        const row = document.createElement('div');
        row.title = name;
        row.classList.toggle('is-cursor', isCursor);
        root.append(row);
      }
      parent.append(root);
      return { element: root };
    },
  };
  harness.showLayouts({
    layouts: new Map<string, Layout>([
      ['default', defaultLayout],
      ['capture', capture],
    ]),
    user: 'capture',
  });
  const cursorNames = () =>
    (panels.at(-1)?.rows ?? [])
      .filter(({ isCursor }) => isCursor)
      .map(({ name }) => name);
  return { panels, cursorNames };
}

describe('systemStatsPagePart', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness } = startOnHarness();
    harness.ready();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it.each<{
    name: string;
    runMode: RunMode;
    hidden: boolean | undefined;
    shown: boolean;
  }>([
    {
      name: 'live, none kept',
      runMode: 'live',
      hidden: undefined,
      shown: true,
    },
    { name: 'live, hidden kept', runMode: 'live', hidden: true, shown: false },
    {
      name: 'self-test, none kept',
      runMode: 'selfTest',
      hidden: undefined,
      shown: false,
    },
    {
      name: 'self-test, shown kept',
      runMode: 'selfTest',
      hidden: false,
      shown: true,
    },
  ])('start_ReportsShownState: $name', ({ runMode, hidden, shown }) => {
    const stored = new Map<string, unknown>();
    if (hidden !== undefined) {
      stored.set('hidden', hidden);
    }
    const { harness, invoked, messages } = startOnHarness({ runMode, stored });

    harness.ready();

    expect({
      invoked,
      announced: messages().includes('panel shown: reading'),
    }).toEqual({ invoked: [['setShown', shown]], announced: shown });
  });

  it('snapshotChange_LogsErrorOnce', () => {
    const { harness, messages } = startOnHarness();
    harness.ready();
    const slot = harness.state.publish(systemStatsSnapshotSlot);

    slot.set(snapshot([proc('a', 2)], 'ps exited with code 1'));
    slot.set(snapshot([proc('a', 3)], 'ps exited with code 1'));
    slot.set(snapshot([proc('a', 4)]));

    expect(messages().filter((message) => message.startsWith('error'))).toEqual(
      ['error: ps exited with code 1', 'error cleared'],
    );
  });

  it('hiddenPanel_DrawsNothingOnSnapshot', () => {
    const { harness, messages } = startOnHarness({
      stored: new Map([['hidden', true]]),
    });
    const { panels } = captureLayout(harness);
    harness.ready();
    const slot = harness.state.publish(systemStatsSnapshotSlot);

    slot.set(snapshot([proc('a', 2), proc('b', 7)], 'ps exited'));
    const whileHidden = { panels: panels.length, lines: messages().length };
    harness.started().commands.togglePanel({ arg: undefined });

    expect({ whileHidden, last: messages().at(-1) }).toEqual({
      whileHidden: { panels: 0, lines: 0 },
      last: 'panel shown: b, a',
    });
  });

  describe('cursorFallback_RowsChangeUnderTheCursor', () => {
    // Shown live, the snapshot `rows` drawn, the panel given the keys.
    function focused(rows: StatsProcessRow[]) {
      installFocusFakeDom(vi.stubGlobal);
      const started = startOnHarness();
      const captured = captureLayout(started.harness);
      const slot = started.harness.state.publish(systemStatsSnapshotSlot);
      slot.set(snapshot(rows));
      started.harness.ready();
      started.focuses[0]();
      return { ...started, ...captured, slot };
    }

    it('a child gone from its open group moves the cursor to the group', () => {
      const { harness, slot, cursorNames } = focused([
        proc('g', 9, [proc('g1', 5), proc('g2', 4)]),
        proc('p', 1),
      ]);
      const { commands } = harness.started();
      commands.openGroup({ arg: undefined });
      commands.cursorDown({ arg: undefined });

      slot.set(snapshot([proc('g', 9, [proc('g2', 4)]), proc('p', 1)]));

      expect(cursorNames()).toEqual(['g']);
    });

    it.each([
      { name: 'the row at the last index', moves: 1, cursor: ['c'] },
      { name: 'clamped to the list', moves: 2, cursor: ['b'] },
    ])('the cursor row gone takes $name', ({ moves, cursor }) => {
      const rows = [proc('a', 9), proc('b', 6), proc('c', 3)];
      const { harness, slot, cursorNames } = focused(rows);
      for (let move = 0; move < moves; move++) {
        harness.started().commands.cursorDown({ arg: undefined });
      }
      const gone = rows[moves].id;

      slot.set(snapshot(rows.filter(({ id }) => id !== gone)));

      expect(cursorNames()).toEqual(cursor);
    });

    // Breaks: a key command that moves rows without moving the cursor's id leaving them off-screen, an opened group
    // scrolling only its row, or a snapshot redraw yanking a wheel scroll back.
    it.each<{
      name: string;
      act: (
        commands: ReturnType<
          ReturnType<typeof startOnHarness>['harness']['started']
        >['commands'],
        slot: ReturnType<typeof focused>['slot'],
      ) => void;
      scrolled: string[];
    }>([
      {
        name: 'open scrolls the last child, then the group',
        act: (commands) => commands.openGroup({ arg: undefined }),
        scrolled: ['g2', 'g'],
      },
      {
        name: 'close scrolls the group',
        act: (commands) => {
          commands.openGroup({ arg: undefined });
          commands.cursorDown({ arg: undefined });
          commands.closeGroup({ arg: undefined });
        },
        scrolled: ['g2', 'g', 'g1', 'g'],
      },
      {
        name: 'a move scrolls the cursor row',
        act: (commands) => commands.cursorDown({ arg: undefined }),
        scrolled: ['p'],
      },
      {
        name: 'sort reveals the cursor row',
        act: (commands) => commands.cycleSort({ arg: undefined }),
        scrolled: ['g'],
      },
      {
        name: 'a snapshot redraw does not scroll',
        act: (_commands, slot) => slot.set(snapshot(revealRows)),
        scrolled: [],
      },
    ])('reveal_KeyCommandsScrollTheirRows: $name', ({ act, scrolled }) => {
      const { harness, slot } = focused(revealRows);
      const titles: string[] = [];
      vi.spyOn(FakeElement.prototype, 'scrollIntoView').mockImplementation(
        function (this: FakeElement) {
          titles.push(this.title);
        },
      );

      act(harness.started().commands, slot);

      expect(titles).toEqual(scrolled);
    });

    it('an empty panel given the keys takes the first row when rows come', () => {
      const { slot, cursorNames, messages } = focused([]);

      slot.set(snapshot([proc('a', 2), proc('b', 7)]));

      expect({ cursor: cursorNames(), last: messages().at(-1) }).toEqual({
        cursor: ['b'],
        last: 'cursor on b',
      });
    });
  });

  it('togglePanel_FlipsHiddenAndReports', () => {
    const { harness, invoked, stored, disposals } = startOnHarness();
    harness.ready();
    const { commands } = harness.started();
    const kept: unknown[] = [];

    commands.togglePanel({ arg: undefined });
    kept.push(stored.get('hidden'));
    commands.togglePanel({ arg: undefined });
    kept.push(stored.get('hidden'));

    expect({ kept, invoked, disposals }).toEqual({
      kept: [true, undefined],
      invoked: [
        ['setShown', true],
        ['setShown', false],
        ['setShown', true],
      ],
      disposals: ['panel'],
    });
  });

  // Breaks: a stage that writes `uiState`, a dispose that hides a panel the user had shown or toggled.
  it.each<{
    name: string;
    hiddenBefore: boolean;
    // `togglePanel` runs during the step.
    toggles: number;
    invoked: unknown[][];
    hidden: (boolean | undefined)[];
  }>([
    {
      name: 'panel hidden',
      hiddenBefore: true,
      toggles: 0,
      invoked: [
        ['setShown', true],
        ['setShown', false],
      ],
      hidden: [true, true, true],
    },
    {
      name: 'panel shown',
      hiddenBefore: false,
      toggles: 0,
      invoked: [],
      hidden: [undefined, undefined, undefined],
    },
    {
      name: 'user toggled during the step',
      hiddenBefore: true,
      toggles: 1,
      invoked: [
        ['setShown', true],
        ['setShown', false],
      ],
      hidden: [true, true, true],
    },
    {
      name: 'user hid and showed it during the step',
      hiddenBefore: true,
      toggles: 2,
      invoked: [
        ['setShown', true],
        ['setShown', false],
        ['setShown', true],
      ],
      hidden: [true, true, undefined],
    },
  ])(
    'demo stage shows the panel for now: $name',
    async ({ hiddenBefore, toggles, invoked: expected, hidden }) => {
      const { harness, invoked, stored, enterDemoStep } = startOnHarness();
      harness.ready();
      const { commands } = harness.started();
      if (hiddenBefore) {
        commands.togglePanel({ arg: undefined });
      }
      invoked.length = 0;
      const kept = [stored.get('hidden')];

      const stage = await enterDemoStep();
      kept.push(stored.get('hidden'));
      for (let toggle = 0; toggle < toggles; toggle++) {
        commands.togglePanel({ arg: undefined });
      }
      stage.dispose();
      kept.push(stored.get('hidden'));

      expect({ invoked, kept }).toEqual({ invoked: expected, kept: hidden });
    },
  );
});
