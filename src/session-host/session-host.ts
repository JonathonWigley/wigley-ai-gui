import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import type { Clock, Timers } from '../contracts/ambient';
import { osPlatform } from '../shared/os-platform';
import { createDiagnosticLog } from './diagnostic-log';
import { createHostChildren } from './host-children';
import { startSessionHost } from './host-server';
import { createOsProcesses } from './os-processes';

const folder = process.argv[2];
const channel = process.argv[3];

const clock: Clock = { now: () => Date.now() };
const timers: Timers = {
  // Node's Timeout converts to its numeric id, and `clearTimeout` takes the id.
  set: (run, ms) => setTimeout(run, ms)[Symbol.toPrimitive](),
  clear: (handle) => clearTimeout(handle),
};
const diagnostics = createDiagnosticLog(folder, clock);
const children = createHostChildren({
  folder,
  pid: process.pid,
  spawn: (command, args, options) =>
    spawn(command, args, { ...options, windowsHide: true }),
  processes: createOsProcesses(osPlatform(process.platform)),
  timers,
  report: (message) => diagnostics.append(message),
});

process.on('uncaughtException', (error) => {
  try {
    children.killAll();
    diagnostics.append(`uncaught: ${error.stack}`);
  } finally {
    process.exit(1);
  }
});

// A signal's default action skips `exit` listeners, the channel lock's release
// among them; 128 plus the signal number is the shell's exit code for it.
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => process.exit(128 + constants.signals[signal]));
}

void startSessionHost({
  folder,
  channel,
  pid: process.pid,
  children,
  env: process.env,
  clock,
  timers,
  ptySpawn: () => {
    throw new Error('this host build has no pty adapter');
  },
  exit: (code) => process.exit(code),
});
