import { describe, expect, it } from 'vitest';
import { runModeOf } from './run-mode';

describe('runModeOf', () => {
  it("'selfTest' when PROOF_SELFTEST is set", () => {
    expect(runModeOf({ PROOF_SELFTEST: '1' })).toBe('selfTest');
  });

  it("'drive' when WIGLEY_DRIVE_DIR is set", () => {
    expect(runModeOf({ WIGLEY_DRIVE_DIR: '/x' })).toBe('drive');
  });

  it("'live' when neither is set", () => {
    expect(runModeOf({ PROOF_SELFTEST: '', WIGLEY_DRIVE_DIR: '' })).toBe(
      'live',
    );
  });

  it('throws when both are set', () => {
    expect(() =>
      runModeOf({ PROOF_SELFTEST: '1', WIGLEY_DRIVE_DIR: '/x' }),
    ).toThrow('Set PROOF_SELFTEST or WIGLEY_DRIVE_DIR, not both');
  });
});
