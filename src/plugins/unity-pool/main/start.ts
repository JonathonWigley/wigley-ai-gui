import { readIfPresent } from '../../../contracts/files';
import type { MainApi, MainPart } from '../../../contracts/plugin';
import { createOriginRepoNames } from '../../../shared/origin-repo-names';
import { chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import {
  type PoolState,
  type UnityPoolChannel,
  unityPoolSnapshotSlot,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { unityPoolManifest } from '../manifest';
import { resolveScriptPath, runPoolClaim, runPoolCommand } from './pool-cli';
import { createPoolProvider } from './pool-provider';
import { createPoolWatch, STATE_FILE } from './pool-watch';
import { unityPoolSelfTestScript } from './selftest-script';
import { readStateFile } from './state-file';

type UnityPoolApi = MainApi<typeof unityPoolManifest, UnityPoolChannel>;

// Watches unity-pool's state files and writes `unity-pool.snapshot` at start and on each change, and runs the CLI for the panel's Hold and
// Release, logging each run's outcome and reading every pool again after it in case the OS watcher misses the
// write. Registers as chat's pool provider, which claims a clone under a new session's ids and reads every pool
// again after each claim. Registers the layouts and hands the self-test the badge and panel script.
export const unityPoolMainPart: MainPart<typeof unityPoolManifest> = {
  manifest: unityPoolManifest,
  start(api: UnityPoolApi) {
    const { services } = api;
    api.layouts.register({ layoutTypes });
    const chat = api.dependency(chatMainKey);
    const poolSnapshot = api.state.publish(unityPoolSnapshotSlot);
    const stateRoot = services.paths.join(
      services.homeDir,
      '.local',
      'state',
      'unity-pool',
    );
    // The CLI as the settings name it now.
    const cliDeps = () => {
      const { scriptPath, pythonCommand } = api.settings();
      return {
        processes: services.processes,
        files: services.files,
        paths: services.paths,
        homeDir: services.homeDir,
        scriptPath: resolveScriptPath(
          scriptPath,
          services.platform.os === 'windows',
        ),
        pythonCommand,
      };
    };
    const readPool = async (pool: string): Promise<PoolState | null> => {
      const text = await readIfPresent(
        services.files,
        services.paths.join(stateRoot, pool, STATE_FILE),
      );
      if (text === null) {
        return null;
      }
      const read = readStateFile(text);
      return read.kind === 'pool' ? read.pool : null;
    };
    const provider = createPoolProvider({
      processes: services.processes,
      snapshot: () => watch.snapshot(),
      readPool,
      runClaim: (request, signal) =>
        runPoolClaim({ ...cliDeps(), log: services.log }, request, signal),
      rescan: () => watch.rescan(),
      log: services.log,
    });
    const watch = createPoolWatch({
      files: services.files,
      paths: services.paths,
      timers: services.timers,
      log: services.log,
      stateRoot,
      changed: (snapshot) => {
        poolSnapshot.set(snapshot);
        provider.snapshotChanged(snapshot);
      },
    });
    poolSnapshot.set(watch.snapshot());
    const registration = chat.addPoolProvider(provider);
    const originName = createOriginRepoNames(services.git);

    api.channel.handle('originName', (folder) => originName(folder));
    api.channel.handle('run', async (action, pool, clone) => {
      const result = await runPoolCommand(cliDeps(), action, pool, clone);
      services.log(
        `${action} ${pool} ${clone}: ${result.ok ? 'ok' : `${result.error}: ${result.message}`}`,
      );
      watch.rescan();
      return result;
    });

    services.selfTest?.run(
      unityPoolSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        clock: services.clock,
        chat,
        sessions: api.dependency(sessionsMainKey),
        rescan: () => watch.rescan(),
      }),
    );

    return {
      commands: {},
      dispose: () => {
        registration.dispose();
        provider.dispose();
        watch.dispose();
      },
    };
  },
};
