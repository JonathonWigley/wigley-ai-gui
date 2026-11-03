// File chips in a box: each path `fileChipsIn` finds draws as a pill, and the
// cursor and deletions treat it as one character.
import {
  Annotation,
  ChangeSet,
  EditorSelection,
  EditorState,
  type Extension,
  Facet,
  type SelectionRange,
  StateField,
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

// Vim's mode as the chip rules read it.
export type EditMode = 'insert' | 'visual' | 'normal';

export function editModeOf(vim: {
  insertMode: boolean;
  visualMode: boolean;
}): EditMode {
  if (vim.insertMode) {
    return 'insert';
  }
  return vim.visualMode ? 'visual' : 'normal';
}

// Marks a transaction that places its own text and selection, as `setText`
// and `insert` do, so the chip rules leave it as it is.
export const skipsChipRules = Annotation.define<boolean>();

// Where an empty selection's head lands once `next`, moved from `previous`,
// falls strictly inside a chip: the chip's end when it moved forward, else its
// start. In normal mode (`isInsert` false) a chip that ends its line keeps the
// head at its start, since the chip is then the line's last character.
export function snapHead(
  chips: readonly Span[],
  previous: number,
  next: number,
  lineEnd: number,
  isInsert: boolean,
): number {
  const chip = chips.find((range) => range.from < next && next < range.to);
  if (chip === undefined) {
    return next;
  }
  const movedForward = next > previous;
  const endsLineInNormalMode = !isInsert && chip.to === lineEnd;
  return movedForward && !endsLineInNormalMode ? chip.to : chip.from;
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
// moves and deletes through its own transactions, so a filter applies the
// chip rules to each, gives vim's own characterwise visual selection the
// selection they settle on, and notes each delete it widened so the register
// takes the whole chip. Vim's character and word motions count a chip as one
// character through `defineChipMotions`.
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
      const rules = chipRulesOf(tr, drawing.paths, editModeOf(vim));
      const main = rules.selection?.main;
      const isVisualCharacterwise =
        vim.visualMode && !vim.visualBlock && !vim.visualLine;
      if (isVisualCharacterwise && !tr.docChanged && main && !main.empty) {
        placeVimSelection(cm, vim.sel, main);
      }
      return withChipRules(tr, rules);
    }),
  ];
}

// `tr`, followed when a rule applies by the deletions that take each chip it
// cut into whole and the selection the rules settle on: an empty selection
// kept off a chip's inside, as `snapHead` places it; in visual mode a
// selection settled as `settledVisualSelection` reads it; in normal mode a
// selection widened over every chip it cuts into. A transaction marked
// `skipsChipRules` stays as it is.
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

// What the chip rules add to a transaction: the chip remainders it deletes,
// and the selection it ends on when the rules move it.
interface ChipRules {
  remainders: ChangeSet;
  selection: EditorSelection | undefined;
}

function chipRulesOf(tr: Transaction, paths: Paths, mode: EditMode): ChipRules {
  const remainders = ChangeSet.of(
    chipRemaindersOf(tr, fileChipsOf(tr.startState)),
    tr.newDoc.length,
  );
  const doc = remainders.apply(tr.newDoc);
  const isDocUnchanged = !tr.docChanged && remainders.empty;
  const chips = isDocUnchanged
    ? fileChipsOf(tr.startState)
    : fileChipsIn(doc.toString(), paths);
  const mapped = tr.newSelection.map(remainders);
  const previous = tr.startState.selection.main.map(tr.changes).map(remainders);
  const main = settledMain(mapped.main, {
    chips,
    previous,
    lineEnd: doc.lineAt(mapped.main.head).to,
    mode,
  });
  const selection = main.eq(mapped.main)
    ? undefined
    : mapped.replaceRange(main, mapped.mainIndex);
  return { remainders, selection };
}

function withChipRules(
  tr: Transaction,
  { remainders, selection }: ChipRules,
): Transaction | readonly TransactionSpec[] {
  if (remainders.empty && selection === undefined) {
    return tr;
  }
  return [tr, { changes: remainders, selection, sequential: true }];
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
// the end of the line its head is on, and vim's mode.
interface SettleContext {
  chips: readonly Span[];
  previous: SelectionRange;
  lineEnd: number;
  mode: EditMode;
}

// The main selection with the chip rules applied: an empty one snapped off a
// chip's inside; in visual mode one settled as `settledVisualSelection`; in
// normal mode one widened over every chip it cuts into, keeping its
// direction.
function settledMain(
  range: SelectionRange,
  { chips, previous, lineEnd, mode }: SettleContext,
): SelectionRange {
  const isInsert = mode === 'insert';
  if (range.empty) {
    return EditorSelection.cursor(
      snapHead(chips, previous.head, range.head, lineEnd, isInsert),
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
// the chip whole; with both ends on one chip the selection is that chip. A
// head that lands on a chip's inside goes past the chip's inside the way it
// moved, as a normal-mode cursor does, so a search or a `;` from it finds the
// next match rather than the one inside the chip.
function settledVisualSelection(
  chips: readonly Span[],
  { anchor, head }: VimSelection,
  previousHead: number,
): VimSelection {
  const headChip = chipUnder(chips, head);
  const anchorChip = chipUnder(chips, anchor);
  if (headChip !== undefined && headChip === anchorChip) {
    return { anchor: headChip.from, head: headChip.to - 1 };
  }
  const settledHead =
    headChip === undefined
      ? head
      : settledVisualHead(headChip, anchor, head, head > previousHead);
  if (anchorChip === undefined) {
    return { anchor, head: settledHead };
  }
  const anchorStarts = anchorChip.from <= settledHead;
  return {
    anchor: anchorStarts ? anchorChip.from : anchorChip.to - 1,
    head: settledHead,
  };
}

// Where a visual head on `chip`, with the anchor off it, settles. On the
// chip's start it is on the chip. Inside it, a forward move takes the chip in
// when the head ends the selection and leaves it out when the head starts it;
// a backward move the other way round.
function settledVisualHead(
  chip: Span,
  anchor: number,
  head: number,
  movedForward: boolean,
): number {
  const headEnds = anchor < chip.from;
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
