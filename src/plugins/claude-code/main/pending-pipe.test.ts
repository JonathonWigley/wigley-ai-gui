import { describe, expect, it } from 'vitest';
import type { HostedProcess } from '../../../contracts/session-host';
import { createPendingPipe } from './pending-pipe';

// A hosted process that records each call it gets.
function recordingProcess(pid: number | null) {
  const calls: string[] = [];
  const process: HostedProcess = {
    id: 'real',
    pid,
    write: (text) => calls.push(`write ${text}`),
    endInput: () => calls.push('endInput'),
    kill: (signal) => calls.push(`kill ${signal}`),
    detach: () => calls.push('detach'),
  };
  return { process, calls };
}

describe('createPendingPipe', () => {
  it('attach_QueuedWritesAndEndInput_ReplayInOrder', () => {
    const pending = createPendingPipe('p-1');
    const real = recordingProcess(42);

    pending.pipe.write('a');
    pending.pipe.endInput();
    pending.pipe.write('b');
    pending.attach(real.process);
    pending.pipe.write('c');

    expect(real.calls).toEqual(['write a', 'endInput', 'write b', 'write c']);
    expect(pending.pipe.id).toBe('p-1');
  });

  it('pid_BeforeAttach_IsNull_AfterAttach_IsReals', () => {
    const pending = createPendingPipe('p-1');

    const before = pending.pipe.pid;
    pending.attach(recordingProcess(42).process);

    expect([before, pending.pipe.pid]).toEqual([null, 42]);
  });

  it('stoppedBy_FirstStopWins', () => {
    const untouched = createPendingPipe('p-1');
    const stopped = createPendingPipe('p-2');

    stopped.pipe.kill('SIGTERM');
    stopped.pipe.kill('SIGKILL');
    stopped.pipe.detach();

    expect([untouched.stoppedBy(), stopped.stoppedBy()]).toEqual([
      null,
      'SIGTERM',
    ]);
  });
});
