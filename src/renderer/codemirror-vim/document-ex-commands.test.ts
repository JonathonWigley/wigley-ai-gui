import { describe, expect, it } from 'vitest';
import { documentExClash, documentExEvent } from './document-ex-commands';
import { exBindName } from './ex-command-name';

describe('documentExEvent', () => {
  it('maps each command to its event', () => {
    expect(documentExEvent('write', undefined)).toEqual({ kind: 'write' });
    expect(documentExEvent('quit', undefined)).toEqual({
      kind: 'quit',
      force: false,
    });
    expect(documentExEvent('wq', undefined)).toEqual({ kind: 'writeQuit' });
    expect(documentExEvent('xit', undefined)).toEqual({ kind: 'writeQuit' });
  });

  it('reads a bang as forced quit', () => {
    expect(documentExEvent('quit', '!')).toEqual({ kind: 'quit', force: true });
    expect(documentExEvent('quit', ' !')).toEqual({
      kind: 'quit',
      force: true,
    });
    expect(documentExEvent('quit', '')).toEqual({ kind: 'quit', force: false });
  });

  it('ignores a bang on write-and-quit', () => {
    expect(documentExEvent('wq', '!')).toEqual({ kind: 'writeQuit' });
  });
});

describe('documentExClash', () => {
  it('finds an ex name clash', () => {
    for (const name of ['w', 'write', 'q', 'wq', 'xit', 'x']) {
      expect(documentExClash(name), name).toBe(true);
    }
    expect(documentExClash('wigleybindzero')).toBe(false);
    expect(documentExClash('wr')).toBe(false);
  });

  it('no bind ex name clashes', () => {
    for (let index = 0; index <= 99; index++) {
      expect(documentExClash(exBindName(index)), exBindName(index)).toBe(false);
    }
  });
});
