import { type BrowserWindow, type NativeImage, nativeImage } from 'electron';
import type { Alerts } from '../../contracts/alerts';
import { createOpenCounts, describeOpenCounts } from './open-counts';

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

// A taskbar overlay dot.
export function createWindowsAlerts(window: BrowserWindow): Alerts {
  const dot = overlayDot();
  const openCounts = createOpenCounts();
  return {
    setOpenCount(source, count, noun) {
      const { total, parts } = openCounts.set(source, count, noun);
      // Electron throws on a call to a destroyed window, as at quit.
      if (window.isDestroyed()) {
        return;
      }
      window.setOverlayIcon(total > 0 ? dot : null, describeOpenCounts(parts));
    },
  };
}
