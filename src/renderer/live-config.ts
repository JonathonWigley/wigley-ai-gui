import type { Disposable } from '../contracts/disposable';
import type { Log } from '../contracts/log';
import type { AppConfig } from '../contracts/settings';
import { errorText } from '../shared/error-text';

// The config the page runs on now. `onChanged` hears each new config with the
// one it replaced, until its `dispose`.
export interface LiveConfig {
  current(): AppConfig;
  onChanged(
    listener: (config: AppConfig, previous: AppConfig) => void,
  ): Disposable;
}

// `replace` sets the current config, then calls each listener with the new
// and previous config in registration order; a listener that throws is logged
// and the rest still run.
export function createLiveConfig(
  initial: AppConfig,
  log: Log,
): LiveConfig & { replace(next: AppConfig): void } {
  let current = initial;
  const listeners = new Set<{
    heard: (config: AppConfig, previous: AppConfig) => void;
  }>();
  return {
    current: () => current,
    onChanged(heard) {
      // Wrapped, so one listener registered twice is two registrations.
      const registration = { heard };
      listeners.add(registration);
      return { dispose: () => listeners.delete(registration) };
    },
    replace(next) {
      const previous = current;
      current = next;
      for (const registration of Array.from(listeners)) {
        try {
          registration.heard(next, previous);
        } catch (error) {
          log('config', `listener failed: ${errorText(error)}`);
        }
      }
    },
  };
}
