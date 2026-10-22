import type { RunMode } from '../contracts/plugin';

// The run mode the environment selects: `PROOF_SELFTEST` set to anything
// non-empty starts the self-test, `WIGLEY_DRIVE_DIR` a drive run in that
// folder, neither the user's app. Setting both throws.
export function runModeOf(env: NodeJS.ProcessEnv): RunMode {
  const isSelfTest = Boolean(env.PROOF_SELFTEST);
  const isDrive = Boolean(env.WIGLEY_DRIVE_DIR);
  if (isSelfTest && isDrive) {
    throw new Error('Set PROOF_SELFTEST or WIGLEY_DRIVE_DIR, not both');
  }
  if (isSelfTest) {
    return 'selfTest';
  }
  return isDrive ? 'drive' : 'live';
}
