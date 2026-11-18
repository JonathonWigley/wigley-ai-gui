// Composition root for the main process: the one module that picks adapters
// and config, and wires them to each other.
import {
  app,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
  dialog,
  type Event,
  globalShortcut,
  ipcMain,
  nativeTheme,
  session,
  shell,
  type WebContents,
} from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { coreCommands, coreScopes } from '../config/keymap';
import {
  coreDefaultSettings,
  optionalSettings,
  settingChoices,
  settingInfo,
} from '../config/settings';
import { coreThemeTokens } from '../config/theme-tokens';
import { builtInThemes } from '../config/themes';
import type { AgentHarness } from '../contracts/agent';
import type { Alerts } from '../contracts/alerts';
import type {
  Clock,
  RandomHex,
  RandomUuid,
  Timers,
} from '../contracts/ambient';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import { CORE_RELOAD_PLUGIN } from '../contracts/commands';
import {
  coreAgentHarnessesSlot,
  corePluginsSlot,
  coreRuntimeMainSlot,
  coreRuntimePageSlot,
} from '../contracts/core-state';
import type { Disposable } from '../contracts/disposable';
import type { Log } from '../contracts/log';
import type { Paths } from '../contracts/paths';
import type { OsName, Platform } from '../contracts/platform';
import type { ProcessRunner } from '../contracts/processes';
import type { ScreenCapture } from '../contracts/screen-capture';
import type { SessionHost } from '../contracts/session-host';
import type { AppConfig } from '../contracts/settings';
import type { SlotChange } from '../contracts/state';
import type { SystemStats } from '../contracts/system-stats';
import type { UserConfig } from '../contracts/user-config';
import type {
  CommandHandler,
  MainCommandContext,
  MainPart,
  MainServices,
  MainStart,
  PluginManifest,
} from '../contracts/plugin';
import type { PluginCatalog } from '../contracts/plugin-catalog';
import { defaultKeymap } from '../plugins/keymap';
import { mainParts } from '../plugins/main';
import { manifests, withoutRealHarnessPlugins } from '../plugins/manifests';
import { appEndpointDir } from '../shared/app-endpoint-dir';
import { CommandRegistry } from '../shared/command-registry';
import { errorText } from '../shared/error-text';
import { createEventBus } from '../shared/event-bus';
import { gateExternalLinks } from '../shared/external-links';
import { createFakeAgentHarness } from '../shared/fake-agent-harness';
import { createFakeScreenCapture } from '../shared/fake-screen-capture';
import { createFakeSystemStats } from '../shared/fake-system-stats';
import { isSameJson } from '../shared/json';
import { osPlatform } from '../shared/os-platform';
import { platformFor } from '../shared/platform';
import { type PluginHost, startPlugins } from '../shared/plugin-host';
import {
  commandLabel,
  qualify,
  withAppliedList,
} from '../shared/plugin-manifests';
import { posixPaths } from '../shared/paths/posix-paths';
import { windowsPaths } from '../shared/paths/windows-paths';
import {
  createRuntimeCommands,
  EMPTY_RUNTIME_CATALOG,
  type RuntimeCommands,
} from '../shared/runtime-commands';
import { scopedFiles } from '../shared/scoped-files';
import type { SlotStore } from '../shared/state/slot-store';
import kitTypes from '../shared/page/layout-host/kit.d.ts?raw';
import shellLayoutTypes from '../renderer/shell/layouts/layout.d.ts?raw';
import { agentEnvironmentOf } from './agent-environment';
import { createAgentHarnessRegistry } from './agent-harness-registry';
import { createMacAlerts } from './alerts/mac-alerts';
import { silentAlerts } from './alerts/silent-alerts';
import { createWindowsAlerts } from './alerts/windows-alerts';
import { appBuildOf, appInstanceOf } from './app-instance';
import {
  type ConfigStore,
  type ConfigStoreDeps,
  loadConfigStore,
} from './config/config-store';
import { createUserConfig } from './config/user-config';
import {
  registerAppSchemes,
  serveDataScheme,
  serveLayoutScheme,
  servePluginScheme,
  serveVisualScheme,
} from './data-protocol/data-protocol';
import { type DriveRun, startDriveRun } from './drive/drive-run';
import { electronDrivenWindow } from './electron-driven-window';
import { createNodeFiles } from './files/node-files';
import { createProcessGit } from './git/process-git';
import {
  installWindowKeybindings,
  registerGlobalShortcuts,
} from './keybindings';
import { readLoginShellEnv, shouldReadLoginShellEnv } from './login-shell-env';
import {
  createLayoutService,
  type LayoutService,
} from './layouts/layout-service';
import { resolveCloneDir } from './resolve-clone-dir';
import { wireRuntime } from './runtime-wiring';
import { createSlotHolder, type SlotHolder } from './state/slot-holder';
import { startWindowFocusSlot } from './state/window-focus-slot';
import { createSessionHostClient } from './session-host/session-host-client';
import { sessionHostChannel } from './session-host/session-host-channel';
import { createMainApi, type MainApiServices } from './plugins/main-api';
import { createBuiltInSource } from './plugin-catalog/built-in-source';
import { importModuleFrom } from './plugin-catalog/import-module';
import { startPluginCatalog } from './plugin-catalog/plugin-catalog';
import {
  emittedTypesFolder,
  writePluginTypes,
} from './plugin-catalog/plugin-types';
import { createUserFolderSource } from './plugin-catalog/user-folder-source';
import { createPageCommands } from './page-commands';
import { createPageLog } from './page-log';
import { createPageParts } from './page-parts';
import { createPastedFiles } from './pasted-files';
import { logSlowQuit, quitStep } from './quit-wait';
import {
  type AppliedPlugins,
  createAppliedPlugins,
} from './plugins/applied-plugins';
import { createPluginChannels } from './plugins/plugin-channel';
import {
  createPluginSwitch,
  heldAtStart,
  type PluginSwitch,
} from './plugins/plugin-switch';
import { addPluginSwitchActions } from './plugins/plugin-switch-drive';
import { nativeImageEncoder } from './images/native-image-encoder';
import { limitRuns } from './processes/limited-processes';
import { createNodeProcesses } from './processes/node-processes';
import { failSelfTest, type SelfTestDriver, startSelfTest } from './selftest';
import { createSelfTestTeardown } from './selftest-teardown';
import {
  electronCaptureSources,
  macScreenAccess,
  openMacScreenSettings,
} from './screen-capture/electron-capture';
import { createMacWindowList } from './screen-capture/mac-window-list';
import { createScreenCapture } from './screen-capture/screen-capture';
import { createUnavailableScreenCapture } from './screen-capture/unavailable-screen-capture';
import { createWindowsWindowList } from './screen-capture/windows-window-list';
import { createMacSystemStats } from './system-stats/mac-system-stats';
import { createUnavailableSystemStats } from './system-stats/unavailable-system-stats';
import { createWindowsSystemStats } from './system-stats/windows-system-stats';
import {
  applySelfTestConfig,
  fakeRunPluginSettings,
  isFakeHarnessRun,
  selfTestFilterOf,
} from './selftest-config';
import {
  SELFTEST_USER_ID,
  seedSelfTestUserPlugin,
  userPluginSelfTestScript,
} from './selftest-user-plugin';
import { tempFolders } from './temp-folders';
import {
  type DriveHarnessName,
  type DriveSystemStatsName,
  type RunEnvironment,
  runEnvironmentOf,
} from './run-mode';
import { resolveTheme } from './themes/theme-loader';
import {
  titleBarOverlayOf,
  titleBarOverlayProblem,
  windowBackgroundOf,
} from './title-bar-overlay';
import { loadUiStateFile, type UiStateFile } from './ui-state/ui-state-file';
import {
  createMainWindow,
  offscreenWindowService,
  windowService,
} from './window';

// The run the environment selects, read before the app makes anything. A bad
// value exits 1 with its reason on stderr, which the drive CLI keeps in the
// run's `app.log`, and no native dialog.
function readRunEnvironment(): RunEnvironment {
  try {
    return runEnvironmentOf(process.env);
  } catch (error) {
    process.stderr.write(
      `wigley-ai-gui could not start: ${errorText(error)}\n`,
    );
    process.exit(1);
  }
}

// The self-test and a drive run render offscreen as an accessory app on a
// home of their own, so neither takes the user's foreground or touches their
// files.
const runEnvironment = readRunEnvironment();
const runMode = runEnvironment.mode;
// The installed stable app, or the dev app run from the repo.
const appInstance = appInstanceOf(app.isPackaged);
// A drive run's folder; null outside a drive run.
const driveRunDir =
  runEnvironment.mode === 'drive' ? runEnvironment.runDir : null;

registerAppSchemes();

// Read while the app gets ready, and applied before any plugin starts. A
// terminal start, the self-test and a drive run keep the environment of the
// shell that ran them and stay clear of the user's shell profile.
const loginShellEnv = shouldReadLoginShellEnv({
  isLive: runMode === 'live',
  parentPid: process.ppid,
})
  ? readLoginShellEnv(process.env.SHELL)
  : Promise.resolve({ path: null, sshAuthSock: null });

// The services that differ by run mode. `trashItem` backs the files service,
// which loads the config before the window exists; `forWindow` builds the
// rest once the window is created, `harnesses` being the adapters the
// composition root registers in `services.agentHarnesses`.
interface ModeServices {
  trashItem(file: string): Promise<void>;
  forWindow(
    context: ModeServicesContext,
  ): Pick<
    MainServices,
    | 'alerts'
    | 'window'
    | 'openExternal'
    | 'systemStats'
    | 'screenCapture'
    | 'agentHomeDir'
  > &
    RunAgents;
}

interface ModeServicesContext {
  window: BrowserWindow;
  homeDir: string;
  log: Log;
}

// The harnesses the composition root registers in a run, and the home folder
// an agent harness runs as (`services.agentHomeDir`).
interface RunAgents {
  harnesses: readonly AgentHarness[];
  agentHomeDir: string;
}

// The icon badge of the OS `osName`. Linux has none.
function alertsFor(osName: OsName, window: BrowserWindow): Alerts {
  if (osName === 'macos') {
    return createMacAlerts();
  }
  return osName === 'windows' ? createWindowsAlerts(window) : silentAlerts;
}

// The readings of the OS `osName`, its commands run through `runner`. Linux has
// no adapter, so its samples reject.
function systemStatsFor(osName: OsName, runner: ProcessRunner): SystemStats {
  switch (osName) {
    case 'macos':
      return createMacSystemStats(runner, os.cpus);
    case 'windows':
      return createWindowsSystemStats(runner, os.cpus);
    default:
      return createUnavailableSystemStats(osName);
  }
}

// The windows the OS `osName` can stream, its commands run through `runner`.
// Linux has no window lister, so its calls reject.
function screenCaptureFor(
  osName: OsName,
  runner: ProcessRunner,
): ScreenCapture {
  switch (osName) {
    case 'macos':
      return createScreenCapture({
        windows: createMacWindowList(runner),
        sources: electronCaptureSources,
        access: macScreenAccess,
        blockedWhenNoSources: true,
        openSettings: openMacScreenSettings,
      });
    case 'windows':
      return createScreenCapture({
        windows: createWindowsWindowList(runner),
        sources: electronCaptureSources,
        access: () => 'granted',
        blockedWhenNoSources: false,
        openSettings: () =>
          Promise.reject(new Error('Windows has no Screen Recording setting')),
      });
    default:
      return createUnavailableScreenCapture(osName);
  }
}

// The user's app: the OS Trash, the icon badge, native dialogs, the agent
// harnesses its plugins register, run as the user, links opened in the user's
// browser, the machine's own readings, and the OS's own windows to stream.
function liveServices(): ModeServices {
  return {
    trashItem: (file) => shell.trashItem(file),
    forWindow: ({ window, homeDir }) => ({
      alerts: alertsFor(platform.os, window),
      harnesses: [],
      agentHomeDir: homeDir,
      window: windowService(window),
      openExternal: gateExternalLinks((url) => shell.openExternal(url)),
      systemStats: systemStatsFor(platform.os, processes),
      screenCapture: screenCaptureFor(platform.os, processes),
    }),
  };
}

// A run beside the user's app, the self-test or a drive run: every file sits
// in the run's own home, so trash deletes for good and the user's Trash
// collects nothing; alerts are silent, the window stays offscreen and shows no
// dialog, and no link takes the user's foreground. `runName` names the run in
// the line a window not shown or a link not opened logs; sessions run over the
// harnesses `agents` builds for the run's home, as the home it names, and
// plugins read the machine `systemStats` builds and the windows `screenCapture`
// builds.
function offscreenRunServices(
  runName: string,
  agents: (homeDir: string) => RunAgents,
  systemStats: () => SystemStats,
  screenCapture: () => ScreenCapture,
): ModeServices {
  return {
    trashItem: (file) => rm(file, { recursive: true }),
    forWindow: (context) => ({
      alerts: silentAlerts,
      ...agents(context.homeDir),
      window: offscreenWindowService(context.window, runName, context.log),
      openExternal: gateExternalLinks(async (url) =>
        context.log('main', `external link not opened in ${runName}: ${url}`),
      ),
      systemStats: systemStats(),
      screenCapture: screenCapture(),
    }),
  };
}

// The fake harness, registered by the composition root, run in `homeDir`.
function fakeAgents(homeDir: string): RunAgents {
  return {
    harnesses: [createFakeAgentHarness(clock, files, timers)],
    agentHomeDir: homeDir,
  };
}

// A drive run's agents, as `WIGLEY_DRIVE_HARNESS` named them: the fake harness
// in the run's home `homeDir`, or none, the built-in harness plugins
// registering theirs to run as the user, logged in in their real home; their
// relays still find this run's endpoint through `services.agentEnvironment`.
function driveAgents(name: DriveHarnessName, homeDir: string): RunAgents {
  return name === 'fake'
    ? fakeAgents(homeDir)
    : { harnesses: [], agentHomeDir: os.homedir() };
}

// A drive run's system stats, as `WIGLEY_DRIVE_SYSTEM_STATS` named them: the
// fake's fixed machine, or this machine's readings.
function driveSystemStats(name: DriveSystemStatsName): SystemStats {
  return name === 'fake'
    ? createFakeSystemStats(clock)
    : systemStatsFor(platform.os, processes);
}

function modeServicesOf(environment: RunEnvironment): ModeServices {
  switch (environment.mode) {
    case 'live':
      return liveServices();
    case 'selfTest':
      return offscreenRunServices(
        'the self-test',
        fakeAgents,
        () => createFakeSystemStats(clock),
        () => createFakeScreenCapture(),
      );
    case 'drive':
      return offscreenRunServices(
        'a drive run',
        (homeDir) => driveAgents(environment.harness, homeDir),
        () => driveSystemStats(environment.systemStats),
        () => createFakeScreenCapture(),
      );
  }
}
const clock: Clock = { now: () => Date.now() };
const timers: Timers = {
  // Node's Timeout converts to its numeric id, and `clearTimeout` takes the id.
  set: (run, ms) => setTimeout(run, ms)[Symbol.toPrimitive](),
  clear: (handle) => clearTimeout(handle),
};
const modeServices = modeServicesOf(runEnvironment);
// The platform record main runs on, as the served config and every plugin's services hold it.
const platform: Platform = platformFor(osPlatform(process.platform), {
  username: os.userInfo().username,
  pid: process.pid,
  env: process.env,
  execPath: process.execPath,
  cwd: process.cwd(),
  isDev: appInstance.isDev,
});
const files = createNodeFiles({
  trashItem: modeServices.trashItem,
  os: platform.os,
});
const processes = createNodeProcesses();
const randomHex: RandomHex = () => randomBytes(4).toString('hex');
const randomUuid: RandomUuid = () => randomUUID();
const paths: Paths = platform.os === 'windows' ? windowsPaths : posixPaths;
// Git runs at most this many at once, so a burst of reads cannot pile up
// exited children faster than main's event loop reaps them.
const MAX_GIT_RUNS = 4;
const git = createProcessGit({
  processes: limitRuns(processes, MAX_GIT_RUNS),
  files,
  paths,
});

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
// The window's layouts service, which the `wigley-layout:` scheme asks for
// each owner's default folder; null until the window makes it.
let layoutService: LayoutService | null = null;

// The work the app does as it quits, started in the order it was added.
const quitTasks: (() => unknown)[] = [];
let quitWork: Promise<unknown> | null = null;
let hasQuitStarted = false;
// The ids whose stop is in flight in the main host, which a slow quit logs;
// at quit the page has gone, so only the main host is still stopping parts.
let stoppingParts: () => readonly string[] = () => [];
// At will-quit every window has closed, so the quit's lines go to stderr in
// every run mode.
const quitLog: Log = (source, message) => {
  process.stderr.write(`wigley-ai-gui ${source}: ${message}\n`);
};

function onQuit(task: () => unknown) {
  quitTasks.push(task);
}

// Starts every quit task, on the first call only, and settles once every task
// has. Outside the user's app, a task's rejection goes to stderr, which the
// drive CLI keeps in the run's `app.log`.
function startQuitWork() {
  hasQuitStarted = true;
  quitWork ??= Promise.allSettled(
    quitTasks.map(async (task) => {
      try {
        await task();
      } catch (error) {
        if (runMode !== 'live') {
          process.stderr.write(
            `wigley-ai-gui quit task failed: ${errorText(error)}\n`,
          );
        }
      }
    }),
  );
  return quitWork;
}

// Starts the quit work on the first will-quit and holds the quit until every
// task settles, with no cap, so each part's stop keeps its save, a drive
// `restart` finds the ui-state it left and a recording finishes encoding. A
// second will-quit during the hold exits a drive run at once (another quit, or
// the SIGTERM Electron turns into a quit); the live app keeps holding. A quit
// still running after QUIT_WAIT_LOG_MS logs the parts still stopping to stderr.
function runQuitTasks(event: Event) {
  const step = quitStep(runMode, quitWork !== null);
  if (step === 'exit') {
    app.exit(0);
    return;
  }
  event.preventDefault();
  if (step === 'hold') {
    return;
  }
  const work = startQuitWork();
  logSlowQuit(work, stoppingParts, timers, quitLog);
  void work.then(() => app.exit(0));
}

// The self-test gives plugins a fresh temp folder as the home folder. Its
// exit skips will-quit and the quit tasks: it runs its own teardown, which
// closes whatever registered through onSelfTestExit, waiting at most a capped
// time, then deletes the home. Node retries the removal on `EBUSY`,
// `ENOTEMPTY` and `EPERM`, which Windows returns for a handle it releases a
// moment after it closes.
let tempHome: string | null = null;
const selfTestTeardown = createSelfTestTeardown(async () => {
  if (tempHome !== null) {
    await rm(tempHome, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
const cleanUpSelfTest = () => selfTestTeardown.run();

// In the self-test, adds `teardown` to what its exit closes before it deletes
// the temp home; `name` names it in the line a teardown that hangs reports.
function onSelfTestExit(name: string, teardown: () => unknown) {
  if (runMode === 'selfTest') {
    selfTestTeardown.add(name, teardown);
  }
}

// Every line main logs to the page, from before the window exists on. A line
// waits while the page loads; with the window or its page destroyed, a line is
// dropped.
const pageLog = createPageLog((source, message) => {
  if (mainWindow !== null) {
    livePage(mainWindow)?.send(BRIDGE_CHANNELS.log, source, message);
  }
});

// What the window and the plugins start from besides the config and the
// plugin catalog, read once the app is ready so that a bad run folder fails
// the start through failStart.
interface StartInputs {
  homeDir: string;
  dataRoot: string;
  // The folder of each user plugin's per-revision code copies.
  pluginCode: string;
  // The user plugin folders, `<config folder>/plugins`.
  pluginsFolder: string;
  uiStatePath: string;
  pastedFolder: string;
  tempFolders: readonly string[];
  // The drive run's folder; null outside a drive run.
  driveRunDir: string | null;
  // The repo clone each owner's live `default` layout is read from:
  // `WIGLEY_CLONE_DIR` when that is a folder, else null.
  repoDir: string | null;
}

// Whether the page paints the theme's `reduced` values, as the page decides it
// from the `transparency` setting and the OS preference.
function isTransparencyReduced(config: AppConfig): boolean {
  const setting = config.settings.transparency;
  return (
    setting === 'reduced' ||
    (setting === 'system' && nativeTheme.prefersReducedTransparency)
  );
}

// macOS keeps its window buttons inset in the page's title bar; Windows and
// Linux draw theirs as an overlay coloured from the theme. The ConfigStore
// serves only a theme the overlay takes, so `log` hears a failure only from a
// bug, and the overlay falls back to the OS colours.
function titleBarOptions(
  config: AppConfig,
  log: Log,
): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay'> {
  if (platform.os === 'macos') {
    return { titleBarStyle: 'hiddenInset' };
  }
  try {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: titleBarOverlayOf(
        config.theme,
        isTransparencyReduced(config),
      ),
    };
  } catch (error) {
    log('main', `title bar not coloured: ${errorText(error)}`);
    return { titleBarStyle: 'hidden', titleBarOverlay: true };
  }
}

// The user's home in a live run; the self-test's fresh temp folder; a drive
// run's `<run>/home`, made if missing and kept, so a restart finds the same
// ui-state, plugin data and config.
function homeFolder(): string {
  if (runMode === 'live') {
    return os.homedir();
  }
  if (driveRunDir !== null) {
    const runHome = path.join(driveRunDir, 'home');
    mkdirSync(runHome, { recursive: true });
    return runHome;
  }
  tempHome = mkdtempSync(path.join(os.tmpdir(), 'wigley-forms-selftest-'));
  return tempHome;
}

// The folder that holds every plugin's data folder; outside a live run it sits
// inside the run's own home folder.
function dataFolder(homeDir: string): string {
  return runMode === 'live'
    ? path.join(app.getPath('userData'), 'plugins')
    : path.join(homeDir, 'plugin-data');
}

// The folder of each user plugin's per-revision code copies, which main
// imports from and the `wigley-plugin:` scheme serves; outside a live run it
// sits inside the run's own home folder beside the plugin data.
function pluginCodeFolder(homeDir: string): string {
  return runMode === 'live'
    ? path.join(app.getPath('userData'), 'plugin-code')
    : path.join(homeDir, 'plugin-code');
}

// The session host's folder: the app instance's, or a drive run's, own user data;
// in the self-test, whose user data every self-test shares, its temp home.
function sessionHostFolder(homeDir: string): string {
  return runMode === 'selfTest'
    ? path.join(homeDir, 'session-host')
    : path.join(app.getPath('userData'), 'session-host');
}

// The app's ui-state file; outside a live run it sits inside the run's own
// home folder beside the plugin data.
function uiStateFilePath(homeDir: string): string {
  return runMode === 'live'
    ? path.join(app.getPath('userData'), 'ui-state.json')
    : path.join(homeDir, 'ui-state.json');
}

// The folder pasted files are saved in, whose files the app never deletes;
// outside a live run it sits inside the run's own home folder beside the
// plugin data.
function pastedFolder(homeDir: string): string {
  return runMode === 'live'
    ? path.join(app.getPath('userData'), 'pasted')
    : path.join(homeDir, 'pasted');
}

// The OS's temp folders as real paths; none in the self-test, whose home is
// itself a temp folder its chat steps open folders in. A temp folder whose
// real path cannot be read is logged and listed as given, since the list only
// filters the folder picker.
async function runTempFolders(): Promise<string[]> {
  if (runMode === 'selfTest') {
    return [];
  }
  const tempDir = os.tmpdir();
  try {
    return tempFolders(await files.realPath(tempDir), platform.os);
  } catch (error) {
    pageLog.log(
      'main',
      `temp folder ${tempDir} not resolved: ${errorText(error)}`,
    );
    return tempFolders(tempDir, platform.os);
  }
}

async function readStartInputs(): Promise<StartInputs> {
  const homeDir = homeFolder();
  return {
    homeDir,
    dataRoot: dataFolder(homeDir),
    pluginCode: pluginCodeFolder(homeDir),
    pluginsFolder: userPluginsFolder(homeDir),
    uiStatePath: uiStateFilePath(homeDir),
    pastedFolder: pastedFolder(homeDir),
    tempFolders: await runTempFolders(),
    driveRunDir,
    repoDir: await resolveCloneDir(
      WIGLEY_CLONE_DIR,
      async (folder) => (await files.stat(folder))?.isFolder ?? false,
    ),
  };
}

// The user config folder in `homeDir`, shared by the stable and dev apps.
function configFolder(homeDir: string): string {
  return path.join(homeDir, '.config', 'wigley-ai-gui');
}

// The user plugin folders in the user config folder in `homeDir`.
function userPluginsFolder(homeDir: string): string {
  return path.join(configFolder(homeDir), 'plugins');
}

// The plugin catalog over the built-in plugins and the user plugin folders
// `inputs` names. Only a built-in bug rejects it: a user plugin that fails to
// load is the catalog's problem, not the start's.
function startCatalog(
  inputs: StartInputs,
): Promise<PluginCatalog & Disposable> {
  return startPluginCatalog({
    builtIn: createBuiltInSource(
      withoutRealHarnessPlugins(
        manifests,
        mainParts,
        isFakeHarnessRun(runEnvironment),
      ),
    ),
    user: createUserFolderSource({
      pluginsFolder: scopedFiles(files, inputs.pluginsFolder, paths),
      userRoot: inputs.pluginsFolder,
      codeFolder: scopedFiles(files, inputs.pluginCode, paths),
      codeRoot: inputs.pluginCode,
      paths,
      importModule: importModuleFrom,
      removeFolder: (folder) => rm(folder, { recursive: true, force: true }),
      log: pageLog.log,
    }),
    log: pageLog.log,
  });
}

// The layouts folder in the user config folder in `homeDir`.
function layoutsFolder(homeDir: string): string {
  return path.join(configFolder(homeDir), 'layouts');
}

// The core settings' defaults. Under the self-test, which starts every plugin,
// the default `plugins.disabled` is empty, so the store's list and the applied
// list agree and the plugin switch stops nothing at the first config change.
function defaultSettings() {
  const defaults = coreDefaultSettings();
  return runMode === 'selfTest'
    ? { ...defaults, plugins: { disabled: [] } }
    : defaults;
}

// What the ConfigStore over the user config folder in `homeDir` and the
// plugins `catalog` holds reads, logging to the page and serving the real path
// of `homeDir`, since index entries and session folders are real paths.
async function configStoreDeps(
  homeDir: string,
  catalog: PluginCatalog,
): Promise<ConfigStoreDeps> {
  return {
    files,
    folder: configFolder(homeDir),
    defaults: defaultSettings(),
    optionalSettings,
    settingChoices,
    defaultKeymap,
    coreCommands,
    coreScopes,
    plugins: catalog.entries(),
    coreThemeTokens,
    builtInThemes,
    resolveTheme,
    checkTokens: titleBarOverlayProblem,
    platform,
    homeDir: await files.realPath(homeDir),
    appInstance,
    runMode,
    log: pageLog.log,
  };
}

// The ConfigStore over the user config folder in `homeDir` and the plugins
// `catalog` holds, the `userConfig` service writing that folder through the
// store's checks, and the applied list it starts on: the store's
// `plugins.disabled` ids the store admitted, then the plugins the switch
// starts after launch (`heldAtStart`), each once.
async function loadConfig(
  homeDir: string,
  catalog: PluginCatalog,
): Promise<{
  store: ConfigStore;
  userConfig: UserConfig;
  applied: AppliedPlugins;
}> {
  const deps = await configStoreDeps(homeDir, catalog);
  const store = await loadConfigStore(deps);
  const admitted = store.plugins();
  const switchedOff = store
    .current()
    .settings.plugins.disabled.filter((id) =>
      admitted.some((entry) => entry.manifest.id === id),
    );
  const applied = createAppliedPlugins([
    ...new Set([...switchedOff, ...heldAtStart(admitted)]),
  ]);
  return {
    store,
    userConfig: createUserConfig({
      files: deps.files,
      folder: deps.folder,
      store,
      settingInfo,
      applied,
    }),
    applied,
  };
}

// The window's page, or null once the window or its page is destroyed, as on
// quit, when a part's dispose may still send to it.
function livePage(window: BrowserWindow): WebContents | null {
  const isGone = window.isDestroyed() || window.webContents.isDestroyed();
  return isGone ? null : window.webContents;
}

// The app's window, or null before it is made and once it is destroyed, as on
// quit, when another start or an activate may still ask for it.
function liveMainWindow(): BrowserWindow | null {
  return mainWindow?.isDestroyed() === false ? mainWindow : null;
}

// Serves the ui-state file at `filePath` to the page. It loads on the page's
// first read, when the page already hears the log, and is kept, so a reload
// reads main's copy, the newest. On quit a pending change is written as a
// quit task, which a drive run waits for and the user's app does not. The
// self-test's exit closes the file as a teardown, loading it first if the page
// never read it: the close writes the pending change, and a page write after
// it is dropped, so nothing writes into the temp home while it is removed.
function serveUiState(filePath: string, log: Log) {
  let loading: Promise<UiStateFile> | null = null;
  let loaded: UiStateFile | null = null;
  const load = () => {
    loading ??= loadUiStateFile({ files, path: filePath, log }).then((file) => {
      loaded = file;
      return file;
    });
    return loading;
  };
  ipcMain.handle(BRIDGE_CHANNELS.uiStateRead, async () =>
    (await load()).snapshot(),
  );
  ipcMain.on(
    BRIDGE_CHANNELS.uiStateWrite,
    (_event, key: string, value: unknown) =>
      void load().then((file) => file.set(key, value)),
  );
  onQuit(() => loaded?.flush());
  onSelfTestExit('the ui-state file', async () => (await load()).close());
}

// The slots of the app run, held in main and served to the window's page. With no
// page to send to, `seq` still moves and the next snapshot holds the change.
function serveSlots(window: BrowserWindow, log: Log): SlotHolder {
  const holder = createSlotHolder(log, (seq, change) => {
    const page = hasQuitStarted ? null : livePage(window);
    page?.send(BRIDGE_CHANNELS.stateChanged, seq, change);
  });
  ipcMain.handle(BRIDGE_CHANNELS.stateSnapshot, () => holder.snapshot());
  ipcMain.on(BRIDGE_CHANNELS.stateWrite, (_event, change: SlotChange) =>
    holder.applyPageWrite(change),
  );
  return holder;
}

// The core layouts service over the layouts folder in `homeDir`, each
// owner's default folder in `repoDir` and each user plugin's own folder in
// `catalog`, sending each owner's set to the window's page and answering the
// page's reads; held in `layoutService` for the `wigley-layout:` scheme. With
// no `repoDir` it logs once under source `layouts`.
function serveLayouts(
  window: BrowserWindow,
  homeDir: string,
  repoDir: string | null,
  catalog: PluginCatalog,
  log: Log,
): LayoutService {
  if (repoDir === null) {
    log(
      'layouts',
      `clone folder ${WIGLEY_CLONE_DIR} is missing; each default draws its bundled copy`,
    );
  }
  const service = createLayoutService({
    files,
    paths,
    folder: layoutsFolder(homeDir),
    repoDir,
    userPluginFolder: (owner) => catalog.entry(owner)?.folder ?? null,
    kitTypes,
    send: (owner, set) =>
      livePage(window)?.send(BRIDGE_CHANNELS.layoutsChanged, owner, set),
    log,
  });
  ipcMain.handle(BRIDGE_CHANNELS.layoutsRead, (_event, owner: string) =>
    service.read(owner),
  );
  layoutService = service;
  return service;
}

// Starts the main part of every plugin `store` admitted that `disabled` does
// not name, each with its own API over one plugin channel router to the
// window's page, the settings
// `store` serves with no self-test layer, one event bus, the shared
// `services`, its own host from `selfTest` (null outside the self-test, and
// for a part started once `isLaunchStartDone` is true, since the handover has
// closed), its own host from `driveRun` (null outside a drive run), its data
// folder under `dataRoot`, and its layouts in `layouts`. Each part's commands
// join `commands` as it starts, tracked in its registrations, so stopping the
// part unregisters them, and each part's API reaches `commands` under its id.
// Outside the user's app, the host's lines also go to stderr, which the drive
// CLI keeps in the run's `app.log`, as the page has gone by the time a quit
// stops the parts.
function startMainParts(
  window: BrowserWindow,
  store: ConfigStore,
  dataRoot: string,
  layouts: LayoutService,
  services: MainApiServices,
  selfTest: SelfTestDriver | null,
  isLaunchStartDone: () => boolean,
  driveRun: DriveRun | null,
  disabled: readonly string[],
  commands: RuntimeCommands<MainCommandContext<any>>,
  state: SlotStore,
): PluginHost<MainStart<PluginManifest>, MainPart> {
  // The stops a quit runs end the rows the next start restores, and a page told
  // of it would save them as gone: panes, recency.
  const channels = createPluginChannels(ipcMain, () =>
    hasQuitStarted ? null : livePage(window),
  );
  const bus = createEventBus();
  return startPlugins(
    store
      .plugins()
      .flatMap((entry) => (entry.main === null ? [] : [entry.main])),
    'main',
    (part, context) => {
      const started = part.start(
        createMainApi(part.manifest, {
          channels,
          pluginSettings: () =>
            fakeRunPluginSettings(
              store.current().pluginSettings,
              runEnvironment,
            ),
          onPluginSettingsChanged: (listener) =>
            store.onChanged((config) =>
              listener(
                fakeRunPluginSettings(config.pluginSettings, runEnvironment),
              ),
            ),
          services,
          selfTestFor: (pluginId) =>
            isLaunchStartDone() ? null : (selfTest?.hostFor(pluginId) ?? null),
          driveFor: (pluginId) => driveRun?.driveFor(pluginId) ?? null,
          dependency: context.dependency,
          registrations: context.registrations,
          bus,
          dataRoot,
          layouts,
          state,
          commands,
        }),
      );
      for (const [short, handler] of Object.entries<
        CommandHandler<MainCommandContext<any>>
      >(started.commands)) {
        context.registrations.track(
          commands.registry.register(
            qualify(part.manifest.id, short),
            handler,
            part.manifest.id,
          ),
        );
      }
      return started;
    },
    () => store.plugins().map((entry) => entry.manifest),
    disabled,
    (source, message) => {
      if (runMode !== 'live') {
        process.stderr.write(`wigley-ai-gui ${source}: ${message}\n`);
      }
      services.log(source, message);
    },
  );
}

// The window's size is read once: the one window hides rather than closes,
// so a new size applies at the next start. Its background and title bar
// overlay follow the theme and the effective transparency.
function createWindow(
  inputs: StartInputs,
  catalog: PluginCatalog,
  store: ConfigStore,
  userConfig: UserConfig,
  applied: AppliedPlugins,
  sessionHost: SessionHost,
) {
  const startConfig = store.current();
  const window = createMainWindow(
    startConfig.settings.window,
    appInstance.displayName,
    windowBackgroundOf(startConfig.theme, isTransparencyReduced(startConfig)),
    runMode !== 'live',
    titleBarOptions(startConfig, pageLog.log),
    pageLog.log,
  );
  mainWindow = window;
  const log = pageLog.log;
  // Registered before the self-test's own did-finish-load listener, so the
  // lines held during the load reach the page before its first step.
  // did-stop-loading also ends a load that failed, which no did-finish-load
  // follows.
  window.webContents.on('did-start-loading', pageLog.pageLoading);
  window.webContents.on('did-finish-load', pageLog.pageLoaded);
  window.webContents.on('did-stop-loading', pageLog.pageLoaded);
  const recolour = () => {
    if (window.isDestroyed()) {
      return;
    }
    const config = store.current();
    const isReduced = isTransparencyReduced(config);
    window.setBackgroundColor(windowBackgroundOf(config.theme, isReduced));
    if (platform.os === 'macos') {
      return;
    }
    try {
      window.setTitleBarOverlay(titleBarOverlayOf(config.theme, isReduced));
    } catch (error) {
      log('main', `title bar not recoloured: ${errorText(error)}`);
    }
  };
  store.onChanged(recolour);
  nativeTheme.on('updated', recolour);

  const selfTest =
    runMode === 'selfTest'
      ? startSelfTest(
          window,
          scopedFiles(files, inputs.homeDir, paths),
          cleanUpSelfTest,
          path.join(app.getAppPath(), '.selftest', 'screenshots'),
          selfTestFilterOf(process.env),
        )
      : null;
  // Quit and the self-test exit stop the started main parts through the host, in
  // reverse start order, each awaited before the next; a start that throws leaves
  // no host, so the parts started before it are not stopped. A live quit leaves
  // every hosted process running; a drive run stops them after the parts, so chat
  // has detached and sees no `closed`, unless its `quit` command kept them for a
  // `restart`.
  let mainHost: PluginHost<MainStart<PluginManifest>, MainPart> | null = null;
  stoppingParts = () => mainHost?.stopping() ?? [];
  let stopsSessionsOnQuit = runMode === 'drive';
  // Added ahead of the parts: as on a quit, the page has gone before they stop,
  // so no stop reaches a page that would invoke a part already stopped.
  onSelfTestExit('the page', () => window.destroy());
  onSelfTestExit('the plugin parts', () => mainHost?.stopAll());
  onSelfTestExit('the session host', () => sessionHost.stopAll());
  const driveRun =
    inputs.driveRunDir === null
      ? null
      : startDriveRun({
          window: electronDrivenWindow(window),
          runDir: inputs.driveRunDir,
          files,
          homeDir: inputs.homeDir,
          paths,
          processes,
          randomHex,
          configChanged: (listener) => store.onChanged(listener),
          quit: (keepSessions) => {
            stopsSessionsOnQuit = !keepSessions;
            app.quit();
          },
          log,
        });
  if (driveRun !== null) {
    onQuit(() => driveRun.dispose());
    driveRun.listening.catch(failStart);
  }
  const layouts = serveLayouts(
    window,
    inputs.homeDir,
    inputs.repoDir,
    catalog,
    log,
  );
  const holder = serveSlots(window, log);
  const slots = holder.store;
  startWindowFocusSlot(slots, {
    isFocused: () => window.isFocused(),
    onFocusChange(listener) {
      window.on('focus', () => listener(true));
      window.on('blur', () => listener(false));
    },
  });
  // The service's dispose on quit ends the registration.
  layouts.register(
    'shell',
    shellLayoutTypes,
    'src/renderer/shell/layouts/default',
  );
  const pageCatalog = slots.read(coreRuntimePageSlot, 'core');
  const pageCommands = createPageCommands({
    page: () => (hasQuitStarted ? null : livePage(window)),
    isStarted: () => pageCatalog.get()?.started === true,
    ipc: ipcMain,
    log,
  });
  const mainCatalog = slots.publish(coreRuntimeMainSlot);
  mainCatalog.set(EMPTY_RUNTIME_CATALOG);
  const commands = createRuntimeCommands<MainCommandContext<any>>({
    process: 'main',
    registry: new CommandRegistry(log),
    writer: mainCatalog,
    other: pageCatalog,
    served: () => store.current().commands,
    leader: () => store.current().keymap.editor.leader,
    remote: pageCommands.run,
  });
  ipcMain.handle(
    BRIDGE_CHANNELS.commandRun,
    (_event, id: string, arg: unknown) => commands.router.run(id, arg),
  );
  const { harnesses, ...windowServices } = modeServices.forWindow({
    window,
    homeDir: inputs.homeDir,
    log,
  });
  // Registered before the main parts start, so every part and page finds them;
  // the registrations live as long as the window, as the shell layout's does.
  const agentHarnesses = createAgentHarnessRegistry(
    slots.publish(coreAgentHarnessesSlot),
    (message) => log('agent-harnesses', message),
  );
  for (const harness of harnesses) {
    agentHarnesses.register(harness);
  }
  // Main parts reach the switch through this forwarder, made before they start.
  let pluginSwitch: PluginSwitch | null = null;
  let isLaunchStartDone = false;
  const host = startMainParts(
    window,
    store,
    inputs.dataRoot,
    layouts,
    {
      files,
      processes,
      git,
      log,
      clock,
      timers,
      randomHex,
      randomUuid,
      homeDir: inputs.homeDir,
      tempFolders: inputs.tempFolders,
      userConfig,
      paths,
      platform,
      images: nativeImageEncoder,
      runMode,
      appInstance,
      appBuild: appBuildOf(
        WIGLEY_BUILD_COMMIT,
        inputs.repoDir,
        runMode === 'live',
      ),
      sessionHost,
      agentHarnesses,
      agentEnvironment: agentEnvironmentOf(
        process.env,
        appEndpointDir(paths, inputs.homeDir, appInstance.id),
      ),
      pluginSwitch: {
        mayDisable: (id) =>
          pluginSwitch === null
            ? Promise.reject(new Error('The plugin switch is not ready'))
            : pluginSwitch.mayDisable(id),
      },
      ...windowServices,
    },
    selfTest,
    () => isLaunchStartDone,
    driveRun,
    applied.disabled(),
    commands,
    slots,
  );
  isLaunchStartDone = true;
  mainHost = host;
  mainCatalog.set({
    ...(mainCatalog.get() ?? EMPTY_RUNTIME_CATALOG),
    started: true,
  });
  host.ready();
  // The layouts service closes after every part's registrations, even when a
  // part's stop rejects.
  onQuit(async () => {
    try {
      await mainHost?.stopAll();
    } finally {
      layouts.dispose();
      if (stopsSessionsOnQuit) {
        await sessionHost.stopAll();
      }
    }
  });
  onSelfTestExit('the layouts service', () => layouts.dispose());
  // Handed over last, so it runs after every plugin's script and its
  // replacement of a built-in is undone before the run ends. Its `open` runs
  // once the switch below exists.
  selfTest?.hostFor(SELFTEST_USER_ID).run(
    userPluginSelfTestScript({
      homeFiles: scopedFiles(files, inputs.homeDir, paths),
      catalog,
      settled: () => pluginSwitch?.settled() ?? Promise.resolve(),
      log: pageLog.log,
    }),
  );
  // The config needs the page binds and settings of the scripts the plugins
  // handed the self-test.
  const selfTestConfig = selfTest?.closeHandover() ?? {
    pageBinds: [],
    settings: {},
  };

  // Read at each request, so a page reload after a config edit starts on the
  // current config.
  const served = () =>
    withAppliedList(
      applySelfTestConfig(
        {
          ...store.current(),
          pluginSettings: fakeRunPluginSettings(
            store.current().pluginSettings,
            runEnvironment,
          ),
        },
        selfTestConfig,
      ),
      applied.disabled(),
      applied.paused(),
    );
  const startServed = served();
  ipcMain.handle(BRIDGE_CHANNELS.config, () => served());
  serveUiState(inputs.uiStatePath, log);
  const pasted = createPastedFiles({
    files,
    clock,
    paths,
    folder: inputs.pastedFolder,
  });
  ipcMain.handle(
    BRIDGE_CHANNELS.savePasted,
    (_event, bytes: Uint8Array, mediaType: string) =>
      pasted.save(bytes, mediaType),
  );
  ipcMain.handle(BRIDGE_CHANNELS.chooseFolder, () =>
    windowServices.window.chooseFolder(),
  );
  ipcMain.handle(BRIDGE_CHANNELS.openExternal, (_event, url: string) =>
    windowServices.openExternal(url),
  );
  // The push to the page runs ahead of the keymap step `wireRuntime` adds.
  store.onChanged(() => {
    livePage(window)?.send(BRIDGE_CHANNELS.configChanged, served());
  });
  let hasPageLoaded = false;
  const runtime = wireRuntime({
    slots,
    applyPageWrite: holder.applyPageWrite,
    config: store,
    served,
    pageCommands,
    has: (id) => commands.registry.has(id),
    applyKeys(keymap) {
      keybindings.setKeymap(keymap);
      if (runMode === 'live' && !appInstance.isDev && hasPageLoaded) {
        registerGlobalShortcuts(keymap.global, commands.keyCommands, log);
      }
    },
    log,
  });
  window.webContents.on('render-process-gone', () => runtime.pageProcessGone());
  const pageParts = createPageParts({
    page: () => (hasQuitStarted ? null : livePage(window)),
    catalog: pageCatalog,
    ipc: ipcMain,
    log,
  });
  const liveSwitch = createPluginSwitch({
    main: host,
    page: pageParts.request,
    applied,
    slots: holder,
    status: slots.publish(corePluginsSlot),
    catalog,
    config: store,
    configDisabled: () => store.current().settings.plugins.disabled,
    problem: (message) => store.setPluginsProblem(message),
    servedChanged() {
      livePage(window)?.send(BRIDGE_CHANNELS.configChanged, served());
      runtime.servedChanged();
    },
    timers,
    log,
  });
  pluginSwitch = liveSwitch;
  // Lives as long as the window. A built-in or unknown id rejects, and the
  // router reports it as any failed command.
  commands.registry.register(
    CORE_RELOAD_PLUGIN.id,
    async (context: MainCommandContext<string>) => {
      await catalog.reload(context.arg);
      await liveSwitch.settled();
    },
    'core',
  );
  // At quit, or with the window or its page destroyed, the page never comes
  // back, so a request it holds resolves empty rather than holding the
  // switch's queue. A crashed page that reloads is not gone: its requests wait.
  onQuit(() => pageParts.pageGone());
  window.webContents.once('destroyed', () => pageParts.pageGone());
  onQuit(() => liveSwitch.dispose());
  // A change that leaves the list as it was, such as the switch's own problem
  // write, applies nothing.
  let handedList = store.current().settings.plugins.disabled;
  store.onChanged((config) => {
    const { disabled } = config.settings.plugins;
    if (isSameJson(disabled, handedList)) {
      return;
    }
    handedList = disabled;
    liveSwitch
      .apply(disabled)
      .catch((error: unknown) =>
        log('plugin-switch', `failed: ${errorText(error)}`),
      );
  });
  if (driveRun !== null) {
    // The actions live as long as the drive run.
    addPluginSwitchActions(driveRun.driveFor('core'), {
      pluginSwitch: liveSwitch,
      userConfig,
      ids: () => store.plugins().map((entry) => entry.manifest.id),
      reload: (id) => catalog.reload(id),
      disabled: () => store.current().settings.plugins.disabled,
    });
  }
  const keybindings = installWindowKeybindings(
    window,
    runtime.handledKeymap(startServed.keymap),
    commands.keyCommands,
    (id) => commandLabel(served().commands, id),
    log,
  );
  window.on('closed', () => {
    globalShortcut.unregisterAll();
    pageParts.pageGone();
  });

  if (runMode !== 'live') {
    return;
  }
  // Only the stable app registers global shortcuts, so the dev app running
  // beside it never takes them.
  window.webContents.once('did-finish-load', () => {
    hasPageLoaded = true;
    if (!appInstance.isDev) {
      registerGlobalShortcuts(
        runtime.handledKeymap(served().keymap).global,
        commands.keyCommands,
        log,
      );
    }
  });
  // The window holds every open round, so on macOS closing it hides it
  // until the app quits.
  window.on('close', (event) => {
    if (platform.lifecycle.closeHidesWindow && !isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
}

// Shows why the app could not start, and exits non-zero. A drive run's window
// is offscreen, so it writes the reason to stderr, which the drive CLI keeps
// in the run's `app.log`.
function failStart(error: unknown) {
  if (runMode === 'selfTest') {
    failSelfTest('the app starts', error, cleanUpSelfTest);
    return;
  }
  if (runMode === 'drive') {
    process.stderr.write(
      `wigley-ai-gui could not start: ${errorText(error)}\n`,
    );
    app.exit(1);
    return;
  }
  dialog.showErrorBox('wigley-ai-gui could not start', errorText(error));
  app.exit(1);
}

function startApp() {
  // The Mac app menu's About, Hide and Quit items show the app name. Every run
  // mode sets its user data folder itself, so the name moves no data.
  app.setName(appInstance.displayName);
  if (platform.lifecycle.toastsNeedAppUserModelId) {
    app.setAppUserModelId(process.execPath);
  }
  if (runMode !== 'live' && platform.lifecycle.hidesFromDockBesideApp) {
    app.setActivationPolicy('accessory');
  }
  if (runMode !== 'live') {
    // Chromium's profile and caches, apart from both apps; set before the app
    // is ready. Each drive run has its own; every self-test reuses one.
    try {
      app.setPath(
        'userData',
        driveRunDir === null
          ? path.join(app.getPath('appData'), 'wigley-ai-gui-selftest')
          : path.join(driveRunDir, 'user-data'),
      );
    } catch (error) {
      failStart(error);
      return;
    }
    // The page loads hundreds of modules from the dev server, and Chromium
    // wrote each one into the profile's HTTP and code caches on every start:
    // about 2,300 files a run, 1.5 GB kept, and Spotlight indexing the churn.
    // A run reuses none of it: a dev start's server port and module URLs
    // change between starts, and a packaged drive run's profile is new. The code cache goes off once the app is ready
    // (`disableCodeCache`).
    app.commandLine.appendSwitch('disable-http-cache');
  }
  // A second start (a relay starting the app) shows the window without
  // taking the user's focus.
  app.on('second-instance', () => liveMainWindow()?.showInactive());
  app.on('before-quit', () => {
    isQuitting = true;
  });
  app
    .whenReady()
    .then(async () => {
      // A variable the login shell did not set keeps the inherited one.
      const shellEnv = await loginShellEnv;
      if (shellEnv.path !== null) {
        process.env.PATH = shellEnv.path;
      }
      if (shellEnv.sshAuthSock !== null) {
        process.env.SSH_AUTH_SOCK = shellEnv.sshAuthSock;
      }
      if (runMode !== 'live') {
        disableCodeCache();
      }
      const inputs = await readStartInputs();
      // The temp home is new each run, so the seed overwrites no user file.
      if (runMode === 'selfTest') {
        await seedSelfTestUserPlugin({
          files,
          paths,
          pluginsFolder: inputs.pluginsFolder,
        });
      }
      const catalog = await startCatalog(inputs);
      onQuit(() => catalog.dispose());
      onSelfTestExit('the plugin catalog', () => catalog.dispose());
      const { store, userConfig, applied } = await loadConfig(
        inputs.homeDir,
        catalog,
      );
      onSelfTestExit('the config store', () => store.dispose());
      // Logs its own failure and never rejects, so the start goes on.
      await writePluginTypes({
        files,
        typesFolder: path.join(inputs.pluginsFolder, '_types'),
        emittedFolder: emittedTypesFolder(
          {
            isPackaged: app.isPackaged,
            appPath: app.getAppPath(),
            resourcesPath: process.resourcesPath,
          },
          paths,
        ),
        paths,
        log: pageLog.log,
      });
      serveDataScheme(inputs.dataRoot, paths);
      servePluginScheme(inputs.pluginCode, paths);
      serveLayoutScheme(
        layoutsFolder(inputs.homeDir),
        paths,
        (owner) => layoutService?.defaultFolderPath(owner) ?? null,
      );
      const serveVisual = serveVisualScheme();
      ipcMain.handle(BRIDGE_CHANNELS.serveVisual, (_event, source: string) =>
        serveVisual(source),
      );
      const sessionHost = createSessionHostClient({
        folder: sessionHostFolder(inputs.homeDir),
        channel: sessionHostChannel(
          platform.os,
          inputs.homeDir,
          platform.relay.username,
          appInstance.id,
        ),
        hostScript: path.join(__dirname, 'session-host.js'),
        execPath: process.execPath,
        env: process.env,
        spawn,
        clock,
        timers,
        log: pageLog.log,
      });
      createWindow(inputs, catalog, store, userConfig, applied, sessionHost);
      // Starts with createWindow's quit tasks, ahead of every part but the first
      // to stop; `current` still answers after it, for the parts still stopping.
      onQuit(() => store.dispose());
      app.on('activate', () => liveMainWindow()?.show());
    })
    .catch(failStart);
  app.on('will-quit', runQuitTasks);
  onQuit(() => globalShortcut.unregisterAll());
  // Quit when the window closes, except on macOS, where closing hides it, and in
  // the self-test, whose exit closes the window and finishes its own teardown.
  app.on('window-all-closed', () => {
    const quitsWithTheWindow =
      !platform.lifecycle.closeHidesWindow && runMode !== 'selfTest';
    if (quitsWithTheWindow) {
      app.quit();
    }
  });
}

// Turns the V8 code cache off for the default session: Electron uses no code
// cache when it cannot create the folder it is given, and no folder can be
// made under the null device.
function disableCodeCache() {
  session.defaultSession.setCodeCachePath(path.join(os.devNull, 'code-cache'));
}

// The user's app, in the app instance's own user data folder. The
// single-instance lock is keyed on that folder, so the stable and the dev app
// each take their own lock and run side by side.
function startLiveApp() {
  try {
    app.setPath('userData', path.join(app.getPath('appData'), appInstance.id));
  } catch (error) {
    failStart(error);
    return;
  }
  if (app.requestSingleInstanceLock()) {
    startApp();
  } else {
    app.quit();
  }
}

// The self-test and a drive run run beside the user's own app, so they take
// no lock.
if (runMode === 'live') {
  startLiveApp();
} else {
  startApp();
}
