import type { OsName } from '../../contracts/platform';
import type { ScreenCapture } from '../../contracts/screen-capture';

// The ScreenCapture of an OS with no adapter: `access` reads `granted`, and
// every call rejects, naming the OS.
export function createUnavailableScreenCapture(os: OsName): ScreenCapture {
  const unavailable = () =>
    Promise.reject(new Error(`Screen capture is not available on ${os}`));
  return {
    access: () => 'granted',
    listWindows: unavailable,
    openAccessSettings: unavailable,
  };
}
