import type {
  AgentHarnessInfo,
  AgentHarnessRegistry,
  HarnessConfigRoots,
  InstalledPlugin,
} from '../../../contracts/agent';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import {
  listedHarnesses,
  registeredProfiles,
} from '../../../shared/harness-profiles';

// One registered profile's folders, as its harness declares them; `~` is left
// for the reader to expand.
export interface ProfileRoots {
  harnessId: string;
  profile: string;
  roots: HarnessConfigRoots;
}

// One plugin install a registered profile lists, with its harness's id.
export interface HarnessPlugin {
  harnessId: string;
  plugin: InstalledPlugin;
}

export interface HarnessFoldersDeps {
  harnesses: Pick<AgentHarnessRegistry, 'get'>;
  // `core.agentHarnesses` now, keyed by harness id in registration order.
  infos(): ReadonlyMap<string, AgentHarnessInfo>;
  log: PluginLog;
}

// Each registered profile's harness folders and plugin installs, asked of the
// adapter registered under the profile's harness id at each call, in
// registration then profile order. A profile whose harness the registry does
// not hold, or whose harness is unlisted, is left out.
export interface HarnessFolders {
  roots(): ProfileRoots[];
  // A profile whose installs reject is logged and lists none.
  installedPlugins(): Promise<HarnessPlugin[]>;
}

export function createHarnessFolders(deps: HarnessFoldersDeps): HarnessFolders {
  const { harnesses, infos, log } = deps;

  const profilesWithHarness = () =>
    registeredProfiles(listedHarnesses(infos())).flatMap((profile) => {
      const harness = harnesses.get(profile.harnessId);
      return harness === null ? [] : [{ profile, harness }];
    });

  return {
    roots: () =>
      profilesWithHarness().map(({ profile, harness }) => ({
        harnessId: profile.harnessId,
        profile: profile.name,
        roots: harness.configRoots(profile.configDir),
      })),
    async installedPlugins() {
      const lists = await Promise.all(
        profilesWithHarness().map(async ({ profile, harness }) => {
          try {
            const plugins = await harness.installedPlugins(profile.configDir);
            return plugins.map((plugin) => ({
              harnessId: profile.harnessId,
              plugin,
            }));
          } catch (error) {
            log(
              `installed plugins of ${profile.name} not read: ${errorText(error)}`,
            );
            return [];
          }
        }),
      );
      return lists.flat();
    },
  };
}
