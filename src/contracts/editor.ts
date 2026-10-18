import type { CommandId } from './commands';
import type { EditorKeymap } from './keymap';

// `insertAtEnd` focuses in insert mode with the cursor after the last
// character, as vim's `GA` does; otherwise the editor keeps its mode.
export interface FocusOptions {
  insertAtEnd?: boolean;
}

// A vim mode, e.g. `insert` or `visual`; `subMode` names a visual mode's kind
// (`linewise` or `blockwise`) and is empty otherwise.
export interface VimMode {
  mode: string;
  subMode: string;
}

export interface TextEditor {
  text(): string;
  focus(options?: FocusOptions): void;
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
  // The vim mode the editor entered.
  modeChanged(mode: VimMode): void;
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
