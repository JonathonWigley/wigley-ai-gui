import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageStart } from '../../../contracts/plugin';
import {
  FakeElement,
  installFakeDom,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import {
  deferred,
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  sessionsActiveSlot,
  sessionsRowsSlot,
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import {
  type PoolClone,
  type PoolSnapshot,
  unityPoolSnapshotSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout, PanelInput } from '../layouts/layout';
import { unityPoolManifest } from '../manifest';
import { sessionHolders } from './pool-view-model';
import { unityPoolPagePart } from './start';

const ROW_ID = 'row-1';
const CLONE_2 = { pool: 'q', clone: 2 };

type PoolCommands = PageStart<typeof unityPoolManifest>['commands'];
const CLONE_PATH = '/x/repo-1';

const ROW = sessionRow(ROW_ID, {
  label: 'alpha 1',
  project: 'alpha',
  projectDir: CLONE_PATH,
  hostSessionId: 'host-1',
});

const UNHELD_CLONE: PoolClone = {
  number: 1,
  path: CLONE_PATH,
  facts: { branch: 'main', dirty: false, editor: 'ready', probedAt: 500 },
  claim: null,
  handoff: null,
  stranded: null,
  lastHolder: null,
  lastReleasedAt: null,
  warmup: null,
};

// The part on the harness, over fakes that file each handle with
// `consumer.track` as the real views do. `invoke` answers main's channel;
// `activated` takes each row id the sessions fake is asked to activate, and
// `focuses` the right-bar `focus` of each contribution with one.
function startOnHarness(
  invoke?: (method: string, ...args: unknown[]) => Promise<unknown>,
  {
    activated = [],
    focuses = [],
  }: { activated?: string[]; focuses?: (() => void)[] } = {},
) {
  const part: typeof unityPoolPagePart = {
    ...unityPoolPagePart,
    start(api) {
      const contribute = api.areas.rightBar.contribute;
      vi.spyOn(api.areas.rightBar, 'contribute').mockImplementation(
        (element, options) => {
          if (options?.focus !== undefined) {
            focuses.push(options.focus);
          }
          return contribute(element, options);
        },
      );
      return unityPoolPagePart.start(api);
    },
  };
  return startPagePart(part, {
    invoke,
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            activate(sessionId: string) {
              activated.push(sessionId);
            },
            addRowPart: () => consumer.track({ dispose() {} }),
          }) as unknown as SessionsPageExports,
      ),
    ],
  });
}

const SNAPSHOT: PoolSnapshot = {
  pools: [{ pool: 'p', updatedAt: 0, clones: [UNHELD_CLONE], queue: [] }],
};

// A layout that records each panel drawn, its root carrying `is-cursor` while
// a holder is the cursor's, and the harness showing it.
function captureLayout(harness: ReturnType<typeof startOnHarness>) {
  const panels: PanelInput[] = [];
  const capture: Layout = {
    panel(parent, input) {
      panels.push(input);
      const root = document.createElement('div');
      root.classList.toggle(
        'is-cursor',
        sessionHolders(input).some((holder) => holder.isCursor),
      );
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
  return panels;
}

describe('unityPoolPagePart', () => {
  beforeEach(() => {
    installFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startOnHarness();
    expect(harness.counts().registrations).toBeGreaterThan(0);
    expect(harness.counts().timers).toBe(1);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startOnHarness();
    harness.ready();
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it.each([
    { name: 'written before ready', writesFirst: true, restarts: false },
    { name: 'written after ready', writesFirst: false, restarts: false },
    // The harness tells layouts only when a test shows them, so the restarted
    // part is shown them again.
    {
      name: 'written after a live restart',
      writesFirst: false,
      restarts: true,
    },
  ])('pools_ReachThePanel: $name', async ({ writesFirst, restarts }) => {
    const harness = startOnHarness(() => Promise.resolve(null));
    let panels = captureLayout(harness);
    harness.state.publish(sessionsRowsSlot).set(ROW_ID, ROW);
    harness.state.publish(sessionsActiveSlot).set(ROW_ID);
    const pools = harness.state.publish(unityPoolSnapshotSlot);

    if (writesFirst) {
      pools.set(SNAPSHOT);
    }
    harness.ready();
    if (restarts) {
      await harness.restart();
      panels = captureLayout(harness);
    }
    if (!writesFirst) {
      pools.set(SNAPSHOT);
    }

    expect(panels.map(({ pool }) => pool).at(-1)).toBe('p');
  });

  it.each([
    {
      name: 'hold',
      runs: (commands: PoolCommands) => commands.hold({ arg: CLONE_2 }),
      sent: [['hold', 'q', 2]],
    },
    {
      name: 'release',
      runs: (commands: PoolCommands) => commands.release({ arg: CLONE_2 }),
      sent: [['release', 'q', 2]],
    },
    {
      name: 'a second hold while the first runs',
      runs: (commands: PoolCommands) => {
        commands.hold({ arg: CLONE_2 });
        commands.hold({ arg: CLONE_2 });
      },
      sent: [['hold', 'q', 2]],
    },
  ])('hold_RunsActionOnTheArgsPoolAndClone: $name', ({ runs, sent }) => {
    const runsSent: unknown[][] = [];
    const harness = startOnHarness(async (method, ...args) => {
      if (method === 'run') {
        runsSent.push(args);
        return deferred<unknown>().promise;
      }
      return null;
    });

    runs(harness.started().commands);

    expect(runsSent).toEqual(sent);
  });

  it('selectHolder_RunsActivateWithTheRow', async () => {
    const activated: string[] = [];
    const harness = startOnHarness(() => Promise.resolve(null), { activated });
    const panels: HTMLElement[] = [];
    const drawsDefault: Layout = {
      panel(parent, input, kit) {
        const drawn = defaultLayout.panel(parent, input, kit);
        panels.push(drawn.element);
        return drawn;
      },
    };
    harness.showLayouts({
      layouts: new Map<string, Layout>([
        ['default', defaultLayout],
        ['drawsDefault', drawsDefault],
      ]),
      user: 'drawsDefault',
    });
    const claimed: PoolClone = {
      ...UNHELD_CLONE,
      claim: {
        kind: 'agent',
        session: 'host-1',
        row: ROW_ID,
        since: 0,
        renewedAt: 0,
      },
    };
    harness.state.publish(unityPoolSnapshotSlot).set({
      pools: [{ pool: 'p', updatedAt: 0, clones: [claimed], queue: [] }],
    });
    harness.state.publish(sessionsRowsSlot).set(ROW_ID, ROW);
    harness.state.publish(sessionsActiveSlot).set(ROW_ID);
    harness.ready();
    const holder = panels
      .at(-1)
      ?.querySelector<HTMLElement>('.unity-pool-holder.is-link');

    holder?.click();

    await vi.waitFor(() => expect(activated).toEqual([ROW_ID]));
  });

  it('run_RejectedCall_ShowsItsError', async () => {
    const run = deferred<unknown>();
    const harness = startOnHarness(async (method) =>
      method === 'run' ? run.promise : null,
    );
    const panels = captureLayout(harness);
    harness.state.publish(unityPoolSnapshotSlot).set(SNAPSHOT);
    harness.ready();
    harness.state.publish(sessionsActiveSlot).set(ROW_ID);
    harness.state.publish(sessionsRowsSlot).set(ROW_ID, ROW);
    await vi.waitFor(() => expect(panels.length).toBeGreaterThan(0));

    harness.started().commands.hold({ arg: { pool: 'p', clone: 1 } });
    run.reject(new Error('main stopped'));

    await vi.waitFor(() =>
      expect(panels[panels.length - 1].clones[0].result).toEqual({
        ok: false,
        text: 'main stopped',
      }),
    );
  });

  // Clones 1 and 2 claimed by rows A and B, B shown, the panel drawn, over
  // the fake DOM with focus.
  function twoHolders() {
    installFocusFakeDom(vi.stubGlobal);
    const focuses: (() => void)[] = [];
    const harness = startOnHarness(() => Promise.resolve(null), { focuses });
    const panels = captureLayout(harness);
    const rows = harness.state.publish(sessionsRowsSlot);
    const claimed = (number: number, row: string): PoolClone => ({
      ...UNHELD_CLONE,
      number,
      path: `/x/repo-${number}`,
      claim: { kind: 'agent', session: null, row, since: 0, renewedAt: 0 },
    });
    for (const [sessionId, label, number] of [
      ['row-a', 'A', 1],
      ['row-b', 'B', 2],
    ] as const) {
      rows.set(sessionId, {
        ...ROW,
        sessionId,
        label,
        projectDir: `/x/repo-${number}`,
      });
    }
    harness.state.publish(sessionsActiveSlot).set('row-b');
    harness.state.publish(unityPoolSnapshotSlot).set({
      pools: [
        {
          pool: 'p',
          updatedAt: 0,
          clones: [claimed(1, 'row-a'), claimed(2, 'row-b')],
          queue: [],
        },
      ],
    });
    harness.ready();
    const cursorLabels = () =>
      sessionHolders(panels[panels.length - 1])
        .filter((holder) => holder.isCursor)
        .map((holder) => holder.label);
    return { harness, focuses, cursorLabels };
  }

  // Breaks: `heldCloneCursor` dropped for `0`, or fed another session.
  it('focus_PutsTheCursorOnTheShownSessionsHolder', () => {
    const { focuses, cursorLabels } = twoHolders();

    focuses[0]();

    expect(cursorLabels()).toEqual(['B']);
  });

  // Breaks: the scroll run on every redraw, yanking a wheel scroll back, or
  // skipped on a move.
  it('cursorScroll_OnlyOnTheKeysArrivalOrAMove', () => {
    const { harness, focuses } = twoHolders();
    const scrolled = vi.spyOn(FakeElement.prototype, 'scrollIntoView');
    const scrolls: number[] = [];
    const { commands } = harness.started();

    focuses[0]();
    scrolls.push(scrolled.mock.calls.length);
    harness.advance(60_000);
    scrolls.push(scrolled.mock.calls.length);
    commands.cursorUp({ arg: undefined });
    scrolls.push(scrolled.mock.calls.length);

    expect(scrolls).toEqual([1, 1, 2]);
  });
});
