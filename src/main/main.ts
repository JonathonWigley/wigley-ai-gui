// Composition root for the main process: the one module that picks adapters
// and config, and wires them to each other.
import {
  app,
  type BrowserWindow,
  globalShortcut,
  ipcMain,
  type WebContents,
} from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { defaultKeymap } from '../config/keymap';
import { defaultSettings } from '../config/settings';
import { builtInThemes } from '../config/themes';
import type { Alerts } from '../contracts/alerts';
import type { Clock, RandomHex } from '../contracts/ambient';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import type { FormsService } from '../contracts/forms';
import type { Log } from '../contracts/log';
import { RELAY_PROTOCOL } from '../contracts/relay';
import type { AppConfig } from '../contracts/settings';
import { CommandRegistry } from '../shared/command-registry';
import { createElectronAlerts } from './alerts/electron-alerts';
import { silentAlerts } from './alerts/silent-alerts';
import { createFormsService } from './forms/forms-service';
import { createRoundStore } from './forms/round-store';
import { FORMS_TOOLS } from './forms/tool-definitions';
import {
  installWindowKeybindings,
  type MainCommands,
  registerGlobalShortcuts,
} from './keybindings';
import { serveMcp } from './mcp/mcp-server';
import {
  channelPath,
  launchCommand,
  writeEndpointFiles,
} from './relay/endpoint';
import { startRelayServer } from './relay/relay-server';
import { SELF_TEST_PAGE_BINDS, startSelfTest } from './selftest';
import { chooseTheme } from './themes/theme-loader';
import { createWindowPresenter } from './window-presenter';
import { createMainWindow, registerWindowCommands } from './window';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// The self-test renders offscreen as an accessory app, so it never takes the
// user's foreground.
const isSelfTest = Boolean(process.env.PROOF_SELFTEST);

const config: AppConfig = {
  settings: defaultSettings,
  keymap: isSelfTest
    ? {
        ...defaultKeymap,
        page: [...defaultKeymap.page, ...SELF_TEST_PAGE_BINDS],
      }
    : defaultKeymap,
  theme: chooseTheme(
    defaultSettings.theme,
    builtInThemes,
    path.join(app.getPath('userData'), 'themes'),
  ),
};

const DEFAULT_DEADLINE_SECONDS = 240;
const clock: Clock = { now: () => Date.now() };
const randomHex: RandomHex = () => randomBytes(4).toString('hex');
const agentsDir = path.join(os.homedir(), '.agents');
// The self-test saves its rounds in a fresh temp folder, never the user's,
// and deletes it before it exits.
const roundsDir = isSelfTest
  ? mkdtempSync(path.join(os.tmpdir(), 'wigley-forms-selftest-'))
  : path.join(agentsDir, 'wigley-forms', 'rounds');

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function pageLog(page: WebContents): Log {
  return (source, message) => page.send(BRIDGE_CHANNELS.log, source, message);
}

ipcMain.handle(BRIDGE_CHANNELS.config, () => config);

function createForms(
  window: BrowserWindow,
  alerts: Alerts,
  log: Log,
): FormsService {
  const store = createRoundStore({ roundsDir, clock, randomHex, log });
  store.prune();
  return createFormsService({
    presenter: createWindowPresenter(window, alerts, log),
    store,
    defaultDeadlineSeconds: DEFAULT_DEADLINE_SECONDS,
  });
}

// Opens the channel relay.py connects to, and tells relays where it is and
// how to start the app.
function openRelayChannel(forms: FormsService, log: Log) {
  const channel = channelPath(
    process.platform,
    os.homedir(),
    os.userInfo().username,
  );
  const relay = startRelayServer({
    channel,
    forms,
    serve: (streams, session) => serveMcp(streams, session, FORMS_TOOLS),
    log,
  });
  writeEndpointFiles(
    path.join(agentsDir, 'wigley-ai-gui'),
    {
      protocol: RELAY_PROTOCOL,
      channel,
      launch: launchCommand(process.env, process.execPath, process.cwd()),
    },
    FORMS_TOOLS,
  );
  app.on('will-quit', () => void relay.close());
}

function createWindow() {
  const window = createMainWindow(
    config.settings.window,
    config.theme.theme.tokens['bg.base'],
    isSelfTest,
  );
  mainWindow = window;
  const log = pageLog(window.webContents);

  const commands: MainCommands = new CommandRegistry<string>();
  registerWindowCommands(commands, window, log);
  installWindowKeybindings(window, config.keymap, commands);
  window.on('closed', () => {
    globalShortcut.unregisterAll();
  });

  const alerts = isSelfTest ? silentAlerts : createElectronAlerts(window, log);
  const forms = createForms(window, alerts, log);
  if (isSelfTest) {
    startSelfTest(window, forms, () =>
      rmSync(roundsDir, { recursive: true, force: true }),
    );
    return;
  }
  openRelayChannel(forms, log);
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
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => mainWindow?.show());
  });
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
