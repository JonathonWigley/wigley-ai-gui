import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { createVisualCommands } from './visual-commands';
import type { VisualOverlay } from './visual-overlay';
import { createVisualRegistry } from './visual-registry';

// A fake overlay recording each call by name, and each `open`'s arguments.
function recordingOverlay() {
  const calls: string[] = [];
  const opened: [readonly string[], number][] = [];
  const overlay: VisualOverlay = {
    open(sources, index) {
      calls.push('open');
      opened.push([sources, index]);
    },
    next: () => calls.push('next'),
    previous: () => calls.push('previous'),
    close: () => calls.push('close'),
  };
  return { overlay, calls, opened };
}

type Focused = 'none' | 'no visual' | 'two visuals';

// The `li` the focused entry is for `focused`, its hosts registered in
// `registry` by source, each in a block of its own after a paragraph; `blocks`
// holds the entry's block elements in order.
function focusedEntry(
  focused: Focused,
  registry: ReturnType<typeof createVisualRegistry>,
): { entry: HTMLElement | null; blocks: HTMLElement[] } {
  if (focused === 'none') {
    return { entry: null, blocks: [] };
  }
  const entry = new FakeElement('li');
  const paragraph = new FakeElement('p');
  entry.append(paragraph);
  const blocks = [asHtml(paragraph)];
  if (focused === 'two visuals') {
    for (const source of ['a', 'b']) {
      const fence = new FakeElement('div');
      const host = new FakeElement('div');
      host.className = 'visual-host';
      fence.append(host);
      entry.append(fence);
      blocks.push(asHtml(fence));
      registry.add(asHtml(host), source);
    }
  }
  return { entry: asHtml(entry), blocks };
}

describe('createVisualCommands', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: 'no focused stop',
      focused: 'none',
      block: null,
      logs: ['no focused entry'],
      opened: [],
    },
    {
      name: 'an entry with no visual',
      focused: 'no visual',
      block: null,
      logs: ['no visuals in the focused entry'],
      opened: [],
    },
    {
      name: 'an entry with two visuals',
      focused: 'two visuals',
      block: null,
      logs: [],
      opened: [[['a', 'b'], 0]],
    },
    {
      name: 'a cursor on the second visual',
      focused: 'two visuals',
      block: 2,
      logs: [],
      opened: [[['a', 'b'], 1]],
    },
    {
      name: 'a cursor on a paragraph',
      focused: 'two visuals',
      block: 0,
      logs: [],
      opened: [[['a', 'b'], 0]],
    },
  ] as const)(
    'openVisuals_FocusedEntry_OpensOrLogs $name',
    ({ focused, block, logs, opened }) => {
      const registry = createVisualRegistry();
      const { entry, blocks } = focusedEntry(focused, registry);
      const fake = recordingOverlay();
      const logged: string[] = [];
      const commands = createVisualCommands({
        chat: {
          focusedEntry: () => entry,
          focusedBlock: () => (block === null ? null : blocks[block]),
        },
        registry,
        overlay: fake.overlay,
        log: (message: string) => logged.push(message),
      });

      commands.openVisuals();

      expect(logged).toEqual(logs);
      expect(fake.opened).toEqual(opened);
    },
  );

  it('overlayCommands_CallTheOverlay', () => {
    const fake = recordingOverlay();
    const commands = createVisualCommands({
      chat: { focusedEntry: () => null, focusedBlock: () => null },
      registry: createVisualRegistry(),
      overlay: fake.overlay,
      log: () => undefined,
    });

    commands.nextVisual();
    commands.prevVisual();
    commands.closeVisual();

    expect(fake.calls).toEqual(['next', 'previous', 'close']);
  });
});
