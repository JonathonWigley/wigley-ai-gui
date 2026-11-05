import type { MainApi, MainPart } from '../../../contracts/plugin';
import { chatMainKey } from '../../chat/contract';
import { createOriginRepoNames } from '../../../shared/origin-repo-names';
import { sessionsMainKey } from '../../sessions/contract';
import type { UnityPoolChannel } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { unityPoolManifest } from '../manifest';
import { resolveScriptPath, runPoolCommand } from './pool-cli';
import { createPoolWatch } from './pool-watch';
import { unityPoolSelfTestScript } from './selftest-script';

type UnityPoolApi = MainApi<typeof unityPoolManifest, UnityPoolChannel>;

// Watches unity-pool's state files and sends the page each change, and runs the CLI for the panel's Hold and
// Release, logging each run's outcome and reading every pool again after it in case the OS watcher misses the write. Registers the layouts
// and hands the self-test the badge and panel script.
export const unityPoolMainPart: MainPart<typeof unityPoolManifest> = {
  manifest: unityPoolManifest,
  start(api: UnityPoolApi) {
    const { services } = api;
    api.layouts.register({ layoutTypes });
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
    const originName = createOriginRepoNames(services.git);

    api.channel.handle('snapshot', () => watch.snapshot());
    api.channel.handle('originName', (folder) => originName(folder));
    api.channel.handle('run', async (action, pool, clone) => {
      const { scriptPath, pythonCommand } = api.settings();
      const result = await runPoolCommand(
        {
          processes: services.processes,
          files: services.files,
          paths: services.paths,
          homeDir: services.homeDir,
          scriptPath: resolveScriptPath(
            scriptPath,
            process.platform === 'win32',
          ),
          pythonCommand,
        },
        action,
        pool,
        clone,
      );
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
        chat: api.dependency(chatMainKey),
        sessions: api.dependency(sessionsMainKey),
        rescan: () => watch.rescan(),
      }),
    );

    return {
      commands: {},
      dispose: () => watch.dispose(),
    };
  },
};
