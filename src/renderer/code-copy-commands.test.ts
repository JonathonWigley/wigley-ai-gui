import { describe, expect, it, vi } from 'vitest';
import type { PageCommandContext } from '../contracts/plugin';
import { CommandRegistry } from '../shared/command-registry';
import {
  listenToCodeCopyClicks,
  registerCodeCopyCommands,
} from './code-copy-commands';

// A root that hands each click to the listener `listenToCodeCopyClicks` adds,
// its target inside a copy button of a block holding `code` when given.
function fakeRoot() {
  let listener: (event: MouseEvent) => void = () => undefined;
  const root = {
    addEventListener: (_type: string, added: (event: MouseEvent) => void) => {
      listener = added;
    },
  } as unknown as Document;
  const click = (code: string | null) => {
    const pre = {
      querySelector: (selector: string) =>
        selector === 'code' ? { textContent: code } : null,
    };
    const button = {
      closest: (selector: string) => (selector === 'pre' ? pre : null),
    };
    const target = {
      closest: (selector: string) =>
        code !== null && selector === 'button.md-copy' ? button : null,
    };
    const event = { target, preventDefault: vi.fn() };
    listener(event as unknown as MouseEvent);
    return event;
  };
  return { root, click };
}

describe('listenToCodeCopyClicks', () => {
  it.each([
    ['a fence code ending on its line break', 'npm test\n', 'npm test'],
    ['code with blank last line kept', 'a\n\n', 'a\n'],
  ])('click_OnCopyButton_%s_CopiesTheCode', (_case, code, copied) => {
    const copy = vi.fn();
    const { root, click } = fakeRoot();
    listenToCodeCopyClicks(root, copy);

    const event = click(code);

    expect(copy).toHaveBeenCalledExactlyOnceWith(copied);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('click_OutsideAnyCopyButton_CopiesNothing', () => {
    const copy = vi.fn();
    const { root, click } = fakeRoot();
    listenToCodeCopyClicks(root, copy);

    const event = click(null);

    expect(copy).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('registerCodeCopyCommands', () => {
  function run(writeClipboard: (text: string) => Promise<void>) {
    const registry = new CommandRegistry<PageCommandContext<any>>(() => {});
    const toast = vi.fn();
    const logs: string[] = [];
    registerCodeCopyCommands(registry, {
      writeClipboard,
      toast,
      log: (message) => logs.push(message),
    });
    return { registry, toast, logs };
  }

  it('copyCode_ClipboardTakesIt_LogsLinesAndToastsCopied', async () => {
    const write = vi.fn(() => Promise.resolve());
    const { registry, toast, logs } = run(write);

    await registry.run('core.copyCode', { arg: 'a\nb' });

    expect(write).toHaveBeenCalledExactlyOnceWith('a\nb');
    expect(logs).toEqual(['copied code (2 lines)']);
    expect(toast).toHaveBeenCalledExactlyOnceWith('Copied', 'success');
  });

  it('copyCode_ClipboardRefuses_ToastsCopyFailed', async () => {
    const { registry, toast, logs } = run(() =>
      Promise.reject(new Error('denied')),
    );

    await registry.run('core.copyCode', { arg: 'a' });

    expect(logs).toEqual(['code copy failed: denied']);
    expect(toast).toHaveBeenCalledExactlyOnceWith('Copy failed', 'error');
  });
});
