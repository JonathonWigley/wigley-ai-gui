// Composition root for the main process: the one module that picks adapters
// and config, and wires them to each other.
import {
  app,
  type BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  type WebContents,
} from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { coreCommands, coreKeymap } from '../config/keymap';
import { defaultSettings } from '../config/settings';
import { builtInThemes } from '../config/themes';
import type { Clock, RandomHex } from '../contracts/ambient';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import type { Keymap, PageBind } from '../contracts/keymap';
import type { Log } from '../contracts/log';
import type {
  MainServices,
  MainStart,
  PluginManifest,
  SelfTestHost,
} from '../contracts/plugin';
import type { AppConfig } from '../contracts/settings';
import { mainParts } from '../plugins/main';
import { manifests } from '../plugins/manifests';
import { CommandRegistry } from '../shared/command-registry';
import { startPlugins } from '../shared/plugin-host';
import {
  commandInfos,
  mergeKeymap,
  pluginSettings,
  qualify,
  requireListed,
} from '../shared/plugin-manifests';
import { createElectronAlerts } from './alerts/electron-alerts';
import { silentAlerts } from './alerts/silent-alerts';
import {
  installWindowKeybindings,
  type MainCommands,
  registerGlobalShortcuts,
} from './keybindings';
import { createMainApi } from './plugins/main-api';
import { createPluginChannels } from './plugins/plugin-channel';
import { failSelfTest, startSelfTest } from './selftest';
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

const theme = chooseTheme(
  defaultSettings.theme,
  builtInThemes,
  path.join(app.getPath('userData'), 'themes'),
);
requireListed(mainParts, manifests);
const settingsByPlugin = pluginSettings(manifests);
const commandsById = commandInfos(coreCommands, manifests);
const clock: Clock = { now: () => Date.now() };
const randomHex: RandomHex = () => randomBytes(4).toString('hex');
// The self-test gives plugins a fresh temp folder as the home folder, never
// the user's, and deletes it before it exits.
const homeDir = isSelfTest
  ? mkdtempSync(path.join(os.tmpdir(), 'wigley-forms-selftest-'))
  : os.homedir();
const cleanUpSelfTest = () => rmSync(homeDir, { recursive: true, force: true });

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function pageLog(page: WebContents): Log {
  return (source, message) => page.send(BRIDGE_CHANNELS.log, source, message);
}

// `selfTestBinds` are the self-test script's page binds, after every plugin's.
function buildConfig(selfTestBinds: PageBind[]): AppConfig {
  const merged = mergeKeymap(coreKeymap, manifests);
  const keymap: Keymap = {
    ...merged,
    page: [...merged.page, ...selfTestBinds],
  };
  return {
    settings: defaultSettings,
    keymap,
    commands: commandsById,
    pluginSettings: settingsByPlugin,
    theme,
  };
}

// Starts every plugin's main part, each with its own API over one plugin
// channel router to the window's page. `onStarted` sees each part as it
// starts, so a part is known even when a later start throws.
function startMainParts(
  window: BrowserWindow,
  services: MainServices,
  onStarted: (part: MainStart<PluginManifest>) => void,
) {
  const channels = createPluginChannels(ipcMain, () => window.webContents);
  return startPlugins(mainParts, (part, dependency) => {
    const started = part.start(
      createMainApi(part.manifest, {
        channels,
        settings: settingsByPlugin[part.manifest.id],
        services,
        dependency,
      }),
    );
    onStarted(started);
    return started;
  });
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

function createWindow() {
  const window = createMainWindow(
    defaultSettings.window,
    theme.theme.tokens['bg.base'],
    isSelfTest,
  );
  mainWindow = window;
  const log = pageLog(window.webContents);

  const selfTest = isSelfTest ? startSelfTest(window, cleanUpSelfTest) : null;
  const selfTestHost: SelfTestHost | null = selfTest && {
    run: (script) => selfTest.run(script),
  };
  // Registered before any part starts, so the parts that did start are
  // disposed even when a later start throws.
  const startedParts: MainStart<PluginManifest>[] = [];
  app.on('will-quit', () => void disposeParts(startedParts));
  const started = startMainParts(
    window,
    {
      log,
      clock,
      randomHex,
      homeDir,
      alerts: isSelfTest ? silentAlerts : createElectronAlerts(window, log),
      window: windowService(window),
      selfTest: selfTestHost,
    },
    (part) => startedParts.push(part),
  );
  // The config needs the page binds of the script a plugin handed the self-test.
  const selfTestBinds = selfTest?.closeHandover() ?? [];

  const commands: MainCommands = new CommandRegistry<string>();
  registerWindowCommands(commands, window, log);
  registerPartCommands(commands, started);
  const config = buildConfig(selfTestBinds);
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
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox('wigley-ai-gui could not start', message);
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
      createWindow();
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
