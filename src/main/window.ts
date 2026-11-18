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

// `title` is the window's title, the name the app shows, held over any title
// the page sets; `offscreen` renders without showing the window or taking
// focus; `backgroundColor` shows before the page paints; `titleBar` hides the
// native title bar the platform's way, keeping the OS window buttons. The
// window stays on the app's page: a navigation the page starts to another URL,
// such as Chromium opening a file dropped on the window, is refused and logged.
// A frame inside the page stays on the `wigley-visual:` scheme: a frame
// navigation off it is refused and logged. The window starts empty: the caller
// loads the page with `loadAppPage` once every listener that counts loads is in
// place.
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
      contextIsolation: true,
      sandbox: true,
    },
  });
  // Electron otherwise replaces the window title with the page's `<title>`.
  window.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  // A middle click on a link otherwise opens a second window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    log('main', `window open refused: ${url}`);
    return { action: 'deny' };
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
  return window;
}

// Starts the window's load of the app's page.
export function loadAppPage(window: BrowserWindow): void {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
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
// user's own act such as clicking a notification; `summon` brings a hidden or
// background app forward and returns whether it did; `isFocused` reads whether
// the window has focus; `chooseFolder` opens the native folder dialog over the
// window and resolves to the chosen folder, or null when the user cancels;
// `capture` resolves to a PNG of the window's content as shown, and rejects
// when the capture is empty. A call can arrive after the window is destroyed,
// as on quit: `show` does nothing, `summon` and `isFocused` are false,
// `chooseFolder` resolves to null and `capture` rejects.
export function windowService(window: BrowserWindow): MainServices['window'] {
  return {
    show: () => {
      if (window.isDestroyed()) {
        return;
      }
      window.show();
      window.focus();
    },
    summon: () => {
      if (window.isDestroyed()) {
        return false;
      }
      // A hidden app stays inactive behind the frontmost app unless activated.
      app.show();
      window.show();
      app.focus({ steal: true });
      return true;
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

// The window service of a run beside the user's app, `runName` naming the run
// in the line a `show` or `summon` not done logs: the window stays offscreen and
// the user keeps the foreground, so those two only log, `summon` returning false,
// and `chooseFolder` resolves to null.
export function offscreenWindowService(
  window: BrowserWindow,
  runName: string,
  log: Log,
): MainServices['window'] {
  return {
    ...windowService(window),
    show: () => log('main', `window not shown in ${runName}`),
    summon: () => {
      log('main', `window not summoned in ${runName}`);
      return false;
    },
    chooseFolder: async () => null,
  };
}
