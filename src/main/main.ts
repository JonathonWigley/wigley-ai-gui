// Composition root for the main process: the one module that picks adapters
// and config, and wires them to each other.
import {
  app,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
  dialog,
  globalShortcut,
  ipcMain,
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
import type { Theme } from '../contracts/theme';
import type {
  MainServices,
  MainStart,
  PluginManifest,
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
import { createPluginChannels } from './plugins/plugin-channel';
import { createNodeProcesses } from './processes/node-processes';
import { failSelfTest, type SelfTestDriver, startSelfTest } from './selftest';
import { applySelfTestConfig } from './selftest-config';
import { resolveTheme } from './themes/theme-loader';
import { titleBarOverlayOf } from './title-bar-overlay';
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

// The self-test renders offscreen as an accessory app, so it never takes the
// user's foreground.
const isSelfTest = Boolean(process.env.PROOF_SELFTEST);

registerDataScheme();

// Read while the app gets ready, and applied before any plugin starts. A
// terminal start and the self-test keep the PATH of the shell that ran them
// and stay clear of the user's shell profile.
const loginShellPath = shouldReadLoginShellPath({
  isSelfTest,
  parentPid: process.ppid,
})
  ? readLoginShellPath(process.env.SHELL)
  : Promise.resolve(null);

// Every self-test file sits in the temp home folder, and the user's Trash
// must not collect them.
const files = createNodeFiles({
  trashItem: isSelfTest
    ? (file) => rm(file, { recursive: true })
    : (file) => shell.trashItem(file),
});
const processes = createNodeProcesses();
const clock: Clock = { now: () => Date.now() };
const randomHex: RandomHex = () => randomBytes(4).toString('hex');
const randomUuid: RandomUuid = () => randomUUID();

// The self-test gives plugins a fresh temp folder as the home folder, and
// their data folders inside it, never the user's, and deletes it before it
// exits.
let selfTestHome: string | null = null;
const cleanUpSelfTest = () => {
  if (selfTestHome !== null) {
    rmSync(selfTestHome, { recursive: true, force: true });
  }
};

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

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

// macOS keeps its window buttons inset in the page's title bar; Windows and
// Linux draw theirs as an overlay coloured from the theme.
function titleBarOptions(
  theme: Theme,
): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay'> {
  return platform === 'macos'
    ? { titleBarStyle: 'hiddenInset' }
    : { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlayOf(theme) };
}

function homeFolder(): string {
  if (!isSelfTest) {
    return os.homedir();
  }
  selfTestHome = mkdtempSync(path.join(os.tmpdir(), 'wigley-forms-selftest-'));
  return selfTestHome;
}

// The folder that holds every plugin's data folder; in the self-test it sits
// inside the temp home folder, so `homeFolder` runs first.
function dataFolder(): string {
  return selfTestHome === null
    ? path.join(app.getPath('userData'), 'plugins')
    : path.join(selfTestHome, 'plugin-data');
}

// The app's ui-state file; in the self-test it sits inside the temp home
// folder beside the plugin data, so `homeFolder` runs first.
function uiStateFilePath(): string {
  return selfTestHome === null
    ? path.join(app.getPath('userData'), 'ui-state.json')
    : path.join(selfTestHome, 'ui-state.json');
}

function readStartInputs(): StartInputs {
  requireListed(mainParts, manifests);
  const homeDir = homeFolder();
  return { homeDir, dataRoot: dataFolder(), uiStatePath: uiStateFilePath() };
}

// The ConfigStore over the user config folder in `homeDir`. Its log reaches
// the window's page once the window exists; a line before is dropped.
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
      plugins: pluginThemeTokens(manifests),
    },
    resolveTheme,
    platform,
    log: (source, message) => {
      if (mainWindow !== null) {
        pageLog(mainWindow)(source, message);
      }
    },
  });
}

// The window's page, or null once the window or its page is destroyed, as on
// quit, when a part's dispose may still send to it.
function livePage(window: BrowserWindow): WebContents | null {
  const isGone = window.isDestroyed() || window.webContents.isDestroyed();
  return isGone ? null : window.webContents;
}

// With the window's page destroyed, a line is dropped.
function pageLog(window: BrowserWindow): Log {
  return (source, message) =>
    livePage(window)?.send(BRIDGE_CHANNELS.log, source, message);
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
// its own host from `selfTest` (null outside the self-test), and its data
// folder under `dataRoot`. `onStarted` sees each part as it starts, so a part
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

// The window's size and background are read once: the one window hides
// rather than closes, so a new size applies at the next start.
function createWindow(inputs: StartInputs, store: ConfigStore) {
  const startConfig = store.current();
  const window = createMainWindow(
    startConfig.settings.window,
    startConfig.theme.tokens['window-background'],
    isSelfTest,
    titleBarOptions(startConfig.theme),
  );
  mainWindow = window;
  const log = pageLog(window);
  if (platform !== 'macos') {
    store.onChanged((config) => {
      try {
        window.setTitleBarOverlay(titleBarOverlayOf(config.theme));
      } catch (error) {
        log('main', `title bar not recoloured: ${errorText(error)}`);
      }
    });
  }

  const selfTest = isSelfTest
    ? startSelfTest(window, scopedFiles(files, inputs.homeDir), cleanUpSelfTest)
    : null;
  const pluginWindow = windowService(window);
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
      alerts: isSelfTest ? silentAlerts : createElectronAlerts(window, log),
      agentHarnesses: isSelfTest
        ? [createFakeAgentHarness()]
        : [
            createClaudeCodeHarness({
              command: () =>
                expandHome(
                  store.current().settings.claude.command,
                  inputs.homeDir,
                ),
              permissionTool: CLAUDE_PERMISSION_TOOL,
              env: process.env,
              log,
              spawn,
              files,
              homeDir: inputs.homeDir,
            }),
          ],
      // An offscreen self-test window can show no dialog.
      window: isSelfTest
        ? { ...pluginWindow, chooseFolder: () => Promise.resolve(null) }
        : pluginWindow,
      // The self-test never takes the user's foreground.
      openExternal: gateExternalLinks(
        isSelfTest
          ? async (url) =>
              log('main', `external link not opened in the self-test: ${url}`)
          : (url) => shell.openExternal(url),
      ),
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
      if (!isSelfTest && hasPageLoaded) {
        registerGlobalShortcuts(config.keymap.global, commands, log);
      }
      appliedKeymap = keymap;
    } catch (error) {
      log('config', `keys not applied: ${errorText(error)}`);
    }
  });

  if (isSelfTest) {
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
  if (isSelfTest) {
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
  if (isSelfTest && process.platform === 'darwin') {
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

// The self-test runs beside the user's own app, so it takes no lock.
if (isSelfTest || app.requestSingleInstanceLock()) {
  startApp();
} else {
  app.quit();
}
