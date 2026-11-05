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
  defaultSettingsFor,
  optionalSettings,
  settingChoices,
  settingInfo,
} from '../config/settings';
import { coreThemeTokens } from '../config/theme-tokens';
import { builtInThemes } from '../config/themes';
import { type AgentHarness, CLAUDE_PERMISSION_TOOL } from '../contracts/agent';
import type { Alerts } from '../contracts/alerts';
import type {
  Clock,
  RandomHex,
  RandomUuid,
  Timers,
} from '../contracts/ambient';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import type { Log } from '../contracts/log';
import type { Paths } from '../contracts/paths';
import type { OsName, Platform } from '../contracts/platform';
import type { SessionHost } from '../contracts/session-host';
import type { AppConfig } from '../contracts/settings';
import type { UserConfig } from '../contracts/user-config';
import type {
  MainServices,
  MainStart,
  PluginManifest,
} from '../contracts/plugin';
import { defaultKeymap } from '../plugins/keymap';
import { mainParts } from '../plugins/main';
import { manifests } from '../plugins/manifests';
import { appEndpointDir } from '../shared/app-endpoint-dir';
import { CommandRegistry } from '../shared/command-registry';
import { errorText } from '../shared/error-text';
import { createEventBus } from '../shared/event-bus';
import { gateExternalLinks } from '../shared/external-links';
import { createFakeAgentHarness } from '../shared/fake-agent-harness';
import { osPlatform } from '../shared/os-platform';
import { platformFor } from '../shared/platform';
import { type PluginHost, startPlugins } from '../shared/plugin-host';
import {
  pluginThemeTokens,
  qualify,
  requireListed,
} from '../shared/plugin-manifests';
import { posixPaths } from '../shared/paths/posix-paths';
import { windowsPaths } from '../shared/paths/windows-paths';
import { scopedFiles } from '../shared/scoped-files';
import kitTypes from '../shared/page/layout-host/kit.d.ts?raw';
import shellLayoutTypes from '../renderer/shell/layouts/layout.d.ts?raw';
import { createPlainAlerts } from './alerts/electron-alerts';
import { createMacAlerts } from './alerts/mac-alerts';
import { silentAlerts } from './alerts/silent-alerts';
import { createWindowsAlerts } from './alerts/windows-alerts';
import { appInstanceOf } from './app-instance';
import { createClaudeCodeHarness } from './claude-code/claude-code-harness';
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
  serveVisualScheme,
} from './data-protocol/data-protocol';
import { type DriveRun, startDriveRun } from './drive/drive-run';
import { electronDrivenWindow } from './electron-driven-window';
import { createNodeFiles } from './files/node-files';
import { createProcessGit } from './git/process-git';
import {
  installWindowKeybindings,
  type MainCommands,
  registerGlobalShortcuts,
} from './keybindings';
import {
  readLoginShellPath,
  shouldReadLoginShellPath,
} from './login-shell-path';
import {
  createLayoutService,
  type LayoutService,
} from './layouts/layout-service';
import { resolveCloneDir } from './resolve-clone-dir';
import { createSessionHostClient } from './session-host/session-host-client';
import { sessionHostChannel } from './session-host/session-host-channel';
import { createMainApi, type MainApiServices } from './plugins/main-api';
import { createPageLog } from './page-log';
import { createPastedFiles } from './pasted-files';
import { createPluginChannels } from './plugins/plugin-channel';
import { nativeImageEncoder } from './images/native-image-encoder';
import { createNodeProcesses } from './processes/node-processes';
import { failSelfTest, type SelfTestDriver, startSelfTest } from './selftest';
import { createSelfTestTeardown } from './selftest-teardown';
import {
  applySelfTestConfig,
  mainStartList,
  selfTestFilterOf,
  withMainStartList,
} from './selftest-config';
import { tempFolders } from './temp-folders';
import {
  type DriveHarnessName,
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
// terminal start, the self-test and a drive run keep the PATH of the shell
// that ran them and stay clear of the user's shell profile.
const loginShellPath = shouldReadLoginShellPath({
  isLive: runMode === 'live',
  parentPid: process.ppid,
})
  ? readLoginShellPath(process.env.SHELL)
  : Promise.resolve(null);

// The services that differ by run mode. `trashItem` backs the files service,
// which loads the config before the window exists; `forWindow` builds the
// rest once the window is created.
interface ModeServices {
  trashItem(file: string): Promise<void>;
  forWindow(
    context: ModeServicesContext,
  ): Pick<
    MainServices,
    'alerts' | 'agentHarnesses' | 'window' | 'openExternal'
  >;
}

interface ModeServicesContext {
  window: BrowserWindow;
  store: ConfigStore;
  homeDir: string;
  log: Log;
  sessionHost: SessionHost;
}

// Claude Code run as the user of `homeDir`, its command and profile folders
// expanded against that home, its sessions on `host`.
function claudeHarness(
  store: ConfigStore,
  homeDir: string,
  env: NodeJS.ProcessEnv,
  log: Log,
  host: SessionHost,
) {
  return createClaudeCodeHarness({
    command: () =>
      paths.expandTilde(store.current().settings.claude.command, homeDir),
    permissionTool: CLAUDE_PERMISSION_TOOL,
    env,
    log,
    host,
    spawn,
    files,
    homeDir,
    paths,
    clock,
    randomUuid,
  });
}

// The app's environment with `WIGLEY_AI_GUI_ENDPOINT_DIR` set to the app
// instance's endpoint folder in `endpointHome`, so the relays of the Claude
// sessions this app starts send their rounds to this app.
function endpointEnv(endpointHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    WIGLEY_AI_GUI_ENDPOINT_DIR: appEndpointDir(
      paths,
      endpointHome,
      appInstance.id,
    ),
  };
}

// The native alerts of the OS `osName`. Linux has no attention call and no badge.
function alertsFor(osName: OsName, window: BrowserWindow, log: Log): Alerts {
  if (osName === 'macos') {
    return createMacAlerts(log);
  }
  return osName === 'windows'
    ? createWindowsAlerts(window, log)
    : createPlainAlerts(log);
}

// The user's app: the OS Trash, native alerts and dialogs, Claude Code, whose
// relays find this app's endpoint through `WIGLEY_AI_GUI_ENDPOINT_DIR`, and
// links opened in the user's browser.
function liveServices(): ModeServices {
  return {
    trashItem: (file) => shell.trashItem(file),
    forWindow: ({ window, store, homeDir, log, sessionHost }) => ({
      alerts: alertsFor(platform.os, window, log),
      agentHarnesses: [
        claudeHarness(store, homeDir, endpointEnv(homeDir), log, sessionHost),
      ],
      window: windowService(window),
      openExternal: gateExternalLinks((url) => shell.openExternal(url)),
    }),
  };
}

// A run beside the user's app, the self-test or a drive run: every file sits
// in the run's own home, so trash deletes for good and the user's Trash
// collects nothing; alerts are silent, the window stays offscreen and shows no
// dialog, and no link takes the user's foreground. `runName` names the run in
// the line a window not shown or a link not opened logs; sessions run over the
// harness `harness` builds.
function offscreenRunServices(
  runName: string,
  harness: (context: ModeServicesContext) => AgentHarness,
): ModeServices {
  return {
    trashItem: (file) => rm(file, { recursive: true }),
    forWindow: (context) => ({
      alerts: silentAlerts,
      agentHarnesses: [harness(context)],
      window: offscreenWindowService(context.window, runName, context.log),
      openExternal: gateExternalLinks(async (url) =>
        context.log('main', `external link not opened in ${runName}: ${url}`),
      ),
    }),
  };
}

// A drive run's agent harness, as `WIGLEY_DRIVE_HARNESS` named it: the fake
// harness, or Claude Code logged in as the user, whose relays find this run's
// endpoint through `WIGLEY_AI_GUI_ENDPOINT_DIR`, the app instance's endpoint
// folder in the run's home.
function driveHarness(
  name: DriveHarnessName,
  { store, homeDir, log, sessionHost }: ModeServicesContext,
): AgentHarness {
  if (name === 'fake') {
    return createFakeAgentHarness(clock, files, timers);
  }
  return claudeHarness(
    store,
    os.homedir(),
    endpointEnv(homeDir),
    log,
    sessionHost,
  );
}

function modeServicesOf(environment: RunEnvironment): ModeServices {
  switch (environment.mode) {
    case 'live':
      return liveServices();
    case 'selfTest':
      return offscreenRunServices('the self-test', () =>
        createFakeAgentHarness(clock, files, timers),
      );
    case 'drive':
      return offscreenRunServices('a drive run', (context) =>
        driveHarness(environment.harness, context),
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
const git = createProcessGit({ processes, files, paths });

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
// The window's layouts service, which the `wigley-layout:` scheme asks for
// each owner's default folder; null until the window makes it.
let layoutService: LayoutService | null = null;

// The work the app does as it quits, started in the order it was added.
const quitTasks: (() => unknown)[] = [];
let quitWork: Promise<unknown> | null = null;
let hasQuitStarted = false;

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

// Starts the quit work on the first will-quit. A drive run holds the quit
// until every task settles, so a drive `restart` finds the ui-state it left
// and a recording finishes encoding; a second will-quit during the hold
// (another quit, or the SIGTERM Electron turns into a quit) exits at once.
// The user's app quits without waiting, so a task still running when it exits
// is cut short.
function runQuitTasks(event: Event) {
  if (runMode === 'drive' && quitWork !== null) {
    app.exit(0);
    return;
  }
  const work = startQuitWork();
  if (runMode === 'drive') {
    void work.then(() => app.exit(0));
    event.preventDefault();
  }
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

// What the window and the plugins start from besides the config, read once
// the app is ready so that a bad manifest or run folder fails the start
// through failStart.
interface StartInputs {
  homeDir: string;
  dataRoot: string;
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
  requireListed(mainParts, manifests);
  const homeDir = homeFolder();
  return {
    homeDir,
    dataRoot: dataFolder(homeDir),
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

// The layouts folder in the user config folder in `homeDir`.
function layoutsFolder(homeDir: string): string {
  return path.join(configFolder(homeDir), 'layouts');
}

// What the ConfigStore over the user config folder in `homeDir` reads,
// logging to the page and serving the real path of `homeDir`, since index
// entries and session folders are real paths.
async function configStoreDeps(homeDir: string): Promise<ConfigStoreDeps> {
  return {
    files,
    folder: configFolder(homeDir),
    defaults: defaultSettingsFor(platform.programs),
    optionalSettings,
    settingChoices,
    defaultKeymap,
    coreCommands,
    coreScopes,
    manifests,
    builtInThemes,
    themeTokens: {
      core: coreThemeTokens,
      plugins: pluginThemeTokens(coreThemeTokens, manifests),
    },
    resolveTheme,
    checkTokens: titleBarOverlayProblem,
    platform,
    homeDir: await files.realPath(homeDir),
    appInstance,
    runMode,
    log: pageLog.log,
  };
}

// The ConfigStore over the user config folder in `homeDir`, and the
// `userConfig` service writing that folder through the store's checks.
async function loadConfig(
  homeDir: string,
): Promise<{ store: ConfigStore; userConfig: UserConfig }> {
  const deps = await configStoreDeps(homeDir);
  const store = await loadConfigStore(deps);
  return {
    store,
    userConfig: createUserConfig({ ...deps, store, settingInfo }),
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

// The core layouts service over the layouts folder in `homeDir` and each
// owner's default folder in `repoDir`, sending each owner's set to the
// window's page and answering the page's reads; held in `layoutService` for
// the `wigley-layout:` scheme. With no `repoDir` it logs once under source
// `layouts`.
function serveLayouts(
  window: BrowserWindow,
  homeDir: string,
  repoDir: string | null,
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

// Starts every plugin's main part `disabled` does not name, each with its own
// API over one plugin channel router to the window's page, the settings
// `store` serves with no self-test layer, one event bus, the shared
// `services`, its own host from `selfTest` (null outside the self-test), its
// own host from `driveRun` (null outside a drive run), its data folder under
// `dataRoot`, and its layouts in `layouts`. Each part's commands join `commands`
// as it starts, tracked in its registrations, so stopping the part unregisters
// them. Outside the user's app, the host's lines also go to stderr, which the
// drive CLI keeps in the run's `app.log`, as the page has gone by the time a
// quit stops the parts.
function startMainParts(
  window: BrowserWindow,
  store: ConfigStore,
  dataRoot: string,
  layouts: LayoutService,
  services: MainApiServices,
  selfTest: SelfTestDriver | null,
  driveRun: DriveRun | null,
  disabled: readonly string[],
  commands: MainCommands,
): PluginHost<MainStart<PluginManifest>> {
  // The stops a quit runs end the rows the next start restores, and a page told
  // of it would save them as gone: panes, recency.
  const channels = createPluginChannels(ipcMain, () =>
    hasQuitStarted ? null : livePage(window),
  );
  const bus = createEventBus();
  return startPlugins(
    mainParts,
    'main',
    (part, context) => {
      const started = part.start(
        createMainApi(part.manifest, {
          channels,
          pluginSettings: () => store.current().pluginSettings,
          onPluginSettingsChanged: (listener) =>
            store.onChanged((config) => listener(config.pluginSettings)),
          services,
          selfTestFor: (pluginId) => selfTest?.hostFor(pluginId) ?? null,
          driveFor: (pluginId) => driveRun?.driveFor(pluginId) ?? null,
          dependency: context.dependency,
          registrations: context.registrations,
          bus,
          dataRoot,
          layouts,
        }),
      );
      for (const [short, handler] of Object.entries<(chord: string) => void>(
        started.commands,
      )) {
        context.registrations.track(
          commands.register(qualify(part.manifest.id, short), handler),
        );
      }
      return started;
    },
    manifests,
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
  store: ConfigStore,
  userConfig: UserConfig,
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
  let mainHost: PluginHost<MainStart<PluginManifest>> | null = null;
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
  const layouts = serveLayouts(window, inputs.homeDir, inputs.repoDir, log);
  // The service's dispose on quit ends the registration.
  layouts.register(
    'shell',
    shellLayoutTypes,
    'src/renderer/shell/layouts/default',
  );
  // Read once: a changed list reaches main's parts on the next app start.
  const startList = mainStartList(
    runMode === 'selfTest',
    store.current().settings.plugins.disabled,
  );
  const commands: MainCommands = new CommandRegistry<string>();
  mainHost = startMainParts(
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
      sessionHost,
      ...modeServices.forWindow({
        window,
        store,
        homeDir: inputs.homeDir,
        log,
        sessionHost,
      }),
    },
    selfTest,
    driveRun,
    startList,
    commands,
  );
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
  // The config needs the page binds and settings of the scripts the plugins
  // handed the self-test.
  const selfTestConfig = selfTest?.closeHandover() ?? {
    pageBinds: [],
    settings: {},
  };

  // Read at each request, so a page reload after a config edit starts on the
  // current config.
  const served = () =>
    withMainStartList(
      applySelfTestConfig(store.current(), selfTestConfig),
      startList,
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
  const keybindings = installWindowKeybindings(
    window,
    startServed.keymap,
    commands,
  );
  window.on('closed', () => {
    globalShortcut.unregisterAll();
  });

  let hasPageLoaded = false;
  let appliedKeymap = JSON.stringify(startServed.keymap);
  store.onChanged(() => {
    const config = served();
    livePage(window)?.send(BRIDGE_CHANNELS.configChanged, config);
    const keymap = JSON.stringify(config.keymap);
    if (keymap === appliedKeymap) {
      return;
    }
    try {
      keybindings.setKeymap(config.keymap);
      if (runMode === 'live' && !appInstance.isDev && hasPageLoaded) {
        registerGlobalShortcuts(config.keymap.global, commands, log);
      }
      appliedKeymap = keymap;
    } catch (error) {
      log('config', `keys not applied: ${errorText(error)}`);
    }
  });

  if (runMode !== 'live') {
    return;
  }
  // Only the stable app registers global shortcuts, so the dev app running
  // beside it never takes them.
  window.webContents.once('did-finish-load', () => {
    hasPageLoaded = true;
    if (!appInstance.isDev) {
      registerGlobalShortcuts(served().keymap.global, commands, log);
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
      // With no login PATH read, the inherited one stays.
      const shellPath = await loginShellPath;
      if (shellPath !== null) {
        process.env.PATH = shellPath;
      }
      const inputs = await readStartInputs();
      const { store, userConfig } = await loadConfig(inputs.homeDir);
      onSelfTestExit('the config store', () => store.dispose());
      serveDataScheme(inputs.dataRoot, paths);
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
      createWindow(inputs, store, userConfig, sessionHost);
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
