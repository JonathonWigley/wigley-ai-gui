import { tmpdir } from 'node:os';
import type * as NodePty from 'node-pty';
import { describe, expect, it, vi } from 'vitest';
import type { PtyExit, PtyOptions } from '../../contracts/pty';
import { createNodePtySpawn, nodePtySpawn } from './node-pty-spawn';

type NodePtyExit = { exitCode: number; signal?: number };

const OPTIONS: PtyOptions = {
  cwd: '/work',
  env: { PATH: '/bin' },
  cols: 80,
  rows: 24,
};

// A node-pty module whose `spawn` returns a pty that exits when the test says.
function fakeNodePty(): {
  module: typeof NodePty;
  exit(exit: NodePtyExit): void;
} {
  const exitListeners: ((exit: NodePtyExit) => void)[] = [];
  const pty = {
    pid: 4242,
    onData: () => ({ dispose: () => {} }),
    onExit: (listener: (exit: NodePtyExit) => void) => {
      exitListeners.push(listener);
      return { dispose: () => {} };
    },
    write: () => {},
    resize: () => {},
    kill: () => {},
  };
  const module = {
    spawn: () => pty as unknown as NodePty.IPty,
  } as unknown as typeof NodePty;
  return {
    module,
    exit: (exit) => {
      for (const listener of exitListeners) {
        listener(exit);
      }
    },
  };
}

describe('nodePtySpawn', () => {
  it.skipIf(process.platform === 'win32')(
    'runs a program in a pty and reports its output and exit',
    async () => {
      const pty = nodePtySpawn('/bin/echo', ['hi'], {
        cwd: tmpdir(),
        env: { PATH: '/bin:/usr/bin' },
        cols: 80,
        rows: 24,
      });
      const chunks: string[] = [];
      const exits: PtyExit[] = [];
      pty.onData((chunk) => chunks.push(chunk));
      pty.onExit((exit) => exits.push(exit));

      await vi.waitFor(
        () => {
          expect(exits).toHaveLength(1);
          expect(chunks.join('')).toContain('hi');
        },
        { timeout: 5000 },
      );
      expect(exits).toEqual([{ exitCode: 0, signal: null }]);
      expect(Number.isInteger(pty.pid) && pty.pid > 0).toBe(true);
    },
  );
});

describe('createNodePtySpawn', () => {
  it('load_Throws_SpawnThrowsTheReasonAndLoadsAgainNextTime', () => {
    const load = vi.fn((): typeof NodePty => {
      throw new Error('no prebuild');
    });

    const spawn = createNodePtySpawn(load);
    expect(load).not.toHaveBeenCalled();

    expect(() => spawn('/bin/zsh', ['-l'], OPTIONS)).toThrow(
      'node-pty did not load: no prebuild',
    );
    expect(() => spawn('/bin/zsh', ['-l'], OPTIONS)).toThrow(
      'node-pty did not load: no prebuild',
    );
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'a normal exit on macOS and Linux',
      exit: { exitCode: 3, signal: 0 },
      expected: { exitCode: 3, signal: null },
    },
    {
      name: 'a signal exit',
      exit: { exitCode: 0, signal: 9 },
      expected: { exitCode: 0, signal: 9 },
    },
    {
      name: 'an exit on Windows',
      exit: { exitCode: 4 },
      expected: { exitCode: 4, signal: null },
    },
  ])('exit_Signal_MapsToPtyExit: $name', ({ exit, expected }) => {
    const nodePty = fakeNodePty();
    const pty = createNodePtySpawn(() => nodePty.module)(
      '/bin/zsh',
      ['-l'],
      OPTIONS,
    );
    const exits: PtyExit[] = [];
    pty.onExit((ptyExit) => exits.push(ptyExit));

    nodePty.exit(exit);

    expect(exits).toEqual([expected]);
  });
});
