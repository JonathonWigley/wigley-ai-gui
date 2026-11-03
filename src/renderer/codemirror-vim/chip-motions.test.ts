import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { fileChipsIn } from '../../shared/page/file-drop/file-chips';
import { CHIP_PATHS } from './chip-paths.test-support';
import { chipCharacterTarget, chipWordTarget } from './chip-motions';

// `text` as a document and the chips it holds.
function docOf(text: string) {
  return {
    doc: Text.of(text.split('\n')),
    chips: fileChipsIn(text, CHIP_PATHS),
  };
}

// The chips `/a/b` and `/c/d` span columns 2 to 6 and 9 to 13.
const TWO_CHIPS = 'x /a/b y /c/d';
// The quoted chip `"/a b/c"` spans columns 2 to 10.
const QUOTED_CHIP = 'x "/a b/c" y';

describe('chipCharacterTarget', () => {
  it.each([
    { text: TWO_CHIPS, ch: 2, repeat: 1, forward: true, target: 6 },
    { text: TWO_CHIPS, ch: 4, repeat: 1, forward: true, target: 6 },
    { text: TWO_CHIPS, ch: 0, repeat: 3, forward: true, target: 6 },
    { text: TWO_CHIPS, ch: 6, repeat: 1, forward: false, target: 2 },
    { text: TWO_CHIPS, ch: 2, repeat: 1, forward: false, target: 1 },
    { text: TWO_CHIPS, ch: 9, repeat: 2, forward: false, target: 7 },
    { text: TWO_CHIPS, ch: 13, repeat: 1, forward: true, target: 14 },
    { text: 'x a/b y', ch: 1, repeat: 3, forward: true, target: 4 },
  ])(
    "steps over a chip as one character: '$text' from $ch, $repeat × forward $forward → $target",
    ({ text, ch, repeat, forward, target }) => {
      const { doc, chips } = docOf(text);
      expect(
        chipCharacterTarget(doc, chips, { line: 0, ch }, repeat, forward),
      ).toEqual({ line: 0, ch: target });
    },
  );

  it('reads the chips on the line it moves on', () => {
    const { doc, chips } = docOf(`one\n${TWO_CHIPS}`);
    expect(
      chipCharacterTarget(doc, chips, { line: 1, ch: 2 }, 1, true),
    ).toEqual({ line: 1, ch: 6 });
  });
});

// Lines with no chip: two words on each, and an empty line between words.
const TWO_LINES = 'one two\nthree four';
const EMPTY_LINE = 'one\n\ntwo';

const W = { forward: true, wordEnd: false, bigWord: false };
const E = { forward: true, wordEnd: true, bigWord: false };
const B = { forward: false, wordEnd: false, bigWord: false };
const GE = { forward: false, wordEnd: true, bigWord: false };
const BIG_W = { forward: true, wordEnd: false, bigWord: true };
const BIG_E = { forward: true, wordEnd: true, bigWord: true };
const BIG_B = { forward: false, wordEnd: false, bigWord: true };

describe('chipWordTarget', () => {
  it.each([
    { key: 'w', text: TWO_CHIPS, from: [0, 0], motion: W, target: [0, 2] },
    { key: 'w', text: TWO_CHIPS, from: [0, 2], motion: W, target: [0, 7] },
    { key: 'w', text: TWO_CHIPS, from: [0, 7], motion: W, target: [0, 9] },
    {
      key: '2w',
      text: TWO_CHIPS,
      from: [0, 0],
      motion: { ...W, repeat: 2 },
      target: [0, 7],
    },
    { key: 'w', text: 'x /a/b', from: [0, 2], motion: W, target: [0, 6] },
    { key: 'w', text: 'x /a/b\ny', from: [0, 2], motion: W, target: [1, 0] },
    { key: 'w', text: '"/a b/c"/d/e', from: [0, 0], motion: W, target: [0, 8] },
    { key: 'e', text: TWO_CHIPS, from: [0, 0], motion: E, target: [0, 2] },
    { key: 'e', text: TWO_CHIPS, from: [0, 2], motion: E, target: [0, 7] },
    { key: 'b', text: TWO_CHIPS, from: [0, 7], motion: B, target: [0, 2] },
    { key: 'b', text: TWO_CHIPS, from: [0, 9], motion: B, target: [0, 7] },
    { key: 'ge', text: TWO_CHIPS, from: [0, 7], motion: GE, target: [0, 2] },
    {
      key: 'W',
      text: QUOTED_CHIP,
      from: [0, 0],
      motion: BIG_W,
      target: [0, 2],
    },
    {
      key: 'W',
      text: QUOTED_CHIP,
      from: [0, 2],
      motion: BIG_W,
      target: [0, 11],
    },
    {
      key: 'E',
      text: QUOTED_CHIP,
      from: [0, 0],
      motion: BIG_E,
      target: [0, 2],
    },
    {
      key: 'B',
      text: QUOTED_CHIP,
      from: [0, 11],
      motion: BIG_B,
      target: [0, 2],
    },
    { key: 'w', text: 'foo.bar baz', from: [0, 0], motion: W, target: [0, 3] },
    { key: 'e', text: 'foo.bar baz', from: [0, 0], motion: E, target: [0, 2] },
    { key: 'b', text: 'foo.bar baz', from: [0, 8], motion: B, target: [0, 4] },
    {
      key: 'ge',
      text: 'foo.bar baz',
      from: [0, 8],
      motion: GE,
      target: [0, 6],
    },
    {
      key: 'W',
      text: 'foo.bar baz',
      from: [0, 0],
      motion: BIG_W,
      target: [0, 8],
    },
    // From an insert-mode cursor on a chip's end, <C-w> deletes back to b's.
    { key: 'B', text: 'x /a/b', from: [0, 6], motion: B, target: [0, 2] },
    // With no chip the motions move as vim's own do.
    { key: 'w', text: TWO_LINES, from: [0, 0], motion: W, target: [0, 4] },
    { key: 'w', text: EMPTY_LINE, from: [0, 0], motion: W, target: [1, 0] },
    { key: 'e', text: EMPTY_LINE, from: [0, 2], motion: E, target: [2, 2] },
    { key: 'b', text: EMPTY_LINE, from: [2, 0], motion: B, target: [1, 0] },
    { key: 'ge', text: EMPTY_LINE, from: [2, 0], motion: GE, target: [1, 0] },
    { key: 'b', text: TWO_LINES, from: [1, 0], motion: B, target: [0, 4] },
    { key: 'ge', text: TWO_LINES, from: [1, 0], motion: GE, target: [0, 6] },
    {
      key: '3w',
      text: TWO_LINES,
      from: [0, 0],
      motion: { ...W, repeat: 3 },
      target: [1, 6],
    },
    { key: 'w', text: 'one two', from: [0, 4], motion: W, target: [0, 7] },
    { key: 'e', text: 'one two', from: [0, 6], motion: E, target: [0, 6] },
    { key: 'b', text: 'one two', from: [0, 0], motion: B, target: [0, 0] },
    { key: 'ge', text: 'one two', from: [0, 0], motion: GE, target: [0, 0] },
    // Vim reads U+E000, a private-use character, as punctuation.
    {
      key: 'w',
      text: 'a\uE000\uE000b',
      from: [0, 1],
      motion: W,
      target: [0, 3],
    },
  ])(
    "moves as vim's $key with each chip one word: '$text' from $from → $target",
    ({ text, from, motion, target }) => {
      const { doc, chips } = docOf(text);
      const head = { line: from[0], ch: from[1] };
      expect(
        chipWordTarget(doc, chips, head, { repeat: 1, ...motion }),
      ).toEqual({ line: target[0], ch: target[1] });
    },
  );
});
