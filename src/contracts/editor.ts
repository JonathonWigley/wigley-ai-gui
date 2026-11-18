import type { Disposable } from './disposable';
import type { FuzzyMatcher } from './fuzzy';
import type { EditorBind, EditorKeymap } from './keymap';
import type { Log } from './log';
import type { Paths } from './paths';

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

// `toNormal` drops the editor to vim's normal mode first, from insert or
// visual, as Esc does there. Without it, the editor keeps its mode.
export interface BlurOptions {
  toNormal?: boolean;
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
  // Types `text` at the cursor — after the character under a normal-mode
  // cursor, as vim's `p`; over the main range of a visual selection, which
  // then drops to normal — adding one space after it when the next character
  // is not whitespace; keeps focus and the mode (visual excepted); reports
  // `changed`.
  insert(text: string): void;
  // The character just before the point `insert` puts text at (in normal
  // mode, the character under the cursor, or the last character of the chip
  // under it); '' at the start of the text.
  charBeforeCursor(): string;
  focus(options?: FocusOptions): void;
  blur(options?: BlurOptions): void;
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
  // Scrolls by `step`, down for 1 and up for -1, keeping the vim mode.
  // - `halfPage`: half the visible height. In visual mode the cursor moves
  //   half a page with the scroll, as vim's Ctrl+d and Ctrl+u do, so the
  //   selection grows or shrinks.
  // - `line`: one editor row, landing the top of sight on a row's top, as
  //   vim's Ctrl+e and Ctrl+y scroll.
  // A cursor the scroll leaves out of sight (in any mode for `line`, outside
  // visual mode for `halfPage`) moves to the first line wholly in sight when
  // it is above, or the last when it is below. In visual mode the selection
  // grows or shrinks with it; otherwise the cursor lands at the line's start,
  // a non-empty selection keeping its anchor. It resolves once the editor
  // has settled its scroll, with what the user then sees.
  scrollBy(step: ScrollStep, direction: 1 | -1): Promise<EditorScroll>;
}

// How far a scroll key moves content: one line of the text the view shows,
// or half the visible height.
export type ScrollStep = 'line' | 'halfPage';

// What a scroll did: `moved` when the view scrolled at all, and `atEnd` when
// it rests at the end it scrolled toward, the top for up and the bottom for
// down.
export interface ContentScroll {
  moved: boolean;
  atEnd: boolean;
}

// What an editor scroll did, measured once the scroll has settled: `top` is
// the line at the top of sight.
export interface EditorScroll extends ContentScroll {
  cursorMoved: boolean;
  top: SightTop;
}

// The 1-based `line` holding the row at the top of sight; `cut` when the top
// of sight falls inside that row, leaving part of it in sight.
export interface SightTop {
  line: number;
  cut: boolean;
}

// One completion: `word` is what the row shows and inserts after the prefix;
// `aliases` also match the typed text, and are never shown or inserted.
export interface CompletionItem {
  word: string;
  aliases: readonly string[];
}

// While the editor is in insert mode and the text from the document's start to the cursor is `prefix`
// followed by no whitespace, offers the `items()` whose word or an alias fuzzily matches the text typed
// after `prefix`, best first, each word once; with nothing typed, every item in the order `items()` gives
// them. Accepting one replaces that text with `prefix`, the word and one space. `drawRow` hears each row's
// word as the popup draws it, with a new element inside the row, after the `prefix` and word text, to
// append to or replace the children of: a one-line flex box holding the width the text leaves, whose
// children past it are cut. `offered` hears the offered words each time the list changes
// while it is open; `accepted` hears the word accepted.
export interface EditorCompletions {
  prefix: string;
  items(): readonly CompletionItem[];
  drawRow?(word: string, row: HTMLElement): void;
  offered(words: readonly string[]): void;
  accepted(word: string): void;
}

// `hidesModeLine` leaves out the `--INSERT--` line under the box, for a box whose
// cursor shape alone shows the vim mode; the `:` prompt and `/` search still draw there.
export interface EditorOptions {
  completions?: EditorCompletions;
  hidesModeLine?: boolean;
}

// What vim read after an ex command's name: `bang` for a `!` straight after
// it, and the rest of the text, trimmed.
export interface ExCall {
  argString: string;
  bang: boolean;
}

export type ExHandler = (editor: TextEditor, command: ExCall) => void;

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
  // Whether the editor holding the event's target takes the key press itself,
  // ahead of the page's chord binds: an open completion popup's keys.
  takesChordKey(event: KeyboardEvent): boolean;
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
  // and reports `[]` before any other editor reports. Hears until the returned
  // handle's `dispose`.
  onPendingKeys(listener: (keys: string[]) => void): Disposable;
  // Discards the unfinished sequence, as Esc does, without running the bind
  // on Esc; does nothing when no keys are pending.
  cancelPendingKeys(): void;
  // Defines `:name` in every editor this host created or will create: vim
  // runs it when the typed name is a start of `name` no shorter than `prefix`,
  // and `handler` hears the editor it ran in. Throws on a name that is not
  // letters only or starts `wigleybind`, on a prefix that is not a non-empty
  // start of the name, on a name defined already (`write`, `quit`, `wq` and
  // `xit` among them), on a name that is one of vim's commands or its short
  // form, and on a prefix another live definition holds. It also throws on a
  // prefix that vim would run another command for when typed alone, whether
  // that command is vim's own or a live definition's (the host's included): a
  // prefix that would take a typed form from it. After the returned handle's
  // `dispose`, `:name` reports vim's `Not an editor command` and the prefix is
  // free again.
  defineEx(name: string, prefix: string, handler: ExHandler): Disposable;
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
// `chips` draws the file chips every box shows; a document editor draws none.
// `matcher` ranks a box's completions.
export type CreateEditorHost = (
  keymap: EditorKeymap,
  run: (binds: EditorBind[], editor: TextEditor) => boolean,
  log: Log,
  chips: FileChipDrawing,
  matcher: FuzzyMatcher,
) => EditorHost;

// What the host needs to draw file chips: the OS's path rules, which find a
// path in a box's text, and the icon each chip shows.
export interface FileChipDrawing {
  paths: Paths;
  fileIcon(): HTMLElement;
}
