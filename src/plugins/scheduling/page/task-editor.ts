import type { EditorHost } from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import {
  createEditorBoxes,
  keepFocusedBox,
  stepBox,
} from '../../../shared/page/editor-boxes';
import { appSlot } from '../../../shared/page/layout-host/app-slot';
import {
  type DrawnPart,
  disposeDraws,
  type RollbackDeps,
  requireElementIn,
} from '../../../shared/page/layout-host/draw-part';
import type { LayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { element } from '../../../shared/page/dom';
import type {
  CompleteSchedulingLayout,
  SchedulingKit,
  SchedulingLayout,
} from '../layouts/layout';
import {
  ENV_NOTE,
  type EditorRow,
  editorHeading,
  editorRows,
  type TaskEditor,
} from './schedules-state';

const FORM_ID = 'scheduling-editor';

type DrawnRoot = DrawnPart<{ element: HTMLElement }>;

export interface TaskEditorDeps {
  editor: EditorHost;
  log: PluginLog;
  parts: LayoutParts<SchedulingLayout, CompleteSchedulingLayout>;
  // The kit a part of the editor draws with, its keys in `scheduling.editor`.
  kit(rollback: RollbackDeps): SchedulingKit;
  // A box's text changed, by the user's typing.
  changed(field: string, text: string): void;
  // A box took focus, from a key or a click.
  activated(field: string): void;
}

// The editor in the details pane: the `editor` part drawn into the pane's `editor` slot, one `fieldRow` per editor
// row in its `fields` slot, and one vim box per box row, keyed by the row's field and kept across redraws while the
// editor stays open. A row redraws only when what it shows beside its box changes (the rows, a choice, a hint); a box's
// own text never redraws it. The field cursor shows as `is-cursor` on its row.
export interface TaskEditorView {
  // Draws `editor` into `slot`, or empties it for null, destroying the boxes. `always` draws again whatever changed,
  // as after a new layout.
  render(editor: TaskEditor | null, slot: HTMLElement, always: boolean): void;
  // Focuses the box of `field`; false for a row with no box placed.
  focusBox(field: string): boolean;
  // Leaves the focused box; returns its field, or null when none had focus.
  leave(): string | null;
  // The field of the box with focus, or null.
  active(): string | null;
  // The box field `step` boxes from the focused box, clamped at the ends. With no box focused, the next or previous
  // box or multiline row from the cursor's row, null when there is none.
  stepBox(editor: TaskEditor, step: 1 | -1): string | null;
  dispose(): void;
}

export function createTaskEditor(deps: TaskEditorDeps): TaskEditorView {
  const { parts } = deps;
  const boxes = createEditorBoxes<string>(
    deps.editor,
    {
      changed: (field, text) => deps.changed(field, text),
      activated: (field) => deps.activated(field),
    },
    deps.log,
    {
      formIdOf: () => FORM_ID,
      keyOf: (field) => field,
      describe: (field) => `${field} box`,
    },
  );

  const fieldsList = element('ol', 'scheduling-fields');
  let paneDraw: DrawnRoot | null = null;
  let rowDraws: DrawnRoot[] = [];
  // What the pane and the rows were drawn from; null to draw again.
  let drawnPaneKey: string | null = null;
  let drawnRowsKey: string | null = null;
  // The editor the boxes hold text for: a new open destroys the last one's boxes.
  let shownEditor: TaskEditor | null = null;

  // A field row kit's `textBox`: the row's box frame placed in `parent` with the row's text, released with the draw.
  const textBoxSlot = (row: EditorRow, rollback: RollbackDeps) => {
    let isPlaced = false;
    return (parent: HTMLElement): HTMLElement => {
      if (row.kind === 'choice') {
        throw new Error(`${row.field} has no box`);
      }
      if (isPlaced) {
        throw new Error('textBox placed twice');
      }
      isPlaced = true;
      const frame = boxes.place(parent, row.field, row.value);
      frame.classList.add('scheduling-box', `scheduling-box--${row.kind}`);
      rollback.recordBox(() => boxes.release(row.field));
      return frame;
    };
  };

  const drawRow = (row: EditorRow): DrawnRoot =>
    parts.draw('fieldRow', fieldsList, (fieldRow, into, rollback) => {
      const textBox = textBoxSlot(row, rollback);
      const root = fieldRow(
        into,
        {
          field: row.field,
          label: row.label,
          value: row.value,
          hint: row.hint,
          kind: row.kind,
        },
        { ...deps.kit(rollback), textBox },
      );
      requireElementIn(into, root, 'fieldRow');
      if (row.kind !== 'choice' && !boxes.isPlaced(row.field)) {
        textBox(root);
      }
      return { element: root };
    });

  const disposePane = () => {
    paneDraw?.dispose();
    paneDraw?.built.element.remove();
    paneDraw = null;
  };

  const drawPane = (editor: TaskEditor, slot: HTMLElement) => {
    disposePane();
    paneDraw = parts.draw('editor', slot, (editorPart, into, rollback) => {
      const fields = appSlot(fieldsList, 'fields', rollback);
      const pane = editorPart(
        into,
        {
          kind: editor.kind,
          heading: editorHeading(editor),
          envNote: ENV_NOTE,
          problem: editor.problem,
        },
        { ...deps.kit(rollback), fields: fields.place },
      );
      fields.placeIfLeftOut(requireElementIn(into, pane.element, 'editor'));
      return pane;
    });
  };

  // A box row's text is left out of the key, so typing never redraws its row.
  const rowsKeyOf = (rows: readonly EditorRow[]) =>
    JSON.stringify(
      rows.map((row) =>
        row.kind === 'choice' ? row : { ...row, value: '', choices: null },
      ),
    );

  const clear = () => {
    disposePane();
    const heldRowDraws = rowDraws;
    rowDraws = [];
    disposeDraws(heldRowDraws);
    fieldsList.replaceChildren();
    boxes.destroyForm(FORM_ID);
    drawnPaneKey = null;
    drawnRowsKey = null;
  };

  return {
    render(editor, slot, always) {
      if (editor === null) {
        if (shownEditor !== null) {
          shownEditor = null;
          clear();
        }
        return;
      }
      const isNewOpen =
        shownEditor === null ||
        shownEditor.kind !== editor.kind ||
        shownEditor.taskId !== editor.taskId ||
        shownEditor.initial !== editor.initial;
      if (isNewOpen && shownEditor !== null) {
        clear();
      }
      shownEditor = editor;
      const rows = editorRows(editor);
      const paneKey = JSON.stringify([
        editor.kind,
        editorHeading(editor),
        editor.problem,
      ]);
      const rowsKey = rowsKeyOf(rows);
      keepFocusedBox(boxes, FORM_ID, () => {
        if (always || paneKey !== drawnPaneKey) {
          drawnPaneKey = paneKey;
          drawPane(editor, slot);
        }
        if (always || rowsKey !== drawnRowsKey) {
          drawnRowsKey = rowsKey;
          const heldRowDraws = rowDraws;
          rowDraws = [];
          disposeDraws(heldRowDraws);
          fieldsList.replaceChildren();
          rowDraws = rows.map(drawRow);
        }
      });
      rows.forEach((row, index) => {
        rowDraws[index]?.built.element.classList.toggle(
          'is-cursor',
          index === editor.cursor,
        );
      });
    },
    focusBox(field) {
      if (!boxes.isPlaced(field)) {
        return false;
      }
      boxes.focus(field);
      return true;
    },
    leave() {
      const field = boxes.active();
      boxes.leave();
      return field;
    },
    active: () => boxes.active(),
    stepBox(editor, step) {
      const rows = editorRows(editor);
      const active = boxes.active();
      if (active !== null) {
        const boxFields = rows
          .filter((row) => row.kind !== 'choice')
          .map((row) => row.field);
        return stepBox(boxFields, (field) => field, active, step);
      }
      for (
        let index = editor.cursor + step;
        index >= 0 && index < rows.length;
        index += step
      ) {
        if (rows[index].kind !== 'choice') {
          return rows[index].field;
        }
      }
      return null;
    },
    dispose() {
      shownEditor = null;
      clear();
    },
  };
}
