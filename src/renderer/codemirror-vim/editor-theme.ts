import { EditorView } from 'codemirror';
import type { ThemeToken } from '../../contracts/theme';
import { FONT_VARIABLES, themeVariable } from '../../shared/theme-variables';

function colour(token: ThemeToken): string {
  return `var(${themeVariable(token)})`;
}

// Colours are CSS variables, so the page's theme restyles every editor.
// `.cm-vimCursorLayer` outranks vim's own `.cm-fat-cursor` rules, and vim sets
// the cursor letter's colour inline.
export const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: colour('editor.bg'),
    color: colour('editor.fg'),
    fontSize: `var(${FONT_VARIABLES.monoSize})`,
  },
  '&.cm-focused': { outline: `1px solid ${colour('border.focus')}` },
  '&.wg-document-editor': { height: '100%' },
  '.cm-scroller': { fontFamily: `var(${FONT_VARIABLES.mono})` },
  '.cm-gutters': {
    backgroundColor: colour('editor.bg'),
    color: colour('editor.gutter'),
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.75em 0 0.5em' },
  '.cm-cursor': { borderLeftColor: colour('editor.cursor') },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: colour('editor.selection') },
  '&.cm-focused .cm-vimCursorLayer .cm-fat-cursor': {
    background: colour('editor.cursor'),
    color: `${colour('text.onAccent')} !important`,
  },
  '&:not(.cm-focused) .cm-vimCursorLayer .cm-fat-cursor': {
    outline: `1px solid ${colour('editor.cursor')}`,
  },
  '.cm-panels': {
    backgroundColor: colour('editor.bg'),
    color: colour('editor.gutter'),
  },
  '.cm-panels-bottom': { borderTop: `1px solid ${colour('border')}` },
  '.cm-vim-panel input': { color: colour('editor.fg') },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    backgroundColor: colour('bg.pane'),
    border: `1px solid ${colour('border')}`,
    color: colour('editor.fg'),
    // Autocomplete's base theme sets `monospace` on the list itself.
    '& > ul': { fontFamily: `var(${FONT_VARIABLES.mono})` },
    '& > ul > li[aria-selected]': {
      backgroundColor: colour('surface.selected'),
      color: colour('editor.fg'),
    },
  },
});
