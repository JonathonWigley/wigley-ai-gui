import type { EditorHost, FocusOptions } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import { element } from '../../../shared/page/dom';
import { createEditorBoxes, stepBox } from '../../../shared/page/editor-boxes';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import {
  type DraftTexts,
  EDITOR_FIELDS,
  type EditorField,
} from './backlog-state';

const FIELD_LABELS: Record<EditorField, string> = {
  title: 'Title',
  oneLine: 'One line',
  tags: 'Tags (comma-separated)',
  body: 'Body',
};

const FORM_ID = 'followup';

export interface FollowupEditorDeps {
  editor: EditorHost;
  log: Log;
  changed(field: EditorField, text: string): void;
  // The editor's footer: its key hints, drawn again by `redrawHints`.
  hints(): HTMLElement[];
}

// The follow-up editor: a vim box per field, drawn into `element` while open.
// `open` mounts the boxes with `texts`, `close` destroys them. `step` moves
// focus to the next or previous box from the focused one; from the page it
// focuses the box focused last. `setText` replaces one box's text, reporting
// no change.
export interface FollowupEditor {
  element: HTMLElement;
  open(heading: string, texts: DraftTexts): void;
  close(): void;
  isOpen(): boolean;
  focus(field: EditorField, options?: FocusOptions): void;
  step(by: 1 | -1): void;
  // Blurs the focused box, if any.
  leave(): void;
  hasFocusedBox(): boolean;
  setText(field: EditorField, text: string): void;
  redrawHints(): void;
}

export function createFollowupEditor(deps: FollowupEditorDeps): FollowupEditor {
  const form = element('div', 'backlog-editor');
  form.tabIndex = -1;
  form.hidden = true;
  const heading = element('h2', 'backlog-editor-heading');
  const fields = element('div', 'backlog-editor-fields');
  const footer = element('div', 'backlog-editor-hints');
  form.append(heading, fields, footer);

  const frames = new Map<EditorField, HTMLElement>();
  for (const field of EDITOR_FIELDS) {
    const label = element('label', 'backlog-editor-label', FIELD_LABELS[field]);
    const frame = inputFrame();
    frame.classList.add('backlog-editor-box', `backlog-editor-box--${field}`);
    frames.set(field, frame);
    fields.append(label, frame);
  }

  const frameOf = (field: EditorField): HTMLElement => {
    const frame = frames.get(field);
    if (frame === undefined) {
      throw new Error(`No editor box for ${field}`);
    }
    return frame;
  };

  let isOpen = false;
  let lastField: EditorField = 'title';
  const boxes = createEditorBoxes<EditorField>(
    deps.editor,
    {
      changed: (field, text) => deps.changed(field, text),
      activated: (field) => {
        lastField = field;
      },
    },
    deps.log,
    {
      formIdOf: () => FORM_ID,
      keyOf: (field) => field,
      describe: (field) => `${FIELD_LABELS[field]} box`,
      logSource: 'backlog',
    },
  );

  return {
    element: form,
    open(title, texts) {
      if (isOpen) {
        return;
      }
      isOpen = true;
      heading.textContent = title;
      for (const field of EDITOR_FIELDS) {
        boxes.mount(frameOf(field), field, texts[field]);
      }
      footer.replaceChildren(...deps.hints());
      form.hidden = false;
      lastField = 'title';
    },
    close() {
      if (!isOpen) {
        return;
      }
      isOpen = false;
      boxes.destroyForm(FORM_ID);
      form.hidden = true;
    },
    isOpen: () => isOpen,
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
      form.focus();
    },
    hasFocusedBox: () => boxes.active() !== null,
    setText(field, text) {
      boxes.destroyBox(field);
      boxes.mount(frameOf(field), field, text);
    },
    redrawHints() {
      if (isOpen) {
        footer.replaceChildren(...deps.hints());
      }
    },
  };
}
