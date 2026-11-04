import type { ProcessActivity } from '../../contracts/agent';
import type { DecodedLine } from './stream-decoder';

// Whether a Claude Code process is working, from the messages written to it
// and the lines it prints; no I/O and no clock.
//
// - `written` opens a message's uuid. A turn opens on a line with
//   `turnStarted` and closes on one with `turnEnded`. Activity is `working`
//   while the turn or any uuid is open, so Claude's own turns show working.
// - The first `turnStarted` line fixes the mode, which `mode` reports and
//   which is `unknown` before it: `lifecycle` when its `capabilities` include
//   `msg_lifecycle_v1`, else `fallback`; the read that fixes `fallback` alone
//   returns `fellBack: true`. The mode never changes after.
// - Lifecycle: a terminal `lifecycle` state closes its uuid; a turn's end
//   returns the command of the uuid `turnOpener` names and closes it and every
//   uuid in `turnMessages`.
// - Fallback, and before any `turnStarted`: a turn's end returns the oldest
//   open uuid's command (null when `turnUnrequested`) and closes every uuid.
// - `interruptAnswered` closes every uuid when no turn is open, and changes
//   nothing while one is. A message the CLI still holds between an interrupted
//   turn's result and its own init is closed too, so activity reads idle in
//   that gap until the init reopens the turn.
// - `abandon` closes the turn and every uuid.

export interface ControlCommand {
  id: 'effort' | 'model' | 'compact';
  value: string;
}

export type TurnLine = Pick<
  DecodedLine,
  | 'turnStarted'
  | 'capabilities'
  | 'lifecycle'
  | 'turnEnded'
  | 'turnUnrequested'
  | 'turnOpener'
  | 'turnMessages'
>;

// `command` is the command of the message whose turn just ended, else null.
export interface TurnRead {
  command: ControlCommand | null;
  fellBack: boolean;
}

export interface TurnTracker {
  written(uuid: string, command: ControlCommand | null): void;
  read(line: TurnLine): TurnRead;
  interruptAnswered(): void;
  // Closes the turn and every open uuid.
  abandon(): void;
  activity(): ProcessActivity;
  mode(): TurnMode;
  isTurnOpen(): boolean;
  // The first open uuid in write order; null when none is open.
  oldestOpen(): string | null;
}

const LIFECYCLE_CAPABILITY = 'msg_lifecycle_v1';
// The lifecycle states that end a message.
export const TERMINAL_STATES: ReadonlySet<string> = new Set([
  'completed',
  'cancelled',
  'discarded',
  'refused',
]);

export type TurnMode = 'unknown' | 'lifecycle' | 'fallback';

export function createTurnTracker(): TurnTracker {
  let turnOpen = false;
  let mode: TurnMode = 'unknown';
  // In write order.
  const open = new Map<string, ControlCommand | null>();

  function endTurn(line: TurnLine): ControlCommand | null {
    turnOpen = false;
    if (mode === 'lifecycle') {
      const command =
        line.turnOpener === null ? null : (open.get(line.turnOpener) ?? null);
      if (line.turnOpener !== null) {
        open.delete(line.turnOpener);
      }
      for (const uuid of line.turnMessages) {
        open.delete(uuid);
      }
      return command;
    }
    const oldest = open.values().next();
    const command =
      line.turnUnrequested || oldest.done === true ? null : oldest.value;
    open.clear();
    return command;
  }

  return {
    written(uuid, command) {
      open.set(uuid, command);
    },
    read(line) {
      let fellBack = false;
      if (line.turnStarted) {
        turnOpen = true;
        if (mode === 'unknown') {
          const hasLifecycle =
            line.capabilities?.includes(LIFECYCLE_CAPABILITY) ?? false;
          mode = hasLifecycle ? 'lifecycle' : 'fallback';
          fellBack = !hasLifecycle;
        }
      }
      if (
        line.lifecycle !== null &&
        TERMINAL_STATES.has(line.lifecycle.state)
      ) {
        open.delete(line.lifecycle.uuid);
      }
      const command = line.turnEnded ? endTurn(line) : null;
      return { command, fellBack };
    },
    interruptAnswered() {
      if (!turnOpen) {
        open.clear();
      }
    },
    abandon() {
      turnOpen = false;
      open.clear();
    },
    activity() {
      return turnOpen || open.size > 0 ? 'working' : 'idle';
    },
    mode() {
      return mode;
    },
    isTurnOpen() {
      return turnOpen;
    },
    oldestOpen() {
      const oldest = open.keys().next();
      return oldest.done === true ? null : oldest.value;
    },
  };
}
