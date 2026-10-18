import type { CommandId } from './commands';
import type { EditorKeymap } from './keymap';

export interface TextEditor {
  text(): string;
  focus(): void;
  blur(): void;
  // Removes the editor from the page; the host forgets it.
  destroy(): void;
}

// What an editor reports while the user works in it.
export interface EditorEvents {
  // The whole text, after every change the user makes.
  changed(text: string): void;
  focused(): void;
  blurred(): void;
  // The vim mode the editor entered, e.g. `insert` or `visual`.
  modeChanged(mode: string): void;
}

export interface EditorHost {
  create(parent: HTMLElement, doc: string, events: EditorEvents): TextEditor;
  // Whether the element sits inside an editor this host created.
  contains(element: Element): boolean;
}

// Every editor the host creates follows the keymap; a bound key runs its
// command with the editor it fired in.
export type CreateEditorHost = (
  keymap: EditorKeymap,
  run: (command: CommandId, editor: TextEditor) => void,
) => EditorHost;
