import type { ProcessRunner } from '../../../contracts/processes';

// How to run the `teamcity` CLI: the runner, and `teamcity` or the full path of the CLI.
export interface TeamcityCli {
  processes: ProcessRunner;
  command: string;
}

// The one place that runs the CLI: `cli.command` with `args` and `--no-input`, which stops every prompt. Resolves with
// stdout on exit 0. Rejects with `teamcity <first two args> timed out`, or `teamcity <first two args> exited <code>`
// followed by `: <last non-empty stderr line>` when stderr holds one; a run that cannot start rejects with its own error.
export async function runTeamcity(
  cli: TeamcityCli,
  args: readonly string[],
  timeoutMs: number,
): Promise<string> {
  const result = await cli.processes.run(cli.command, [...args, '--no-input'], {
    timeoutMs,
  });
  const name = `teamcity ${args.slice(0, 2).join(' ')}`;
  if (result.timedOut) {
    throw new Error(`${name} timed out`);
  }
  if (result.code !== 0) {
    const reason = lastNonEmptyLine(result.stderr);
    throw new Error(
      reason === null
        ? `${name} exited ${result.code}`
        : `${name} exited ${result.code}: ${reason}`,
    );
  }
  return result.stdout;
}

function lastNonEmptyLine(text: string): string | null {
  const lines = text.split('\n').map((line) => line.trim());
  return lines.findLast((line) => line !== '') ?? null;
}
