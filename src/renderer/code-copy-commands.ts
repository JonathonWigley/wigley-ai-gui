import { CORE_COPY_CODE } from '../contracts/commands';
import type {
  PageCommandContext,
  PageServices,
  RunMode,
} from '../contracts/plugin';
import type { CommandRegistry } from '../shared/command-registry';
import { errorText } from '../shared/error-text';
import { CODE_COPY_BUTTON } from '../shared/page/dom';

export type WriteClipboard = (text: string) => Promise<void>;

export interface CodeCopyCommandDeps {
  writeClipboard: WriteClipboard;
  toast: PageServices['toast'];
  log(message: string): void;
}

// A self-test's or drive run's writer resolves without touching the system
// clipboard, which is the user's own, so only the live app writes it.
export function codeClipboardWriter(runMode: RunMode): WriteClipboard {
  return runMode === 'live'
    ? (text) => navigator.clipboard.writeText(text)
    : () => Promise.resolve();
}

// Registers `core.copyCode` under `core`: it logs `copied code (<n> lines)`
// and toasts `Copied` once the clipboard holds the code, else toasts that the
// copy failed.
export function registerCodeCopyCommands(
  commands: Pick<CommandRegistry<PageCommandContext<any>>, 'register'>,
  deps: CodeCopyCommandDeps,
): void {
  commands.register(
    CORE_COPY_CODE.id,
    async ({ arg }: PageCommandContext<string>) => {
      try {
        await deps.writeClipboard(arg);
      } catch (error) {
        deps.log(`code copy failed: ${errorText(error)}`);
        deps.toast('Copy failed', 'error');
        return;
      }
      const lines = arg === '' ? 0 : arg.split('\n').length;
      deps.log(`copied code (${lines === 1 ? '1 line' : `${lines} lines`})`);
      deps.toast('Copied', 'success');
    },
    'core',
  );
}

// Runs `copy` with the code of the block whose copy button a click lands on,
// less the one line break markdown ends a fence's code with.
export function listenToCodeCopyClicks(
  root: Pick<Document, 'addEventListener'>,
  copy: (code: string) => void,
): void {
  root.addEventListener('click', (event) => {
    // A click's target is always an element: one on the icon targets it.
    const target = event.target as Element | null;
    const button = target?.closest(CODE_COPY_BUTTON) ?? null;
    const code = button?.closest('pre')?.querySelector('code') ?? null;
    if (code === null) {
      return;
    }
    event.preventDefault();
    copy((code.textContent ?? '').replace(/\n$/, ''));
  });
}
