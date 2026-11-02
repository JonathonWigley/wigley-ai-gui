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
import { getCM } from '@replit/codemirror-vim';
import type { FileChipDrawing } from '../../contracts/editor';
import {
  type FileChipRange,
  fileChipsIn,
} from '../../shared/page/file-drop/file-chips';

interface Span {
  from: number;
  to: number;
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
// moves and deletes through its own transactions, so a filter takes a chip
// whole in each deletion and visual selection, and keeps an empty selection's
// head off a chip's inside, in every transaction not marked `skipsChipRules`.
export function fileChipExtension(drawing: FileChipDrawing): Extension {
  let hostView: EditorView | null = null;
  const tracksView = ViewPlugin.define((view) => {
    hostView = view;
    return {};
  });
  return [
    chipDrawing.of(drawing),
    drawnChipsField,
    tracksView,
    EditorState.transactionFilter.of((tr) =>
      hostView === null ? tr : applyChipRules(tr, hostView, drawing),
    ),
  ];
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

// `tr`, followed when a rule applies by the deletions that take each chip it
// cut into whole and the selection the rules settle on.
function applyChipRules(
  tr: Transaction,
  view: EditorView,
  drawing: FileChipDrawing,
): Transaction | readonly TransactionSpec[] {
  const vim = getCM(view)?.state.vim;
  if (tr.annotation(skipsChipRules) === true || !vim) {
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
    : fileChipsIn(doc.toString(), drawing.paths);
  const mapped = tr.newSelection.map(remainders);
  const previousHead = remainders.mapPos(
    tr.changes.mapPos(tr.startState.selection.main.head),
  );
  const main = settledMain(mapped.main, {
    chips,
    previousHead,
    lineEnd: doc.lineAt(mapped.main.head).to,
    isInsert: vim.insertMode === true,
    isVisual: vim.visualMode === true,
  });
  const isSelectionSettled = main.eq(mapped.main);
  if (remainders.empty && isSelectionSettled) {
    return tr;
  }
  const selection = isSelectionSettled
    ? undefined
    : mapped.replaceRange(main, mapped.mainIndex);
  return [tr, { changes: remainders, selection, sequential: true }];
}

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

interface CursorContext {
  chips: readonly FileChipRange[];
  previousHead: number;
  lineEnd: number;
  isInsert: boolean;
  isVisual: boolean;
}

// The main selection with the chip rules applied: a visual selection widened
// over every chip it cuts into, keeping its direction; an empty one snapped
// off a chip's inside.
function settledMain(
  range: SelectionRange,
  context: CursorContext,
): SelectionRange {
  if (range.empty) {
    const head = snapHead(
      context.chips,
      context.previousHead,
      range.head,
      context.lineEnd,
      context.isInsert,
    );
    return EditorSelection.cursor(head);
  }
  if (!context.isVisual) {
    return range;
  }
  const widened = widenRange(context.chips, range.from, range.to);
  return range.anchor <= range.head
    ? EditorSelection.range(widened.from, widened.to)
    : EditorSelection.range(widened.to, widened.from);
}
