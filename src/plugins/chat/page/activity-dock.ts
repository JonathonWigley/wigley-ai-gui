import type { ChatEntry } from '../../../contracts/agent';
import type { Clock, Timers } from '../../../contracts/ambient';
import type {
  DoneWorkingInput,
  LiveWorkingInput,
  WorkingInput,
} from '../layouts/layout';
import { isStepsChanged } from './activity-runs';
import { doneInput, isTurnEmpty, workingInput } from './working-turn';

export interface ActivityDockDeps {
  clock: Clock;
  timers: Timers;
  // Runs each time what the dock shows changes, and once a second with a new `now` while the dock is live; null
  // hides the dock.
  changed(input: WorkingInput | null): void;
}

// The activity dock's data: what the composer's working slot shows for one session. While the session works, the
// dock is live (`workingInput`), sent again only when its steps (by identity), state or start change, and once a
// second with a new `now`; a live dock is held as shown while the turn holds no entries, so a turn's last result
// leaves it running until the session goes idle. Once idle, the dock shows the turn's finished line (`doneInput`)
// whenever any of its fields change, or hides (null) when no result follows the user's last message. Done and hidden
// never tick.
export interface ActivityDock {
  // The session's entries after a change and whether the session works on its turn.
  set(entries: readonly ChatEntry[], working: boolean): void;
  // What the dock shows now; null while hidden.
  input(): WorkingInput | null;
  // Clears the tick.
  dispose(): void;
}

const TICK_MS = 1000;

export function createActivityDock(deps: ActivityDockDeps): ActivityDock {
  let shown: WorkingInput | null = null;
  let tick: number | null = null;

  const show = (next: WorkingInput | null) => {
    shown = next;
    deps.changed(next);
  };

  // Sends the live input with the time now, and arms the next tick while the
  // dock is still live.
  const runTick = () => {
    tick = null;
    if (!isLive(shown)) {
      return;
    }
    show({ ...shown, now: deps.clock.now() });
    if (isLive(shown)) {
      tick = deps.timers.set(runTick, TICK_MS);
    }
  };

  const clearTick = () => {
    if (tick !== null) {
      deps.timers.clear(tick);
      tick = null;
    }
  };

  const setWorking = (entries: readonly ChatEntry[]) => {
    const isHeld = isLive(shown) && isTurnEmpty(entries);
    if (isHeld) {
      return;
    }
    const next = workingInput(entries, deps.clock.now());
    if (!isLive(shown) || isLiveChanged(shown, next)) {
      show(next);
    }
    if (tick === null) {
      tick = deps.timers.set(runTick, TICK_MS);
    }
  };

  const setIdle = (entries: readonly ChatEntry[]) => {
    clearTick();
    const next = doneInput(entries);
    if (isShownChanged(shown, next)) {
      show(next);
    }
  };

  return {
    set(entries, working) {
      if (working) {
        setWorking(entries);
      } else {
        setIdle(entries);
      }
    },
    input: () => shown,
    dispose: clearTick,
  };
}

function isLive(input: WorkingInput | null): input is LiveWorkingInput {
  return input !== null && input.state !== 'done';
}

// Whether a dock showing `last` shows something else with `next`, idle.
function isShownChanged(
  last: WorkingInput | null,
  next: DoneWorkingInput | null,
): boolean {
  if (last === null || next === null) {
    return last !== next;
  }
  return last.state !== 'done' || isDoneChanged(last, next);
}

// Whether a live dock drawn with `last` shows something else with `next`. `now`
// changes only on a tick.
function isLiveChanged(
  last: LiveWorkingInput,
  next: LiveWorkingInput,
): boolean {
  return (
    isStepsChanged(last.steps, next.steps) ||
    last.state !== next.state ||
    last.startedAt !== next.startedAt
  );
}

function isDoneChanged(
  last: DoneWorkingInput,
  next: DoneWorkingInput,
): boolean {
  return (
    isStepsChanged(last.steps, next.steps) ||
    last.startedAt !== next.startedAt ||
    last.endedAt !== next.endedAt ||
    last.stopReason !== next.stopReason ||
    last.costUsd !== next.costUsd
  );
}
