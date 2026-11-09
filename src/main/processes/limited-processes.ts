import type {
  ProcessResult,
  ProcessRunner,
  ProcessRunOptions,
} from '../../contracts/processes';

interface WaitingRun {
  start: () => void;
  stop: () => void;
}

// `runner` with at most `maxRunning` programs running at once; a run past
// that waits its turn, in call order, and its `timeoutMs` counts from its
// start. An abort of `signal` while it waits rejects it with
// `Stopped <command>` without starting the program.
export function limitRuns(
  runner: ProcessRunner,
  maxRunning: number,
): ProcessRunner {
  if (!Number.isInteger(maxRunning) || maxRunning < 1) {
    throw new Error(
      `limitRuns: maxRunning must be a whole number of at least 1, got ${String(maxRunning)}`,
    );
  }
  let running = 0;
  const waiting: WaitingRun[] = [];

  const startNext = () => {
    const next = waiting.shift();
    next?.start();
  };

  return {
    run(
      command: string,
      args: string[],
      options?: ProcessRunOptions,
    ): Promise<ProcessResult> {
      const runNow = async (): Promise<ProcessResult> => {
        running += 1;
        try {
          return await runner.run(command, args, options);
        } finally {
          running -= 1;
          startNext();
        }
      };
      if (running < maxRunning) {
        return runNow();
      }
      return new Promise((resolve, reject) => {
        const signal = options?.signal;
        const turn: WaitingRun = {
          start: () => {
            signal?.removeEventListener('abort', turn.stop);
            runNow().then(resolve, reject);
          },
          stop: () => {
            waiting.splice(waiting.indexOf(turn), 1);
            reject(new Error(`Stopped ${command}`));
          },
        };
        if (signal?.aborted === true) {
          reject(new Error(`Stopped ${command}`));
          return;
        }
        signal?.addEventListener('abort', turn.stop, { once: true });
        waiting.push(turn);
      });
    },
  };
}
