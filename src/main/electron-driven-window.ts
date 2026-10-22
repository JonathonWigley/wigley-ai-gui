import type {
  BrowserWindow,
  Event,
  NativeImage,
  Rectangle,
  WebContentsConsoleMessageEventParams,
} from 'electron';
import type { ConsoleMessage, DrivenWindow } from './drive/driven-window';

// The Electron adapter of `DrivenWindow`. `paint` fires only for an offscreen
// window, so over a visible window `hasPaintedSinceNavigation` stays false and
// `onFrame` hears nothing; self-test and drive windows are offscreen
// (window.ts).
export function electronDrivenWindow(window: BrowserWindow): DrivenWindow {
  const { webContents } = window;
  let hasPainted = false;
  webContents.on('did-navigate', () => {
    hasPainted = false;
  });
  webContents.on('paint', () => {
    hasPainted = true;
  });
  return {
    sendInput: (input) => webContents.sendInputEvent(input),
    run: (script) => webContents.executeJavaScript(script),
    async capture(box) {
      const image = await webContents.capturePage(box, { stayHidden: true });
      return image.isEmpty() ? null : image.toPNG();
    },
    contentSize() {
      const [width, height] = window.getContentSize();
      return { width, height };
    },
    minimumWidth: () => window.getMinimumSize()[0],
    setContentWidth(width) {
      const [, height] = window.getContentSize();
      window.setContentSize(width, height);
    },
    setSize: (width, height) => window.setContentSize(width, height),
    focus: () => webContents.focus(),
    hasPaintedSinceNavigation: () => hasPainted,
    onFrame(listener) {
      const onPaint = (
        _event: unknown,
        _dirty: Rectangle,
        image: NativeImage,
      ) => listener(() => image.toPNG(), Date.now());
      webContents.on('paint', onPaint);
      return { dispose: () => webContents.off('paint', onPaint) };
    },
    onConsole(listener) {
      const onMessage = (
        details: Event<WebContentsConsoleMessageEventParams>,
      ) => {
        const message: ConsoleMessage = {
          level: details.level,
          text: details.message,
          source: `${details.sourceId}:${details.lineNumber}`,
        };
        listener(message);
      };
      webContents.on('console-message', onMessage);
      return { dispose: () => webContents.off('console-message', onMessage) };
    },
  };
}
