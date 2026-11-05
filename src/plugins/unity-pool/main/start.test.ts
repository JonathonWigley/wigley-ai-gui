import { describe, expect, it, vi } from 'vitest';
import type { OsName } from '../../../contracts/platform';
import { fakePlatform } from '../../../shared/platform.test-support';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import {
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import { unityPoolManifest } from '../manifest';
import { unityPoolMainPart } from './start';

function startOnHarness(os: OsName = 'macos') {
  return startMainPart(unityPoolMainPart, {
    settings: { ...unityPoolManifest.settings, scriptPath: '' },
    services: { platform: fakePlatform(os) },
    dependencies: [
      fakeDependency(chatMainKey, () => ({}) as unknown as ChatMainExports),
      fakeDependency(
        sessionsMainKey,
        () => ({}) as unknown as SessionsMainExports,
      ),
    ],
  });
}

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
});
