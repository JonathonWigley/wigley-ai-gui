import { EditorView, minimalSetup } from 'codemirror';
import { getCM, Vim, vim } from '@replit/codemirror-vim';
import type {
  CreateEditorHost,
  EditorEvents,
  FocusOptions,
  TextEditor,
} from '../../contracts/editor';
import type {
  EditorBind,
  EditorKeymap,
  EditorMode,
} from '../../contracts/keymap';
import { withLeader } from '../../shared/key-hints';
import { editorTheme } from './editor-theme';
import { exBindName } from './ex-command-name';

type VimEditor = Parameters<typeof Vim.handleEx>[0];

interface HostedEditor {
  view: EditorView;
  editor: TextEditor;
}

const MAP_PREFIX: Record<EditorMode, string> = { normal: 'n', insert: 'i' };

// The binds sharing one key sequence, `<Leader>` spelled as the leader.
interface BindGroup {
  keys: string;
  binds: EditorBind[];
}

// The keymap's binds grouped by key sequence, groups in the order their keys
// first appear and binds in keymap order: one vim map per sequence.
function bindGroups(keymap: EditorKeymap): BindGroup[] {
  const groups = new Map<string, EditorBind[]>();
  for (const bind of keymap.binds) {
    const keys = withLeader(bind.keys, keymap.leader);
    const group = groups.get(keys);
    if (group) {
      group.push(bind);
    } else {
      groups.set(keys, [bind]);
    }
  }
  return [...groups].map(([keys, binds]) => ({ keys, binds }));
}

// The engine runs a complete bind at once instead of waiting for a longer one,
// so the leader's own default bind is unmapped before the binds that use it. A
// bind to an ex command ends in <CR>, or its keys only type into the prompt.
function vimrcLines(keymap: EditorKeymap, groups: BindGroup[]): string[] {
  return [
    `unmap ${keymap.leader}`,
    ...keymap.remaps.map(
      (remap) =>
        `${MAP_PREFIX[remap.mode]}noremap ${withLeader(remap.keys, keymap.leader)} ${remap.to}`,
    ),
    ...groups.map(
      (group, index) => `nnoremap ${group.keys} :${exBindName(index)}<CR>`,
    ),
  ];
}

function vimEditorOf(view: EditorView): VimEditor {
  const cm = getCM(view);
  if (!cm?.state.vim) {
    throw new Error('Editor has no vim extension to apply the keymap to');
  }
  return cm as VimEditor;
}

// The editor an ex command ran in, from the cm vim hands the command: focus
// state is unreliable, since view.hasFocus is false while the window is not.
function hostedEditorOf(cm: VimEditor, hosted: HostedEditor[]): TextEditor {
  const match = hosted.find((entry) => getCM(entry.view) === cm);
  if (!match) {
    throw new Error('Ex command ran in an editor this host did not create');
  }
  return match.editor;
}

// Each group's ex command hands `run` the group's binds and the editor its
// keys fired in.
function defineExCommands(
  groups: BindGroup[],
  hosted: HostedEditor[],
  run: (binds: EditorBind[], editor: TextEditor) => void,
) {
  groups.forEach((group, index) => {
    const name = exBindName(index);
    Vim.defineEx(name, name, (cm: VimEditor) =>
      run(group.binds, hostedEditorOf(cm, hosted)),
    );
  });
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

function focusEditor(
  view: EditorView,
  cm: VimEditor,
  options: FocusOptions | undefined,
) {
  view.focus();
  if (options?.insertAtEnd) {
    insertAtEnd(view, cm);
  }
}

// A key goes through the editor's own keydown handling, so vim runs it in
// any mode and CodeMirror's keymap takes Enter or Backspace. A key event
// built in script types no text, so a character neither handles in insert
// mode is inserted here, as the browser inserts a typed one.
function typeKey(view: EditorView, cm: VimEditor, key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  const isUnhandled = view.contentDOM.dispatchEvent(event);
  const typesText = isUnhandled && key.length === 1 && cm.state.vim.insertMode;
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

// Answer boxes are prose: no gutters, brackets or completion; lines wrap.
// `leaving` runs on blur before the editor reports it, so a box the user
// leaves drops its unfinished keys before any other box reports.
function editorExtensions(
  events: EditorEvents,
  leaving: (view: EditorView) => void,
) {
  return [
    vim({ status: true }),
    minimalSetup,
    EditorView.lineWrapping,
    editorTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        events.changed(update.state.doc.toString());
      }
    }),
    EditorView.domEventHandlers({
      focus: () => events.focused(),
      blur: (_event, view) => {
        leaving(view);
        events.blurred();
      },
    }),
  ];
}

// Vim keymaps are global to the engine; they are applied once, through the
// first editor, since applying them needs an editor instance.
export const createCodeMirrorVimHost: CreateEditorHost = (keymap, run) => {
  const hosted: HostedEditor[] = [];
  let isKeymapApplied = false;
  const pendingKeys = new PendingKeys();
  const groups = bindGroups(keymap);
  defineExCommands(groups, hosted, run);

  return {
    create(parent, doc, events) {
      const view = new EditorView({
        doc,
        extensions: editorExtensions(events, (left) =>
          pendingKeys.discardIn(vimEditorOf(left)),
        ),
        parent,
      });
      const cm = vimEditorOf(view);
      requireKeyBuffer(cm);
      const cursorRedraw = redrawCursorOnResize(view);
      if (!isKeymapApplied) {
        for (const line of vimrcLines(keymap, groups)) {
          Vim.handleEx(cm, line);
        }
        isKeymapApplied = true;
      }
      cm.on('vim-mode-change', (change: { mode: string; subMode?: string }) =>
        events.modeChanged({
          mode: change.mode,
          subMode: change.subMode ?? '',
        }),
      );
      cm.on('vim-keypress', () => pendingKeys.reportFrom(cm));
      cm.on('vim-command-done', () => pendingKeys.reportFrom(cm));
      const entry: HostedEditor = {
        view,
        editor: {
          text: () => view.state.doc.toString(),
          focus: (options) => {
            leaveFocusedEditor(view, hosted, pendingKeys);
            focusEditor(view, cm, options);
          },
          blur: () => {
            pendingKeys.discardIn(cm);
            view.contentDOM.blur();
          },
          destroy: () => {
            const index = hosted.indexOf(entry);
            if (index < 0) {
              return;
            }
            hosted.splice(index, 1);
            cursorRedraw.disconnect();
            pendingKeys.forget(cm);
            view.destroy();
          },
        },
      };
      hosted.push(entry);
      return entry.editor;
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
  };
};
