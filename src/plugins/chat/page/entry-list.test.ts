import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '../../../contracts/agent';
import type { CommandId } from '../../../contracts/commands';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { chatCommand } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type {
  ChatKit,
  ChatLayout,
  EntryInput,
  EntryKind,
  EntryView,
} from '../layouts/layout';
import { createEntryList } from './entry-list';

type AnyBuilder = (
  parent: HTMLElement,
  input: EntryInput<EntryKind>,
  kit: ChatKit,
) => EntryView;

const KINDS: EntryKind[] = [
  'user',
  'assistant',
  'thinking',
  'tool',
  'permission',
  'result',
  'notice',
  'raw',
];

// Draws `div.fancy` for every kind, with the builders in `overrides` in
// place of it; a kind `overrides` sets to undefined is left out.
function fancyLayout(
  overrides: Partial<Record<EntryKind, AnyBuilder | undefined>>,
): ChatLayout {
  const drawsFancy: AnyBuilder = (parent, _input, kit) => ({
    element: kit.el(parent, 'div', 'fancy'),
  });
  const entries = Object.fromEntries(
    KINDS.filter(
      (kind) =>
        !Object.hasOwn(overrides, kind) || overrides[kind] !== undefined,
    ).map((kind) => [kind, overrides[kind] ?? drawsFancy]),
  );
  return { entries };
}

// Names a key hint and draws a card through the kit, then throws.
const anchorsThenThrows: AnyBuilder = (parent, _input, kit) => {
  kit.keyHint(parent, 'allowPermission');
  kit.card(parent);
  throw new Error('boom');
};

// Draws `div.fancy` whose update throws.
const updateThrows: AnyBuilder = (parent, _input, kit) => ({
  element: kit.el(parent, 'div', 'fancy'),
  update() {
    throw new Error('broken update');
  },
});

const tool = (id: string): ChatEntry => ({
  kind: 'tool',
  id,
  toolUseId: `use-${id}`,
  name: 'Bash',
  input: {},
  summary: 'ls',
  result: null,
  raw: [],
});
const notice = (id: string): ChatEntry => ({
  kind: 'notice',
  id,
  text: 'hi',
  tone: 'info',
  raw: [],
});
const assistant = (text: string): ChatEntry => ({
  kind: 'assistant',
  id: 'a1',
  text,
  streaming: false,
  raw: [],
});

interface Row {
  name: string;
  shown: 'fancy' | 'default';
  fancy?: Partial<Record<EntryKind, AnyBuilder | undefined>>;
  // The kind whose default builder throws.
  breakDefault?: EntryKind;
  // Put in order; an entry whose id was put before redraws its slot.
  puts: ChatEntry[];
  // Each slot's children, as `<classes>@<data-layout>`.
  slots: string[][];
  logs: string[];
  toasts: string[];
  disposedAnchors: CommandId[];
}

const rows: Row[] = [
  {
    name: 'shown layout draws',
    shown: 'fancy',
    puts: [tool('t1')],
    slots: [['fancy@fancy']],
    logs: [],
    toasts: [],
    disposedAnchors: [],
  },
  {
    name: 'shown layout leaves the kind out',
    shown: 'fancy',
    fancy: { tool: undefined },
    puts: [tool('t1'), notice('n1')],
    slots: [['chat-entry chat-tool@default'], ['fancy@fancy']],
    logs: [],
    toasts: [],
    disposedAnchors: [],
  },
  {
    name: 'shown layout throws',
    shown: 'fancy',
    fancy: { tool: anchorsThenThrows },
    puts: [tool('t1'), tool('t2')],
    slots: [['chat-entry chat-tool@default'], ['chat-entry chat-tool@default']],
    logs: ['[chat] layout fancy tool entry failed: boom'],
    toasts: ['Chat layout fancy: tool entries drawn with default'],
    disposedAnchors: [
      chatCommand('allowPermission'),
      chatCommand('allowPermission'),
    ],
  },
  {
    name: 'default throws while default is shown',
    shown: 'default',
    breakDefault: 'notice',
    puts: [notice('n1'), notice('n2')],
    slots: [['chat-entry chat-raw@'], ['chat-entry chat-raw@']],
    logs: [
      '[chat] default layout notice entry failed: broken default',
      '[chat] default layout notice entry failed: broken default',
    ],
    toasts: ['Chat layout default: notice entries drawn as bare lines'],
    disposedAnchors: [],
  },
  {
    name: 'default throws after the shown layout threw',
    shown: 'fancy',
    fancy: { notice: anchorsThenThrows },
    breakDefault: 'notice',
    puts: [notice('n1')],
    slots: [['chat-entry chat-raw@']],
    logs: [
      '[chat] layout fancy notice entry failed: boom',
      '[chat] default layout notice entry failed: broken default',
    ],
    toasts: ['Chat layout fancy: notice entries drawn as bare lines'],
    disposedAnchors: [chatCommand('allowPermission')],
  },
  {
    name: 'update throws under the shown layout',
    shown: 'fancy',
    fancy: { assistant: updateThrows },
    puts: [assistant('one'), assistant('two'), assistant('three')],
    slots: [['chat-entry chat-assistant@default']],
    logs: ['[chat] layout fancy assistant entry update failed: broken update'],
    toasts: ['Chat layout fancy: assistant entries drawn with default'],
    disposedAnchors: [],
  },
  {
    name: 'update throws, default breaks',
    shown: 'fancy',
    fancy: { assistant: updateThrows },
    breakDefault: 'assistant',
    puts: [assistant('one'), assistant('two'), assistant('three')],
    slots: [['chat-entry chat-raw@']],
    logs: [
      '[chat] layout fancy assistant entry update failed: broken update',
      '[chat] default layout assistant entry failed: broken default',
      '[chat] default layout assistant entry failed: broken default',
    ],
    toasts: ['Chat layout fancy: assistant entries drawn as bare lines'],
    disposedAnchors: [],
  },
];

describe('entry list', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(rows)('buildEntry: $name', (row) => {
    if (row.breakDefault !== undefined) {
      vi.spyOn(defaultLayout.entries, row.breakDefault).mockImplementation(
        () => {
          throw new Error('broken default');
        },
      );
    }
    const logs: string[] = [];
    const toasts: string[] = [];
    const disposed: CommandId[] = [];
    const shown =
      row.shown === 'default'
        ? {
            layouts: new Map<string, ChatLayout>([['default', defaultLayout]]),
            user: 'default',
          }
        : withUser<ChatLayout>(
            defaultLayout,
            fancyLayout(row.fancy ?? {}),
            'fancy',
          );
    const list = createEntryList({
      layouts: { shown: () => shown },
      toastedKinds: new Set(),
      kit: {
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
      log: (source, message) => logs.push(`[${source}] ${message}`),
      toast: (text) => toasts.push(text),
    });

    const entries = new Map<string, ChatEntry>();
    for (const entry of row.puts) {
      entries.set(entry.id, entry);
      list.put(entry, [...entries.values()]);
    }

    const slots = asFake(list.element).children.map((slot) =>
      slot.children.map(
        (child: FakeElement) =>
          `${child.className}@${child.dataset.layout ?? ''}`,
      ),
    );
    expect(slots).toEqual(row.slots);
    expect(logs).toEqual(row.logs);
    expect(toasts).toEqual(row.toasts);
    expect(disposed).toEqual(row.disposedAnchors);
  });
});
