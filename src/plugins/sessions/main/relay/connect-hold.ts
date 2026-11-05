import type { Timers } from '../../../../contracts/ambient';
import type { PluginLog } from '../../../../contracts/log';

// Stays under the relay's 10 s wait for its hello reply (wigley-ai-marketplace
// `plugins/wigley/scripts/forms/relay.py`).
export const CONNECT_HOLD_MS = 5_000;

// `hold` adds a promise to the running wait, or starts a new wait with its own
// bound when none runs. `ready` resolves once every held promise has settled or
// CONNECT_HOLD_MS after the wait's first `hold`, and at once when no wait runs.
export interface ConnectHold {
  hold(until: Promise<unknown>): void;
  ready(): Promise<void>;
}

interface ConnectWait {
  unsettled: number;
  bound: number;
  ended: Promise<void>;
  end(): void;
}

export function createConnectHold(timers: Timers, log: PluginLog): ConnectHold {
  let running: ConnectWait | null = null;

  function startWait(): ConnectWait {
    let end = () => {};
    const ended = new Promise<void>((resolve) => {
      end = resolve;
    });
    const bound = timers.set(() => {
      log(`relay connects held past ${CONNECT_HOLD_MS} ms; connecting`);
      running = null;
      end();
    }, CONNECT_HOLD_MS);
    return { unsettled: 0, bound, ended, end };
  }

  return {
    hold(until) {
      const wait = running ?? startWait();
      running = wait;
      wait.unsettled += 1;
      const settled = () => {
        wait.unsettled -= 1;
        if (wait.unsettled === 0 && running === wait) {
          timers.clear(wait.bound);
          running = null;
          wait.end();
        }
      };
      until.then(settled, settled);
    },
    ready: () => running?.ended ?? Promise.resolve(),
  };
}
