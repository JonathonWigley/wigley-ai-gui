import { describe, expect, it } from 'vitest';
import { HEADLESS_NOTE, HEADLESS_OFF_NOTE } from '../../chat/contract';
import { createHeadlessLines } from './headless-line';

const ON = `text\n${HEADLESS_NOTE}`;
const OFF = `text\n${HEADLESS_OFF_NOTE}`;

describe('createHeadlessLines', () => {
  // `seeded` is the flag when the lines are made; each call then reads the
  // next entry of `flags`.
  it.each([
    { name: 'on', seeded: false, flags: [true, true], expected: [ON, ON] },
    {
      name: 'on then off',
      seeded: false,
      flags: [true, false, false],
      expected: [ON, OFF, 'text'],
    },
    {
      name: 'never on',
      seeded: false,
      flags: [false, false],
      expected: ['text', 'text'],
    },
    {
      name: 'seeded on, then off',
      seeded: true,
      flags: [false, false],
      expected: [OFF, 'text'],
    },
  ])(
    'append_HeadlessState_AddsTheMatchingLine ($name)',
    ({ seeded, flags, expected }) => {
      let headless = seeded;
      const lines = createHeadlessLines(() => headless);

      const results = flags.map((flag) => {
        headless = flag;
        return lines.append('text');
      });

      expect(results).toEqual(expected);
    },
  );
});
