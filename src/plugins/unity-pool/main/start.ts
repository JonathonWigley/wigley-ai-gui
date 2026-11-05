import type { MainApi, MainPart } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';
import type { UnityPoolChannel } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { unityPoolManifest } from '../manifest';
import { createOriginNames } from './origin-names';
import { runPoolCommand } from './pool-cli';
import { createPoolWatch } from './pool-watch';
import { unityPoolSelfTestScript } from './selftest-script';

type UnityPoolApi = MainApi<typeof unityPoolManifest, UnityPoolChannel>;

// Watches unity-pool's state files and sends the page each change, and runs the CLI for the panel's Hold and
// Release, reading every pool again after each run in case the OS watcher misses the write. Registers the layouts
// and hands the self-test the badge and panel script.
export const unityPoolMainPart: MainPart<typeof unityPoolManifest> = {
  manifest: unityPoolManifest,
  start(api: UnityPoolApi) {
    const { services } = api;
    const layouts = api.layouts.register({ layoutTypes });
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

    services.selfTest?.run(
      unityPoolSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        clock: services.clock,
        chat: api.dependency<ChatMainExports>('chat'),
        sessions: api.dependency<SessionsMainExports>('sessions'),
        rescan: () => watch.rescan(),
      }),
    );

    return {
      commands: {},
      dispose: () =>
        callEach<() => void>(
          [() => watch.dispose(), () => layouts.dispose()],
          (step) => step(),
        ),
    };
  },
};
