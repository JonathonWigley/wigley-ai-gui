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
    ).toThrow(/PROOF_SELFTEST.*WIGLEY_DRIVE_DIR/);
  });

  it('a drive run in WIGLEY_DRIVE_DIR over the fake harness by default', () => {
    expect(runEnvironmentOf({ WIGLEY_DRIVE_DIR: runDir })).toEqual({
      mode: 'drive',
      runDir,
      harness: 'fake',
      systemStats: 'fake',
      terminals: 'fake',
    });
  });

  it('a drive run over the harness WIGLEY_DRIVE_HARNESS names', () => {
    expect(
      runEnvironmentOf({
        WIGLEY_DRIVE_DIR: runDir,
        WIGLEY_DRIVE_HARNESS: 'claude',
      }),
    ).toEqual({
      mode: 'drive',
      runDir,
      harness: 'claude',
      systemStats: 'fake',
      terminals: 'fake',
    });
  });

  it('a drive run over the system stats WIGLEY_DRIVE_SYSTEM_STATS names', () => {
    expect(
      runEnvironmentOf({
        WIGLEY_DRIVE_DIR: runDir,
        WIGLEY_DRIVE_SYSTEM_STATS: 'live',
      }),
    ).toMatchObject({ mode: 'drive', systemStats: 'live' });
  });

  it('a drive run over the terminals WIGLEY_DRIVE_TERMINALS names', () => {
    expect(
      runEnvironmentOf({
        WIGLEY_DRIVE_DIR: runDir,
        WIGLEY_DRIVE_TERMINALS: 'live',
      }),
    ).toMatchObject({ mode: 'drive', terminals: 'live' });
  });

  it('throws on a relative WIGLEY_DRIVE_DIR', () => {
    expect(() => runEnvironmentOf({ WIGLEY_DRIVE_DIR: 'runs/one' })).toThrow(
      'WIGLEY_DRIVE_DIR',
    );
  });

  it('throws on a WIGLEY_DRIVE_HARNESS it does not know', () => {
    expect(() =>
      runEnvironmentOf({
        WIGLEY_DRIVE_DIR: runDir,
        WIGLEY_DRIVE_HARNESS: 'codex',
      }),
    ).toThrow(/WIGLEY_DRIVE_HARNESS.*codex/);
  });

  it('throws on a WIGLEY_DRIVE_SYSTEM_STATS it does not know', () => {
    expect(() =>
      runEnvironmentOf({
        WIGLEY_DRIVE_DIR: runDir,
        WIGLEY_DRIVE_SYSTEM_STATS: 'real',
      }),
    ).toThrow(/WIGLEY_DRIVE_SYSTEM_STATS.*real/);
  });

  it('throws on a WIGLEY_DRIVE_TERMINALS it does not know', () => {
    expect(() =>
      runEnvironmentOf({
        WIGLEY_DRIVE_DIR: runDir,
        WIGLEY_DRIVE_TERMINALS: 'real',
      }),
    ).toThrow(/WIGLEY_DRIVE_TERMINALS.*real/);
  });
});
