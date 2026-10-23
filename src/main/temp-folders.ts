import type { Platform } from '../contracts/platform';

// macOS links `/tmp` to `/private/tmp`, and its `os.tmpdir()` is a third
// folder apart from both.
const POSIX_TEMP_FOLDERS = ['/tmp', '/private/tmp'];

// The OS's temporary folders on `platform`, given the real path of its own
// temp folder `osTemp`: on macOS and Linux that folder, `/tmp` and
// `/private/tmp`; on Windows that folder alone.
export function tempFolders(osTemp: string, platform: Platform): string[] {
  if (platform === 'windows') {
    return [osTemp];
  }
  return [...new Set([osTemp, ...POSIX_TEMP_FOLDERS])];
}
