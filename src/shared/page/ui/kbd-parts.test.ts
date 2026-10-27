import { describe, expect, it } from 'vitest';
import { kbdParts } from './kbd-parts';

describe('kbdParts', () => {
  it.each([
    {
      keys: 'Space k s',
      parts: [
        { kind: 'key', text: 'Space' },
        { kind: 'key', text: 'k' },
        { kind: 'key', text: 's' },
      ],
    },
    { keys: '<A-o>', parts: [{ kind: 'chord', text: '<A-o>' }] },
    {
      keys: 'j / k',
      parts: [
        { kind: 'key', text: 'j' },
        { kind: 'or', text: '/' },
        { kind: 'key', text: 'k' },
      ],
    },
    { keys: '/', parts: [{ kind: 'key', text: '/' }] },
    {
      keys: '/ n',
      parts: [
        { kind: 'key', text: '/' },
        { kind: 'key', text: 'n' },
      ],
    },
    {
      keys: 'n /',
      parts: [
        { kind: 'key', text: 'n' },
        { kind: 'key', text: '/' },
      ],
    },
    { keys: '1–9', parts: [{ kind: 'key', text: '1–9' }] },
    {
      keys: '  <D-Enter>   x ',
      parts: [
        { kind: 'chord', text: '<D-Enter>' },
        { kind: 'key', text: 'x' },
      ],
    },
    { keys: '', parts: [] },
    { keys: '<Space>kd', parts: [{ kind: 'key', text: '<Space>kd' }] },
  ])('splits "$keys" into its parts', ({ keys, parts }) => {
    expect(kbdParts(keys)).toEqual(parts);
  });
});
