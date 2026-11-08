import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageStart } from '../../../contracts/plugin';
import { installFakeDom } from '../../../shared/page/test-dom';
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
// `consumer.track` as the real views do. `invoke` answers main's channel, and
// `activated` takes each row id the sessions fake is asked to activate.
function startOnHarness(
  invoke?: (method: string, ...args: unknown[]) => Promise<unknown>,
  activated: string[] = [],
) {
  return startPagePart(unityPoolPagePart, {
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

// A layout that records each panel drawn, and the harness showing it.
function captureLayout(harness: ReturnType<typeof startOnHarness>) {
  const panels: PanelInput[] = [];
  const capture: Layout = {
    panel(parent, input) {
      panels.push(input);
      const root = document.createElement('div');
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
    { name: 'written before ready', writesFirst: true },
    { name: 'written after ready', writesFirst: false },
  ])('pools_ReachThePanel: $name', ({ writesFirst }) => {
    const harness = startOnHarness(() => Promise.resolve(null));
    const panels = captureLayout(harness);
    harness.state.publish(sessionsRowsSlot).set(ROW_ID, ROW);
    harness.state.publish(sessionsActiveSlot).set(ROW_ID);
    const pools = harness.state.publish(unityPoolSnapshotSlot);

    if (writesFirst) {
      pools.set(SNAPSHOT);
    }
    harness.ready();
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
    const harness = startOnHarness(() => Promise.resolve(null), activated);
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
});
