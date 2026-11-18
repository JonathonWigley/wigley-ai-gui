import { EditorState } from '@codemirror/state';
import { Vim } from '@replit/codemirror-vim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FuzzyMatcher } from '../../contracts/fuzzy';
import { CHIP_DRAWING, CHIP_PATHS } from './chip-paths.test-support';
import { fileChipExtension } from './chip-decorations';
import { createCodeMirrorVimHost, insertionOf } from './codemirror-vim-host';

type VimEditor = Parameters<typeof Vim.handleEx>[0];

interface FakeNode {
  readonly textContent: string;
  children: FakeNode[];
}

// The DOM vim builds its message from: an element's text is its children's.
function fakeNode(text = ''): FakeNode {
  const node = {
    style: {},
    children: [] as FakeNode[],
    nodeType: 1,
    get textContent(): string {
      return text + node.children.map((child) => child.textContent).join('');
    },
    setAttribute: () => undefined,
    appendChild: (child: FakeNode) => node.children.push(child),
  };
  return node;
}

// An editor as far as vim's ex dispatch reads one, with each message vim
// shows collected in `messages`; the host hosts no such editor.
function promptEditor(messages: string[]): VimEditor {
  const editor = {
    state: { vim: { visualMode: false } },
    operation: (run: () => void) => run(),
    getCursor: () => ({ line: 0, ch: 0 }),
    openNotification: (message: FakeNode) => {
      messages.push(message.textContent);
    },
  };
  return editor as unknown as VimEditor;
}

describe('defineEx', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: 'a disposed command is unknown to vim, which says so itself',
      typed: 'hostgone',
      disposes: true,
      messages: ['Not an editor command ":hostgone"'],
      logged: [],
    },
    {
      name: 'a disposed command typed with an argument shows all of it',
      typed: 'hostgone! hi',
      disposes: true,
      messages: ['Not an editor command ":hostgone! hi"'],
      logged: [],
    },
    {
      name: 'a throw from a live command is logged and leaves vim silent',
      typed: 'hostgone',
      disposes: false,
      messages: [],
      logged: [
        'editor: ex command hostgone failed: A bound key or ex command ran in an editor this host did not create',
      ],
    },
  ])('$name', ({ typed, disposes, messages, logged }) => {
    vi.stubGlobal('document', {
      createElement: () => fakeNode(),
      createTextNode: (text: string) => fakeNode(text),
    });
    const lines: string[] = [];
    const host = createCodeMirrorVimHost(
      { leader: '<Space>', remaps: [], binds: [] },
      () => false,
      (source, message) => lines.push(`${source}: ${message}`),
      CHIP_DRAWING,
      {} as FuzzyMatcher,
    );
    const handle = host.defineEx('hostgone', 'hostg', () => undefined);
    if (disposes) {
      handle.dispose();
    }
    const shown: string[] = [];

    Vim.handleEx(promptEditor(shown), typed);

    expect({ shown, lines }).toEqual({ shown: messages, lines: logged });
    if (!disposes) {
      handle.dispose();
    }
  });
});

describe('insertionOf', () => {
  it.each([
    {
      name: 'normal mode inserts after the character under the cursor, spaced off the next',
      doc: 'ab',
      selection: { anchor: 0 },
      mode: 'normal' as const,
      text: ' /p/q.md',
      insertion: { from: 1, to: 1, insert: ' /p/q.md ', cursor: 2 },
    },
    {
      name: 'normal mode on a chip inserts after the whole chip',
      doc: 'see /a/b now',
      selection: { anchor: 4 },
      mode: 'normal' as const,
      text: ' /p/q.md',
      insertion: { from: 8, to: 8, insert: ' /p/q.md', cursor: 9 },
    },
    {
      name: 'normal mode on an empty line inserts at the cursor',
      doc: 'one\n\ntwo',
      selection: { anchor: 4 },
      mode: 'normal' as const,
      text: '/p/q.md',
      insertion: { from: 4, to: 4, insert: '/p/q.md', cursor: 4 },
    },
    {
      name: 'normal mode on the last character adds no space after',
      doc: 'ab',
      selection: { anchor: 1 },
      mode: 'normal' as const,
      text: ' /p/q.md',
      insertion: { from: 2, to: 2, insert: ' /p/q.md', cursor: 3 },
    },
    {
      name: 'normal mode puts the cursor on the last character of text with no chip',
      doc: 'ab',
      selection: { anchor: 0 },
      mode: 'normal' as const,
      text: ' word',
      insertion: { from: 1, to: 1, insert: ' word ', cursor: 5 },
    },
    {
      name: 'insert mode inserts at the cursor and puts it after the text and its space',
      doc: 'ab',
      selection: { anchor: 1 },
      mode: 'insert' as const,
      text: ' /p/q.md',
      insertion: { from: 1, to: 1, insert: ' /p/q.md ', cursor: 10 },
    },
    {
      name: 'visual mode replaces the selection and puts the cursor on the chip',
      doc: 'one two three',
      selection: { anchor: 4, head: 7 },
      mode: 'visual' as const,
      text: '/p/q.md',
      insertion: { from: 4, to: 7, insert: '/p/q.md', cursor: 4 },
    },
  ])('$name', ({ doc, selection, mode, text, insertion }) => {
    const state = EditorState.create({
      doc,
      selection,
      extensions: fileChipExtension(CHIP_DRAWING),
    });
    expect(insertionOf(state, mode, text, CHIP_PATHS)).toEqual(insertion);
  });
});
