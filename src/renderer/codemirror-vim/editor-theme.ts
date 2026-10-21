import { EditorView } from 'codemirror';

// Colours, fonts and sizes are theme variables, so the page's theme restyles
// every editor. `.cm-vimCursorLayer` outranks vim's own `.cm-fat-cursor`
// rules, and vim sets the cursor letter's colour inline.
export const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--wg-editor-background)',
    color: 'var(--wg-fg)',
    fontSize: 'var(--wg-text-mono)',
  },
  '&.cm-focused': { outline: '1px solid var(--wg-focus-border)' },
  '&.wg-document-editor': { height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--wg-font-mono)' },
  '.cm-gutters': {
    backgroundColor: 'var(--wg-editor-background)',
    color: 'var(--wg-line-number)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.75em 0 0.5em' },
  '.cm-cursor': { borderLeftColor: 'var(--wg-cursor)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--wg-selection-background)' },
  '&.cm-focused .cm-vimCursorLayer .cm-fat-cursor': {
    background: 'var(--wg-cursor)',
    color: 'var(--wg-fg-on-accent) !important',
  },
  '&:not(.cm-focused) .cm-vimCursorLayer .cm-fat-cursor': {
    outline: '1px solid var(--wg-cursor)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--wg-editor-background)',
    color: 'var(--wg-line-number)',
  },
  '.cm-panels-bottom': { borderTop: '1px solid var(--wg-border-default)' },
  '.cm-vim-panel input': { color: 'var(--wg-fg)' },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    backgroundColor: 'var(--wg-material-floating-bg)',
    border: '1px solid var(--wg-border-default)',
    color: 'var(--wg-fg)',
    // Autocomplete's base theme sets `monospace` on the list itself.
    '& > ul': { fontFamily: 'var(--wg-font-mono)' },
    '& > ul > li[aria-selected]': {
      backgroundColor: 'var(--wg-list-active-background)',
      color: 'var(--wg-fg)',
    },
  },
});
