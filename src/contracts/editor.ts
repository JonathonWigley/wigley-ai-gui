import type { EditorBind, EditorKeymap } from './keymap';
import type { Log } from './log';

// The keys an insert-mode editor bind may take, in vim notation: each is one
// the host can type itself when no bind on it runs, as `CreateEditorHost`
// requires.
export const UNBOUND_INSERT_KEYS = ['<CR>'] as const;

export type UnboundInsertKey = (typeof UNBOUND_INSERT_KEYS)[number];

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

// How a document editor opens a file: `fileName` picks the language by its
// extension, and `line` (1-based) is the line shown at the top with the cursor
// on it.
export interface DocumentOptions {
  fileName: string;
  readOnly: boolean;
  line: number;
}

// What a document editor reports. The ex commands fire in a read-only editor
// too.
export interface DocumentEditorEvents {
  // The whole text, after every change the user makes.
  changed(text: string): void;
  // `:w`
  write(): void;
  // `:q`, and `:q!` with `force`
  quit(force: boolean): void;
  // `:wq`, `:x`
  writeQuit(): void;
  // The vim mode the editor entered.
  modeChanged(mode: VimMode): void;
}

// A whole file in vim: line numbers, the file's language, wrapped lines, and
// its parent's full height, scrolling inside.
export interface DocumentEditor extends TextEditor {
  // Replaces the whole text, keeping focus and normal or insert mode (visual
  // mode ends), and puts the cursor at the start of the line it was on,
  // clamped to the new line count; it reports no `changed`.
  setText(text: string): void;
  // Puts the cursor at the start of the 1-based `line`, clamped to the text,
  // and scrolls it to the top.
  goToLine(line: number): void;
  // Scrolls by half the visible height, down for 1 and up for -1, keeping
  // the vim mode. In visual mode the cursor moves half a page with the
  // scroll, as vim's Ctrl+d and Ctrl+u do, so the selection grows or
  // shrinks. Otherwise a cursor the scroll leaves out of sight moves to the
  // start of the first line wholly in sight (scrolling down) or the last
  // (scrolling up), a non-empty selection keeping its anchor.
  scrollHalfPage(direction: 1 | -1): EditorHalfPageScroll;
}

// What a half-page scroll did: `moved` when the view scrolled at all, and
// `atEnd` when it rests at the end it scrolled toward, the top for up and the
// bottom for down.
export interface HalfPageScroll {
  moved: boolean;
  atEnd: boolean;
}

export interface EditorHalfPageScroll extends HalfPageScroll {
  cursorMoved: boolean;
}

// While the editor is in insert mode and the text from the document's start to the cursor is `prefix`
// followed by no whitespace, offers the `words()` that start with the text typed after `prefix`, ignoring
// case, in the order `words()` gives them. Accepting one replaces that text with `prefix`, the word and
// one space. `offered` hears the offered words each time the list changes while it is open; `accepted`
// hears the word accepted.
export interface EditorCompletions {
  prefix: string;
  words(): readonly string[];
  offered(words: readonly string[]): void;
  accepted(word: string): void;
}

export interface EditorOptions {
  completions?: EditorCompletions;
}

export interface EditorHost {
  // A small prose box: no gutter, no language; it reports focus and blur, and
  // offers `options.completions` when given.
  create(
    parent: HTMLElement,
    doc: string,
    events: EditorEvents,
    options?: EditorOptions,
  ): TextEditor;
  // A full-file editor, hosted as a box is: keys, focus and pending keys
  // behave the same in both.
  createDocument(
    parent: HTMLElement,
    doc: string,
    options: DocumentOptions,
    events: DocumentEditorEvents,
  ): DocumentEditor;
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
  // Replaces the keymap every editor follows, at once in every open editor and
  // in every editor created after. The caller has checked the keymap with
  // `requireUnambiguousEditorBinds`.
  setKeymap(keymap: EditorKeymap): void;
}

// Every editor the host creates follows the keymap, until `setKeymap`
// replaces it; a bound key sequence calls
// `run` with every bind on those keys in its mode, in keymap order, and the
// editor it fired in, leaving the choice among them to the caller. `run`
// returns whether a bind ran; when none ran on an insert-mode key, the host
// does what the key does unbound, so Enter still breaks the line. `log`
// takes the host's own lines, such as a mapping the editor engine had lost.
export type CreateEditorHost = (
  keymap: EditorKeymap,
  run: (binds: EditorBind[], editor: TextEditor) => boolean,
  log: Log,
) => EditorHost;
