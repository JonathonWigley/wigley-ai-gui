import type { FeatureKey } from '../../../contracts/contributions';
import type { KeyedSlotKey } from '../../../contracts/state';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import { CONTRIBUTIONS_FILE } from '../../../shared/agent-plugin';
import { createHarnessFolders } from '../../../shared/harness-folders';
import {
  type ContributionsMainExports,
  contributionsFeaturesSlot,
  type FeatureStrategies,
  type Strategy,
} from '../contract';
import { contributionsManifest } from '../manifest';
import { createRegistry } from './registry';
import { createReload } from './reload';
import { scanSources } from './sources';

type ContributionsApi = MainApi<typeof contributionsManifest, ChannelShape>;

// `contributions.features` as the part publishes it: each strategy's value is
// `unknown`, because `JsonSlot` cannot expand the recursive `JsonValue`
// (TS2589). Every value the registry writes is a reader's value, which
// `registerFeature`'s `JsonSlot` already checked, and readers see the key's
// own `FeatureStrategies`.
interface PublishedFeatures extends Omit<FeatureStrategies, 'strategies'> {
  strategies: Strategy<unknown>[];
}

const publishedFeaturesSlot = contributionsFeaturesSlot as KeyedSlotKey<
  PublishedFeatures,
  'main',
  'contributions'
>;

// Scans the app's own agent plugin and every install a registered profile
// lists for `auri.json`, serves each registered feature's strategies through
// its exports and `contributionsFeaturesSlot`, and serves the files' problems
// through `services.configProblems`. It rescans, after the reload's delay, on
// a change to a profile's installs list, to a source's `auri.json`, or to
// `core.agentHarnesses`.
export const contributionsMainPart: MainPart<typeof contributionsManifest> = {
  manifest: contributionsManifest,
  start(api: ContributionsApi) {
    const { services } = api;
    const { files, paths, log } = services;
    const harnessInfos = api.state.read(coreAgentHarnessesSlot);
    const folders = createHarnessFolders({
      harnesses: services.agentHarnesses,
      infos: () => harnessInfos.all(),
      log,
    });
    const registry = createRegistry({
      slot: api.state.publish(publishedFeaturesSlot),
      paths,
      log,
      setProblems: (problems) => services.configProblems.set(problems),
    });
    let isStopped = false;
    const reload = createReload({
      files,
      paths,
      timers: services.timers,
      log,
      async scan() {
        const plugins = await folders.installedPlugins();
        const sources = await scanSources(
          { files, paths, appDir: services.appDir, log },
          plugins,
        );
        if (isStopped) {
          return [];
        }
        registry.scanned(sources);
        const installLists = folders
          .roots()
          .map(({ roots }) => roots.installedPluginsFile)
          .filter((file) => file !== null)
          .map((file) => paths.expandTilde(file, services.homeDir));
        return [
          ...installLists,
          ...sources.map(({ source }) =>
            paths.join(source.root, CONTRIBUTIONS_FILE),
          ),
        ];
      },
    });
    harnessInfos.on(() => reload.changed());
    const ready = reload.start();
    return {
      commands: {},
      exports: (consumer): ContributionsMainExports => ({
        registerFeature: (key, reader) =>
          consumer.track(registry.register(key, reader)),
        strategies: <V>(key: FeatureKey) =>
          registry.strategies(key) as readonly Strategy<V>[],
        onChanged: (key, listener) =>
          consumer.track(registry.onChanged(key, listener)),
        ready,
      }),
      dispose() {
        isStopped = true;
        reload.stop();
      },
    };
  },
};
