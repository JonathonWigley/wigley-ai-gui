import type { Log } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type {
  ChatComposerPart,
  ComposerStop,
  ComposerStopExits,
} from '../contract';

// One Chat tab's hold on the composer part whose stop took its entry cursor.
// `offer` asks each part with a stop, in order, until one takes the cursor,
// and returns its id; null when none does. A part whose `enter` throws is
// logged, its `leave` called and chat's scope set again, and the next asked.
// An offer while a part holds leaves that part first. `leave` calls the holding part's `leave` once and holds nothing.
// `holding` is the holding part's id, null while none holds. `boxFocused`
// leaves the holding part and sets chat's scope again; `scopeChanged` leaves it
// when the tab is no longer the visible tab. Each does nothing while none
// holds.
export interface ComposerStopHolder {
  offer(parts: readonly ChatComposerPart[]): string | null;
  leave(): void;
  holding(): string | null;
  boxFocused(): void;
  scopeChanged(isVisible: boolean): void;
}

// `name` is the tab's name in log lines. `toEntries` and `toBox` hand the
// cursor back to chat once the holder holds nothing: chat's scope, then the
// last entry or the box. `setChatScope` sets chat's base scope. `changed` runs
// each time the holder starts or stops holding.
export interface ComposerStopHolderDeps {
  sessionId: string;
  name: string;
  toEntries(): void;
  toBox(how: 'insert' | 'append'): void;
  setChatScope(): void;
  changed(holding: boolean): void;
  log: Log;
}

// The part holding the cursor; `exits` are the ones its `enter` was handed.
interface Hold {
  id: string;
  stop: ComposerStop;
  exits: ComposerStopExits;
}

export function createComposerStopHolder(
  deps: ComposerStopHolderDeps,
): ComposerStopHolder {
  const { log, name } = deps;
  let held: Hold | null = null;

  const release = () => {
    held = null;
    deps.changed(false);
  };

  // Exits bound to one `enter`: they act only while that enter's hold is the
  // one held.
  const exitsFor = (): ComposerStopExits => {
    const exits: ComposerStopExits = {
      toEntries() {
        if (held?.exits !== exits) {
          log('chat', `stale composer stop exit in ${name} ignored`);
          return;
        }
        release();
        deps.toEntries();
        log('chat', `cursor back on the entries in ${name}`);
      },
      toBox(how) {
        if (held?.exits !== exits) {
          log('chat', `stale composer stop exit in ${name} ignored`);
          return;
        }
        release();
        deps.toBox(how);
        log('chat', `focused the box in ${name}`);
      },
    };
    return exits;
  };

  const leavePart = (id: string, stop: ComposerStop) => {
    try {
      stop.leave(deps.sessionId);
    } catch (error: unknown) {
      log('chat', `composer part ${id} leave failed: ${errorText(error)}`);
    }
  };

  const leave = () => {
    if (held === null) {
      return;
    }
    const { id, stop } = held;
    held = null;
    leavePart(id, stop);
    log('chat', `composer part ${id} left in ${name}`);
    deps.changed(false);
  };

  const enter = (id: string, stop: ComposerStop): boolean => {
    const exits = exitsFor();
    try {
      if (!stop.enter(deps.sessionId, exits)) {
        return false;
      }
    } catch (error: unknown) {
      log('chat', `composer part ${id} stop failed: ${errorText(error)}`);
      leavePart(id, stop);
      deps.setChatScope();
      return false;
    }
    held = { id, stop, exits };
    deps.changed(true);
    log('chat', `composer part ${id} took the cursor in ${name}`);
    return true;
  };

  return {
    offer(parts) {
      leave();
      for (const part of parts) {
        if (part.stop !== undefined && enter(part.id, part.stop)) {
          return part.id;
        }
      }
      return null;
    },
    leave,
    holding: () => held?.id ?? null,
    boxFocused() {
      if (held === null) {
        return;
      }
      leave();
      deps.setChatScope();
    },
    scopeChanged(isVisible) {
      if (!isVisible) {
        leave();
      }
    },
  };
}
