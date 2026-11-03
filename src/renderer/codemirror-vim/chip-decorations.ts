// File chips in a box: each path `fileChipsIn` finds draws as a pill, and the
// cursor and deletions treat it as one character.
import {
  Annotation,
  type ChangeSpec,
  ChangeSet,
  EditorSelection,
  EditorState,
  type Extension,
  Facet,
  type SelectionRange,
  StateField,
  type Text,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';
import { type CodeMirror, getCM, Vim } from '@replit/codemirror-vim';
import type { FileChipDrawing } from '../../contracts/editor';
import type { Paths } from '../../contracts/paths';
import {
  type FileChipRange,
  fileChipsIn,
} from '../../shared/page/file-drop/file-chips';

export interface Span {
  from: number;
  to: number;
}

// Vim's mode as the chip rules read it; `visual` is characterwise visual.
export type EditMode =
  | 'insert'
  | 'visual'
  | 'visualLine'
  | 'visualBlock'
  | 'normal';

export function editModeOf(vim: {
  insertMode: boolean;
  visualMode: boolean;
  visualLine: boolean;
  visualBlock: boolean;
}): EditMode {
  if (vim.insertMode) {
    return 'insert';
  }
  if (!vim.visualMode) {
    return 'normal';
  }
  if (vim.visualBlock) {
    return 'visualBlock';
  }
  return vim.visualLine ? 'visualLine' : 'visual';
}

// Marks a transaction that places its own text and selection, as `setText`
// and `insert` do, so the chip rules leave it as it is.
export const skipsChipRules = Annotation.define<boolean>();

// Where an empty selection's head lands once `next`, moved from `previous`,
// falls strictly inside a chip: its start, except that a forward move goes to
// the chip's end in insert mode, and in normal mode (`isInsert` false) when
// `previous` was already on the chip's start, so a search, `;` or `l` from a
// chip steps past it. A chip's end may be its line's end.
export function snapHead(
  chips: readonly Span[],
  previous: number,
  next: number,
  isInsert: boolean,
): number {
  const chip = chips.find((range) => range.from < next && next < range.to);
  if (chip === undefined) {
    return next;
  }
  const movedForward = next > previous;
  const stepsPast = isInsert || previous === chip.from;
  return movedForward && stepsPast ? chip.to : chip.from;
}

// Vim's characterwise visual selection as offsets: the character under each
// end, as vim reads a CodeMirror selection; a cursor is both ends.
export interface VimSelection {
  anchor: number;
  head: number;
}

// The visual selection vim reads from CodeMirror's `range`: the range's last
// character is the end it ends on.
export function vimSelectionOf(range: {
  anchor: number;
  head: number;
}): VimSelection {
  if (range.head < range.anchor) {
    return { anchor: range.anchor - 1, head: range.head };
  }
  const head = range.head > range.anchor ? range.head - 1 : range.head;
  return { anchor: range.anchor, head };
}

// The CodeMirror range vim draws for `selection`, each end's character in it.
function rangeOfVimSelection(selection: VimSelection): SelectionRange {
  return selection.head < selection.anchor
    ? EditorSelection.range(selection.anchor + 1, selection.head)
    : EditorSelection.range(selection.anchor, selection.head + 1);
}

// `from` and `to`, each widened to the edge of a chip it falls strictly
// inside, so a deletion takes a chip whole.
export function widenRange(
  chips: readonly Span[],
  from: number,
  to: number,
): Span {
  let widened = { from, to };
  for (const chip of chips) {
    if (chip.from < from && from < chip.to) {
      widened = { ...widened, from: chip.from };
    }
    if (chip.from < to && to < chip.to) {
      widened = { ...widened, to: chip.to };
    }
  }
  return widened;
}

// The chips drawn in an editor's text; `[]` in an editor that draws none.
export function fileChipsOf(state: EditorState): readonly FileChipRange[] {
  return state.field(drawnChipsField, false)?.chips ?? [];
}

// Chips drawn over every path in the text, rebuilt on each change, and the
// same ranges made atomic so CodeMirror's own motions step over them. Vim
// moves, deletes and pastes through its own transactions, so a filter applies
// the chip rules to each, gives vim's own characterwise visual selection the
// selection they settle on, notes each delete it widened so the register
// takes the whole chip, and moves the cursor vim places after a paste the
// rules moved past a chip along with the paste. Vim's character and word
// motions count a chip as one character through `defineChipMotions`.
export function fileChipExtension(drawing: FileChipDrawing): Extension {
  let hostView: EditorView | null = null;
  const tracksView = ViewPlugin.define((view) => {
    hostView = view;
    return {};
  });
  fillRegistersWithWholeChips();
  return [
    chipDrawing.of(drawing),
    drawnChipsField,
    tracksView,
    EditorState.transactionFilter.of((tr) => {
      const cm = hostView === null ? null : getCM(hostView);
      const vim = cm?.state.vim;
      if (!cm || !vim || tr.annotation(skipsChipRules) === true) {
        return tr;
      }
      noteWidenedCut(cm, tr);
      const cursorShift = movedPasteShift(cm, tr);
      noteMovedPaste(cm, tr);
      const mode = editModeOf(vim);
      const rules = chipRulesOf(tr, drawing.paths, mode, cursorShift);
      const main = rules.selection?.main;
      if (mode === 'visual' && !tr.docChanged && main && !main.empty) {
        placeVimSelection(cm, vim.sel, main);
      }
      return withChipRules(tr, rules);
    }),
  ];
}

// `tr`, followed when a rule applies by the deletions that take each chip it
// cut into whole, or else by each insertion it made strictly inside a chip
// moved to that chip's end, and the selection the rules settle on: an empty
// selection kept off a chip's inside, as `snapHead` places it; in
// characterwise visual mode a selection settled as `settledVisualSelection`
// reads it; in normal, linewise and blockwise visual mode a selection widened
// over every chip it cuts into. A transaction marked `skipsChipRules` stays as
// it is.
export function applyChipRules(
  tr: Transaction,
  paths: Paths,
  mode: EditMode,
): Transaction | readonly TransactionSpec[] {
  if (tr.annotation(skipsChipRules) === true) {
    return tr;
  }
  return withChipRules(tr, chipRulesOf(tr, paths, mode));
}

// What the chip rules add to a transaction: the chip remainders it deletes or
// the insertions it moves past chips, and the selection it ends on when the
// rules move it.
interface ChipRules {
  changes: ChangeSet;
  selection: EditorSelection | undefined;
}

// The chip rules for `tr` in `mode`, its cursor first moved on by
// `cursorShift`, as `movedPasteShift` reads it.
function chipRulesOf(
  tr: Transaction,
  paths: Paths,
  mode: EditMode,
  cursorShift = 0,
): ChipRules {
  const chipsBefore = fileChipsOf(tr.startState);
  const remainders = chipRemaindersOf(tr, chipsBefore);
  const changes = ChangeSet.of(
    remainders.length > 0
      ? remainders
      : insertionsMovedPastChips(tr, chipsBefore),
    tr.newDoc.length,
  );
  const isDocUnchanged = !tr.docChanged && changes.empty;
  const chips = isDocUnchanged
    ? chipsBefore
    : fileChipsIn(changes.apply(tr.newDoc).toString(), paths);
  const placed = tr.newSelection.map(changes);
  const isShifted = cursorShift !== 0 && placed.main.empty;
  const mapped = isShifted
    ? placed.replaceRange(
        EditorSelection.cursor(placed.main.head + cursorShift),
        placed.mainIndex,
      )
    : placed;
  const previous = tr.startState.selection.main.map(tr.changes).map(changes);
  const main = settledMain(mapped.main, { chips, previous, mode });
  const selection = main.eq(placed.main)
    ? undefined
    : mapped.replaceRange(main, mapped.mainIndex);
  return { changes, selection };
}

function withChipRules(
  tr: Transaction,
  { changes, selection }: ChipRules,
): Transaction | readonly TransactionSpec[] {
  if (changes.empty && selection === undefined) {
    return tr;
  }
  return [tr, { changes, selection, sequential: true }];
}

class FileChipWidget extends WidgetType {
  constructor(
    private readonly chip: FileChipRange,
    private readonly fileIcon: () => HTMLElement,
  ) {
    super();
  }

  eq(other: FileChipWidget): boolean {
    return other.chip.path === this.chip.path;
  }

  toDOM(): HTMLElement {
    const pill = document.createElement('span');
    pill.className = 'wg-file-chip';
    pill.title = this.chip.path;
    const glyph = this.fileIcon();
    glyph.classList.add('wg-file-chip-icon');
    const name = document.createElement('span');
    name.className = 'wg-file-chip-name';
    name.textContent = this.chip.name;
    pill.append(glyph, name);
    return pill;
  }
}

interface DrawnChips {
  chips: readonly FileChipRange[];
  decorations: DecorationSet;
}

// The drawing the box's `fileChipExtension` gave; only that extension adds
// the field that reads it.
const chipDrawing = Facet.define<FileChipDrawing, FileChipDrawing | undefined>({
  combine: (drawings) => drawings[0],
});

function drawnChips(state: EditorState): DrawnChips {
  const drawing = state.facet(chipDrawing);
  if (drawing === undefined) {
    throw new Error('File chips drawn in an editor given no FileChipDrawing');
  }
  const chips = fileChipsIn(state.doc.toString(), drawing.paths);
  const decorations = Decoration.set(
    chips.map((chip) =>
      Decoration.replace({
        widget: new FileChipWidget(chip, drawing.fileIcon),
      }).range(chip.from, chip.to),
    ),
  );
  return { chips, decorations };
}

const drawnChipsField = StateField.define<DrawnChips>({
  create: (state) => drawnChips(state),
  update: (value, tr) => (tr.docChanged ? drawnChips(tr.state) : value),
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
});

// The parts of chips each deletion in `tr` cut into and left, as ranges in
// `tr`'s new document, merged where they meet.
function chipRemaindersOf(
  tr: Transaction,
  chips: readonly FileChipRange[],
): Span[] {
  const remainders: Span[] = [];
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA === toA) {
      return;
    }
    const widened = widenRange(chips, fromA, toA);
    if (widened.from < fromA) {
      remainders.push({
        from: tr.changes.mapPos(widened.from),
        to: tr.changes.mapPos(fromA, -1),
      });
    }
    if (toA < widened.to) {
      remainders.push({
        from: tr.changes.mapPos(toA, 1),
        to: tr.changes.mapPos(widened.to),
      });
    }
  });
  return mergedSpans(remainders);
}

// An insertion `tr` made strictly inside a chip: where `tr`'s old document had
// it, where its new document holds it, the text, and the chip.
interface InsertionInsideChip {
  at: number;
  inserted: Span;
  text: Text;
  chip: FileChipRange;
}

function insertionsInsideChips(
  tr: Transaction,
  chips: readonly FileChipRange[],
): InsertionInsideChip[] {
  const insertions: InsertionInsideChip[] = [];
  tr.changes.iterChanges((fromA, toA, fromB, toB, text) => {
    const chip = chips.find((range) => range.from < fromA && fromA < range.to);
    if (fromA === toA && chip !== undefined) {
      insertions.push({
        at: fromA,
        inserted: { from: fromB, to: toB },
        text,
        chip,
      });
    }
  });
  return insertions;
}

// Each insertion `tr` made strictly inside a chip, as vim's `p` makes on a
// chip's start, moved to the chip's end, as changes in `tr`'s new document.
function insertionsMovedPastChips(
  tr: Transaction,
  chips: readonly FileChipRange[],
): ChangeSpec[] {
  return insertionsInsideChips(tr, chips).flatMap(
    ({ inserted, text, chip }) => [
      inserted,
      { from: tr.changes.mapPos(chip.to), insert: text },
    ],
  );
}

function mergedSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && span.from <= last.to) {
      last.to = Math.max(last.to, span.to);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

// What the main selection is settled against: the chips in the text it ends
// on, the main selection the transaction started from, mapped into that text,
// and vim's mode.
interface SettleContext {
  chips: readonly Span[];
  previous: SelectionRange;
  mode: EditMode;
}

// The main selection with the chip rules applied: an empty one snapped off a
// chip's inside; in characterwise visual mode one settled as
// `settledVisualSelection`; in normal, linewise and blockwise visual mode one
// widened over every chip it cuts into, keeping its direction.
function settledMain(
  range: SelectionRange,
  { chips, previous, mode }: SettleContext,
): SelectionRange {
  const isInsert = mode === 'insert';
  if (range.empty) {
    return EditorSelection.cursor(
      snapHead(chips, previous.head, range.head, isInsert),
    );
  }
  if (isInsert) {
    return range;
  }
  if (mode === 'visual') {
    const selection = settledVisualSelection(
      chips,
      vimSelectionOf(range),
      vimSelectionOf(previous).head,
    );
    return rangeOfVimSelection(selection);
  }
  const widened = widenRange(chips, range.from, range.to);
  return range.anchor <= range.head
    ? EditorSelection.range(widened.from, widened.to)
    : EditorSelection.range(widened.to, widened.from);
}

function chipUnder(chips: readonly Span[], at: number): Span | undefined {
  return chips.find((chip) => chip.from <= at && at < chip.to);
}

// Vim's visual `selection` with each chip one character, the head moved from
// `previousHead`. An end on a chip sits on the chip's start when it starts the
// selection and on its last character when it ends it, so the selection holds
// the chip whole. With both ends on one chip the selection is that chip,
// ending on the chip's start when the head moved back, or stayed on the
// selection's start, so that a backward search or `,` from it starts before
// the chip. A head on a chip settles as `settledVisualHead` places it.
function settledVisualSelection(
  chips: readonly Span[],
  { anchor, head }: VimSelection,
  previousHead: number,
): VimSelection {
  const headChip = chipUnder(chips, head);
  const anchorChip = chipUnder(chips, anchor);
  if (headChip !== undefined && headChip === anchorChip) {
    const startsOnHead =
      head < previousHead || (head === previousHead && head < anchor);
    return startsOnHead
      ? { anchor: headChip.to - 1, head: headChip.from }
      : { anchor: headChip.from, head: headChip.to - 1 };
  }
  const settledHead =
    headChip === undefined
      ? head
      : settledVisualHead(headChip, anchor, head, previousHead);
  if (anchorChip === undefined) {
    return { anchor, head: settledHead };
  }
  const anchorStarts = anchorChip.from <= settledHead;
  return {
    anchor: anchorStarts ? anchorChip.from : anchorChip.to - 1,
    head: settledHead,
  };
}

// Where a visual head on `chip`, with the anchor off it, settles once moved
// from `previousHead`. A head that has not moved stays, as vim re-sends a
// settled selection before an operator reads it. A head that ends the
// selection and moved back within the chip it already covered leaves the chip
// out, so a backward search or `,` from it starts before the chip. Otherwise,
// on the chip's start the head is on the chip; inside it, a forward move takes
// the chip in when the head ends the selection and leaves it out when the head
// starts it, and a backward move the other way round.
function settledVisualHead(
  chip: Span,
  anchor: number,
  head: number,
  previousHead: number,
): number {
  if (head === previousHead) {
    return head;
  }
  const headEnds = anchor < chip.from;
  const movedForward = head > previousHead;
  const coveredChip = chip.from <= previousHead && previousHead < chip.to;
  if (headEnds && !movedForward && coveredChip) {
    return chip.from - 1;
  }
  if (head === chip.from) {
    return headEnds ? chip.to - 1 : chip.from;
  }
  if (headEnds) {
    return movedForward ? chip.to - 1 : chip.from - 1;
  }
  return movedForward ? chip.to : chip.from;
}

type VimPos = ReturnType<CodeMirror['posFromIndex']>;

// Sets vim's own visual selection to the one it reads from `range`, so vim's
// next motion starts where the chip rules settled the selection.
function placeVimSelection(
  cm: CodeMirror,
  sel: { head: VimPos; anchor: VimPos },
  range: SelectionRange,
) {
  const { anchor, head } = vimSelectionOf(range);
  sel.anchor = cm.posFromIndex(anchor);
  sel.head = cm.posFromIndex(head);
}

// The editor a vim command runs in, as far as the register fill reads it: the
// operation it runs, with `isVimOp` set while vim runs it.
export type VimOperationHolder = Pick<CodeMirror, 'curOp'>;

// The text a vim command's delete took and the whole-chip text the chip
// rules widened it to, while the vim operation that made it still runs.
interface WidenedCut {
  cm: VimOperationHolder;
  operation: object;
  cut: string;
  whole: string;
}

let widenedCut: WidenedCut | null = null;

// Vim reads a delete's text into its register before the chip rules widen
// the delete, so the one delete a vim command makes is noted here when it
// cuts into a chip; the register controller's next `pushText` in the same
// operation writes the whole chips in place of that text.
export function noteWidenedCut(cm: VimOperationHolder, tr: Transaction) {
  const operation = cm.curOp;
  if (!operation?.isVimOp) {
    return;
  }
  const cuts: Span[] = [];
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA < toA) {
      cuts.push({ from: fromA, to: toA });
    }
  });
  if (cuts.length !== 1) {
    return;
  }
  const [cut] = cuts;
  const whole = widenRange(fileChipsOf(tr.startState), cut.from, cut.to);
  const isWidened = whole.from < cut.from || cut.to < whole.to;
  if (isWidened) {
    widenedCut = {
      cm,
      operation,
      cut: tr.startState.sliceDoc(cut.from, cut.to),
      whole: tr.startState.sliceDoc(whole.from, whole.to),
    };
  }
}

// A paste a vim command made strictly inside a chip, which the chip rules
// moved past the chip by `shift`, while the vim operation that made it still
// runs.
interface MovedPaste {
  cm: VimOperationHolder;
  operation: object;
  shift: number;
}

let movedPaste: MovedPaste | null = null;

// Vim places its cursor after a paste from where it put the text, so the
// paste a vim command makes strictly inside a chip, in a transaction that cuts
// into no chip, is noted here; the cursor vim places next in the same
// operation moves on with the paste, as `movedPasteShift` reads it.
export function noteMovedPaste(cm: VimOperationHolder, tr: Transaction) {
  const operation = cm.curOp;
  if (!operation?.isVimOp) {
    return;
  }
  const chips = fileChipsOf(tr.startState);
  const [moved] = insertionsInsideChips(tr, chips);
  const cutsNoChip = chipRemaindersOf(tr, chips).length === 0;
  if (moved !== undefined && cutsNoChip) {
    movedPaste = { cm, operation, shift: moved.chip.to - moved.at };
  }
}

// How far `tr`'s cursor moves on with the paste `noteMovedPaste` noted: the
// paste's shift when `tr` only places the cursor in the same vim operation,
// else 0. Reading it ends the note.
export function movedPasteShift(
  cm: VimOperationHolder,
  tr: Transaction,
): number {
  const noted = movedPaste;
  movedPaste = null;
  const isCursorOfNotedPaste =
    noted !== null &&
    noted.cm.curOp === noted.operation &&
    cm === noted.cm &&
    !tr.docChanged &&
    tr.selection !== undefined;
  return isCursorOfNotedPaste ? noted.shift : 0;
}

const registersFillingWholeChips = new WeakSet<object>();

// Vim offers no hook between reading a delete's text and writing it to a
// register, so its register controller's `pushText` is wrapped once: text a
// widened delete took is written as the whole chips the delete removed.
function fillRegistersWithWholeChips() {
  const registers = Vim.getRegisterController();
  if (registersFillingWholeChips.has(registers)) {
    return;
  }
  registersFillingWholeChips.add(registers);
  const pushText = registers.pushText.bind(registers);
  registers.pushText = (name, operator, text, linewise, blockwise) => {
    const noted = widenedCut;
    widenedCut = null;
    const isNotedCut =
      noted !== null &&
      noted.cm.curOp === noted.operation &&
      noted.cut === text;
    pushText(
      name,
      operator,
      isNotedCut ? noted.whole : text,
      linewise,
      blockwise,
    );
  };
}
