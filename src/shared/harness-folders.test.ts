import { describe, expect, it } from 'vitest';
import type { AgentHarnessInfo, InstalledPlugin } from '../contracts/agent';
import {
  harnessInfo,
  harnessRegistryOf,
} from './agent-harness-registry.test-support';
import {
  createFakeAgentHarness,
  FAKE_HARNESS_ID,
  FAKE_MICROTASK_TIMERS,
} from './fake-agent-harness';
import { createMemoryFiles } from './memory-files';
import { createHarnessFolders } from './harness-folders';

const PROFILES = [
  { name: 'work', configDir: '/Users/u/.claude' },
  { name: 'personal', configDir: '/Users/u/.claude-personal' },
];

function install(key: string, installDir: string): InstalledPlugin {
  return { key, installDir, version: '1.0.0', listedAt: null };
}

// A fake harness under `claude`, and the slot holding `infos` (default: the
// fake's id with `PROFILES`).
function setUp(infos?: ReadonlyMap<string, AgentHarnessInfo>) {
  const harness = createFakeAgentHarness(
    { now: () => 1000 },
    createMemoryFiles(),
    FAKE_MICROTASK_TIMERS,
  );
  const logged: string[] = [];
  const folders = createHarnessFolders({
    harnesses: harnessRegistryOf([harness]),
    infos: () =>
      infos ?? new Map([[harness.id, harnessInfo({ profiles: PROFILES })]]),
    log: (message) => logged.push(message),
  });
  return { harness, folders, logged };
}

describe('createHarnessFolders', () => {
  it('roots_TwoProfiles_SlotOrder', () => {
    const { harness, folders } = setUp();

    expect(folders.roots()).toEqual([
      {
        harnessId: harness.id,
        profile: 'work',
        roots: harness.configRoots('/Users/u/.claude'),
      },
      {
        harnessId: harness.id,
        profile: 'personal',
        roots: harness.configRoots('/Users/u/.claude-personal'),
      },
    ]);
  });

  it.each([
    {
      given: 'harness not registered',
      infos: new Map([['other', harnessInfo({ profiles: PROFILES })]]),
    },
    {
      given: 'harness unlisted',
      infos: new Map([
        [FAKE_HARNESS_ID, harnessInfo({ profiles: PROFILES, unlisted: true })],
      ]),
    },
  ])('roots_ProfilesHarnessNotListable_LeftOut given $given', ({ infos }) => {
    const { folders } = setUp(infos);

    expect(folders.roots()).toEqual([]);
  });

  it('installedPlugins_OneRejects_LoggedAndLeftOut', async () => {
    const { harness, folders, logged } = setUp();
    const first = install('p@m', '/Users/u/.claude/plugins/cache/m/p/1.0.0');
    harness.setInstalledPlugins('/Users/u/.claude', [first]);
    const listed = harness.installedPlugins.bind(harness);
    harness.installedPlugins = (profileDir) =>
      profileDir === '/Users/u/.claude-personal'
        ? Promise.reject(new Error('nope'))
        : listed(profileDir);

    const plugins = await folders.installedPlugins();

    expect(plugins).toEqual([{ harnessId: harness.id, plugin: first }]);
    expect(logged).toEqual(['installed plugins of personal not read: nope']);
  });
});
