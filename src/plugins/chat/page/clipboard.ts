import type { RunMode } from '../../../contracts/plugin';

export type WriteClipboard = (text: string) => Promise<void>;

// The self-test's writer resolves without touching the system clipboard, which
// is the user's own.
export function clipboardWriter(runMode: RunMode): WriteClipboard {
  return runMode === 'selfTest'
    ? () => Promise.resolve()
    : (text) => navigator.clipboard.writeText(text);
}
