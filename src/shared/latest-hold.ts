import type { Disposable } from '../contracts/disposable';

// One value many holders set: `hold` applies its value, the latest handle's
// `dispose` applies `released`, and an older handle's `dispose` does nothing.
export function createLatestHold<T>(
  released: T,
  apply: (value: T) => void,
): { hold(value: T): Disposable } {
  let latest: Disposable | null = null;
  return {
    hold(value) {
      apply(value);
      const handle: Disposable = {
        dispose() {
          if (latest === handle) {
            latest = null;
            apply(released);
          }
        },
      };
      latest = handle;
      return handle;
    },
  };
}
