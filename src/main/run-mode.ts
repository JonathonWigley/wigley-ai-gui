import path from 'node:path';

// The agent harness a drive run's sessions use: the fake harness, or Claude
// Code logged in as the user.
export type DriveHarnessName = 'fake' | 'claude';

// What a drive run's system stats read: the fake's fixed machine, or this
// machine's own readings.
export type DriveSystemStatsName = 'fake' | 'live';

// The run the environment selects, with what a drive run reads from it.
export type RunEnvironment =
  | { mode: 'live' | 'selfTest' }
  | {
      mode: 'drive';
      runDir: string;
      harness: DriveHarnessName;
      systemStats: DriveSystemStatsName;
    };

// Reads the run from the environment: `PROOF_SELFTEST` set to anything
// non-empty starts the self-test, `WIGLEY_DRIVE_DIR` a drive run in that
// folder, neither the user's app. A drive run's folder must be absolute, and
// `WIGLEY_DRIVE_HARNESS` names its harness and `WIGLEY_DRIVE_SYSTEM_STATS` its
// system stats, each `fake` when unset. Throws on both
// modes set or on a bad drive value, naming the variable.
export function runEnvironmentOf(env: NodeJS.ProcessEnv): RunEnvironment {
  const isSelfTest = Boolean(env.PROOF_SELFTEST);
  const isDrive = Boolean(env.WIGLEY_DRIVE_DIR);
  if (isSelfTest && isDrive) {
    throw new Error('Set PROOF_SELFTEST or WIGLEY_DRIVE_DIR, not both');
  }
  if (isSelfTest) {
    return { mode: 'selfTest' };
  }
  if (!isDrive) {
    return { mode: 'live' };
  }
  const runDir = env.WIGLEY_DRIVE_DIR ?? '';
  if (!path.isAbsolute(runDir)) {
    throw new Error('WIGLEY_DRIVE_DIR must be an absolute path');
  }
  const harness = env.WIGLEY_DRIVE_HARNESS ?? 'fake';
  if (harness !== 'fake' && harness !== 'claude') {
    throw new Error(
      `WIGLEY_DRIVE_HARNESS is ${JSON.stringify(harness)}; set it to fake or claude`,
    );
  }
  const systemStats = env.WIGLEY_DRIVE_SYSTEM_STATS ?? 'fake';
  if (systemStats !== 'fake' && systemStats !== 'live') {
    throw new Error(
      `WIGLEY_DRIVE_SYSTEM_STATS is ${JSON.stringify(systemStats)}; set it to fake or live`,
    );
  }
  return { mode: 'drive', runDir, harness, systemStats };
}
