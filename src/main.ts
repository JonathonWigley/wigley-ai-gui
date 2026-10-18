import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { promptAgentProcess } from './agent-client';
import { LOG_CHANNEL, PROMPT_CHANNEL, type LogSource } from './proof-api';
import { startSelfTest } from './selftest';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Chords a browser tab never hands to the page; the app menu claims them.
const CLAIMED_ACCELERATORS = [
  'CommandOrControl+W',
  'CommandOrControl+T',
  'CommandOrControl+N',
  'CommandOrControl+L',
  'CommandOrControl+1',
];

const SUMMON_SHORTCUT = 'Control+Alt+Command+W';

// The self-test renders offscreen as an accessory app, so it never takes the
// user's foreground.
const isSelfTest = Boolean(process.env.PROOF_SELFTEST);

function logToPage(page: WebContents, source: LogSource, message: string) {
  page.send(LOG_CHANNEL, source, message);
}

function buildMenu(window: BrowserWindow): Menu {
  const claimed: MenuItemConstructorOptions[] = CLAIMED_ACCELERATORS.map(
    (accelerator) => ({
      label: `Claim ${accelerator}`,
      accelerator,
      click: () =>
        logToPage(window.webContents, 'menu', `${accelerator} claimed`),
    }),
  );
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Proof', submenu: claimed },
    { role: 'viewMenu' },
  ]);
}

function claimCtrlTab(window: BrowserWindow) {
  window.webContents.on('before-input-event', (event, input) => {
    const isCtrlTabDown =
      input.type === 'keyDown' && input.control && input.key === 'Tab';
    if (!isCtrlTabDown) {
      return;
    }
    event.preventDefault();
    logToPage(window.webContents, 'input', 'Ctrl+Tab caught before the page');
  });
}

function registerSummonShortcut(window: BrowserWindow) {
  const registered = globalShortcut.register(SUMMON_SHORTCUT, () => {
    // A hidden app stays inactive behind the frontmost app unless activated.
    app.show();
    window.show();
    app.focus({ steal: true });
    logToPage(
      window.webContents,
      'global',
      `${SUMMON_SHORTCUT} summoned the window`,
    );
  });
  if (!registered) {
    logToPage(
      window.webContents,
      'global',
      `${SUMMON_SHORTCUT} is taken by another app`,
    );
  }
}

// In dev the mock agent runs on Electron's own Node; the packaged app's
// RunAsNode fuse is off, so this path is dev-only.
function promptMockAgent(page: WebContents, text: string) {
  return promptAgentProcess(
    process.execPath,
    [path.join(__dirname, 'mock-agent.cjs')],
    { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    text,
    (chunk) => logToPage(page, 'acp', chunk),
  );
}

const createWindow = () => {
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    show: !isSelfTest,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      offscreen: isSelfTest,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  Menu.setApplicationMenu(buildMenu(window));
  claimCtrlTab(window);
  if (isSelfTest) {
    startSelfTest(window);
  } else {
    window.webContents.once('did-finish-load', () =>
      registerSummonShortcut(window),
    );
  }
  window.on('closed', () => {
    globalShortcut.unregisterAll();
  });
};

ipcMain.handle(PROMPT_CHANNEL, (event, text: string) =>
  promptMockAgent(event.sender, text),
);

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
