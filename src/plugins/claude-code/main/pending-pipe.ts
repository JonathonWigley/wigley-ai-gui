import type { HostedProcess } from '../../../contracts/session-host';

// A session's pipe from its first line, while the real hosted process is still
// to come. Before `attach` its `pid` is null, `write` and `endInput` queue in
// call order, and the first `kill` or `detach` is kept as `stoppedBy`, later
// ones doing nothing. `attach` replays the queue on `real` in order; from then
// every member delegates to `real`.
export interface PendingPipe {
  readonly pipe: HostedProcess;
  attach(real: HostedProcess): void;
  // Why the pipe stopped before `attach`: the signal of the first `kill`,
  // 'detach', or null.
  stoppedBy(): 'SIGTERM' | 'SIGKILL' | 'detach' | null;
}

type QueuedCall = { kind: 'write'; text: string } | { kind: 'endInput' };

export function createPendingPipe(id: string): PendingPipe {
  const queued: QueuedCall[] = [];
  let real: HostedProcess | null = null;
  let stop: 'SIGTERM' | 'SIGKILL' | 'detach' | null = null;

  const pipe: HostedProcess = {
    id,
    get pid() {
      return real === null ? null : real.pid;
    },
    write(text) {
      if (real === null) {
        queued.push({ kind: 'write', text });
      } else {
        real.write(text);
      }
    },
    endInput() {
      if (real === null) {
        queued.push({ kind: 'endInput' });
      } else {
        real.endInput();
      }
    },
    kill(signal) {
      if (real !== null) {
        real.kill(signal);
      } else if (stop === null) {
        stop = signal;
      }
    },
    detach() {
      if (real !== null) {
        real.detach();
      } else if (stop === null) {
        stop = 'detach';
      }
    },
  };

  return {
    pipe,
    attach(attached) {
      real = attached;
      for (const call of queued.splice(0)) {
        if (call.kind === 'write') {
          attached.write(call.text);
        } else {
          attached.endInput();
        }
      }
    },
    stoppedBy: () => stop,
  };
}
