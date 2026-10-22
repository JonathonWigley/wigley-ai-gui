import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEnvironmentOf } from './run-mode';

const runDir = path.resolve('/runs/one');

describe('runEnvironmentOf', () => {
  it("'selfTest' when PROOF_SELFTEST is set", () => {
    expect(runEnvironmentOf({ PROOF_SELFTEST: '1' })).toEqual({
      mode: 'selfTest',
    });
  });

  it("'live' when neither is set", () => {
    expect(
      runEnvironmentOf({ PROOF_SELFTEST: '', WIGLEY_DRIVE_DIR: '' }),
    ).toEqual({ mode: 'live' });
  });

  it('throws when both are set', () => {
    expect(() =>
      runEnvironmentOf({ PROOF_SELFTEST: '1', WIGLEY_DRIVE_DIR: runDir }),
    ).toThrow('Set PROOF_SELFTEST or WIGLEY_DRIVE_DIR, not both');
  });

  it('a drive run in WIGLEY_DRIVE_DIR over the fake harness by default', () => {
    expect(runEnvironmentOf({ WIGLEY_DRIVE_DIR: runDir })).toEqual({
      mode: 'drive',
      runDir,
      harness: 'fake',
    });
  });

  it('a drive run over the harness WIGLEY_DRIVE_HARNESS names', () => {
    expect(
      runEnvironmentOf({
        WIGLEY_DRIVE_DIR: runDir,
        WIGLEY_DRIVE_HARNESS: 'claude',
      }),
    ).toEqual({ mode: 'drive', runDir, harness: 'claude' });
  });

  it('throws on a relative WIGLEY_DRIVE_DIR', () => {
    expect(() => runEnvironmentOf({ WIGLEY_DRIVE_DIR: 'runs/one' })).toThrow(
      'WIGLEY_DRIVE_DIR must be an absolute path',
    );
  });

  it('throws on a WIGLEY_DRIVE_HARNESS it does not know', () => {
    expect(() =>
      runEnvironmentOf({
        WIGLEY_DRIVE_DIR: runDir,
        WIGLEY_DRIVE_HARNESS: 'codex',
      }),
    ).toThrow('WIGLEY_DRIVE_HARNESS is "codex"; set it to fake or claude');
  });
});
