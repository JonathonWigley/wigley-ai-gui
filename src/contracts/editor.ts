import type { CommandId } from './commands';
import type { EditorKeymap } from './keymap';

export interface TextEditor {
  text(): string;
  focus(): void;
  blur(): void;
}

export interface EditorHost {
  create(parent: HTMLElement, doc: string): TextEditor;
  // Whether the element sits inside an editor this host created.
  contains(element: Element): boolean;
}

// Every editor the host creates follows the keymap; a bound key runs its
// command with the editor it fired in.
export type CreateEditorHost = (
  keymap: EditorKeymap,
  run: (command: CommandId, editor: TextEditor) => void,
) => EditorHost;
