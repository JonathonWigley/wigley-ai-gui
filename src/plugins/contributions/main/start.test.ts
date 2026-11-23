import { describe, expect, it, vi } from 'vitest';
import type { HarnessProfile } from '../../../contracts/agent';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import type { WatchOptions } from '../../../contracts/files';
import {
  harnessInfo,
  harnessRegistryOf,
} from '../../../shared/agent-harness-registry.test-support';
import {
  createFakeAgentHarness,
  FAKE_HARNESS_ID,
  FAKE_MICROTASK_TIMERS,
} from '../../../shared/fake-agent-harness';
import { createMemoryFiles } from '../../../shared/memory-files';
import { startMainPart } from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import {
  type ContributionsMainExports,
  contributionsFeaturesSlot,
  type FeatureReader,
} from '../contract';
import { contributionsMainPart } from './start';

// The part harness's `services.appDir` is `/app`.
const APP_ROOT = '/app/agent-plugin';
const APP_FILE = `${APP_ROOT}/auri.json`;
const CONFIG_DIR = '/cfg';
const INSTALLS_FOLDER = `${CONFIG_DIR}/plugins`;
const INSTALLS_FILE = `${INSTALLS_FOLDER}/installed_plugins.json`;
const INSTALL_ROOT = '/p/wigley';
const INSTALL_FILE = `${INSTALL_ROOT}/auri.json`;
const PROFILE: HarnessProfile = { name: 'work', configDir: CONFIG_DIR };

const GOOD_TEXT = JSON.stringify({ version: 1, retro: {} });

// Lets every pending promise chain settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const acceptAll: FeatureReader<unknown> = {
  label: 'Retro',
  read: (value) => ({ ok: true, value }),
};

interface SetUpOptions {
  // `auri.json` text by path, written once the first scan settled.
  files?: Record<string, string>;
  // Whether `installed_plugins.json` is on disk; true when left out.
  hasInstallsFile?: boolean;
  // A folder whose first watch throws at start.
  throwWatchOnce?: string;
}

// The part over one fake profile, at `/cfg`, that installs `wigley` at
// `/p/wigley`. The first scan finds nothing, since no profile is registered
// and no file is written; then the files are written, `core.agentHarnesses`
// names the profile, and the scan that follows settles. `reads(path)` counts
// the reads of `path` since the setup; `watchesOf(folder)` lists the watches
// started on `folder` since the part started.
async function setUp(options: SetUpOptions = {}) {
  const agentHarness = createFakeAgentHarness(
    { now: () => 0 },
    createMemoryFiles(),
    FAKE_MICROTASK_TIMERS,
  );
  agentHarness.setInstalledPlugins(CONFIG_DIR, [
    {
      key: 'wigley@market',
      installDir: INSTALL_ROOT,
      version: '1.0.0',
      listedAt: null,
    },
  ]);
  const harness = startMainPart(contributionsMainPart, {
    services: { agentHarnesses: harnessRegistryOf([agentHarness]) },
  });
  const { watchesOf } = spyWatches(harness, options.throwWatchOnce);
  const exports = harness
    .started()
    .exports?.(createRegistrations()) as ContributionsMainExports;
  exports.registerFeature('retro', acceptAll);
  await exports.ready;
  if (options.hasInstallsFile ?? true) {
    await harness.files.write(INSTALLS_FILE, '{}');
  }
  for (const [path, text] of Object.entries(options.files ?? {})) {
    await harness.files.write(path, text);
  }
  const infos = harness.state.publish(coreAgentHarnessesSlot);
  infos.set(FAKE_HARNESS_ID, harnessInfo({ profiles: [PROFILE] }));
  await flush();
  harness.advance(300);
  await flush();
  const read = vi.spyOn(harness.files, 'read');
  const reads = (path: string) =>
    read.mock.calls.filter(([each]) => each === path).length;
  const messages = () => harness.logs.map(({ message }) => message);
  return { harness, exports, infos, reads, messages, watchesOf };
}

// A spy on `files.watch` that records each watch's folder and options, and
// throws for `throwOnce`'s folder the first time it is watched.
function spyWatches(
  harness: ReturnType<typeof startMainPart>,
  throwOnce?: string,
) {
  const watched: { folder: string; options: WatchOptions }[] = [];
  const watch = harness.files.watch.bind(harness.files);
  let hasThrown = false;
  vi.spyOn(harness.files, 'watch').mockImplementation(
    (folder, onChange, options) => {
      if (folder === throwOnce && !hasThrown) {
        hasThrown = true;
        throw new Error('denied');
      }
      watched.push({ folder, options: options ?? {} });
      return watch(folder, onChange, options);
    },
  );
  const watchesOf = (folder: string) =>
    watched.filter((each) => each.folder === folder);
  return { watchesOf };
}

describe('contributionsMainPart', () => {
  it('starts with no auri.json anywhere: empty strategies, no problem, no error', async () => {
    const { harness, exports, messages } = await setUp();

    expect(exports.strategies('retro')).toEqual([]);
    expect(
      harness.state.read(contributionsFeaturesSlot, 'test').get('retro'),
    ).toEqual({ key: 'retro', label: 'Retro', strategies: [] });
    expect(harness.configProblems.get('contributions')).toEqual([]);
    expect(messages().filter((line) => line.includes('failed'))).toEqual([]);
    await harness.stop();
  });

  it("serves the app's own plugin and an install as strategies", async () => {
    const { harness, exports } = await setUp({
      files: { [APP_FILE]: GOOD_TEXT, [INSTALL_FILE]: GOOD_TEXT },
    });

    expect(exports.strategies('retro').map(({ id }) => id)).toEqual([
      'auri',
      'wigley',
    ]);
    await harness.stop();
  });

  // Catches a rescan per change, or one that runs before the delay.
  it('rescans once, 300 ms after the last of two changes', async () => {
    const { harness, reads } = await setUp({
      files: { [APP_FILE]: GOOD_TEXT },
    });

    await harness.files.write(APP_FILE, GOOD_TEXT);
    harness.advance(100);
    await harness.files.write(APP_FILE, GOOD_TEXT);
    harness.advance(299);
    await flush();
    const before = reads(APP_FILE);
    harness.advance(1);
    await flush();

    expect(before).toBe(0);
    expect(reads(APP_FILE)).toBe(1);
    await harness.stop();
  });

  it.each<{
    name: string;
    scans: number;
    change(parts: Awaited<ReturnType<typeof setUp>>): Promise<void> | void;
  }>([
    {
      name: 'installed_plugins.json',
      scans: 1,
      change: ({ harness }) => harness.files.write(INSTALLS_FILE, '{ "a": 1 }'),
    },
    {
      name: 'core.agentHarnesses',
      scans: 1,
      change: ({ infos }) =>
        infos.set(
          FAKE_HARNESS_ID,
          harnessInfo({ profiles: [PROFILE], label: 'Other' }),
        ),
    },
    {
      name: 'another file in a watched folder',
      scans: 0,
      change: ({ harness }) =>
        harness.files.write(`${INSTALLS_FOLDER}/known_marketplaces.json`, '{}'),
    },
  ])('a change to $name runs $scans scans', async ({ change, scans }) => {
    const parts = await setUp({ files: { [APP_FILE]: GOOD_TEXT } });

    await change(parts);
    await flush();
    parts.harness.advance(300);
    await flush();

    expect(parts.reads(APP_FILE)).toBe(scans);
    await parts.harness.stop();
  });

  // Catches a reload that dies after one watch error.
  it('starts a failed watch again on the next scan', async () => {
    const { harness, messages, watchesOf } = await setUp({
      files: { [APP_FILE]: GOOD_TEXT },
    });
    watchesOf(APP_ROOT)[0].options.onError?.(new Error('gone'));

    await harness.files.write(INSTALLS_FILE, '{ "a": 1 }');
    harness.advance(300);
    await flush();

    expect(messages()).toContain(`watch of ${APP_ROOT} failed: gone`);
    expect(watchesOf(APP_ROOT)).toHaveLength(2);
    await harness.stop();
  });

  it('logs a watch that throws at start and tries it on the next scan', async () => {
    const { harness, messages, watchesOf } = await setUp({
      files: { [APP_FILE]: GOOD_TEXT },
      throwWatchOnce: APP_ROOT,
    });
    const afterFirst = watchesOf(APP_ROOT).length;

    await harness.files.write(INSTALLS_FILE, '{ "a": 1 }');
    harness.advance(300);
    await flush();

    expect(messages()).toContain(`watch of ${APP_ROOT} failed: denied`);
    expect(afterFirst).toBe(0);
    expect(watchesOf(APP_ROOT)).toHaveLength(1);
    await harness.stop();
  });

  it('rescans 300 ms after a watch may have missed a change', async () => {
    const { harness, reads, watchesOf } = await setUp({
      files: { [APP_FILE]: GOOD_TEXT },
    });

    watchesOf(APP_ROOT)[0].options.onMissed?.();
    harness.advance(299);
    await flush();
    const before = reads(APP_FILE);
    harness.advance(1);
    await flush();

    expect(before).toBe(0);
    expect(reads(APP_FILE)).toBe(1);
    await harness.stop();
  });

  // Catches a watch that creates a missing folder.
  it('watches no folder that is absent', async () => {
    const { harness, watchesOf } = await setUp({ hasInstallsFile: false });

    expect(watchesOf(INSTALLS_FOLDER)).toEqual([]);
    expect(await harness.files.stat(INSTALLS_FOLDER)).toBeNull();
    await harness.stop();
  });

  it('serves a file problem with its full path, cleared once fixed', async () => {
    const { harness } = await setUp({
      files: { [INSTALL_FILE]: JSON.stringify({ version: 2 }) },
    });
    const whileBroken = harness.configProblems.get('contributions');

    await harness.files.write(INSTALL_FILE, GOOD_TEXT);
    harness.advance(300);
    await flush();

    expect(whileBroken).toEqual([
      {
        file: INSTALL_FILE,
        message: 'wigley: auri.json version is 2, not 1',
      },
    ]);
    expect(harness.configProblems.get('contributions')).toEqual([]);
    await harness.stop();
  });
});
