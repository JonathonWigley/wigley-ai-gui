import type { TerminalExit } from '../../contracts/terminals';

// How a shell ended, in words a log line and the drawer's header show.
export function exitReason(exit: TerminalExit): string {
  if (exit.error !== null) {
    return exit.error;
  }
  if (exit.code !== null) {
    return `code ${exit.code}`;
  }
  if (exit.signal !== null) {
    return `signal ${exit.signal}`;
  }
  return 'unknown';
}
