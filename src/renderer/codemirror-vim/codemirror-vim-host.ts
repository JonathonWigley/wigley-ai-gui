import { closeCompletion } from '@codemirror/autocomplete';
import { EditorView, minimalSetup } from 'codemirror';
import { syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { lineNumbers } from '@codemirror/view';
import { CodeMirror, getCM, Vim, vim } from '@replit/codemirror-vim';
import type {
  CreateEditorHost,
  DocumentEditor,
  DocumentEditorEvents,
  DocumentOptions,
  EditorEvents,
  EditorOptions,
  FocusOptions,
  TextEditor,
  VimMode,
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
const UNBOUND_INSERT_KEYS: Partial<Record<string, (cm: CodeMirror) => void>> = {
  '<CR>': (cm) => CodeMirror.commands.newlineAndIndent(cm),
};

function unboundInsertKey(group: BindGroup): (cm: CodeMirror) => void {
  const unbound = UNBOUND_INSERT_KEYS[group.keys];
  if (!unbound) {
    const supported = Object.keys(UNBOUND_INSERT_KEYS).join(', ');
    throw new Error(
      `Insert-mode bind "${group.keys}" names a key the editor cannot type when no bind is in force; insert binds take ${supported}`,
    );
  }
  return unbound;
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
      this.discardIn(this.holder);
    }
  }

  // Vim clears its whole input state — buffer, count, operator, register — on
  // a key no command matches, and runs nothing; Esc would run the bind on Esc
  // in normal mode. Vim's command-done then reports `[]`. A recording macro
  // logs that key, so it is sent only when vim holds unfinished input.
  discardIn(cm: VimEditor) {
    if (holdsUnfinishedInput(cm)) {
      Vim.handleKey(cm, UNMATCHED_KEY, 'user');
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
function leaveFocusedEditor(
  target: EditorView,
  hosted: HostedEditor[],
  pendingKeys: PendingKeys,
) {
  const focused = hosted.find(({ view }) =>
    view.dom.contains(document.activeElement),
  );
  if (focused && focused.view !== target) {
    pendingKeys.discardIn(vimEditorOf(focused.view));
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
// reports.
function boxExtensions(
  events: EditorEvents,
  options: EditorOptions | undefined,
  leaving: (view: EditorView) => void,
) {
  const completion = options?.completions
    ? prefixCompletion(options.completions)
    : [];
  return [
    vim({ status: true }),
    completion,
    minimalSetup,
    EditorView.lineWrapping,
    editorTheme,
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

// A whole file: line numbers, wrapped lines, the language `language` holds once
// it loads, highlighted through the Catppuccin Mocha style. Read-only blocks typed
// input, and vim drops every edit it dispatches under the same facet.
function documentExtensions(
  options: DocumentOptions,
  language: Compartment,
  events: DocumentEditorEvents,
  leaving: (view: EditorView) => void,
) {
  return [
    vim({ status: true }),
    minimalSetup,
    lineNumbers(),
    EditorView.lineWrapping,
    EditorState.readOnly.of(options.readOnly),
    language.of([]),
    syntaxHighlighting(codeColours),
    editorTheme,
    EditorView.editorAttributes.of({ class: 'wg-document-editor' }),
    reportUserChanges(events.changed),
    EditorView.domEventHandlers({
      blur: (_event, view) => {
        leaving(view);
      },
    }),
  ];
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

// Vim keymaps are global to the engine; the vimrc lines are applied through
// one hosted editor, since applying them needs an editor instance: the first
// one created, or the first after `setKeymap` ran with none hosted.
export const createCodeMirrorVimHost: CreateEditorHost = (
  initialKeymap,
  run,
) => {
  const hosted: HostedEditor[] = [];
  let keymap = initialKeymap;
  let groups = bindGroups(keymap);
  let isKeymapApplied = false;
  // The leader whose default bind vim has dropped, null before any has been.
  let unmappedLeader: string | null = null;
  const pendingKeys = new PendingKeys();
  defineBindCommands(groups, hosted, run);

  const applyVimrc = (cm: VimEditor) => {
    const unmapsLeader = keymap.leader !== unmappedLeader;
    for (const line of vimrcLines(keymap, groups, unmapsLeader)) {
      Vim.handleEx(cm, line);
    }
    unmappedLeader = keymap.leader;
    isKeymapApplied = true;
  };

  defineDocumentExCommands(hosted);
  const leaving = (left: EditorView) =>
    pendingKeys.discardIn(vimEditorOf(left));

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
      applyVimrc(cm);
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
        leaveFocusedEditor(view, hosted, pendingKeys);
        focusEditor(view, cm, options);
      },
      blur: () => {
        pendingKeys.discardIn(cm);
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
    // its index, and maps the new keymap through a hosted editor, or through
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
        Vim.unmap(keys, mode);
      }
      keymap = next;
      groups = nextGroups;
      defineBindCommands(groups, hosted, run);
      isKeymapApplied = false;
      const first = hosted[0];
      if (first !== undefined) {
        applyVimrc(vimEditorOf(first.view));
      }
    },
  };
};
