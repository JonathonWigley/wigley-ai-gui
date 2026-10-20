import type { EditorBind, EditorKeymap } from './keymap';

// `insertAtEnd` focuses in insert mode with the cursor after the last
// character, as vim's `GA` does; `insert` focuses in insert mode with the
// cursor where it was, as vim's `i` does; `insertAtEnd` wins when both are
// set. With neither, the editor keeps its mode.
export interface FocusOptions {
  insertAtEnd?: boolean;
  insert?: boolean;
}

// A vim mode, e.g. `insert` or `visual`; `subMode` names a visual mode's kind
// (`linewise` or `blockwise`) and is empty otherwise.
export interface VimMode {
  mode: string;
  subMode: string;
}

export interface TextEditor {
  text(): string;
  // Replaces the whole text, keeping focus and the vim mode; it reports no
  // `changed`.
  setText(text: string): void;
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
  // Delivers `keys`, named as KeyboardEvent.key names them, to the editor
  // holding `element` as typed keys: each runs in the vim mode the keys before
  // it left, so in insert mode a character types itself.
  typeInto(element: Element, keys: string[]): void;
  // Hears the keys of an unfinished normal-mode sequence in any editor this
  // host created or will create, as vim names them (`['<Space>', 'a']`), each
  // time they change; `[]` once the sequence ends or the editor leaves normal
  // mode. A count with no key after it (`3`) and an operator waiting for its
  // motion (`d`) are no sequence and report `[]`. An editor losing focus
  // discards every unfinished command, count, operator and register included,
  // and reports `[]` before any other editor reports.
  onPendingKeys(listener: (keys: string[]) => void): void;
  // Discards the unfinished sequence, as Esc does, without running the bind
  // on Esc; does nothing when no keys are pending.
  cancelPendingKeys(): void;
}

// Every editor the host creates follows the keymap; a bound key sequence calls
// `run` with every bind on those keys in its mode, in keymap order, and the
// editor it fired in, leaving the choice among them to the caller. `run`
// returns whether a bind ran; when none ran on an insert-mode key, the host
// does what the key does unbound, so Enter still breaks the line.
export type CreateEditorHost = (
  keymap: EditorKeymap,
  run: (binds: EditorBind[], editor: TextEditor) => boolean,
) => EditorHost;
