import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipboardWriter } from './clipboard';

describe('clipboardWriter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { runMode: 'live', written: ['text'] },
    { runMode: 'drive', written: ['text'] },
    { runMode: 'selfTest', written: [] },
  ] as const)('clipboardWriter_$runMode', async ({ runMode, written }) => {
    const writes: string[] = [];
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText(text: string) {
          writes.push(text);
          return Promise.resolve();
        },
      },
    });

    await clipboardWriter(runMode)('text');

    expect(writes).toEqual(written);
  });
});
