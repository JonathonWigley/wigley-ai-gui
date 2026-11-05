import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { chatCommand } from '../ids';
import { createEntryKit } from './chat-kit';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

describe('createEntryKit', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // An assistant entry's kit; each anchor's dispose records its command in
  // `disposed`.
  function assistantKit(disposed: CommandId[] = []) {
    return createEntryKit(
      {
        kind: 'assistant',
        id: 'a1',
        at: 1000,
        text: 'hi',
        streaming: false,
        raw: [],
      },
      {
        markdown: {
          block: (text) => text,
          inline: (text) => text,
          document: (text) => Promise.resolve(text),
          ...NO_FENCES,
        },
        keys: {
          anchor: (_node, command) => ({
            dispose: () => disposed.push(command),
          }),
          keysFor: () => null,
        },
        commands: { exists: () => true, run: () => undefined },
        platform: 'macos',
        state: noLayoutState,
        allow: () => undefined,
        deny: () => undefined,
        openImages: () => undefined,
      },
    );
  }

  it('dispose_DisposesBaseKitAnchors', () => {
    const disposed: CommandId[] = [];
    const entryKit = assistantKit(disposed);
    entryKit.kit.keyHint(asHtml(new FakeElement('div')), 'send');

    entryKit.dispose();

    expect(disposed).toEqual([chatCommand('send')]);
  });

  it('collapsibleRow_RegistersWithExpanders', () => {
    const entryKit = assistantKit();
    const parent = new FakeElement('div');

    const row = entryKit.kit.collapsibleRow(asHtml(parent), {
      summary: 'Thinking',
      body: () => asHtml(new FakeElement('div')),
    });
    entryKit.expanders.setAllOpen(true);

    expect(entryKit.expanders.count()).toBe(1);
    expect(row.isOpen()).toBe(true);
  });
});
