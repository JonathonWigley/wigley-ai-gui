import { describe, expect, it } from 'vitest';
import { holdsPastedText } from './pasted-text';

function transferHolding(text: string): DataTransfer {
  return { getData: () => text } as unknown as DataTransfer;
}

const ONE_FILE = [new File([], 'a.png')];

describe('holdsPastedText', () => {
  it.each([
    { text: '', files: ONE_FILE, holds: false },
    { text: '  ', files: ONE_FILE, holds: false },
    { text: 'a.png', files: ONE_FILE, holds: false },
    { text: 'https://x.com/i.png', files: ONE_FILE, holds: false },
    { text: 'file:///tmp/a.png', files: ONE_FILE, holds: false },
    { text: 'hello', files: ONE_FILE, holds: true },
    { text: 'hello', files: [], holds: true },
  ])(
    "treats text standing for the files as no text: '$text' with $files.length files → $holds",
    ({ text, files, holds }) => {
      expect(holdsPastedText(transferHolding(text), files)).toBe(holds);
    },
  );

  it('finds no text in a null transfer', () => {
    expect(holdsPastedText(null, ONE_FILE)).toBe(false);
  });
});
