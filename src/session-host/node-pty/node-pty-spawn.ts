// The node-pty adapter behind `PtySpawn`: the only file in the repo that imports node-pty.
import type * as NodePty from 'node-pty';
import type { Pty, PtyExit, PtySpawn } from '../../contracts/pty';

// node-pty sets the shell's `TERM` from this name; the host's shell env holds the same value.
const TERMINAL_NAME = 'xterm-256color';

// A PtySpawn over the module `load` returns. `load` runs on the first spawn, not at import, and
// again on the next spawn after one that failed: Node caches no failed `require`.
export function createNodePtySpawn(load: () => typeof NodePty): PtySpawn {
  let nodePty: typeof NodePty | null = null;
  return (file, args, options) => {
    nodePty ??= loadNodePty(load);
    const pty = nodePty.spawn(file, [...args], {
      name: TERMINAL_NAME,
      cwd: options.cwd,
      env: options.env,
      cols: options.cols,
      rows: options.rows,
    });
    return ptyOver(pty);
  };
}

// The host bundle is CommonJS with node-pty external, so this `require` stays in the built
// `session-host.js` and resolves at run time.
export const nodePtySpawn: PtySpawn = createNodePtySpawn(
  () => require('node-pty') as typeof NodePty,
);

function loadNodePty(load: () => typeof NodePty): typeof NodePty {
  try {
    return load();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`node-pty did not load: ${reason}`, { cause: error });
  }
}

function ptyOver(pty: NodePty.IPty): Pty {
  return {
    pid: pty.pid,
    onData: (listener) => {
      pty.onData(listener);
    },
    onExit: (listener) => {
      pty.onExit((exit) => listener(ptyExitOf(exit)));
    },
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: () => pty.kill(),
  };
}

// On macOS and Linux node-pty reports `signal` 0 for a normal exit; Windows leaves it undefined.
function ptyExitOf(exit: { exitCode: number; signal?: number }): PtyExit {
  return { exitCode: exit.exitCode, signal: exit.signal ? exit.signal : null };
}
