import type { Timers } from '../../contracts/ambient';
import { createRegistrations } from '../registrations';
import { trackedTimers } from '../tracked-timers';

// Timers over the global setTimeout, as a plugin receives them: `vi.useFakeTimers`
// drives them, and a delay reaches the same cap.
export const globalTimers: Timers = trackedTimers(
  {
    // Node's Timeout converts to its numeric id, and `clearTimeout` takes the id.
    set: (run, ms) => setTimeout(run, ms)[Symbol.toPrimitive](),
    clear: (handle) => clearTimeout(handle),
  },
  createRegistrations(),
);
