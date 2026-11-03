import {
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from '@codemirror/state';
import { Vim } from '@replit/codemirror-vim';
import { describe, expect, it } from 'vitest';
import { CHIP_DRAWING, CHIP_PATHS } from './chip-paths.test-support';
import {
  applyChipRules,
  type EditMode,
  editModeOf,
  fileChipExtension,
  movedPasteShift,
  noteMovedPaste,
  noteWidenedCut,
  skipsChipRules,
  snapHead,
  type VimOperationHolder,
  vimSelectionOf,
  widenRange,
} from './chip-decorations';

const CHIPS = [{ from: 4, to: 20 }];

describe('snapHead', () => {
  it.each([
    { previous: 3, next: 5, isInsert: false, head: 4 },
    { previous: 4, next: 5, isInsert: false, head: 20 },
    { previous: 21, next: 19, isInsert: false, head: 4 },
    { previous: 3, next: 5, isInsert: true, head: 20 },
    { previous: 21, next: 19, isInsert: true, head: 4 },
    { previous: 3, next: 4, isInsert: false, head: 4 },
    { previous: 19, next: 20, isInsert: true, head: 20 },
    { previous: 24, next: 25, isInsert: false, head: 25 },
  ])(
    "keeps the cursor off a chip's inside: ($previous → $next, insert $isInsert) → $head",
    ({ previous, next, isInsert, head }) => {
      expect(snapHead(CHIPS, previous, next, isInsert)).toBe(head);
    },
  );
});

describe('editModeOf', () => {
  const NORMAL = {
    insertMode: false,
    visualMode: false,
    visualLine: false,
    visualBlock: false,
  };
  it.each([
    { vim: NORMAL, mode: 'normal' },
    { vim: { ...NORMAL, insertMode: true }, mode: 'insert' },
    { vim: { ...NORMAL, visualMode: true }, mode: 'visual' },
    {
      vim: { ...NORMAL, visualMode: true, visualLine: true },
      mode: 'visualLine',
    },
    {
      vim: { ...NORMAL, visualMode: true, visualBlock: true },
      mode: 'visualBlock',
    },
  ])("reads vim's mode: $vim → $mode", ({ vim, mode }) => {
    expect(editModeOf(vim)).toBe(mode);
  });
});

describe('widenRange', () => {
  it.each([
    { from: 4, to: 5, widened: { from: 4, to: 20 } },
    { from: 19, to: 20, widened: { from: 4, to: 20 } },
    { from: 2, to: 6, widened: { from: 2, to: 20 } },
    { from: 10, to: 12, widened: { from: 4, to: 20 } },
    { from: 0, to: 3, widened: { from: 0, to: 3 } },
    { from: 3, to: 25, widened: { from: 3, to: 25 } },
    { from: 20, to: 22, widened: { from: 20, to: 22 } },
  ])('takes a chip whole: ($from, $to) → $widened', ({ from, to, widened }) => {
    expect(widenRange(CHIPS, from, to)).toEqual(widened);
  });
});

// `doc` with the selection at `anchor`..`head`, updated by `spec` under the
// chip rules in `mode`.
function settled(
  doc: string,
  selection: { anchor: number; head?: number },
  spec: TransactionSpec,
  mode: EditMode,
) {
  const state = EditorState.create({
    doc,
    selection,
    extensions: [
      fileChipExtension(CHIP_DRAWING),
      EditorState.transactionFilter.of((tr) =>
        applyChipRules(tr, CHIP_PATHS, mode),
      ),
    ],
  });
  const next = state.update(spec).state;
  const { anchor, head } = next.selection.main;
  return { text: next.doc.toString(), anchor, head };
}

describe('vimSelectionOf', () => {
  it.each([
    { range: { anchor: 2, head: 6 }, selection: { anchor: 2, head: 5 } },
    { range: { anchor: 6, head: 2 }, selection: { anchor: 5, head: 2 } },
    { range: { anchor: 2, head: 3 }, selection: { anchor: 2, head: 2 } },
    { range: { anchor: 3, head: 3 }, selection: { anchor: 3, head: 3 } },
  ])(
    'reads the character under each end: $range → $selection',
    ({ range, selection }) => {
      expect(vimSelectionOf(range)).toEqual(selection);
    },
  );
});

// The chip `/tmp/chips/a.md` spans 4 to 19.
const ONE_CHIP = 'see /tmp/chips/a.md now';
// The same chip, ending its line.
const LINE_END_CHIP = 'see /tmp/chips/a.md';
// The same chip on a second line, spanning 12 to 27.
const SECOND_LINE_CHIP = `one two\n${ONE_CHIP}`;
// The chip ending the first of two lines; the second spans 20 to 24.
const LINE_END_CHIP_THEN_LINE = `${LINE_END_CHIP}\nnext`;
// The chips `/a/b` and `/c/d` span 2 to 6 and 7 to 11.
const TWO_CHIPS = 'x /a/b /c/d y';

describe('applyChipRules', () => {
  it.each([
    {
      name: 'a cursor moved forward into a chip lands on its start in normal mode',
      doc: SECOND_LINE_CHIP,
      from: { anchor: 5 },
      to: { anchor: 13 },
      mode: 'normal' as const,
      selection: { anchor: 12, head: 12 },
    },
    {
      name: "a cursor moved forward from a chip's start into the chip lands past it in normal mode",
      doc: ONE_CHIP,
      from: { anchor: 4 },
      to: { anchor: 10 },
      mode: 'normal' as const,
      selection: { anchor: 19, head: 19 },
    },
    {
      name: "a cursor moved forward from the start of a chip that ends its line lands on the line's end in normal mode",
      doc: LINE_END_CHIP,
      from: { anchor: 4 },
      to: { anchor: 18 },
      mode: 'normal' as const,
      selection: { anchor: 19, head: 19 },
    },
    {
      name: 'a cursor moved back into a chip lands on its start in normal mode',
      doc: ONE_CHIP,
      from: { anchor: 19 },
      to: { anchor: 18 },
      mode: 'normal' as const,
      selection: { anchor: 4, head: 4 },
    },
    {
      name: 'a cursor moved into a chip lands on its end in insert mode',
      doc: ONE_CHIP,
      from: { anchor: 4 },
      to: { anchor: 5 },
      mode: 'insert' as const,
      selection: { anchor: 19, head: 19 },
    },
    {
      name: 'a cursor moved back into a chip lands on its start in insert mode',
      doc: ONE_CHIP,
      from: { anchor: 19 },
      to: { anchor: 18 },
      mode: 'insert' as const,
      selection: { anchor: 4, head: 4 },
    },
    {
      name: 'a visual head moved forward into a chip it ends on takes the chip in',
      doc: ONE_CHIP,
      from: { anchor: 1 },
      to: { anchor: 1, head: 6 },
      mode: 'visual' as const,
      selection: { anchor: 1, head: 19 },
    },
    {
      name: 'a visual head moved back into a chip it starts on takes the chip in',
      doc: ONE_CHIP,
      from: { anchor: 21 },
      to: { anchor: 21, head: 10 },
      mode: 'visual' as const,
      selection: { anchor: 21, head: 4 },
    },
    {
      name: 'a visual head moved forward into a chip it starts on leaves the chip out',
      doc: ONE_CHIP,
      from: { anchor: 21, head: 2 },
      to: { anchor: 21, head: 10 },
      mode: 'visual' as const,
      selection: { anchor: 21, head: 19 },
    },
    {
      name: 'a visual head moved back into a chip it ends on leaves the chip out',
      doc: ONE_CHIP,
      from: { anchor: 1, head: 23 },
      to: { anchor: 1, head: 11 },
      mode: 'visual' as const,
      selection: { anchor: 1, head: 4 },
    },
    {
      name: "a visual head on a chip's start it ends on takes the chip in",
      doc: ONE_CHIP,
      from: { anchor: 1, head: 21 },
      to: { anchor: 1, head: 5 },
      mode: 'visual' as const,
      selection: { anchor: 1, head: 19 },
    },
    {
      name: 'an unchanged visual selection re-sent with its head on a chip comes back unchanged',
      doc: ONE_CHIP,
      from: { anchor: 1, head: 19 },
      to: { anchor: 1, head: 19 },
      mode: 'visual' as const,
      selection: { anchor: 1, head: 19 },
    },
    {
      name: 'a visual head moved back onto the start of the chip it ended on leaves the chip out',
      doc: ONE_CHIP,
      from: { anchor: 1, head: 19 },
      to: { anchor: 1, head: 5 },
      mode: 'visual' as const,
      selection: { anchor: 1, head: 4 },
    },
    {
      name: "a one-chip visual selection whose head moves back inside the chip ends on the chip's start",
      doc: ONE_CHIP,
      from: { anchor: 4, head: 19 },
      to: { anchor: 4, head: 11 },
      mode: 'visual' as const,
      selection: { anchor: 19, head: 4 },
    },
    {
      name: "a one-chip visual selection on the chip's start whose head moves forward inside the chip ends on its last character",
      doc: ONE_CHIP,
      from: { anchor: 19, head: 4 },
      to: { anchor: 19, head: 10 },
      mode: 'visual' as const,
      selection: { anchor: 4, head: 19 },
    },
    {
      name: "an unchanged one-chip visual selection on the chip's start keeps its direction",
      doc: ONE_CHIP,
      from: { anchor: 19, head: 4 },
      to: { anchor: 19, head: 4 },
      mode: 'visual' as const,
      selection: { anchor: 19, head: 4 },
    },
    {
      name: 'a linewise visual selection moved back up to a line ending in a chip keeps the chip',
      doc: LINE_END_CHIP_THEN_LINE,
      from: { anchor: 0, head: 24 },
      to: { anchor: 0, head: 19 },
      mode: 'visualLine' as const,
      selection: { anchor: 0, head: 19 },
    },
    {
      name: 'a visual selection begun on a chip is the chip',
      doc: ONE_CHIP,
      from: { anchor: 4 },
      to: { anchor: 4, head: 5 },
      mode: 'visual' as const,
      selection: { anchor: 4, head: 19 },
    },
    {
      name: "a visual anchor inside a chip it starts on goes to the chip's start",
      doc: ONE_CHIP,
      from: { anchor: 10, head: 11 },
      to: { anchor: 10, head: 22 },
      mode: 'visual' as const,
      selection: { anchor: 4, head: 22 },
    },
    {
      name: "an operator's selection in normal mode widens over a chip",
      doc: ONE_CHIP,
      from: { anchor: 4 },
      to: { anchor: 4, head: 5 },
      mode: 'normal' as const,
      selection: { anchor: 4, head: 19 },
    },
    {
      name: 'a selection in insert mode stays as it is',
      doc: ONE_CHIP,
      from: { anchor: 2 },
      to: { anchor: 2, head: 6 },
      mode: 'insert' as const,
      selection: { anchor: 2, head: 6 },
    },
  ])('$name', ({ doc, from, to, mode, selection }) => {
    expect(settled(doc, from, { selection: to }, mode)).toEqual({
      text: doc,
      ...selection,
    });
  });

  it.each([
    {
      name: "a delete of a chip's first character takes the chip",
      doc: ONE_CHIP,
      spec: { changes: { from: 4, to: 5 } },
      mode: 'normal' as const,
      text: 'see  now',
    },
    {
      name: "a delete from a chip's inside into the next word takes the chip",
      doc: ONE_CHIP,
      spec: { changes: { from: 10, to: 21 } },
      mode: 'normal' as const,
      text: 'see ow',
    },
    {
      name: 'a delete across the end of one chip and the start of the next takes both',
      doc: TWO_CHIPS,
      spec: { changes: { from: 4, to: 9 } },
      mode: 'visual' as const,
      text: 'x  y',
    },
    {
      name: 'a transaction marked skipsChipRules stays as it is',
      doc: ONE_CHIP,
      spec: {
        changes: { from: 4, to: 5 },
        annotations: skipsChipRules.of(true),
      },
      mode: 'normal' as const,
      text: 'see tmp/chips/a.md now',
    },
    {
      name: 'a paste inside a chip goes in after it',
      doc: ONE_CHIP,
      spec: { changes: { from: 5, insert: ' xy' } },
      mode: 'normal' as const,
      text: 'see /tmp/chips/a.md xy now',
    },
    {
      name: "a paste on a chip's start goes in before it",
      doc: ONE_CHIP,
      spec: { changes: { from: 4, insert: 'xy ' } },
      mode: 'normal' as const,
      text: 'see xy /tmp/chips/a.md now',
    },
    {
      name: 'typing on the end of a chip deletes nothing',
      doc: ONE_CHIP,
      spec: { changes: { from: 19, insert: 'x' } },
      mode: 'insert' as const,
      text: 'see /tmp/chips/a.mdx now',
    },
  ])('$name', ({ doc, spec, mode, text }) => {
    expect(settled(doc, { anchor: 0 }, spec, mode).text).toBe(text);
  });

  it('a blockwise visual selection keeps its ranges, its main range widened over a chip', () => {
    // `/a/b` spans 3 to 7 and `/c/d` 11 to 15; the block takes columns 1 to 4.
    const block = EditorSelection.create(
      [EditorSelection.range(1, 5), EditorSelection.range(9, 13)],
      1,
    );
    const state = EditorState.create({
      doc: 'ab /a/b\ncd /c/d',
      selection: block,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        fileChipExtension(CHIP_DRAWING),
        EditorState.transactionFilter.of((tr) =>
          applyChipRules(tr, CHIP_PATHS, 'visualBlock'),
        ),
      ],
    });
    const { ranges, mainIndex } = state.update({ selection: block }).state
      .selection;
    expect({
      ranges: ranges.map(({ anchor, head }) => ({ anchor, head })),
      mainIndex,
    }).toEqual({
      ranges: [
        { anchor: 1, head: 5 },
        { anchor: 9, head: 15 },
      ],
      mainIndex: 1,
    });
  });
});

describe('movedPasteShift', () => {
  it.each([
    {
      name: 'the cursor a vim paste inside a chip places next moves on as far as the paste moved past the chip',
      paste: { from: 5, insert: ' xy' },
      isVimOp: true,
      placesLater: false,
      shift: 14,
    },
    {
      name: 'a cursor placed in a later operation stays where it is placed',
      paste: { from: 5, insert: ' xy' },
      isVimOp: true,
      placesLater: true,
      shift: 0,
    },
    {
      name: 'a paste outside a vim operation moves no cursor',
      paste: { from: 5, insert: ' xy' },
      isVimOp: false,
      placesLater: false,
      shift: 0,
    },
    {
      name: "a paste on a chip's start moves no cursor",
      paste: { from: 4, insert: 'xy ' },
      isVimOp: true,
      placesLater: false,
      shift: 0,
    },
  ])('$name', ({ paste, isVimOp, placesLater, shift }) => {
    const state = EditorState.create({
      doc: ONE_CHIP,
      extensions: fileChipExtension(CHIP_DRAWING),
    });
    const cm: VimOperationHolder = { curOp: { $d: 0, isVimOp } };
    const pasted = state.update({ changes: paste });
    noteMovedPaste(cm, pasted);
    if (placesLater) {
      cm.curOp = { $d: 1, isVimOp: true };
    }
    const placed = pasted.state.update({ selection: { anchor: 7 } });
    expect(movedPasteShift(cm, placed)).toBe(shift);
  });
});

// A vim delete of the chip's first character, as the chip rules see it.
const CHIP_CUT = { from: 4, to: 5 };

describe('noteWidenedCut', () => {
  it.each([
    {
      name: "a vim delete that cuts into a chip puts the whole chip in the operation's register write",
      cut: CHIP_CUT,
      isVimOp: true,
      writesLater: false,
      written: '/',
      register: '/tmp/chips/a.md',
    },
    {
      name: "a later operation's register write keeps its own text",
      cut: CHIP_CUT,
      isVimOp: true,
      writesLater: true,
      written: '/',
      register: '/',
    },
    {
      name: 'a register write of other text keeps its own text',
      cut: CHIP_CUT,
      isVimOp: true,
      writesLater: false,
      written: 'x',
      register: 'x',
    },
    {
      name: 'a delete outside a vim operation leaves the register write as it is',
      cut: CHIP_CUT,
      isVimOp: false,
      writesLater: false,
      written: '/',
      register: '/',
    },
    {
      name: 'a delete that cuts into no chip leaves the register write as it is',
      cut: { from: 0, to: 2 },
      isVimOp: true,
      writesLater: false,
      written: 'se',
      register: 'se',
    },
  ])('$name', ({ cut, isVimOp, writesLater, written, register }) => {
    const state = EditorState.create({
      doc: ONE_CHIP,
      extensions: fileChipExtension(CHIP_DRAWING),
    });
    const cm: VimOperationHolder = { curOp: { $d: 0, isVimOp } };
    noteWidenedCut(cm, state.update({ changes: cut }));
    if (writesLater) {
      cm.curOp = { $d: 1, isVimOp: true };
    }
    const registers = Vim.getRegisterController();
    registers.pushText(undefined, 'delete', written);
    expect(registers.getRegister().toString()).toBe(register);
  });
});
