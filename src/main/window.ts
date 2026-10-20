import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import type { Log } from '../contracts/log';
import type { MainServices } from '../contracts/plugin';
import type { Settings } from '../contracts/settings';
import type { MainCommands } from './keybindings';

// `offscreen` renders without showing the window or taking focus;
// `backgroundColor` shows before the page paints.
export function createMainWindow(
  settings: Settings['window'],
  backgroundColor: string,
  offscreen: boolean,
): BrowserWindow {
  const window = new BrowserWindow({
    width: settings.width,
    height: settings.height,
    minWidth: settings.minWidth,
    minHeight: settings.minHeight,
    backgroundColor,
    show: !offscreen,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      offscreen,
    },
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
  return window;
}

// Plugins' window service: `show` shows the window and gives it focus, for a
// user's own act such as clicking a notification; `isFocused` reads whether
// the window has focus; `chooseFolder` opens the native folder dialog over the
// window and resolves to the chosen folder, or null when the user cancels.
export function windowService(window: BrowserWindow): MainServices['window'] {
  return {
    show: () => {
      window.show();
      window.focus();
    },
    isFocused: () => window.isFocused(),
    chooseFolder: async () => {
      const chosen = await dialog.showOpenDialog(window, {
        properties: ['openDirectory', 'createDirectory'],
      });
      return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
    },
  };
}

export function registerWindowCommands(
  commands: MainCommands,
  window: BrowserWindow,
  log: Log,
) {
  commands.register('window.summon', (chord) => {
    // A hidden app stays inactive behind the frontmost app unless activated.
    app.show();
    window.show();
    app.focus({ steal: true });
    log('global', `${chord} summoned the window`);
  });
}
