import type { PageDrops } from '../../../contracts/drops';
import type { EditorHost, FocusOptions } from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type { ToastTone } from '../../../contracts/plugin';
import {
  boxDropTake,
  createEditorBoxes,
  type EditorBoxes,
  stepBox,
} from '../../../shared/page/editor-boxes';
import { EDITOR_FIELDS, type EditorField } from './backlog-state';

export const EDITOR_FIELD_LABELS: Record<EditorField, string> = {
  title: 'Title',
  oneLine: 'One line',
  tags: 'Tags (comma-separated)',
  body: 'Body',
};

// The form id every follow-up editor box carries.
export const FOLLOWUP_FORM_ID = 'followup';

export interface FollowupEditorDeps {
  editor: EditorHost;
  log: PluginLog;
  changed(field: EditorField, text: string): void;
  // The `div.backlog-editor` slot the editor pane is drawn into; `leave`
  // focuses it. It is a drop target through `drops`, typing files into the
  // box used last.
  element: HTMLElement;
  // The box hint the editor moves into the frame of each box it activates.
  fieldHint: HTMLElement;
  drops: Pick<PageDrops, 'addTarget' | 'savePasted'>;
  toast(text: string, tone: ToastTone): void;
}

// The follow-up editor's vim boxes, one per field, mounted into the frames the
// editor pane places; it builds no DOM. `step` moves focus to the next or
// previous box from the focused one; from the page it focuses the box focused
// last. `setText` replaces one box's text, reporting no change.
export interface FollowupEditor {
  // Mounts `field`'s box into `frame` with `text`; the box's frame takes the
  // field hint when the box activates.
  mount(field: EditorField, frame: HTMLElement, text: string): void;
  isMounted(field: EditorField): boolean;
  // Destroys every mounted box. A redraw of the same draft keeps the box used
  // last and the mount order; `forget` drops them.
  destroy(): void;
  // Forgets the box used last and the mount order, when the editor pane closes.
  forget(): void;
  focus(field: EditorField, options?: FocusOptions): void;
  step(by: 1 | -1): void;
  // Blurs the focused box and focuses the `div.backlog-editor` slot.
  leave(): void;
  hasFocusedBox(): boolean;
  // Remounts `field`'s box in its current frame with `text`.
  setText(field: EditorField, text: string): void;
  boxes: EditorBoxes<EditorField>;
}

export function createFollowupEditor(deps: FollowupEditorDeps): FollowupEditor {
  const frames = new Map<EditorField, HTMLElement>();
  const frameOf = (field: EditorField): HTMLElement => {
    const frame = frames.get(field);
    if (frame === undefined) {
      throw new Error(`No editor box for ${field}`);
    }
    return frame;
  };

  let lastField: EditorField = 'title';
  const boxes = createEditorBoxes<EditorField>(
    deps.editor,
    {
      changed: (field, text) => deps.changed(field, text),
      activated: (field) => {
        lastField = field;
        frameOf(field).append(deps.fieldHint);
      },
    },
    deps.log,
    {
      formIdOf: () => FOLLOWUP_FORM_ID,
      keyOf: (field) => field,
      describe: (field) => `${EDITOR_FIELD_LABELS[field]} box`,
    },
  );
  // The page API disposes the target when backlog stops.
  deps.drops.addTarget({
    element: deps.element,
    take: boxDropTake(() => boxes.fileEditor(FOLLOWUP_FORM_ID, () => true), {
      savePasted: (file) => deps.drops.savePasted(file),
      toast: (text, tone) => deps.toast(text, tone),
      log: deps.log,
    }),
  });

  return {
    mount(field, frame, text) {
      boxes.mount(frame, field, text);
      frames.set(field, frame);
    },
    isMounted: (field) => boxes.isMounted(field),
    destroy() {
      boxes.destroyForm(FOLLOWUP_FORM_ID);
      frames.clear();
    },
    forget() {
      boxes.forgetForm(FOLLOWUP_FORM_ID);
    },
    focus(field, options) {
      boxes.focus(field, options);
    },
    step(by) {
      const next = stepBox(
        EDITOR_FIELDS,
        (field) => field,
        boxes.active() ?? lastField,
        boxes.active() === null ? 0 : by,
      );
      if (next !== null) {
        boxes.focus(next);
      }
    },
    leave() {
      boxes.leave();
      deps.element.focus();
    },
    hasFocusedBox: () => boxes.active() !== null,
    setText(field, text) {
      const frame = frameOf(field);
      boxes.destroyBox(field);
      boxes.mount(frame, field, text);
    },
    boxes,
  };
}
