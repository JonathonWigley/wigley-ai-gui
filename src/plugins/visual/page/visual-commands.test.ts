import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { ChatFocus } from '../../chat/contract';
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

type Focused =
  | 'none'
  | 'no visual'
  | 'two visuals'
  | 'two visuals, the same entry id in another session';

// Chat tab `sessionId`'s root holding entry `e1` as chat marks them, its blocks
// a paragraph then one block per source, each holding that source's host,
// registered in `registry`; returns the entry.
function entryInTab(
  sessionId: string,
  sources: readonly string[],
  registry: ReturnType<typeof createVisualRegistry>,
): HTMLElement {
  const root = new FakeElement('div');
  root.dataset.chatSession = sessionId;
  const entry = new FakeElement('li');
  entry.dataset.chatEntry = 'e1';
  root.append(entry);
  const paragraph = new FakeElement('p');
  paragraph.dataset.mdLines = '0,1';
  entry.append(paragraph);
  sources.forEach((source, index) => {
    const fence = new FakeElement('div');
    fence.dataset.mdLines = `${index + 1},${index + 2}`;
    const host = new FakeElement('div');
    host.className = 'visual-host';
    fence.append(host);
    entry.append(fence);
    registry.add(asHtml(host), source);
  });
  return asHtml(entry);
}

// The focused entry for `focused` in session `s1`, and the focus on its block
// `block` that chat publishes; the other session's entry is registered first.
function arrangeFocus(
  focused: Focused,
  block: number | null,
  registry: ReturnType<typeof createVisualRegistry>,
): { entry: HTMLElement | null; focus: ChatFocus | null } {
  if (focused === 'none') {
    return { entry: null, focus: null };
  }
  if (focused === 'two visuals, the same entry id in another session') {
    entryInTab('s2', ['z'], registry);
  }
  const sources = focused === 'no visual' ? [] : ['a', 'b'];
  return {
    entry: entryInTab('s1', sources, registry),
    focus: { sessionId: 's1', entryId: 'e1', block },
  };
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
    {
      name: 'same entry id in another session',
      focused: 'two visuals, the same entry id in another session',
      block: 2,
      logs: [],
      opened: [[['a', 'b'], 1]],
    },
  ] as const)(
    'openVisuals_FocusedEntry_OpensOrLogs $name',
    ({ focused, block, logs, opened }) => {
      const registry = createVisualRegistry();
      const { focus } = arrangeFocus(focused, block, registry);
      const fake = recordingOverlay();
      const logged: string[] = [];
      const commands = createVisualCommands({
        focus: () => focus,
        registry,
        overlay: fake.overlay,
        log: (message: string) => logged.push(message),
      });

      commands.openVisuals();

      expect(logged).toEqual(logs);
      expect(fake.opened).toEqual(opened);
    },
  );

  it.each([
    {
      name: 'no focused stop',
      focused: 'none',
      block: null,
      logs: ['no focused entry'],
      wide: [],
    },
    {
      name: 'an entry with no visual',
      focused: 'no visual',
      block: null,
      logs: ['no visuals in the focused entry'],
      wide: [],
    },
    {
      name: 'an entry with two visuals',
      focused: 'two visuals',
      block: null,
      logs: ['visual width: wide'],
      wide: [true, false],
    },
    {
      name: 'a cursor on the second visual',
      focused: 'two visuals',
      block: 2,
      logs: ['visual width: wide'],
      wide: [false, true],
    },
  ] as const)(
    'toggleWidth_FocusedEntry_FlipsTheVisualOrLogs $name',
    ({ focused, block, logs, wide }) => {
      const registry = createVisualRegistry();
      const { entry, focus } = arrangeFocus(focused, block, registry);
      const logged: string[] = [];
      const commands = createVisualCommands({
        focus: () => focus,
        registry,
        overlay: recordingOverlay().overlay,
        log: (message: string) => logged.push(message),
      });

      commands.toggleWidth();

      expect(logged).toEqual(logs);
      const hosts = entry === null ? [] : registry.hostsIn(entry);
      expect(hosts.map((host) => host.classList.contains('is-wide'))).toEqual(
        wide,
      );
    },
  );

  it('overlayCommands_CallTheOverlay', () => {
    const fake = recordingOverlay();
    const commands = createVisualCommands({
      focus: () => null,
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
