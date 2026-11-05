import type { MainApi, MainPart } from '../../../contracts/plugin';
import type { UnityPoolChannel } from '../contract';
import { unityPoolManifest } from '../manifest';
import { createOriginNames } from './origin-names';
import { runPoolCommand } from './pool-cli';
import { createPoolWatch } from './pool-watch';

type UnityPoolApi = MainApi<typeof unityPoolManifest, UnityPoolChannel>;

// Watches unity-pool's state files and sends the page each change, and runs the CLI for the panel's Hold and
// Release, reading every pool again after each run in case the OS watcher misses the write.
export const unityPoolMainPart: MainPart<typeof unityPoolManifest> = {
  manifest: unityPoolManifest,
  start(api: UnityPoolApi) {
    const { services } = api;
    const watch = createPoolWatch({
      files: services.files,
      paths: services.paths,
      timers: services.timers,
      log: services.log,
      stateRoot: services.paths.join(
        services.homeDir,
        '.local',
        'state',
        'unity-pool',
      ),
      changed: (snapshot) => api.channel.send('changed', snapshot),
    });
    const originName = createOriginNames(services.git);

    api.channel.handle('snapshot', () => watch.snapshot());
    api.channel.handle('originName', (folder) => originName(folder));
    api.channel.handle('run', async (action, pool, clone) => {
      const result = await runPoolCommand(
        {
          processes: services.processes,
          files: services.files,
          paths: services.paths,
          homeDir: services.homeDir,
          scriptPath: api.settings().scriptPath,
        },
        action,
        pool,
        clone,
      );
      services.log(
        'unity-pool',
        `${action} ${pool} ${clone}: ${result.ok ? 'ok' : result.error}`,
      );
      watch.rescan();
      return result;
    });

    return { commands: {}, dispose: () => watch.dispose() };
  },
};
