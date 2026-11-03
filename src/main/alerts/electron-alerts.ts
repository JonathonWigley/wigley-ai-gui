import {
  app,
  type BrowserWindow,
  type NativeImage,
  nativeImage,
  Notification,
} from 'electron';
import type { Alerts } from '../../contracts/alerts';
import type { Log } from '../../contracts/log';
import { createOpenCounts } from './open-counts';

const OVERLAY_SIZE = 16;
// Catppuccin Mocha red in the BGRA byte order createFromBitmap reads.
const OVERLAY_DOT_BGRA = [0xa8, 0x8b, 0xf3, 0xff];

// A filled dot for the Windows taskbar overlay, which has no count badge.
function overlayDot(): NativeImage {
  const bitmap = Buffer.alloc(OVERLAY_SIZE * OVERLAY_SIZE * 4);
  const centre = (OVERLAY_SIZE - 1) / 2;
  const radius = OVERLAY_SIZE / 2 - 2;
  for (let y = 0; y < OVERLAY_SIZE; y++) {
    for (let x = 0; x < OVERLAY_SIZE; x++) {
      const isInside = (x - centre) ** 2 + (y - centre) ** 2 <= radius ** 2;
      if (isInside) {
        bitmap.set(OVERLAY_DOT_BGRA, (y * OVERLAY_SIZE + x) * 4);
      }
    }
  }
  return nativeImage.createFromBitmap(bitmap, {
    width: OVERLAY_SIZE,
    height: OVERLAY_SIZE,
  });
}

// Electron throws on a call to a destroyed window, as at quit.
function hasLiveTaskbarButton(window: BrowserWindow) {
  return process.platform === 'win32' && !window.isDestroyed();
}

// For when no notification can show: unsigned macOS builds emit `failed`.
function drawAttention(window: BrowserWindow) {
  if (process.platform === 'darwin') {
    app.dock?.bounce('informational');
  } else if (hasLiveTaskbarButton(window)) {
    window.flashFrame(true);
  }
}

export function createElectronAlerts(window: BrowserWindow, log: Log): Alerts {
  // A notification nothing references is collected, and its click never fires.
  const shown = new Set<Notification>();
  const dot = process.platform === 'win32' ? overlayDot() : null;
  const openCounts = createOpenCounts();
  if (process.platform === 'win32') {
    window.on('focus', () => window.flashFrame(false));
  }
  return {
    announce(title, body, onClick) {
      if (!Notification.isSupported()) {
        drawAttention(window);
        return;
      }
      const notification = new Notification({ title, body });
      shown.add(notification);
      notification.on('click', () => {
        shown.delete(notification);
        onClick();
      });
      // On Windows a toast that times out moves to the Action Center, where it can still be clicked.
      notification.on('close', (event) => {
        if (event.reason !== 'timedOut') {
          shown.delete(notification);
        }
      });
      notification.on('failed', (_event, error) => {
        shown.delete(notification);
        log('alerts', `notification failed: ${error}`);
        drawAttention(window);
      });
      notification.show();
    },
    setOpenCount(source, count) {
      const total = openCounts.set(source, count);
      if (process.platform === 'darwin') {
        app.setBadgeCount(total);
      } else if (hasLiveTaskbarButton(window)) {
        const description =
          total === 0
            ? ''
            : total === 1
              ? '1 open agent form'
              : `${total} open agent forms`;
        window.setOverlayIcon(total > 0 ? dot : null, description);
      }
    },
  };
}
