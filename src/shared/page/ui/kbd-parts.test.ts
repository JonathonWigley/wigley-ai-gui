import { describe, expect, it } from 'vitest';
import { kbdParts } from './kbd-parts';

describe('kbdParts', () => {
  it('splits a page sequence into keys', () => {
    expect(kbdParts('Space k s')).toEqual([
      { kind: 'key', text: 'Space' },
      { kind: 'key', text: 'k' },
      { kind: 'key', text: 's' },
    ]);
  });

  it('reads a whole vim chord as one chord', () => {
    expect(kbdParts('<A-o>')).toEqual([{ kind: 'chord', text: '<A-o>' }]);
  });

  it('reads a lone slash between two keys as an alternative', () => {
    expect(kbdParts('j / k')).toEqual([
      { kind: 'key', text: 'j' },
      { kind: 'or', text: '/' },
      { kind: 'key', text: 'k' },
    ]);
  });

  it('reads a slash alone as the slash key', () => {
    expect(kbdParts('/')).toEqual([{ kind: 'key', text: '/' }]);
  });

  it('reads a slash at either end as the slash key', () => {
    expect(kbdParts('/ n')).toEqual([
      { kind: 'key', text: '/' },
      { kind: 'key', text: 'n' },
    ]);
    expect(kbdParts('n /')).toEqual([
      { kind: 'key', text: 'n' },
      { kind: 'key', text: '/' },
    ]);
  });

  it('keeps a digit range whole', () => {
    expect(kbdParts('1–9')).toEqual([{ kind: 'key', text: '1–9' }]);
  });

  it('ignores extra whitespace', () => {
    expect(kbdParts('  <D-Enter>   x ')).toEqual([
      { kind: 'chord', text: '<D-Enter>' },
      { kind: 'key', text: 'x' },
    ]);
  });

  it('reads an empty string as no parts', () => {
    expect(kbdParts('')).toEqual([]);
  });

  it('leaves a chord inside a longer token as a key', () => {
    expect(kbdParts('<Space>kd')).toEqual([{ kind: 'key', text: '<Space>kd' }]);
  });
});
