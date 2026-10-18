import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import type { Log } from '../contracts/log';
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
