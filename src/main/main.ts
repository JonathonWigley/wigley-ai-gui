// Composition root for the main process: the one module that picks adapters
// and config, and wires them to each other.
import {
  app,
  type BrowserWindow,
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
import { defaultSettings } from '../config/settings';
import { builtInThemes } from '../config/themes';
import { CLAUDE_PERMISSION_TOOL } from '../contracts/agent';
import type { Clock, RandomHex, RandomUuid } from '../contracts/ambient';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import type { Keymap } from '../contracts/keymap';
import type { Log } from '../contracts/log';
import type {
  MainServices,
  MainStart,
  PluginManifest,
} from '../contracts/plugin';
import type { AppConfig } from '../contracts/settings';
import { mainParts } from '../plugins/main';
import { manifests } from '../plugins/manifests';
import { CommandRegistry } from '../shared/command-registry';
import { errorText } from '../shared/error-text';
import { createEventBus } from '../shared/event-bus';
import { expandHome } from '../shared/expand-home';
import { createFakeAgentHarness } from '../shared/fake-agent-harness';
import { startPlugins } from '../shared/plugin-host';
import {
  commandInfos,
  mergeKeymap,
  overrideSettings,
  pluginSettings,
  qualify,
  requireListed,
  scopeInfos,
} from '../shared/plugin-manifests';
import { createElectronAlerts } from './alerts/electron-alerts';
import { silentAlerts } from './alerts/silent-alerts';
import { createClaudeCodeHarness } from './claude-code/claude-code-harness';
import {
  registerDataScheme,
  serveDataScheme,
} from './data-protocol/data-protocol';
import { createNodeFiles } from './files/node-files';
import {
  installWindowKeybindings,
  type MainCommands,
  registerGlobalShortcuts,
} from './keybindings';
import { createMainApi } from './plugins/main-api';
import { createPluginChannels } from './plugins/plugin-channel';
import { createNodeProcesses } from './processes/node-processes';
import { failSelfTest, type SelfTestDriver, startSelfTest } from './selftest';
import type { SelfTestConfig } from './selftest-config';
import { chooseTheme } from './themes/theme-loader';
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

// What the window and the plugins start from, read once the app is ready so
// that a bad manifest, theme or temp folder fails the start through failStart.
interface StartInputs {
  theme: AppConfig['theme'];
  settingsByPlugin: AppConfig['pluginSettings'];
  commandsById: AppConfig['commands'];
  scopes: AppConfig['scopes'];
  homeDir: string;
  dataRoot: string;
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

function readStartInputs(): StartInputs {
  requireListed(mainParts, manifests);
  const homeDir = homeFolder();
  return {
    theme: chooseTheme(
      defaultSettings.theme,
      builtInThemes,
      path.join(app.getPath('userData'), 'themes'),
    ),
    settingsByPlugin: pluginSettings(manifests),
    commandsById: commandInfos(coreCommands, manifests),
    scopes: scopeInfos(coreScopes, manifests),
    homeDir,
    dataRoot: dataFolder(),
  };
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

// `selfTest` adds the self-test scripts' page binds after every plugin's, and
// lays their settings over the plugins'.
function buildConfig(inputs: StartInputs, selfTest: SelfTestConfig): AppConfig {
  const merged = mergeKeymap(coreKeymap, manifests);
  const keymap: Keymap = {
    ...merged,
    page: [...merged.page, ...selfTest.pageBinds],
  };
  return {
    settings: defaultSettings,
    keymap,
    commands: inputs.commandsById,
    scopes: inputs.scopes,
    pluginSettings: overrideSettings(
      inputs.settingsByPlugin,
      selfTest.settings,
    ),
    theme: inputs.theme,
  };
}

// Starts every plugin's main part, each with its own API over one plugin
// channel router to the window's page, one event bus, the shared `services`,
// its own host from `selfTest` (null outside the self-test), and its data
// folder under `dataRoot`. `onStarted` sees each part as it starts, so a part
// is known even when a later start throws.
function startMainParts(
  window: BrowserWindow,
  settingsByPlugin: StartInputs['settingsByPlugin'],
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
          settings: settingsByPlugin[part.manifest.id],
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

function createWindow(inputs: StartInputs) {
  const window = createMainWindow(
    defaultSettings.window,
    inputs.theme.theme.tokens['bg.base'],
    isSelfTest,
  );
  mainWindow = window;
  const log = pageLog(window);

  const selfTest = isSelfTest ? startSelfTest(window, cleanUpSelfTest) : null;
  const pluginWindow = windowService(window);
  // On a normal quit, will-quit disposes the parts that started; a failed
  // start exits through failStart, which skips will-quit.
  const startedParts: MainStart<PluginManifest>[] = [];
  app.on('will-quit', () => void disposeParts(startedParts));
  const started = startMainParts(
    window,
    inputs.settingsByPlugin,
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
              command: expandHome(
                defaultSettings.claude.command,
                inputs.homeDir,
              ),
              permissionTool: CLAUDE_PERMISSION_TOOL,
              env: process.env,
              log,
              spawn,
            }),
          ],
      // An offscreen self-test window can show no dialog.
      window: isSelfTest
        ? { ...pluginWindow, chooseFolder: () => Promise.resolve(null) }
        : pluginWindow,
      // The self-test never takes the user's foreground.
      openExternal: isSelfTest
        ? async (url) =>
            log('main', `external link not opened in the self-test: ${url}`)
        : (url) => shell.openExternal(url),
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
  const config = buildConfig(inputs, selfTestConfig);
  ipcMain.handle(BRIDGE_CHANNELS.config, () => config);
  installWindowKeybindings(window, config.keymap, commands);
  window.on('closed', () => {
    globalShortcut.unregisterAll();
  });

  if (isSelfTest) {
    return;
  }
  window.webContents.once('did-finish-load', () =>
    registerGlobalShortcuts(config.keymap.global, commands, log),
  );
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
    .then(() => {
      const inputs = readStartInputs();
      serveDataScheme(inputs.dataRoot);
      createWindow(inputs);
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
