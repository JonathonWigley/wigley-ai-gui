import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { CHIP_DRAWING, CHIP_PATHS } from './chip-paths.test-support';
import { fileChipExtension } from './chip-decorations';
import { insertionOf } from './codemirror-vim-host';

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
