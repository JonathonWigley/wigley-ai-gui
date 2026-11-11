import type { OsName } from '../../contracts/platform';
import type { ScreenCapture } from '../../contracts/screen-capture';

// The ScreenCapture of an OS with no adapter: every call rejects, naming the OS.
export function createUnavailableScreenCapture(os: OsName): ScreenCapture {
  const unavailable = () =>
    Promise.reject(new Error(`Screen capture is not available on ${os}`));
  return {
    listWindows: unavailable,
    openAccessSettings: unavailable,
  };
}
