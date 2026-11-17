import { spawn } from 'node:child_process';
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

void startSessionHost({
  folder,
  channel,
  pid: process.pid,
  children,
  env: process.env,
  clock,
  timers,
  exit: (code) => process.exit(code),
});
