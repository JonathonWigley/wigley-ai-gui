// Composition root for the main process: the one module that picks adapters
// and config, and wires them to each other.
import {
  app,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  shell,
  type WebContents,
} from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { coreCommands, coreKeymap, coreScopes } from '../config/keymap';
import {
  defaultSettings,
  optionalSettings,
  settingChoices,
} from '../config/settings';
import { coreThemeTokens } from '../config/theme-tokens';
import { builtInThemes } from '../config/themes';
import { CLAUDE_PERMISSION_TOOL } from '../contracts/agent';
import type { Clock, RandomHex, RandomUuid } from '../contracts/ambient';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import type { Log } from '../contracts/log';
import type { Platform } from '../contracts/platform';
import type { AppConfig } from '../contracts/settings';
import type {
  MainServices,
  MainStart,
  PluginManifest,
  RunMode,
} from '../contracts/plugin';
import { mainParts } from '../plugins/main';
import { manifests } from '../plugins/manifests';
import { CommandRegistry } from '../shared/command-registry';
import { errorText } from '../shared/error-text';
import { createEventBus } from '../shared/event-bus';
import { expandHome } from '../shared/expand-home';
import { createFakeAgentHarness } from '../shared/fake-agent-harness';
import { startPlugins } from '../shared/plugin-host';
import {
  pluginThemeTokens,
  qualify,
  requireListed,
} from '../shared/plugin-manifests';
import { scopedFiles } from '../shared/scoped-files';
import { createElectronAlerts } from './alerts/electron-alerts';
import { silentAlerts } from './alerts/silent-alerts';
import { createClaudeCodeHarness } from './claude-code/claude-code-harness';
import { type ConfigStore, loadConfigStore } from './config/config-store';
import {
  registerDataScheme,
  serveDataScheme,
} from './data-protocol/data-protocol';
import { gateExternalLinks } from './external-links';
import { createNodeFiles } from './files/node-files';
import {
  installWindowKeybindings,
  type MainCommands,
  registerGlobalShortcuts,
} from './keybindings';
import {
  readLoginShellPath,
  shouldReadLoginShellPath,
} from './login-shell-path';
import { createMainApi } from './plugins/main-api';
import { createPageLog } from './page-log';
import { createPluginChannels } from './plugins/plugin-channel';
import { createNodeProcesses } from './processes/node-processes';
import { failSelfTest, type SelfTestDriver, startSelfTest } from './selftest';
import { applySelfTestConfig } from './selftest-config';
import { runModeOf } from './run-mode';
import { resolveTheme } from './themes/theme-loader';
import {
  titleBarOverlayOf,
  titleBarOverlayProblem,
  windowBackgroundOf,
} from './title-bar-overlay';
import { loadUiStateFile, type UiStateFile } from './ui-state/ui-state-file';
import {
  createMainWindow,
  registerWindowCommands,
  windowService,
} from './window';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// The self-test and a drive run render offscreen as an accessory app on a
// temp home, so neither takes the user's foreground or touches their files.
const runMode = runModeOf(process.env);

registerDataScheme();

// Read while the app gets ready, and applied before any plugin starts. A
// terminal start, the self-test and a drive run keep the PATH of the shell
// that ran them and stay clear of the user's shell profile.
const loginShellPath = shouldReadLoginShellPath({
  isSelfTest: runMode !== 'live',
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
}

// The user's app: the OS Trash, native alerts and dialogs, Claude Code, and
// links opened in the user's browser.
function liveServices(): ModeServices {
  return {
    trashItem: (file) => shell.trashItem(file),
    forWindow: ({ window, store, homeDir, log }) => ({
      alerts: createElectronAlerts(window, log),
      agentHarnesses: [
        createClaudeCodeHarness({
          command: () =>
            expandHome(store.current().settings.claude.command, homeDir),
          permissionTool: CLAUDE_PERMISSION_TOOL,
          env: process.env,
          log,
          spawn,
          files,
          homeDir,
        }),
      ],
      window: windowService(window),
      openExternal: gateExternalLinks((url) => shell.openExternal(url)),
    }),
  };
}

// The self-test: every file sits in the temp home folder, so trash deletes
// for good and the user's Trash collects nothing; alerts are silent, sessions
// run over the fake harness, the offscreen window shows no dialog, and no link
// takes the user's foreground.
function selfTestServices(): ModeServices {
  return {
    trashItem: (file) => rm(file, { recursive: true }),
    forWindow: ({ window, log }) => ({
      alerts: silentAlerts,
      agentHarnesses: [createFakeAgentHarness()],
      window: { ...windowService(window), chooseFolder: async () => null },
      openExternal: gateExternalLinks(async (url) =>
        log('main', `external link not opened in the self-test: ${url}`),
      ),
    }),
  };
}

const servicesByMode: Record<RunMode, () => ModeServices> = {
  live: liveServices,
  selfTest: selfTestServices,
  drive: selfTestServices,
};
const modeServices = servicesByMode[runMode]();

const files = createNodeFiles({ trashItem: modeServices.trashItem });
const processes = createNodeProcesses();
const clock: Clock = { now: () => Date.now() };
const randomHex: RandomHex = () => randomBytes(4).toString('hex');
const randomUuid: RandomUuid = () => randomUUID();

// The self-test and a drive run give plugins a fresh temp folder as the home
// folder, and their data folders inside it, never the user's; the self-test
// deletes it before it exits.
let tempHome: string | null = null;
const cleanUpSelfTest = () => {
  if (tempHome !== null) {
    rmSync(tempHome, { recursive: true, force: true });
  }
};

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// Every line main logs to the page, from before the window exists on. A line
// waits while the page loads; with the window or its page destroyed, a line is
// dropped.
const pageLog = createPageLog((source, message) => {
  if (mainWindow !== null) {
    livePage(mainWindow)?.send(BRIDGE_CHANNELS.log, source, message);
  }
});

// What the window and the plugins start from besides the config, read once
// the app is ready so that a bad manifest or temp folder fails the start
// through failStart.
interface StartInputs {
  homeDir: string;
  dataRoot: string;
  uiStatePath: string;
}

// The OS as the served config names it.
const platform: Platform =
  process.platform === 'darwin'
    ? 'macos'
    : process.platform === 'win32'
      ? 'windows'
      : 'linux';

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
  if (platform === 'macos') {
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

function homeFolder(): string {
  if (runMode === 'live') {
    return os.homedir();
  }
  tempHome = mkdtempSync(path.join(os.tmpdir(), 'wigley-forms-selftest-'));
  return tempHome;
}

// The folder that holds every plugin's data folder; outside a live run it sits
// inside the temp home folder, so `homeFolder` runs first.
function dataFolder(): string {
  return tempHome === null
    ? path.join(app.getPath('userData'), 'plugins')
    : path.join(tempHome, 'plugin-data');
}

// The app's ui-state file; outside a live run it sits inside the temp home
// folder beside the plugin data, so `homeFolder` runs first.
function uiStateFilePath(): string {
  return tempHome === null
    ? path.join(app.getPath('userData'), 'ui-state.json')
    : path.join(tempHome, 'ui-state.json');
}

function readStartInputs(): StartInputs {
  requireListed(mainParts, manifests);
  const homeDir = homeFolder();
  return { homeDir, dataRoot: dataFolder(), uiStatePath: uiStateFilePath() };
}

// The ConfigStore over the user config folder in `homeDir`, logging to the
// page.
function loadConfig(homeDir: string): Promise<ConfigStore> {
  return loadConfigStore({
    files,
    folder: path.join(homeDir, '.config', 'wigley-ai-gui'),
    defaults: defaultSettings,
    optionalSettings,
    settingChoices,
    coreKeymap,
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
    log: pageLog.log,
  });
}

// The window's page, or null once the window or its page is destroyed, as on
// quit, when a part's dispose may still send to it.
function livePage(window: BrowserWindow): WebContents | null {
  const isGone = window.isDestroyed() || window.webContents.isDestroyed();
  return isGone ? null : window.webContents;
}

// Serves the ui-state file at `filePath` to the page. It loads on the page's
// first read, when the page already hears the log, and is kept, so a reload
// reads main's copy, the newest. On quit a pending change starts to write;
// Electron does not wait for it, so a change made just before quit may be
// lost.
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
  app.on('will-quit', () => void loaded?.flush());
}

// Starts every plugin's main part, each with its own API over one plugin
// channel router to the window's page, the settings `store` serves with no
// self-test layer, one event bus, the shared `services`,
// its own host from `selfTest` (null outside the self-test), no drive host,
// and its data folder under `dataRoot`. `onStarted` sees each part as it starts, so a part
// is known even when a later start throws.
function startMainParts(
  window: BrowserWindow,
  store: ConfigStore,
  dataRoot: string,
  services: Omit<MainServices, 'selfTest'>,
  selfTest: SelfTestDriver | null,
  onStarted: (part: MainStart<PluginManifest>) => void,
) {
  const channels = createPluginChannels(ipcMain, () => livePage(window));
  const bus = createEventBus();
  return startPlugins(
    mainParts,
    (part, dependency) => {
      const started = part.start(
        createMainApi(part.manifest, {
          channels,
          pluginSettings: () => store.current().pluginSettings,
          onPluginSettingsChanged: (listener) =>
            store.onChanged((config) => listener(config.pluginSettings)),
          services,
          selfTestFor: (pluginId) => selfTest?.hostFor(pluginId) ?? null,
          driveFor: () => null,
          dependency,
          bus,
          dataRoot,
        }),
      );
      onStarted(started);
      return started;
    },
    manifests,
  );
}

function registerPartCommands(
  commands: MainCommands,
  started: ReadonlyMap<string, MainStart<PluginManifest>>,
) {
  for (const [pluginId, part] of started) {
    for (const [short, handler] of Object.entries<(chord: string) => void>(
      part.commands,
    )) {
      commands.register(qualify(pluginId, short), handler);
    }
  }
}

// Starts every part's dispose at once, in start order. Electron does not wait
// for the returned promise, so the app may exit before a dispose finishes.
function disposeParts(parts: readonly MainStart<PluginManifest>[]) {
  return Promise.allSettled(parts.map(async (part) => part.dispose?.()));
}

// The window's size is read once: the one window hides rather than closes,
// so a new size applies at the next start. Its background and title bar
// overlay follow the theme and the effective transparency.
function createWindow(inputs: StartInputs, store: ConfigStore) {
  const startConfig = store.current();
  const window = createMainWindow(
    startConfig.settings.window,
    windowBackgroundOf(startConfig.theme, isTransparencyReduced(startConfig)),
    runMode !== 'live',
    titleBarOptions(startConfig, pageLog.log),
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
    const config = store.current();
    const isReduced = isTransparencyReduced(config);
    window.setBackgroundColor(windowBackgroundOf(config.theme, isReduced));
    if (platform === 'macos') {
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
          scopedFiles(files, inputs.homeDir),
          cleanUpSelfTest,
          path.join(app.getAppPath(), '.selftest', 'screenshots'),
        )
      : null;
  // On a normal quit, will-quit disposes the parts that started; a failed
  // start exits through failStart, which skips will-quit.
  const startedParts: MainStart<PluginManifest>[] = [];
  app.on('will-quit', () => void disposeParts(startedParts));
  const started = startMainParts(
    window,
    store,
    inputs.dataRoot,
    {
      files,
      processes,
      log,
      clock,
      randomHex,
      randomUuid,
      homeDir: inputs.homeDir,
      runMode,
      ...modeServices.forWindow({
        window,
        store,
        homeDir: inputs.homeDir,
        log,
      }),
    },
    selfTest,
    (part) => startedParts.push(part),
  );
  // The config needs the page binds and settings of the scripts the plugins
  // handed the self-test.
  const selfTestConfig = selfTest?.closeHandover() ?? {
    pageBinds: [],
    settings: {},
  };

  const commands: MainCommands = new CommandRegistry<string>();
  registerWindowCommands(commands, window, log);
  registerPartCommands(commands, started);
  // Read at each request, so a page reload after a config edit starts on the
  // current config.
  const served = () => applySelfTestConfig(store.current(), selfTestConfig);
  const startServed = served();
  ipcMain.handle(BRIDGE_CHANNELS.config, () => served());
  serveUiState(inputs.uiStatePath, log);
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
      if (runMode === 'live' && hasPageLoaded) {
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
  window.webContents.once('did-finish-load', () => {
    hasPageLoaded = true;
    registerGlobalShortcuts(served().keymap.global, commands, log);
  });
  // The window holds every open round, so on macOS closing it hides it
  // until the app quits.
  window.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
}

// Shows why the app could not start, and exits non-zero.
function failStart(error: unknown) {
  if (runMode === 'selfTest') {
    failSelfTest('the app starts', error, cleanUpSelfTest);
    return;
  }
  dialog.showErrorBox('wigley-ai-gui could not start', errorText(error));
  app.exit(1);
}

function startApp() {
  if (process.platform === 'win32') {
    // Windows shows a toast only for an app with an AppUserModelID.
    app.setAppUserModelId(process.execPath);
  }
  if (runMode !== 'live' && process.platform === 'darwin') {
    app.setActivationPolicy('accessory');
  }
  // A second start (a relay starting the app) shows the window without
  // taking the user's focus.
  app.on('second-instance', () => mainWindow?.showInactive());
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
      const inputs = readStartInputs();
      const store = await loadConfig(inputs.homeDir);
      serveDataScheme(inputs.dataRoot);
      createWindow(inputs, store);
      // After createWindow's will-quit, so the parts dispose before it.
      app.on('will-quit', () => store.dispose());
      app.on('activate', () => mainWindow?.show());
    })
    .catch(failStart);
  app.on('will-quit', () => globalShortcut.unregisterAll());
  // Quit when the window closes, except on macOS, where closing hides it.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

// The self-test and a drive run run beside the user's own app, so they take
// no lock.
if (runMode !== 'live' || app.requestSingleInstanceLock()) {
  startApp();
} else {
  app.quit();
}
