import { EditorView, minimalSetup } from 'codemirror';
import { getCM, Vim, vim } from '@replit/codemirror-vim';
import type { CommandId } from '../../contracts/commands';
import type {
  CreateEditorHost,
  EditorEvents,
  FocusOptions,
  TextEditor,
} from '../../contracts/editor';
import type { EditorKeymap, EditorMode } from '../../contracts/keymap';
import { editorTheme } from './editor-theme';
import { exCommandName } from './ex-command-name';

type VimEditor = Parameters<typeof Vim.handleEx>[0];

interface HostedEditor {
  view: EditorView;
  editor: TextEditor;
}

const MAP_PREFIX: Record<EditorMode, string> = { normal: 'n', insert: 'i' };

// The engine runs a complete bind at once instead of waiting for a longer one,
// so the leader's own default bind is unmapped before the binds that use it. A
// bind to an ex command ends in <CR>, or its keys only type into the prompt.
function vimrcLines(keymap: EditorKeymap): string[] {
  const withLeader = (keys: string) =>
    keys.replaceAll('<Leader>', keymap.leader);
  return [
    `unmap ${keymap.leader}`,
    ...keymap.remaps.map(
      (remap) =>
        `${MAP_PREFIX[remap.mode]}noremap ${withLeader(remap.keys)} ${remap.to}`,
    ),
    ...keymap.binds.map(
      (bind) =>
        `nnoremap ${withLeader(bind.keys)} :${exCommandName(bind.command)}<CR>`,
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

function defineExCommands(
  keymap: EditorKeymap,
  hosted: HostedEditor[],
  run: (command: CommandId, editor: TextEditor) => void,
) {
  const commandsByName = new Map<string, CommandId>();
  for (const { command } of keymap.binds) {
    const name = exCommandName(command);
    const claimant = commandsByName.get(name);
    if (claimant && claimant !== command) {
      throw new Error(
        `Commands "${claimant}" and "${command}" share the ex name :${name}`,
      );
    }
    commandsByName.set(name, command);
  }
  for (const [name, command] of commandsByName) {
    Vim.defineEx(name, name, (cm: VimEditor) =>
      run(command, hostedEditorOf(cm, hosted)),
    );
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

function hostedViewOf(element: Element, hosted: HostedEditor[]): EditorView {
  const match = hosted.find(({ view }) => view.dom.contains(element));
  if (!match) {
    throw new Error('Keys typed into an element outside every hosted editor');
  }
  return match.view;
}

// Answer boxes are prose: no gutters, brackets or completion; lines wrap.
function editorExtensions(events: EditorEvents) {
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
      blur: () => events.blurred(),
    }),
  ];
}

// Vim keymaps are global to the engine; they are applied once, through the
// first editor, since applying them needs an editor instance.
export const createCodeMirrorVimHost: CreateEditorHost = (keymap, run) => {
  const hosted: HostedEditor[] = [];
  let isKeymapApplied = false;
  defineExCommands(keymap, hosted, run);

  return {
    create(parent, doc, events) {
      const view = new EditorView({
        doc,
        extensions: editorExtensions(events),
        parent,
      });
      const cm = vimEditorOf(view);
      if (!isKeymapApplied) {
        for (const line of vimrcLines(keymap)) {
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
      const entry: HostedEditor = {
        view,
        editor: {
          text: () => view.state.doc.toString(),
          focus: (options) => focusEditor(view, cm, options),
          blur: () => view.contentDOM.blur(),
          destroy: () => {
            const index = hosted.indexOf(entry);
            if (index < 0) {
              return;
            }
            hosted.splice(index, 1);
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
  };
};
