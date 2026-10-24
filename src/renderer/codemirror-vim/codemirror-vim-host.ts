import { closeCompletion } from '@codemirror/autocomplete';
import { EditorView, minimalSetup } from 'codemirror';
import { syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  tooltips,
} from '@codemirror/view';
import { CodeMirror, getCM, Vim, vim } from '@replit/codemirror-vim';
import {
  type CreateEditorHost,
  type DocumentEditor,
  type DocumentEditorEvents,
  type DocumentOptions,
  type EditorEvents,
  type EditorScroll,
  type EditorOptions,
  type FocusOptions,
  type ScrollStep,
  type TextEditor,
  UNBOUND_INSERT_KEYS,
  type UnboundInsertKey,
  type VimMode,
} from '../../contracts/editor';
import type {
  EditorBind,
  EditorKeymap,
  EditorMode,
} from '../../contracts/keymap';
import {
  DOCUMENT_EX_COMMANDS,
  type DocumentExEvent,
  documentExEvent,
} from './document-ex-commands';
import { codeColours } from './code-colours';
import { editorTheme } from './editor-theme';
import { exBindName } from './ex-command-name';
import { isScrolledToEnd, scrollStepPx } from '../../shared/content-scroll';
import { findLanguageByFile, loadLanguage } from './languages';
import { prefixCompletion } from './prefix-completion';
import {
  appliedMappings,
  type BindGroup,
  bindGroups,
  vimrcLines,
} from './vim-binds';

type VimEditor = Parameters<typeof Vim.handleEx>[0];

// `answerEx` raises a document editor's ex command events; a box has none.
interface HostedEditor {
  view: EditorView;
  editor: TextEditor;
  answerEx?: (event: DocumentExEvent) => void;
}

function vimEditorOf(view: EditorView): VimEditor {
  const cm = getCM(view);
  if (!cm?.state.vim) {
    throw new Error('Editor has no vim extension to apply the keymap to');
  }
  return cm as VimEditor;
}

// The editor a bound key or ex command ran in, from the cm vim hands it: focus
// state is unreliable, since view.hasFocus is false while the window is not.
function hostedEntryOf(cm: VimEditor, hosted: HostedEditor[]): HostedEditor {
  const match = hosted.find((entry) => getCM(entry.view) === cm);
  if (!match) {
    throw new Error(
      'A bound key or ex command ran in an editor this host did not create',
    );
  }
  return match;
}

type RunBinds = (binds: EditorBind[], editor: TextEditor) => boolean;

// What each key an insert-mode bind may take does in insert mode with no bind
// on it, as CodeMirror's own key handling does it.
const UNBOUND_INSERT_ACTIONS: Record<
  UnboundInsertKey,
  (cm: CodeMirror) => void
> = {
  '<CR>': (cm) => CodeMirror.commands.newlineAndIndent(cm),
};

function isUnboundInsertKey(keys: string): keys is UnboundInsertKey {
  return UNBOUND_INSERT_KEYS.some((key) => key === keys);
}

function unboundInsertKey(group: BindGroup): (cm: CodeMirror) => void {
  if (!isUnboundInsertKey(group.keys)) {
    throw new Error(
      `Insert-mode bind "${group.keys}" names a key the editor cannot type when no bind is in force; insert binds take ${UNBOUND_INSERT_KEYS.join(', ')}`,
    );
  }
  return UNBOUND_INSERT_ACTIONS[group.keys];
}

// An insert-mode group maps its key to a vim action, which runs without
// leaving insert mode; when `run` runs no bind, the key does what it does
// unbound, since vim's map on it holds in every editor.
function defineInsertAction(
  group: BindGroup,
  name: string,
  hosted: HostedEditor[],
  run: RunBinds,
) {
  const unbound = unboundInsertKey(group);
  Vim.defineAction(name, (cm: VimEditor) => {
    const entry = hostedEntryOf(cm, hosted);
    const isBound = run(group.binds, entry.editor);
    const adapter = getCM(entry.view);
    if (!isBound && adapter) {
      unbound(adapter);
    }
  });
  Vim.mapCommand(group.keys, 'action', name, undefined, { context: 'insert' });
}

// Each group's ex command, or an insert group's action, hands `run` the
// group's binds and the editor its keys fired in.
function defineBindCommands(
  groups: BindGroup[],
  hosted: HostedEditor[],
  run: RunBinds,
) {
  groups.forEach((group, index) => {
    const name = exBindName(index);
    if (group.mode === 'insert') {
      defineInsertAction(group, name, hosted, run);
    } else {
      Vim.defineEx(name, name, (cm: VimEditor) => {
        run(group.binds, hostedEntryOf(cm, hosted).editor);
      });
    }
  });
}

// Each document ex command raises its event in the document editor it ran in,
// and does nothing in a box. Defining one replaces vim's own command of that
// name, such as `write`, which saves through a handler the adapter leaves unset.
function defineDocumentExCommands(hosted: HostedEditor[]) {
  for (const { name, prefix } of DOCUMENT_EX_COMMANDS) {
    Vim.defineEx(
      name,
      prefix,
      (cm: VimEditor, params: { argString?: string }) => {
        const event = documentExEvent(name, params.argString);
        hostedEntryOf(cm, hosted).answerEx?.(event);
      },
    );
  }
}

function raiseDocumentEx(events: DocumentEditorEvents, event: DocumentExEvent) {
  switch (event.kind) {
    case 'write':
      events.write();
      break;
    case 'quit':
      events.quit(event.force);
      break;
    case 'writeQuit':
      events.writeQuit();
      break;
  }
}

// Vim's `GA` from any mode: leaves visual mode, puts the cursor after the
// last character, and enters insert mode there. `:startinsert!` is vim's `A`.
function insertAtEnd(view: EditorView, cm: VimEditor) {
  if (cm.state.vim.visualMode) {
    Vim.exitVisualMode(cm);
  }
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  if (!cm.state.vim.insertMode) {
    Vim.handleEx(cm, 'startinsert!');
  }
}

// Vim's `i` from any mode: leaves visual mode, then enters insert mode with
// the cursor where it was. In visual mode `i` would start a text object.
function insertHere(cm: VimEditor) {
  if (cm.state.vim.visualMode) {
    Vim.exitVisualMode(cm);
  }
  if (!cm.state.vim.insertMode) {
    Vim.handleEx(cm, 'startinsert');
  }
}

function focusEditor(
  view: EditorView,
  cm: VimEditor,
  options: FocusOptions | undefined,
) {
  view.focus();
  if (options?.insertAtEnd) {
    insertAtEnd(view, cm);
  } else if (options?.insert) {
    insertHere(cm);
  }
}

// The user-event annotation marking the transaction `setText` dispatches, so
// the editor reports no `changed` for it.
const HOST_REPLACE = 'wigley.setText';

function replaceText(view: EditorView, text: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    userEvent: HOST_REPLACE,
  });
}

// Replaces the whole text in one transaction, the cursor at the start of the
// line it was on, clamped to the new line count.
function replaceTextKeepingLine(view: EditorView, text: string) {
  const { state } = view;
  const cursorLine = state.doc.lineAt(state.selection.main.head).number;
  const next = state.toText(text);
  const anchor = next.line(Math.min(cursorLine, next.lines)).from;
  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: next },
    selection: { anchor },
    userEvent: HOST_REPLACE,
  });
}

// The cursor to the start of the 1-based `line`, clamped to the text, and
// that line scrolled to the top.
function goToLine(view: EditorView, line: number) {
  const { doc } = view.state;
  const anchor = doc.line(Math.min(Math.max(line, 1), doc.lines)).from;
  view.dispatch({
    selection: { anchor },
    effects: EditorView.scrollIntoView(anchor, { y: 'start' }),
  });
}

// Keys no user can type, mapped in visual mode to vim's own Ctrl+d and Ctrl+u
// motion and its `j` and `k` motion, so a remap of those keys never changes a
// scroll.
const SCROLL_MOTION_KEYS = {
  halfPageDown: '<WigleyHalfPageDown>',
  halfPageUp: '<WigleyHalfPageUp>',
  lineDown: '<WigleyLineDown>',
  lineUp: '<WigleyLineUp>',
} as const;

// Vim's mapCommand adds an entry on every call, so each key's earlier mapping,
// when vim still holds one, is unmapped first.
function mapScrollMotions() {
  for (const forward of [true, false]) {
    const halfPage = forward
      ? SCROLL_MOTION_KEYS.halfPageDown
      : SCROLL_MOTION_KEYS.halfPageUp;
    const line = forward
      ? SCROLL_MOTION_KEYS.lineDown
      : SCROLL_MOTION_KEYS.lineUp;
    Vim.unmap(halfPage, 'visual');
    Vim.mapCommand(
      halfPage,
      'motion',
      'moveByScroll',
      { forward, explicitRepeat: true },
      { context: 'visual' },
    );
    Vim.unmap(line, 'visual');
    Vim.mapCommand(
      line,
      'motion',
      'moveByLines',
      { forward, linewise: true },
      { context: 'visual' },
    );
  }
}

// Scrolls the editor by `step` in `direction`. A half page in visual mode
// runs vim's own half-page motion, which moves the cursor with the scroll;
// every other scroll keeps the cursor where it is unless the scroll leaves it
// out of sight, as vim's Ctrl+e and Ctrl+y do. A motion it runs through vim
// first drops any count the user typed, since a chord cannot continue one.
function scrollEditor(
  view: EditorView,
  cm: VimEditor,
  step: ScrollStep,
  direction: 1 | -1,
): EditorScroll {
  const scroller = view.scrollDOM;
  const scrollTop = scroller.scrollTop;
  const { head } = view.state.selection.main;
  const isVisual = cm.state.vim.visualMode === true;
  if (isVisual && step === 'halfPage') {
    const key =
      direction === 1
        ? SCROLL_MOTION_KEYS.halfPageDown
        : SCROLL_MOTION_KEYS.halfPageUp;
    discardUnfinishedInput(cm);
    Vim.handleKey(cm, key, 'user');
  } else {
    scroller.scrollTop +=
      direction * scrollStepPx(scroller, step, rowStepPx(view, direction));
    if (isVisual) {
      bringVisualHeadIntoSight(view, cm);
    } else {
      bringCursorIntoSight(view);
    }
  }
  return {
    moved: scroller.scrollTop !== scrollTop,
    atEnd: isScrolledToEnd(scroller, direction),
    cursorMoved: view.state.selection.main.head !== head,
  };
}

// How far a line scroll in `direction` moves the editor, in pixels: about one
// row, landing the top of sight on a row's top so no sliver of the row above
// stays in sight, and on the very top for the first row.
function rowStepPx(view: EditorView, direction: 1 | -1): number {
  const row = view.defaultLineHeight;
  const topRow = Math.round(Math.max(sightOf(view).top, 0) / row);
  const targetTop = (topRow + direction) * row;
  const target = targetTop <= 0 ? 0 : targetTop + view.documentPadding.top;
  return Math.abs(target - view.scrollDOM.scrollTop);
}

// How far a row may cross the edge of sight and still count as on its side,
// since `scrollTop` lands on whole pixels and rows on fractions.
const SIGHT_SLACK_PX = 1;

// The top and bottom of the editor's visible part, in line block heights.
function sightOf(view: EditorView): { top: number; bottom: number } {
  const scroller = view.scrollDOM;
  const top = scroller.scrollTop - view.documentPadding.top;
  return { top, bottom: top + scroller.clientHeight };
}

// Moves visual mode's cursor, when its line is wholly out of sight, by whole
// lines through vim's own motion to the first line wholly in sight when it is
// above, or the last when below, so the selection grows or shrinks with it.
// The editor keeps the scroll it had before the motion.
function bringVisualHeadIntoSight(view: EditorView, cm: VimEditor) {
  const { top, bottom } = sightOf(view);
  const { doc } = view.state;
  const headLine = (cm.state.vim.sel as { head: { line: number } }).head.line;
  const headBlock = view.lineBlockAt(doc.line(headLine + 1).from);
  const isAboveSight = headBlock.bottom <= top + SIGHT_SLACK_PX;
  const isBelowSight = headBlock.top >= bottom - SIGHT_SLACK_PX;
  if (!isAboveSight && !isBelowSight) {
    return;
  }
  const target = isAboveSight
    ? firstWholeLineFrom(view, top)
    : lastWholeLineTo(view, bottom);
  const lines = Math.abs(doc.lineAt(target).number - 1 - headLine);
  if (lines === 0) {
    return;
  }
  const scroll = view.scrollSnapshot();
  discardUnfinishedInput(cm);
  for (const digit of String(lines)) {
    Vim.handleKey(cm, digit, 'user');
  }
  const key = isAboveSight
    ? SCROLL_MOTION_KEYS.lineDown
    : SCROLL_MOTION_KEYS.lineUp;
  Vim.handleKey(cm, key, 'user');
  // Vim's motion scrolls its cursor into view with CodeMirror's 5px margin.
  view.dispatch({ effects: scroll });
}

// Moves a cursor wholly out of sight to the start of the first line wholly in
// sight when it is above, or the last when below; a non-empty selection keeps
// its anchor.
function bringCursorIntoSight(view: EditorView) {
  const { top, bottom } = sightOf(view);
  const selection = view.state.selection.main;
  const headLine = view.lineBlockAt(selection.head);
  const isAboveSight = headLine.bottom <= top + SIGHT_SLACK_PX;
  const isBelowSight = headLine.top >= bottom - SIGHT_SLACK_PX;
  if (!isAboveSight && !isBelowSight) {
    return;
  }
  const head = isAboveSight
    ? firstWholeLineFrom(view, top)
    : lastWholeLineTo(view, bottom);
  const anchor = selection.empty ? head : selection.anchor;
  view.dispatch({ selection: { anchor, head } });
}

// The start of the first line whose top is at or below `top`, within the
// slack, or of the line `top` cuts when it is the last.
function firstWholeLineFrom(view: EditorView, top: number): number {
  const line = view.lineBlockAtHeight(top);
  const isCutOff =
    line.top < top - SIGHT_SLACK_PX && line.to < view.state.doc.length;
  return isCutOff ? view.lineBlockAt(line.to + 1).from : line.from;
}

// The start of the last line whose bottom is at or above `bottom`, within the
// slack, or of the line `bottom` cuts when it is the first.
function lastWholeLineTo(view: EditorView, bottom: number): number {
  const line = view.lineBlockAtHeight(bottom - 1);
  const isCutOff = line.bottom > bottom + SIGHT_SLACK_PX && line.from > 0;
  return isCutOff ? view.lineBlockAt(line.from - 1).from : line.from;
}

// Reconfigures `slot` with the file's language once it loads, unless the
// editor was destroyed first. A file with no known language, or one whose
// language fails to load, stays plain text: the text is still whole and
// editable, so a missing highlight is no error to raise.
function loadDocumentLanguage(
  view: EditorView,
  fileName: string,
  slot: Compartment,
  isHosted: () => boolean,
) {
  const language = findLanguageByFile(fileName);
  if (language === null) {
    return;
  }
  void loadLanguage(language).then(
    (support) => {
      if (isHosted()) {
        view.dispatch({ effects: slot.reconfigure(support) });
      }
    },
    () => undefined,
  );
}

// A key goes through the editor's own keydown handling, so vim runs it in
// any mode (in insert mode Enter through the host's insert map, whose
// fallback breaks the line) and CodeMirror's keymap takes Backspace. A key
// event built in script types no text, so a character neither handles in
// insert mode is inserted here, as the browser inserts a typed one, unless
// the document is read-only.
function typeKey(view: EditorView, cm: VimEditor, key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  const isUnhandled = view.contentDOM.dispatchEvent(event);
  const typesText =
    isUnhandled &&
    key.length === 1 &&
    cm.state.vim.insertMode &&
    !view.state.readOnly;
  if (typesText) {
    view.dispatch({
      ...view.state.replaceSelection(key),
      userEvent: 'input.type',
      scrollIntoView: true,
    });
  }
}

// CodeMirror skips measuring an editor scrolled out of view, so after a
// resize vim's block cursor keeps the spot the old line wrap gave it, past the
// editor's edge. Setting the same selection makes vim redraw it.
function redrawCursorOnResize(view: EditorView): ResizeObserver {
  const observer = new ResizeObserver(() =>
    view.dispatch({ selection: view.state.selection }),
  );
  observer.observe(view.scrollDOM);
  return observer;
}

// Vim's own test for a buffer holding only a count; `0` alone is a motion.
const COUNT_ONLY = /^[1-9]\d*$/;

// A key name no vim command or keymap bind starts with.
const UNMATCHED_KEY = '<Nop>';

// The keys of an unfinished sequence vim is waiting on. Insert and visual
// mode report none, so a pending insert remap such as `jk` stays unseen, and
// neither does a count with no key after it, which vim keeps on Esc, nor an
// operator, which vim holds outside the buffer once typed.
function pendingKeysOf(cm: VimEditor): string[] {
  const { vim } = cm.state;
  const keyBuffer: string[] = vim.inputState.keyBuffer;
  const isCountOnly = COUNT_ONLY.test(keyBuffer.join(''));
  if (vim.insertMode || vim.visualMode || isCountOnly) {
    return [];
  }
  return [...keyBuffer];
}

// Vim replaces its input state on every cleared sequence, so the buffer is
// read fresh from this path each time; an upgrade that moves it fails here.
function requireKeyBuffer(cm: VimEditor) {
  if (!Array.isArray(cm.state.vim.inputState?.keyBuffer)) {
    throw new Error(
      'Vim has no array at cm.state.vim.inputState.keyBuffer to read pending keys from',
    );
  }
}

// Any part of a command vim is still waiting to finish, in any mode: the key
// buffer (an insert remap prefix such as `j` of `jk` included), a count, an
// operator, a register, or a literal character it expects next.
function holdsUnfinishedInput(cm: VimEditor): boolean {
  const { vim } = cm.state;
  const { inputState } = vim;
  const hasKeys = inputState.keyBuffer.length > 0;
  const hasCount =
    inputState.prefixRepeat.length > 0 || inputState.motionRepeat.length > 0;
  const hasOperator = inputState.operator !== null;
  const hasRegister = inputState.registerName !== undefined;
  const expectsLiteral = vim.expectLiteralNext === true;
  return hasKeys || hasCount || hasOperator || hasRegister || expectsLiteral;
}

// Vim clears its whole input state — buffer, count, operator, register — on a
// key no command matches, and runs nothing; Esc would run the bind on Esc in
// normal mode. Vim's command-done then reports `[]`. A recording macro logs
// that key, so it is sent only when vim holds unfinished input.
function discardUnfinishedInput(cm: VimEditor) {
  if (holdsUnfinishedInput(cm)) {
    Vim.handleKey(cm, UNMATCHED_KEY, 'user');
  }
}

// Esc in normal mode cancels a command vim holds unfinished — an operator, a
// count, a register — as vim does, so only the next Esc runs the bind on Esc.
// Highest precedence runs it ahead of vim's keydown handler.
function escapeCancelsUnfinishedInput() {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown: (event, view) => {
        if (event.key !== 'Escape') {
          return false;
        }
        const cm = vimEditorOf(view);
        const { vim } = cm.state;
        const isNormalMode = !vim.insertMode && !vim.visualMode;
        if (!isNormalMode || !holdsUnfinishedInput(cm)) {
          return false;
        }
        discardUnfinishedInput(cm);
        event.preventDefault();
        return true;
      },
    }),
  );
}

// Which editor holds the reported pending keys, and the listeners that hear
// them; a report from any editor replaces the last. Keys never outlive their
// editor's focus, so the holder is always the editor that last reported.
class PendingKeys {
  private readonly listeners: ((keys: string[]) => void)[] = [];
  private reported: string[] = [];
  private holder: VimEditor | undefined;

  listen(listener: (keys: string[]) => void) {
    this.listeners.push(listener);
  }

  reportFrom(cm: VimEditor) {
    this.report(cm, pendingKeysOf(cm));
  }

  // A destroyed editor's keys can no longer complete.
  forget(cm: VimEditor) {
    if (this.holder === cm) {
      this.report(cm, []);
    }
  }

  cancel() {
    if (this.holder) {
      discardUnfinishedInput(this.holder);
    }
  }

  private report(cm: VimEditor, keys: string[]) {
    this.holder = keys.length > 0 ? cm : undefined;
    const isUnchanged =
      keys.length === this.reported.length &&
      keys.every((key, index) => key === this.reported[index]);
    if (isUnchanged) {
      return;
    }
    this.reported = keys;
    for (const listener of this.listeners) {
      listener([...keys]);
    }
  }
}

// The window may hold no focus while the host moves it between editors, and
// the browser fires no blur then, so the editor focus leaves drops its
// unfinished command here as well as on blur.
function leaveFocusedEditor(target: EditorView, hosted: HostedEditor[]) {
  const focused = hosted.find(({ view }) =>
    view.dom.contains(document.activeElement),
  );
  if (focused && focused.view !== target) {
    discardUnfinishedInput(vimEditorOf(focused.view));
  }
}

function hostedViewOf(element: Element, hosted: HostedEditor[]): EditorView {
  const match = hosted.find(({ view }) => view.dom.contains(element));
  if (!match) {
    throw new Error('Keys typed into an element outside every hosted editor');
  }
  return match.view;
}

// The whole text after each change the user makes; `setText` is no such change.
function reportUserChanges(changed: (text: string) => void) {
  return EditorView.updateListener.of((update) => {
    const isHostReplace = update.transactions.some((transaction) =>
      transaction.isUserEvent(HOST_REPLACE),
    );
    if (update.docChanged && !isHostReplace) {
      changed(update.state.doc.toString());
    }
  });
}

// Answer boxes are prose: no gutters or brackets, and completion only when
// `options.completions` is given, after vim so CodeMirror's keymap stays
// behind vim; lines wrap. `leaving` runs on blur before the editor reports it,
// so a box the user leaves drops its unfinished keys before any other box
// reports. Its popups draw on the page body, past any scroll box it sits in.
function boxExtensions(
  events: EditorEvents,
  options: EditorOptions | undefined,
  leaving: (view: EditorView) => void,
) {
  const completion = options?.completions
    ? prefixCompletion(options.completions)
    : [];
  return [
    escapeCancelsUnfinishedInput(),
    vim({ status: true }),
    completion,
    minimalSetup,
    EditorView.lineWrapping,
    editorTheme,
    tooltipsOnBody(),
    reportUserChanges(events.changed),
    EditorView.domEventHandlers({
      focus: () => events.focused(),
      blur: (_event, view) => {
        leaving(view);
        events.blurred();
      },
    }),
  ];
}

// A whole file: line numbers, the active-line band, wrapped lines, the
// language `language` holds once it loads, highlighted through the Catppuccin
// Mocha style. Read-only blocks typed input, and vim drops every edit it
// dispatches under the same facet. Its popups draw on the page body, as a
// box's do.
function documentExtensions(
  options: DocumentOptions,
  language: Compartment,
  events: DocumentEditorEvents,
  leaving: (view: EditorView) => void,
) {
  return [
    escapeCancelsUnfinishedInput(),
    vim({ status: true }),
    minimalSetup,
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    EditorView.lineWrapping,
    EditorState.readOnly.of(options.readOnly),
    language.of([]),
    syntaxHighlighting(codeColours),
    editorTheme,
    tooltipsOnBody(),
    EditorView.editorAttributes.of({ class: 'wg-document-editor' }),
    reportUserChanges(events.changed),
    EditorView.domEventHandlers({
      blur: (_event, view) => {
        leaving(view);
      },
    }),
  ];
}

// CodeMirror mounts tooltips in a container on the body that carries the
// editor's theme classes, so the editor theme still styles them.
function tooltipsOnBody() {
  return tooltips({ parent: document.body });
}

// The completion popup belongs to insert mode, so any other mode closes it.
function closeCompletionOnLeavingInsert(view: EditorView) {
  vimEditorOf(view).on('vim-mode-change', (change: { mode: string }) => {
    if (change.mode !== 'insert') {
      closeCompletion(view);
    }
  });
}

// The mappings of `keymap` vim holds now: every one once its vimrc lines are
// applied, and before that only the insert groups' maps, which
// `defineBindCommands` makes with no editor.
function heldMappings(
  keymap: EditorKeymap,
  groups: BindGroup[],
  isVimrcApplied: boolean,
): { keys: string; mode: EditorMode }[] {
  if (isVimrcApplied) {
    return appliedMappings(keymap, groups);
  }
  return appliedMappings(
    { ...keymap, remaps: [] },
    groups.filter((group) => group.mode === 'insert'),
  );
}

// Vim keymaps are global to the engine; the keymap is applied through one
// hosted editor, since the vimrc lines need an editor instance: the first one
// created, or the first after `setKeymap` ran with none hosted. Each apply maps
// the scroll motions again, since `:mapclear` drops them with every map.
export const createCodeMirrorVimHost: CreateEditorHost = (
  initialKeymap,
  run,
  log,
) => {
  const hosted: HostedEditor[] = [];
  let keymap = initialKeymap;
  let groups = bindGroups(keymap);
  let isKeymapApplied = false;
  // Every leader whose default bind vim has dropped; vim keeps none to drop
  // again.
  const unmappedLeaders = new Set<string>();
  const pendingKeys = new PendingKeys();
  defineBindCommands(groups, hosted, run);

  const applyKeymap = (cm: VimEditor) => {
    mapScrollMotions();
    const unmapsLeader = !unmappedLeaders.has(keymap.leader);
    for (const line of vimrcLines(keymap, groups, unmapsLeader)) {
      Vim.handleEx(cm, line);
    }
    unmappedLeaders.add(keymap.leader);
    isKeymapApplied = true;
  };

  defineDocumentExCommands(hosted);
  const leaving = (left: EditorView) =>
    discardUnfinishedInput(vimEditorOf(left));

  // Joins `view` to the host: the keymap, mode and pending-key reports, and the
  // focus, blur and destroy every editor shares, which `editorOf` builds the
  // hosted editor on.
  function hostView<E extends TextEditor>(
    view: EditorView,
    modeChanged: (mode: VimMode) => void,
    editorOf: (shared: TextEditor) => E,
    answerEx?: (event: DocumentExEvent) => void,
  ): E {
    const cm = vimEditorOf(view);
    requireKeyBuffer(cm);
    const cursorRedraw = redrawCursorOnResize(view);
    if (!isKeymapApplied) {
      applyKeymap(cm);
    }
    cm.on('vim-mode-change', (change: { mode: string; subMode?: string }) =>
      modeChanged({
        mode: change.mode,
        subMode: change.subMode ?? '',
      }),
    );
    cm.on('vim-keypress', () => pendingKeys.reportFrom(cm));
    cm.on('vim-command-done', () => pendingKeys.reportFrom(cm));
    const editor = editorOf({
      text: () => view.state.doc.toString(),
      setText: (text) => replaceText(view, text),
      focus: (options) => {
        leaveFocusedEditor(view, hosted);
        focusEditor(view, cm, options);
      },
      blur: () => {
        discardUnfinishedInput(cm);
        view.contentDOM.blur();
      },
      destroy: () => {
        const index = hosted.findIndex((entry) => entry.view === view);
        if (index < 0) {
          return;
        }
        hosted.splice(index, 1);
        cursorRedraw.disconnect();
        pendingKeys.forget(cm);
        // Destroying the view nulls cm.state.vim, which vim still reads after
        // an ex command or key it is running returns: `:q` lands here. Vim's
        // prompt stops the Enter that ran the command, so no page key hears it.
        queueMicrotask(() => view.destroy());
      },
    });
    hosted.push({ view, editor, answerEx });
    return editor;
  }

  return {
    create(parent, doc, events, options) {
      const view = new EditorView({
        doc,
        extensions: boxExtensions(events, options, leaving),
        parent,
      });
      const editor = hostView(view, events.modeChanged, (shared) => shared);
      if (options?.completions) {
        closeCompletionOnLeavingInsert(view);
      }
      return editor;
    },
    createDocument(parent, doc, options, events) {
      const language = new Compartment();
      const view = new EditorView({
        doc,
        extensions: documentExtensions(options, language, events, leaving),
        parent,
      });
      const editor = hostView(
        view,
        events.modeChanged,
        (shared): DocumentEditor => ({
          ...shared,
          setText: (text) => replaceTextKeepingLine(view, text),
          goToLine: (line) => goToLine(view, line),
          scrollBy: (step, direction) =>
            scrollEditor(view, vimEditorOf(view), step, direction),
        }),
        (event) => raiseDocumentEx(events, event),
      );
      goToLine(view, options.line);
      loadDocumentLanguage(view, options.fileName, language, () =>
        hosted.some((entry) => entry.view === view),
      );
      return editor;
    },
    contains: (element) =>
      hosted.some(({ view }) => view.dom.contains(element)),
    typeInto(element, keys) {
      const view = hostedViewOf(element, hosted);
      const cm = vimEditorOf(view);
      for (const key of keys) {
        typeKey(view, cm, key);
      }
    },
    onPendingKeys: (listener) => pendingKeys.listen(listener),
    cancelPendingKeys: () => pendingKeys.cancel(),
    // Unmaps the old keymap's mappings, redefines each group's command under
    // its index, and applies the new keymap through a hosted editor, or through
    // the next one created. A changed leader's old key keeps no mapping, since
    // restoring vim's default for it would clear every map.
    setKeymap(next) {
      const nextGroups = bindGroups(next);
      // Rejects an insert key the editor cannot type unbound before anything
      // changes, as defining its action would after the old maps are gone.
      for (const group of nextGroups) {
        if (group.mode === 'insert') {
          unboundInsertKey(group);
        }
      }
      for (const { keys, mode } of heldMappings(
        keymap,
        groups,
        isKeymapApplied,
      )) {
        // Vim's unmap returns true only when it removed a mapping.
        if (Vim.unmap(keys, mode) !== true) {
          log('editor', `vim held no ${mode} mapping of ${keys} to unmap`);
        }
      }
      keymap = next;
      groups = nextGroups;
      defineBindCommands(groups, hosted, run);
      isKeymapApplied = false;
      const first = hosted[0];
      if (first !== undefined) {
        applyKeymap(vimEditorOf(first.view));
      }
    },
  };
};
