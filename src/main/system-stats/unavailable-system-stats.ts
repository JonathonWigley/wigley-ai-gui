import type { OsName } from '../../contracts/platform';
import type { SystemStats } from '../../contracts/system-stats';

// The SystemStats of an OS with no adapter: every sample rejects, naming the OS.
export function createUnavailableSystemStats(os: OsName): SystemStats {
  return {
    sample: () =>
      Promise.reject(new Error(`System stats are not available on ${os}`)),
  };
}
