import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  dialog,
} from 'electron';
import path from 'node:path';
import type { Log } from '../contracts/log';
import type { MainServices } from '../contracts/plugin';
import type { Settings } from '../contracts/settings';
import { refusesFrameNavigation } from '../shared/visual-url';
import type { MainCommands } from './keybindings';

// `title` is the window's title, the name the app shows, held over any title
// the page sets; `offscreen` renders without showing the window or taking
// focus; `backgroundColor` shows before the page paints; `titleBar` hides the
// native title bar the platform's way, keeping the OS window buttons. The
// window stays on the app's page: a navigation the page starts to another URL,
// such as Chromium opening a file dropped on the window, is refused and logged.
// A frame inside the page stays on the `wigley-visual:` scheme: a frame
// navigation off it is refused and logged.
export function createMainWindow(
  settings: Settings['window'],
  title: string,
  backgroundColor: string,
  offscreen: boolean,
  titleBar: Pick<
    BrowserWindowConstructorOptions,
    'titleBarStyle' | 'titleBarOverlay'
  >,
  log: Log,
): BrowserWindow {
  const window = new BrowserWindow({
    ...titleBar,
    title,
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
  // Electron otherwise replaces the window title with the page's `<title>`.
  window.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  window.webContents.on('will-navigate', (event) => {
    if (!isSamePage(event.url, window.webContents.getURL())) {
      event.preventDefault();
      log('main', `navigation refused: ${event.url}`);
    }
  });
  window.webContents.on('will-frame-navigate', (details) => {
    if (refusesFrameNavigation(details)) {
      details.preventDefault();
      log('main', `frame navigation refused: ${details.url}`);
    }
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

// Whether `target` is the page at `current`, apart from its hash, as a page
// reload is.
function isSamePage(target: string, current: string): boolean {
  return withoutHash(target) === withoutHash(current);
}

function withoutHash(url: string): string {
  const hashAt = url.indexOf('#');
  return hashAt === -1 ? url : url.slice(0, hashAt);
}

// Plugins' window service: `show` shows the window and gives it focus, for a
// user's own act such as clicking a notification; `isFocused` reads whether
// the window has focus; `chooseFolder` opens the native folder dialog over the
// window and resolves to the chosen folder, or null when the user cancels;
// `capture` resolves to a PNG of the window's content as shown, and rejects
// when the capture is empty. A call can arrive after the window is destroyed,
// as on quit: `show` does nothing, `isFocused` is false, `chooseFolder` resolves
// to null and `capture` rejects.
export function windowService(window: BrowserWindow): MainServices['window'] {
  return {
    show: () => {
      if (window.isDestroyed()) {
        return;
      }
      window.show();
      window.focus();
    },
    isFocused: () => !window.isDestroyed() && window.isFocused(),
    chooseFolder: async () => {
      if (window.isDestroyed()) {
        return null;
      }
      const chosen = await dialog.showOpenDialog(window, {
        properties: ['openDirectory', 'createDirectory'],
      });
      return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
    },
    capture: async () => {
      if (window.isDestroyed()) {
        throw new Error('Window capture is empty: the window is destroyed');
      }
      const image = await window.webContents.capturePage();
      if (image.isEmpty()) {
        throw new Error('Window capture is empty');
      }
      return image.toPNG();
    },
  };
}

export function registerWindowCommands(
  commands: MainCommands,
  window: BrowserWindow,
  log: Log,
) {
  commands.register('window.summon', (chord) => {
    if (window.isDestroyed()) {
      return;
    }
    // A hidden app stays inactive behind the frontmost app unless activated.
    app.show();
    window.show();
    app.focus({ steal: true });
    log('global', `${chord} summoned the window`);
  });
}
