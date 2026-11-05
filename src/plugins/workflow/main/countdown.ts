import type { Clock, Timers } from '../../../contracts/ambient';
import type { SessionFlow } from '../contract';
import { heavyStateOf } from '../stages/heavy-contract';

// One timer per session, armed while its flow's `countdownEndsAt` is set.
// `sync` arms the timer for a flow counting down that has none and clears it
// for a flow that stopped; `stop` clears the session's timer. A timer that
// fires is forgotten before `fire` runs, so the next countdown arms anew.
export interface Countdown {
  sync(flow: SessionFlow): void;
  stop(sessionId: string): void;
}

export function createCountdown(deps: {
  timers: Timers;
  clock: Clock;
  fire(sessionId: string): void;
}): Countdown {
  const handles = new Map<string, number>();

  const stop = (sessionId: string) => {
    const handle = handles.get(sessionId);
    if (handle !== undefined) {
      deps.timers.clear(handle);
      handles.delete(sessionId);
    }
  };

  return {
    sync(flow) {
      const { sessionId } = flow;
      const { countdownEndsAt } = heavyStateOf(flow);
      if (countdownEndsAt === null) {
        stop(sessionId);
        return;
      }
      if (handles.has(sessionId)) {
        return;
      }
      const handle = deps.timers.set(
        () => {
          handles.delete(sessionId);
          deps.fire(sessionId);
        },
        Math.max(0, countdownEndsAt - deps.clock.now()),
      );
      handles.set(sessionId, handle);
    },
    stop,
  };
}
