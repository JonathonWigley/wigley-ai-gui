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
// falls strictly inside a chip. In insert mode the cursor sits between
// characters: the chip's end when it moved forward, else its start. Outside
// insert mode the cursor is on a character, and the chip is that character:
// its start.
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
  return isInsert && movedForward ? chip.to : chip.from;
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
// moves and deletes through its own transactions, so a filter applies
// `applyChipRules` to each, keeps vim's own visual selection off a chip's
// inside, and notes each delete it widened so the register takes the whole
// chip. Vim's character and word motions count a chip as one character
// through `defineChipMotions`.
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
      if (vim.visualMode && !tr.docChanged) {
        settleVisualEnds(cm, vim.sel, fileChipsOf(tr.startState));
      }
      return applyChipRules(tr, drawing.paths, editModeOf(vim));
    }),
  ];
}

// `tr`, followed when a rule applies by the deletions that take each chip it
// cut into whole and the selection the rules settle on: an empty selection
// kept off a chip's inside, as `snapHead` places it, and outside insert mode
// a selection widened over every chip it cuts into. A transaction marked
// `skipsChipRules` stays as it is.
export function applyChipRules(
  tr: Transaction,
  paths: Paths,
  mode: EditMode,
): Transaction | readonly TransactionSpec[] {
  if (tr.annotation(skipsChipRules) === true) {
    return tr;
  }
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
  const previousHead = remainders.mapPos(
    tr.changes.mapPos(tr.startState.selection.main.head),
  );
  const main = settledMain(mapped.main, chips, previousHead, mode);
  const isSelectionSettled = main.eq(mapped.main);
  if (remainders.empty && isSelectionSettled) {
    return tr;
  }
  const selection = isSelectionSettled
    ? undefined
    : mapped.replaceRange(main, mapped.mainIndex);
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

// The main selection with the chip rules applied: outside insert mode a
// selection widened over every chip it cuts into, keeping its direction; an
// empty one snapped off a chip's inside.
function settledMain(
  range: SelectionRange,
  chips: readonly Span[],
  previousHead: number,
  mode: EditMode,
): SelectionRange {
  const isInsert = mode === 'insert';
  if (range.empty) {
    return EditorSelection.cursor(
      snapHead(chips, previousHead, range.head, isInsert),
    );
  }
  if (isInsert) {
    return range;
  }
  const widened = widenRange(chips, range.from, range.to);
  return range.anchor <= range.head
    ? EditorSelection.range(widened.from, widened.to)
    : EditorSelection.range(widened.to, widened.from);
}

type VimPos = ReturnType<CodeMirror['posFromIndex']>;

// Each end of vim's visual selection that falls strictly inside a chip moves
// to the chip's start, where vim counts the chip as one character, as the
// widened selection draws it.
function settleVisualEnds(
  cm: CodeMirror,
  sel: { head: VimPos; anchor: VimPos },
  chips: readonly Span[],
) {
  sel.head = chipStartOf(cm, chips, sel.head);
  sel.anchor = chipStartOf(cm, chips, sel.anchor);
}

function chipStartOf(
  cm: CodeMirror,
  chips: readonly Span[],
  pos: VimPos,
): VimPos {
  const offset = cm.indexFromPos(pos);
  const chip = chips.find((range) => range.from < offset && offset < range.to);
  return chip === undefined ? pos : cm.posFromIndex(chip.from);
}

// The text a vim command's delete took and the whole-chip text the chip
// rules widened it to, while the vim operation that made it still runs.
interface WidenedCut {
  cm: CodeMirror;
  operation: object;
  cut: string;
  whole: string;
}

let widenedCut: WidenedCut | null = null;

// Vim reads a delete's text into its register before the chip rules widen
// the delete, so the one delete a vim command makes is noted here when it
// cuts into a chip.
function noteWidenedCut(cm: CodeMirror, tr: Transaction) {
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
