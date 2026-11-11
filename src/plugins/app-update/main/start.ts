import type { AppBuild } from '../../../contracts/app-instance';
import { coreWindowFocusedSlot } from '../../../contracts/core-state';
import type { Git } from '../../../contracts/git';
import type {
  ChannelShape,
  MainApi,
  MainPart,
} from '../../../contracts/plugin';
import { type AppUpdateStatus, appUpdateStatusSlot } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { appUpdateManifest } from '../manifest';
import { addDriveActions } from './drive-actions';
import { installCommandFor } from './install-command';
import {
  createInstaller,
  INSTALL_EXIT_CODE_FILE,
  INSTALL_LOG_FILE,
} from './installer';
import { appUpdateSelfTestScript } from './selftest-script';
import { FIXTURE_INSTALLED_COMMIT, fixtureGit } from './update-fixture';
import { createUpdater, statusText, type Updater } from './updater';

type AppUpdateApi = MainApi<typeof appUpdateManifest, ChannelShape>;

// Registers the layouts and writes `app-update.status`. With a build baked in
// (`services.appBuild`) and an install command for the OS, it checks origin's
// `main` in the build's clone at start, every 15 minutes and when the window
// gains focus, and `install` starts `npm run install-app -- --ref origin/main`
// there detached, its output in `install.log` and its exit code in
// `install-exit-code` in the plugin's data folder; with neither, it checks
// nothing and the status stays `none`. A seed, from a drive run or the
// self-test's script, swaps in a fixture build and clone and an install that
// starts no program. Its stop leaves a running install alone and holds no quit.
export const appUpdateMainPart: MainPart<typeof appUpdateManifest> = {
  manifest: appUpdateManifest,
  start(api: AppUpdateApi) {
    const { services } = api;
    const log = services.log;
    api.layouts.register({ layoutTypes });
    const status = api.state.publish(appUpdateStatusSlot);
    if (status.get() === undefined) {
      status.set({ kind: 'none' });
    }
    let updater: Updater | null = null;

    const startUpdater = (
      build: AppBuild,
      git: Pick<Git, 'fetch' | 'resolveCommit' | 'isAncestor'>,
      startProgram: () => Promise<void>,
    ) => {
      updater?.dispose();
      updater = createUpdater({
        installed: build.commit,
        cloneDir: build.cloneDir,
        git,
        installer: createInstaller({ data: api.data, startProgram }),
        status,
        timers: services.timers,
        clock: services.clock,
        log,
      });
    };

    const build = services.appBuild;
    const commandLine = installCommandFor(
      services.platform.os,
      services.paths.join(api.dataFolder, INSTALL_EXIT_CODE_FILE),
    );
    if (build === null) {
      log('no build baked in: checking nothing');
    } else if (commandLine === null) {
      log(`no install command on ${services.platform.os}: checking nothing`);
    } else {
      startUpdater(build, services.git, () =>
        services.processes.startDetached(
          commandLine.command,
          commandLine.args,
          {
            cwd: build.cloneDir,
            logPath: services.paths.join(api.dataFolder, INSTALL_LOG_FILE),
          },
        ),
      );
    }

    api.state.read(coreWindowFocusedSlot).on((isFocused) => {
      if (isFocused === true) {
        updater?.focused();
      }
    });

    const currentStatus = (): AppUpdateStatus =>
      status.get() ?? { kind: 'none' };
    const seed = async (): Promise<AppUpdateStatus> => {
      status.set({ kind: 'none' });
      startUpdater(
        { commit: FIXTURE_INSTALLED_COMMIT, cloneDir: services.homeDir },
        fixtureGit(),
        async () => log('fixture install: no program started'),
      );
      await updater?.check();
      log(`seeded: ${statusText(currentStatus())}`);
      return currentStatus();
    };
    if (api.drive !== null) {
      addDriveActions(api.drive, { seed, status: currentStatus });
    }
    services.selfTest?.run(appUpdateSelfTestScript({ seed }));

    return {
      commands: {
        install: async () => {
          if (updater === null) {
            log('install skipped: no build baked in');
            return;
          }
          await updater.install();
        },
        check: async () => {
          if (updater === null) {
            log('check skipped: no build baked in');
            return;
          }
          await updater.check();
        },
      },
      dispose: () => updater?.dispose(),
    };
  },
};
