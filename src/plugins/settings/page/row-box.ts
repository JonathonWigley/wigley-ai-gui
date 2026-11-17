import type { DocumentEditor, EditorHost } from '../../../contracts/editor';
import { element } from '../../../shared/page/dom';
import { textBoxInput } from '../../../shared/page/text-box';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import type { ConfigFile } from './settings-view';

// A box opened in place under a row. A `line` box is one line of text,
// `preview` drawing what its text means under it on each change; a
// `document` box is the document editor over the text, `fileName` picking its
// language.
export type BoxEditor =
  | { type: 'line'; preview?(text: string): HTMLElement | null }
  | { type: 'document'; fileName: string };

export interface BoxRequest {
  // The row it opens under, as `SettingsRow.key` names it.
  key: string;
  file: ConfigFile;
  text: string;
  editor: BoxEditor;
  // Enter in a line box; `:w`, `:wq` and `:x` in a document box.
  accept(box: RowBox): void;
}

// `expectedText` is the file's text the box writes against; a refused stale
// write replaces it with the text now on disk. `showMessage` shows a line
// under the box until the next; `redrawMessage` draws the last one again, for
// a new layout, and does nothing before the first. `keepFocusAcross` runs `move`, which may move
// the box's element, and gives the box back the focus and the selection it
// held. `accept` runs the request's accept on a line box and focuses a
// document box, whose own ex commands accept it.
export interface RowBox {
  key: string;
  element: HTMLElement;
  expectedText: string | null;
  text(): string;
  accept(): void;
  showMessage(text: string): void;
  redrawMessage(): void;
  focus(): void;
  keepFocusAcross(move: () => void): void;
  destroy(): void;
}

export interface RowBoxDeps {
  editor: EditorHost;
  // `:q` or `:q!` in a document box.
  quit(): void;
  // Draws the message `text` into `parent`, the box's message slot, and
  // returns the dispose that takes it out again.
  drawMessage(parent: HTMLElement, text: string): () => void;
}

// A line box opens focused with its whole text selected, so typing replaces
// it and an arrow key keeps it.
export function createRowBox(
  request: BoxRequest,
  expectedText: string | null,
  deps: RowBoxDeps,
): RowBox {
  const root = element('div', 'settings-box');
  const frame = inputFrame();
  // The slot the layout's `boxMessage` is drawn into; the app keeps it.
  const message = element('div', 'settings-box-message-slot');
  let messageText: string | null = null;
  let disposeMessage: (() => void) | null = null;
  root.append(frame);

  const clearMessage = () => {
    const dispose = disposeMessage;
    disposeMessage = null;
    dispose?.();
  };
  const redrawMessage = () => {
    if (messageText === null) {
      return;
    }
    clearMessage();
    disposeMessage = deps.drawMessage(message, messageText);
  };
  const showMessage = (text: string) => {
    messageText = text;
    redrawMessage();
  };

  if (request.editor.type === 'document') {
    const host = element('div', 'settings-document');
    frame.append(host);
    root.append(message);
    let editor: DocumentEditor | null = null;
    const box: RowBox = {
      key: request.key,
      element: root,
      expectedText,
      text: () => editor?.text() ?? request.text,
      accept: () => editor?.focus(),
      showMessage,
      redrawMessage,
      focus: () => editor?.focus(),
      keepFocusAcross(move) {
        const hadFocus = root.contains(document.activeElement);
        move();
        if (hadFocus) {
          editor?.focus();
        }
      },
      destroy() {
        clearMessage();
        editor?.destroy();
        root.remove();
      },
    };
    editor = deps.editor.createDocument(
      host,
      request.text,
      { fileName: request.editor.fileName, readOnly: false, line: 1 },
      {
        changed: () => undefined,
        write: () => request.accept(box),
        writeQuit: () => request.accept(box),
        quit: () => deps.quit(),
        modeChanged: () => undefined,
      },
    );
    return box;
  }

  const { preview } = request.editor;
  const input = textBoxInput('settings-box-input');
  input.value = request.text;
  frame.append(input);
  const previewSlot = element('div', 'settings-box-preview');
  root.append(previewSlot, message);
  const drawPreview = () => {
    const drawn = preview?.(input.value) ?? null;
    previewSlot.replaceChildren(...(drawn === null ? [] : [drawn]));
    previewSlot.hidden = drawn === null;
  };
  input.addEventListener('input', drawPreview);
  drawPreview();

  const box: RowBox = {
    key: request.key,
    element: root,
    expectedText,
    text: () => input.value,
    accept: () => request.accept(box),
    showMessage,
    redrawMessage,
    focus() {
      input.focus();
      input.select();
    },
    keepFocusAcross(move) {
      const hadFocus = document.activeElement === input;
      const { selectionStart, selectionEnd, selectionDirection } = input;
      move();
      if (hadFocus) {
        input.focus();
        input.setSelectionRange(
          selectionStart,
          selectionEnd,
          selectionDirection ?? undefined,
        );
      }
    },
    destroy() {
      clearMessage();
      root.remove();
    },
  };
  return box;
}
