import type { Platform } from '../contracts/platform';

// The `Platform` Node names `nodePlatform`, every OS but macOS and Windows as `linux`.
export function osPlatform(nodePlatform: NodeJS.Platform): Platform {
  if (nodePlatform === 'darwin') {
    return 'macos';
  }
  return nodePlatform === 'win32' ? 'windows' : 'linux';
}
