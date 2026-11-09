import { describe, expect, it, vi } from 'vitest';
import type { OsName } from '../../../contracts/platform';
import { fakePlatform } from '../../../shared/platform.test-support';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type ChatMainExports,
  chatMainKey,
  type PoolProvider,
} from '../../chat/contract';
import {
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import { unityPoolSnapshotSlot } from '../contract';
import { unityPoolManifest } from '../manifest';
import { claimCommandArgs } from './pool-cli';
import {
  poolStateText,
  SELFTEST_POOL,
  SELFTEST_STATE_PATH,
} from './selftest-fixture';
import { unityPoolMainPart } from './start';

// The fake chat records each provider `addPoolProvider` registers and counts each registration's dispose.
function startOnHarness(os: OsName = 'macos') {
  const providers: PoolProvider[] = [];
  let disposed = 0;
  const chat = {
    addPoolProvider: (provider: PoolProvider) => {
      providers.push(provider);
      return {
        dispose: () => {
          disposed++;
        },
      };
    },
  };
  const harness = startMainPart(unityPoolMainPart, {
    settings: { ...unityPoolManifest.settings, scriptPath: '' },
    services: { platform: fakePlatform(os) },
    dependencies: [
      fakeDependency(chatMainKey, () => chat as unknown as ChatMainExports),
      fakeDependency(
        sessionsMainKey,
        () => ({}) as unknown as SessionsMainExports,
      ),
    ],
  });
  return Object.assign(harness, {
    providers,
    disposedRegistrations: () => disposed,
  });
}

const CLAIM = {
  pool: SELFTEST_POOL,
  branch: 'main',
  hostSessionId: 'host-1',
  rowId: 'row-1',
};

describe('unityPoolMainPart', () => {
  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startOnHarness();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startOnHarness();
    // The first scan finds no state folder and sets the minute's check.
    await vi.waitFor(() => expect(harness.counts().timers).toBe(1));
    const before = harness.counts();

    await harness.restart();
    await vi.waitFor(() => expect(harness.counts()).toEqual(before));
  });

  it('start_WritesTheWatchSnapshot_AndAChangeWritesTheNewOne', async () => {
    const harness = startOnHarness();
    const slot = harness.state.read(unityPoolSnapshotSlot, 'test');
    expect(slot.get()).toEqual({ pools: [] });

    await harness.files.write(
      `/home/${SELFTEST_STATE_PATH}`,
      poolStateText(
        { rowId: 'row-1', clonePaths: ['/x/1', '/x/2'], startedAt: 1_000 },
        'opening',
      ),
    );
    // A run reads every pool again.
    await harness.invoke('run', 'hold', SELFTEST_POOL, 1);
    await vi.waitFor(() =>
      expect(slot.get()?.pools.map(({ pool }) => pool)).toEqual([
        SELFTEST_POOL,
      ]),
    );
  });

  // The harness's home is `/home`.
  it.each([
    ['windows', '/home/wigley-agents/tools/unity-pool/unity-pool'],
    ['macos', '/home/.local/bin/unity-pool'],
  ] as const)(
    'run_EmptyScriptPath_LooksUpPlatformDefault: %s',
    async (platform, script) => {
      const harness = startOnHarness(platform);
      const stat = vi.spyOn(harness.files, 'stat');

      await harness.invoke('run', 'hold', 'pool', 1);

      expect(stat).toHaveBeenCalledWith(script);
    },
  );

  it('start_RegistersThePoolProvider_StopDisposesIt', async () => {
    const harness = startOnHarness();
    expect(harness.providers).toHaveLength(1);

    await harness.stop();

    expect(harness.disposedRegistrations()).toBe(1);
  });

  it('poolProvider_Folders_ReadTheWatchSnapshot', async () => {
    const harness = startOnHarness();
    await harness.files.write(
      `/home/${SELFTEST_STATE_PATH}`,
      poolStateText(
        { rowId: 'row-1', clonePaths: ['/x/1', '/x/2'], startedAt: 1_000 },
        'opening',
      ),
    );

    await harness.invoke('run', 'hold', SELFTEST_POOL, 1);

    await vi.waitFor(() =>
      expect(harness.providers[0].folders(SELFTEST_POOL)).toEqual([
        '/x/1',
        '/x/2',
      ]),
    );
  });

  it('poolProvider_Claim_Diverged_ReadsTheStateFile', async () => {
    const harness = startOnHarness();
    const script = '/home/.local/bin/unity-pool';
    await harness.files.write(script, '');
    const state = JSON.parse(
      poolStateText(
        { rowId: 'row-9', clonePaths: ['/x/1', '/x/2'], startedAt: 1_000 },
        'panel',
      ),
    );
    state.clones['2'].claim = {
      kind: 'agent',
      session: 'host-1',
      row: 'row-1',
      since: 990,
      renewedAt: 990,
    };
    await harness.files.write(
      `/home/${SELFTEST_STATE_PATH}`,
      JSON.stringify(state),
    );
    harness.processes.script(
      'python3',
      claimCommandArgs(script, SELFTEST_POOL, 'main'),
      {
        code: 1,
        stdout: '{"ok": false, "error": "diverged", "message": "m"}\n',
        stderr: '',
        timedOut: false,
      },
    );

    const result = await harness.providers[0].claim(
      CLAIM,
      new AbortController().signal,
      () => {},
    );

    expect(result).toEqual({ ok: true, path: '/x/2', note: 'm' });
  });

  it.each([
    ['windows', '/home/wigley-agents/tools/unity-pool/unity-pool'],
    ['macos', '/home/.local/bin/unity-pool'],
  ] as const)(
    'poolProvider_Claim_EmptyScriptPath_LooksUpPlatformDefault: %s',
    async (platform, script) => {
      const harness = startOnHarness(platform);
      const stat = vi.spyOn(harness.files, 'stat');

      const result = await harness.providers[0].claim(
        CLAIM,
        new AbortController().signal,
        () => {},
      );

      expect(stat).toHaveBeenCalledWith(script);
      expect(result).toMatchObject({ ok: false, error: 'no-cli' });
    },
  );
});
