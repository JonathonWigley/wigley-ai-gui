import { spawn } from 'node:child_process';
import type { Clock, Timers } from '../contracts/ambient';
import { createDiagnosticLog } from './diagnostic-log';
import { startSessionHost } from './host-server';

const folder = process.argv[2];
const channel = process.argv[3];

const clock: Clock = { now: () => Date.now() };
const timers: Timers = {
  // Node's Timeout converts to its numeric id, and `clearTimeout` takes the id.
  set: (run, ms) => setTimeout(run, ms)[Symbol.toPrimitive](),
  clear: (handle) => clearTimeout(handle),
};

process.on('uncaughtException', (error) => {
  try {
    createDiagnosticLog(folder, clock).append(`uncaught: ${error.stack}`);
  } finally {
    process.exit(1);
  }
});

void startSessionHost({
  folder,
  channel,
  pid: process.pid,
  spawn: (command, args, options) =>
    spawn(command, args, { ...options, windowsHide: true }),
  clock,
  timers,
  exit: (code) => process.exit(code),
});
