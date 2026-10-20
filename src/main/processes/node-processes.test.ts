import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeProcesses } from './node-processes';

const processes = createNodeProcesses();

// Runs `script` in the Node that runs the tests.
function runScript(script: string, options?: { cwd?: string }) {
  return processes.run(process.execPath, ['-e', script], options);
}

describe('createNodeProcesses', () => {
  it('run_ExitThree_ReturnsCodeAndOutput', async () => {
    const result = await runScript(
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
    );

    expect(result).toEqual({ code: 3, stdout: 'out', stderr: 'err' });
  });

  it('run_Cwd_RunsInTheFolder', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wigley-node-processes-'));
    try {
      const result = await runScript('process.stdout.write(process.cwd())', {
        cwd: dir,
      });

      expect(result.stdout).toBe(realpathSync(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('run_LargeOutput_KeepsPastOneMegabyte', async () => {
    const result = await runScript('process.stdout.write("x".repeat(2000000))');

    expect(result.stdout.length).toBe(2000000);
  });

  it('run_MissingProgram_RejectsNamingIt', async () => {
    await expect(processes.run('wigley-no-such-program', [])).rejects.toThrow(
      'wigley-no-such-program',
    );
  });
});
