import type { ProcessRunner } from '../../contracts/processes';

// The stdout of `program` run with `args`; rejects naming `program` when it
// times out or, unless `anyExitCode`, exits non-zero, adding the first line of
// its stderr.
export async function requiredStdout(
  processes: ProcessRunner,
  program: string,
  args: string[],
  options: { timeoutMs: number; anyExitCode?: boolean },
): Promise<string> {
  const result = await processes.run(program, args, {
    timeoutMs: options.timeoutMs,
  });
  if (result.timedOut) {
    throw new Error(`${program} timed out`);
  }
  if (result.code !== 0 && options.anyExitCode !== true) {
    const exited = `${program} exited with code ${result.code}`;
    const cause = firstLine(result.stderr);
    throw new Error(cause === undefined ? exited : `${exited}: ${cause}`);
  }
  return result.stdout;
}

function firstLine(text: string): string | undefined {
  return text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
}
