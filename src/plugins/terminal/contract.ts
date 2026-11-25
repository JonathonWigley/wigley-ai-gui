import type { ChannelShape } from '../../contracts/plugin';
import type { KeyedSlotKey } from '../../contracts/state';
import type { TerminalExit } from '../../contracts/terminals';

// What main holds of a session's shell, as `open` and `restart` answer it.
export interface TerminalOpened {
  shell: string; // this shell's id: new for each spawn or adoption by main
  buffer: string; // main's last `TERMINAL_REPLAY_LIMIT` UTF-16 code units of the shell's output
  seq: number; // the seq of the last chunk in `buffer`; 0 when empty
  folder: string; // the shell's cwd
  exit: TerminalExit | null; // null while the shell runs
}

// The terminal plugin's channel, keyed by app session id. `open` starts the
// session's shell when it has none, and resizes a running one; an exited one
// stays exited. `restart` starts a new shell in place of an exited one, and
// acts as `open` on a running one. `write` and `resize` do nothing for a shell
// that is not running. Each message carries the id of the shell it belongs
// to, and a `data` message's `seq` counts within that shell only.
export interface TerminalChannel extends ChannelShape {
  invoke: {
    open(
      sessionId: string,
      cols: number,
      rows: number,
    ): Promise<TerminalOpened>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    restart(
      sessionId: string,
      cols: number,
      rows: number,
    ): Promise<TerminalOpened>;
  };
  messages: {
    data: { sessionId: string; shell: string; chunk: string; seq: number };
    exited: { sessionId: string; shell: string; exit: TerminalExit };
    typed: { sessionId: string; shell: string; text: string };
  };
}

// Each session's shell output: its last 200 lines, escape sequences stripped,
// joined with `\n`, keyed by app session id. A key is deleted when its shell is
// killed for a closed row.
export const terminalOutputSlot: KeyedSlotKey<string, 'main', 'terminal'> = {
  id: 'terminal.output',
  process: 'main',
  kind: 'keyed',
};
