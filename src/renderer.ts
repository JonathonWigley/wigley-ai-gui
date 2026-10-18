import './index.css';
import { basicSetup, EditorView } from 'codemirror';
import { getCM, Vim, vim } from '@replit/codemirror-vim';
import type { LogSource } from './proof-api';

// The same vimrc lines the forms' keys.vim uses. The engine fires a full match
// before waiting on a longer one, so the default <Space> (move right) is
// unmapped first, or it shadows every <Space> mapping. A mapping to an ex
// command ends in <CR>: without it the keys only type the command into the
// prompt.
const VIMRC = `
unmap <Space>
inoremap jk <Esc>
nnoremap <Space><Space> :submit<CR>
nnoremap <Space>j :nextbox<CR>
nnoremap <Space>k :prevbox<CR>
nnoremap <Space>q :leave<CR>
`;

const logList = document.getElementById('log') as HTMLOListElement;
const editors: EditorView[] = [];

function log(source: LogSource, message: string) {
  const entry = document.createElement('li');
  entry.textContent = `[${source}] ${message}`;
  logList.prepend(entry);
}

function createEditor(parent: HTMLElement, doc: string): EditorView {
  return new EditorView({
    doc,
    extensions: [vim({ status: true }), basicSetup],
    parent,
  });
}

type VimEditor = Parameters<typeof Vim.handleEx>[0];

// The editor an ex command ran in, from the cm vim hands the command: focus
// state is unreliable, since view.hasFocus is false while the window is not.
function editorIndexOf(cm: VimEditor): number {
  const index = editors.findIndex((editor) => getCM(editor) === cm);
  if (index < 0) {
    throw new Error('Ex command ran in an editor this page did not create');
  }
  return index;
}

function focusEditorBy(from: number, step: number) {
  const next = (from + step + editors.length) % editors.length;
  editors[next].focus();
  log('vim', `focused box ${next + 1}`);
}

async function submitEditor(editor: EditorView) {
  const text = editor.state.doc.toString();
  log('vim', `:submit sent "${text}"`);
  const stopReason = await window.proof.promptAgent(text);
  log('acp', `turn ended: ${stopReason}`);
}

function defineExCommands() {
  Vim.defineEx('submit', 'sub', (cm: VimEditor) => {
    void submitEditor(editors[editorIndexOf(cm)]);
  });
  Vim.defineEx('nextbox', 'nextb', (cm: VimEditor) =>
    focusEditorBy(editorIndexOf(cm), +1),
  );
  Vim.defineEx('prevbox', 'prevb', (cm: VimEditor) =>
    focusEditorBy(editorIndexOf(cm), -1),
  );
  Vim.defineEx('leave', 'lea', (cm: VimEditor) => {
    editors[editorIndexOf(cm)].contentDOM.blur();
    log('vim', ':leave dropped focus to the page');
  });
}

function vimEditorOf(editor: EditorView): VimEditor {
  const cm = getCM(editor);
  if (!cm?.state.vim) {
    throw new Error('Editor has no vim extension to apply the vimrc to');
  }
  return cm as VimEditor;
}

function applyVimrc(editor: EditorView) {
  const cm = vimEditorOf(editor);
  for (const line of VIMRC.split('\n')) {
    if (line.trim()) {
      Vim.handleEx(cm, line);
    }
  }
}

// Keys for when no editor has focus.
function wirePageKeys() {
  document.addEventListener('keydown', (event) => {
    const isInEditor = (event.target as Element).closest('.cm-editor');
    if (isInEditor || event.key !== 'i') {
      return;
    }
    event.preventDefault();
    editors[0].focus();
    log('page', 'i focused box 1');
  });
}

defineExCommands();
for (const [index, parent] of document.querySelectorAll('.box').entries()) {
  editors.push(createEditor(parent as HTMLElement, `box ${index + 1}`));
}
applyVimrc(editors[0]);
wirePageKeys();
window.proof.onLog(log);
editors[0].focus();
