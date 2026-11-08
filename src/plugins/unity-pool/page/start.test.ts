import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  type SessionRow,
  sessionsRowsSlot,
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import {
  type PoolClone,
  type PoolSnapshot,
  unityPoolSnapshotSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout, PanelInput } from '../layouts/layout';
import { sessionHolders } from './pool-view-model';
import { unityPoolPagePart } from './start';

const ROW_ID = 'row-1';
const CLONE_PATH = '/x/repo-1';

const ROW: SessionRow = {
  sessionId: ROW_ID,
  label: 'alpha 1',
  project: 'alpha',
  harness: 'claude',
  marked: false,
  projectDir: CLONE_PATH,
  hostSessionId: 'host-1',
  titles: { user: null, agent: null, firstMessage: null },
  profileDir: null,
};

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
// `focuses` receives the right-bar `focus` of each contribution with one.
function startOnHarness(
  invoke?: (method: string, ...args: unknown[]) => Promise<unknown>,
  focuses: (() => void)[] = [],
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
            activate() {},
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
    const before = harness.counts();

    await harness.restart();

    expect(harness.counts()).toEqual(before);
  });

  it.each([
    { name: 'written before core.pageReady', writesFirst: true },
    { name: 'written after core.pageReady', writesFirst: false },
  ])('pools_ReachThePanel: $name', ({ writesFirst }) => {
    const harness = startOnHarness(() => Promise.resolve(null));
    const panels = captureLayout(harness);
    harness.state.publish(sessionsRowsSlot).set(ROW_ID, ROW);
    harness.state.publish(sessionsActiveSlot).set(ROW_ID);
    const pools = harness.state.publish(unityPoolSnapshotSlot);

    if (writesFirst) {
      pools.set(SNAPSHOT);
    }
    harness.emit('core.pageReady', null);
    if (!writesFirst) {
      pools.set(SNAPSHOT);
    }

    expect(panels.map(({ pool }) => pool).at(-1)).toBe('p');
  });

  it('run_OnePerCloneAndARejectedCallShowsItsError', async () => {
    const run = deferred<unknown>();
    const runs: unknown[][] = [];
    const harness = startOnHarness(async (method, ...args) => {
      if (method === 'run') {
        runs.push(args);
        return run.promise;
      }
      return null;
    });
    const panels = captureLayout(harness);
    harness.state.publish(unityPoolSnapshotSlot).set(SNAPSHOT);
    harness.emit('core.pageReady', null);
    harness.state.publish(sessionsActiveSlot).set(ROW_ID);
    harness.state.publish(sessionsRowsSlot).set(ROW_ID, ROW);
    await vi.waitFor(() => expect(panels.length).toBeGreaterThan(0));
    const hold = () => panels[panels.length - 1].clones[0].action?.run();

    hold();
    hold();
    run.reject(new Error('main stopped'));

    await vi.waitFor(() =>
      expect(panels[panels.length - 1].clones[0].result).toEqual({
        ok: false,
        text: 'main stopped',
      }),
    );
    expect(runs).toEqual([['hold', 'p', 1]]);
  });

  // Clones 1 and 2 claimed by rows A and B, B shown, the panel drawn, over
  // the fake DOM with focus.
  function twoHolders() {
    installFocusFakeDom(vi.stubGlobal);
    const focuses: (() => void)[] = [];
    const harness = startOnHarness(() => Promise.resolve(null), focuses);
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
    harness.emit('core.pageReady', null);
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
