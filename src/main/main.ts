// Composition root for the main process: the one module that picks adapters
// and config, and wires them to each other.
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  type WebContents,
} from 'electron';
import started from 'electron-squirrel-startup';
import { defaultKeymap } from '../config/keymap';
import { defaultSettings } from '../config/settings';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import type { Log } from '../contracts/log';
import type { AppConfig } from '../contracts/settings';
import { CommandRegistry } from '../shared/command-registry';
import {
  installWindowKeybindings,
  type MainCommands,
  registerGlobalShortcuts,
} from './keybindings';
import { registerProofCommands } from './proof-commands';
import { startSelfTest } from './selftest';
import { createMainWindow, registerWindowCommands } from './window';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// The self-test renders offscreen as an accessory app, so it never takes the
// user's foreground.
const isSelfTest = Boolean(process.env.PROOF_SELFTEST);

const config: AppConfig = { settings: defaultSettings, keymap: defaultKeymap };

function pageLog(page: WebContents): Log {
  return (source, message) => page.send(BRIDGE_CHANNELS.log, source, message);
}

ipcMain.handle(BRIDGE_CHANNELS.config, () => config);

const createWindow = () => {
  const window = createMainWindow(config.settings.window, isSelfTest);
  const log = pageLog(window.webContents);

  const commands: MainCommands = new CommandRegistry<string>();
  registerProofCommands(commands, log);
  registerWindowCommands(commands, window, log);
  installWindowKeybindings(window, config.keymap, commands);

  if (isSelfTest) {
    startSelfTest(window);
  } else {
    window.webContents.once('did-finish-load', () =>
      registerGlobalShortcuts(config.keymap.global, commands, log),
    );
  }
  window.on('closed', () => {
    globalShortcut.unregisterAll();
  });
};

if (isSelfTest && process.platform === 'darwin') {
  app.setActivationPolicy('accessory');
}

app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
