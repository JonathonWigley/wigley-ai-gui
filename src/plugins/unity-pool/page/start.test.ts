import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  deferred,
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import type { PoolClone, PoolSnapshot } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout, PanelInput } from '../layouts/layout';
import { unityPoolPagePart } from './start';

const ROW_ID = 'row-1';
const CLONE_PATH = '/x/repo-1';

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
// `selected` is the row the sessions fake shows.
function startOnHarness(
  invoke?: (method: string, ...args: unknown[]) => Promise<unknown>,
  selected: string | null = null,
) {
  return startPagePart(unityPoolPagePart, {
    invoke,
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            selectedSessionId: () => selected,
            activate() {},
            addRowPart: () => consumer.track({ dispose() {} }),
          }) as unknown as SessionsPageExports,
      ),
    ],
  });
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

  it('run_OnePerCloneAndARejectedCallShowsItsError', async () => {
    const snapshot: PoolSnapshot = {
      pools: [{ pool: 'p', updatedAt: 0, clones: [UNHELD_CLONE], queue: [] }],
    };
    const run = deferred<unknown>();
    const runs: unknown[][] = [];
    const harness = startOnHarness(async (method, ...args) => {
      if (method === 'run') {
        runs.push(args);
        return run.promise;
      }
      return method === 'snapshot' ? snapshot : null;
    }, ROW_ID);
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
    harness.emit('sessions.sessionAdded', {
      sessionId: ROW_ID,
      label: 'alpha 1',
      projectDir: CLONE_PATH,
      hostSessionId: 'host-1',
    });
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
});
