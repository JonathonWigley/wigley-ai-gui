import { EditorState, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { CHIP_DRAWING, CHIP_PATHS } from './chip-paths.test-support';
import {
  applyChipRules,
  type EditMode,
  fileChipExtension,
  skipsChipRules,
  snapHead,
  widenRange,
} from './chip-decorations';

const CHIPS = [{ from: 4, to: 20 }];

describe('snapHead', () => {
  it.each([
    { previous: 3, next: 5, isInsert: false, head: 4 },
    { previous: 20, next: 19, isInsert: false, head: 4 },
    { previous: 3, next: 5, isInsert: true, head: 20 },
    { previous: 20, next: 19, isInsert: true, head: 4 },
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

// The chip `/tmp/chips/a.md` spans 4 to 19.
const ONE_CHIP = 'see /tmp/chips/a.md now';
// The chips `/a/b` and `/c/d` span 2 to 6 and 7 to 11.
const TWO_CHIPS = 'x /a/b /c/d y';

describe('applyChipRules', () => {
  it.each([
    {
      name: 'a cursor moved into a chip lands on its start in normal mode',
      from: { anchor: 4 },
      to: { anchor: 5 },
      mode: 'normal' as const,
      selection: { anchor: 4, head: 4 },
    },
    {
      name: 'a cursor moved back into a chip lands on its start in normal mode',
      from: { anchor: 19 },
      to: { anchor: 18 },
      mode: 'normal' as const,
      selection: { anchor: 4, head: 4 },
    },
    {
      name: 'a cursor moved into a chip lands on its end in insert mode',
      from: { anchor: 4 },
      to: { anchor: 5 },
      mode: 'insert' as const,
      selection: { anchor: 19, head: 19 },
    },
    {
      name: 'a cursor moved back into a chip lands on its start in insert mode',
      from: { anchor: 19 },
      to: { anchor: 18 },
      mode: 'insert' as const,
      selection: { anchor: 4, head: 4 },
    },
    {
      name: 'a visual selection widens over a chip it cuts',
      from: { anchor: 1 },
      to: { anchor: 1, head: 6 },
      mode: 'visual' as const,
      selection: { anchor: 1, head: 19 },
    },
    {
      name: 'a backward visual selection widens and keeps its direction',
      from: { anchor: 21 },
      to: { anchor: 21, head: 10 },
      mode: 'visual' as const,
      selection: { anchor: 21, head: 4 },
    },
    {
      name: "an operator's selection in normal mode widens over a chip",
      from: { anchor: 4 },
      to: { anchor: 4, head: 5 },
      mode: 'normal' as const,
      selection: { anchor: 4, head: 19 },
    },
    {
      name: 'a selection in insert mode stays as it is',
      from: { anchor: 2 },
      to: { anchor: 2, head: 6 },
      mode: 'insert' as const,
      selection: { anchor: 2, head: 6 },
    },
  ])('$name', ({ from, to, mode, selection }) => {
    expect(settled(ONE_CHIP, from, { selection: to }, mode)).toEqual({
      text: ONE_CHIP,
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
      name: 'typing on the end of a chip deletes nothing',
      doc: ONE_CHIP,
      spec: { changes: { from: 19, insert: 'x' } },
      mode: 'insert' as const,
      text: 'see /tmp/chips/a.mdx now',
    },
  ])('$name', ({ doc, spec, mode, text }) => {
    expect(settled(doc, { anchor: 0 }, spec, mode).text).toBe(text);
  });
});
