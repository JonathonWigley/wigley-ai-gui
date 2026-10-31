import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { chatCommand } from '../ids';
import { createEntryKit } from './chat-kit';

describe('createEntryKit', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispose_DisposesBaseKitAnchors', () => {
    const disposed: CommandId[] = [];
    const entryKit = createEntryKit(
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
        },
        keys: {
          anchor: (_node, command) => ({
            dispose: () => disposed.push(command),
          }),
          keysFor: () => null,
        },
        commands: { exists: () => true, run: () => undefined },
        platform: 'macos',
        allow: () => undefined,
        deny: () => undefined,
        openImages: () => undefined,
      },
    );
    entryKit.kit.keyHint(asHtml(new FakeElement('div')), 'send');

    entryKit.dispose();

    expect(disposed).toEqual([chatCommand('send')]);
  });
});
