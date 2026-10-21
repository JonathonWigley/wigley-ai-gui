import { describe, expect, it } from 'vitest';
import { documentExEvent } from './document-ex-commands';

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
