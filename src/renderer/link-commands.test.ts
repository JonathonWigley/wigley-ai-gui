import { describe, expect, it, vi } from 'vitest';
import type { PageCommandContext } from '../contracts/plugin';
import { CommandRegistry } from '../shared/command-registry';
import { listenToLinkClicks, registerLinkCommands } from './link-commands';

// A root that hands each click to the listener `listenToLinkClicks` adds,
// its target finding a rendered link with `href` when `onLink` holds.
function fakeRoot() {
  let listener: (event: MouseEvent) => void = () => undefined;
  const root = {
    addEventListener: (_type: string, added: (event: MouseEvent) => void) => {
      listener = added;
    },
  } as unknown as Document;
  const click = (
    link: { href: string } | null,
    init: { defaultPrevented?: boolean } = {},
  ) => {
    const target = {
      closest: (selector: string) =>
        link !== null && selector === 'a.md-link[data-href]'
          ? { dataset: { href: link.href } }
          : null,
    };
    const event = {
      defaultPrevented: init.defaultPrevented ?? false,
      target,
      preventDefault: vi.fn(),
    };
    listener(event as unknown as MouseEvent);
    return event;
  };
  return { root, click };
}

describe('listenToLinkClicks', () => {
  it('click_OnRenderedLink_OpensItsHrefAndTakesTheClick', () => {
    const open = vi.fn();
    const { root, click } = fakeRoot();
    listenToLinkClicks(root, open);

    const event = click({ href: 'https://example.com' });

    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com');
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it.each([
    ['taken by a view', { href: 'https://e.com' }, { defaultPrevented: true }],
    ['outside any link', null, {}],
  ])('click_%s_OpensNothing', (_case, link, init) => {
    const open = vi.fn();
    const { root, click } = fakeRoot();
    listenToLinkClicks(root, open);

    const event = click(link, init);

    expect(open).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('registerLinkCommands', () => {
  const setup = (openExternal: (url: string) => Promise<void>) => {
    const registry = new CommandRegistry<PageCommandContext<any>>(() => {});
    const deps = { openExternal, toast: vi.fn(), log: vi.fn() };
    registerLinkCommands(registry, deps);
    return { registry, deps };
  };

  it('openLink_Opens_LogsTheUrl', async () => {
    const { registry, deps } = setup(vi.fn().mockResolvedValue(undefined));

    await registry.run('core.openLink', { arg: 'https://example.com' });

    expect(deps.openExternal).toHaveBeenCalledWith('https://example.com');
    expect(deps.log).toHaveBeenCalledWith('opened link https://example.com');
    expect(deps.toast).not.toHaveBeenCalled();
  });

  it('openLink_Refused_ToastsTheError', async () => {
    const { registry, deps } = setup(
      vi.fn().mockRejectedValue(new Error('Refused to open file:///x')),
    );

    await registry.run('core.openLink', { arg: 'file:///x' });

    expect(deps.toast).toHaveBeenCalledWith(
      'Refused to open file:///x',
      'error',
    );
    expect(deps.log).not.toHaveBeenCalled();
  });
});
