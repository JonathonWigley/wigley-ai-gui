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
// `registry` by source.
function focusedEntry(
  focused: Focused,
  registry: ReturnType<typeof createVisualRegistry>,
): HTMLElement | null {
  if (focused === 'none') {
    return null;
  }
  const entry = new FakeElement('li');
  entry.append(new FakeElement('p'));
  if (focused === 'two visuals') {
    for (const source of ['a', 'b']) {
      const host = new FakeElement('div');
      host.className = 'visual-host';
      entry.append(host);
      registry.add(asHtml(host), source);
    }
  }
  return asHtml(entry);
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
      logs: ['no focused entry'],
      opened: [],
    },
    {
      name: 'an entry with no visual',
      focused: 'no visual',
      logs: ['no visuals in the focused entry'],
      opened: [],
    },
    {
      name: 'an entry with two visuals',
      focused: 'two visuals',
      logs: [],
      opened: [[['a', 'b'], 0]],
    },
  ] as const)(
    'openVisuals_FocusedEntry_OpensOrLogs $name',
    ({ focused, logs, opened }) => {
      const registry = createVisualRegistry();
      const entry = focusedEntry(focused, registry);
      const fake = recordingOverlay();
      const logged: string[] = [];
      const commands = createVisualCommands({
        chat: { focusedEntry: () => entry },
        registry,
        overlay: fake.overlay,
        log: (_source, message) => logged.push(message),
      });

      commands.openVisuals();

      expect(logged).toEqual(logs);
      expect(fake.opened).toEqual(opened);
    },
  );

  it('overlayCommands_CallTheOverlay', () => {
    const fake = recordingOverlay();
    const commands = createVisualCommands({
      chat: { focusedEntry: () => null },
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
