import type { MainApi, MainPart } from '../../../contracts/plugin';
import { createOriginRepoNames } from '../../../shared/origin-repo-names';
import { chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import {
  type PoolSnapshot,
  type PoolState,
  type UnityPoolChannel,
  unityPoolSnapshotSlot,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { unityPoolManifest } from '../manifest';
import { DEMO_POOL, registerDemoSteps } from './demo-steps';
import { resolveScriptPath, runPoolCommand } from './pool-cli';
import { createPoolProvider } from './pool-provider';
import { createPoolWatch } from './pool-watch';
import { unityPoolSelfTestScript } from './selftest-script';

type UnityPoolApi = MainApi<typeof unityPoolManifest, UnityPoolChannel>;

// Watches unity-pool's state files and writes `unity-pool.snapshot` at start and on each change, and runs the CLI for
// the panel's Hold, Release and Open, logging each run's outcome and reading every pool again after it in case the OS
// watcher misses the write. Registers as chat's pool provider, which gives each pool's clone folders, and tells chat at
// each change that those folders may have changed.
// Registers the layouts and hands the self-test the badge and panel script. The demo step's pool joins the slot, never
// the pool provider, and a run on it runs nothing.
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
      const { scriptPath } = api.settings();
      return {
        processes: services.processes,
        files: services.files,
        paths: services.paths,
        homeDir: services.homeDir,
        scriptPath: resolveScriptPath(
          scriptPath,
          services.platform.os === 'windows',
        ),
      };
    };
    // The demo step's pool, published beside the watch's while the step is entered.
    let demoPool: PoolState | null = null;
    const publish = (snapshot: PoolSnapshot) =>
      poolSnapshot.set(
        demoPool === null
          ? snapshot
          : {
              pools: [...snapshot.pools, demoPool].sort((a, b) =>
                a.pool.localeCompare(b.pool),
              ),
            },
      );
    const watch = createPoolWatch({
      files: services.files,
      paths: services.paths,
      timers: services.timers,
      log: services.log,
      stateRoot,
      // Never called before `createPoolWatch` returns: its first scan is async.
      changed: (snapshot) => {
        publish(snapshot);
        registration.changed();
      },
    });
    publish(watch.snapshot());
    const registration = chat.addPoolProvider(
      createPoolProvider(() => watch.snapshot()),
    );
    const originName = createOriginRepoNames(services.git);
    const demo = registerDemoSteps(services, {
      setDemoPool(pool) {
        demoPool = pool;
        publish(watch.snapshot());
      },
    });

    api.channel.handle('originName', (folder) => originName(folder));
    api.channel.handle('run', async (action, pool, clone) => {
      if (pool === DEMO_POOL) {
        services.log(`${action} ${pool} ${clone}: demo clone, nothing run`);
        return {
          ok: false,
          error: 'demo',
          message: 'A demo clone: nothing runs.',
        };
      }
      const result = await runPoolCommand(cliDeps(), action, pool, clone);
      services.log(
        `${action} ${pool} ${clone}: ${result.ok ? 'ok' : `${result.error}: ${result.message}`}`,
      );
      watch.rescan();
      return result;
    });
    api.channel.handle('showDemoStage', (stage) => demo.showStage(stage));

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
        watch.dispose();
      },
    };
  },
};
