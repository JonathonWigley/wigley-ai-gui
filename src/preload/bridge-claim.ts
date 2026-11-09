import type { Bridge } from '../contracts/bridge';

// Hands out the Bridge to the first caller of `claim()` alone.
export function bridgeClaim(bridge: Bridge): { claim(): Bridge } {
  let unclaimed: Bridge | null = bridge;
  return {
    claim: () => {
      if (unclaimed === null) {
        throw new Error('the bridge was already claimed');
      }
      const claimed = unclaimed;
      unclaimed = null;
      return claimed;
    },
  };
}
