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
  // A text box's focus ring is its frame. The document editor's ring is an
  // overlay so the opaque gutter and vim panel cannot cover its edges; an
  // input frame around a document editor hides it and rings it instead. The
  // document editor isolates its stacking, so the ring's z-index orders it
  // only above the editor's own gutter and panels. The ring follows focus
  // anywhere inside the editor: vim's `:` line input takes focus from the
  // content, and CodeMirror drops `.cm-focused` while it holds it.
  '&.cm-focused': { outline: 'none' },
  '&.wg-document-editor': { height: '100%', isolation: 'isolate' },
  '&.wg-document-editor:focus-within::after': {
    content: '""',
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '300',
    borderRadius: 'inherit',
    outline: '1px solid var(--wg-focus-border)',
    outlineOffset: '-1px',
  },
  '.cm-scroller': { fontFamily: 'var(--wg-font-mono)' },
  '.cm-gutters': {
    backgroundColor: 'var(--wg-editor-background)',
    color: 'var(--wg-line-number)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 var(--wg-space-3) 0 var(--wg-space-2)',
  },
  // The active-line band shows only while the editor is focused.
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLine': {
    backgroundColor: 'var(--wg-editor-active-line)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLineGutter': {
    color: 'var(--wg-line-number-active)',
  },
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
  // CodeMirror stacks its panels at z-index 300, above the page's overlays.
  // The bottom panel follows the scroller in the DOM, so it paints over the
  // scroller's text with no z-index of its own.
  '.cm-panels-bottom': {
    borderTop: '1px solid var(--wg-border-default)',
    zIndex: 'auto',
  },
  '.cm-vim-panel input': { color: 'var(--wg-fg)' },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    // The popup carries `.material-floating`; CodeMirror's base tooltip theme
    // outranks that class on background and border, so both are restated here.
    backgroundColor: 'var(--wg-material-floating-bg)',
    border: '1px solid var(--wg-material-floating-edge)',
    borderRadius: 'var(--wg-radius-lg)',
    color: 'var(--wg-fg)',
    fontSize: 'var(--wg-text-mono)',
    // Boxes sit in the composer and in dialogs; the popup draws above every
    // surface a box sits in and below toasts.
    zIndex: 'calc(var(--wg-z-dialog) + 1)',
    // Autocomplete's base theme sets `monospace` on the list itself.
    '& > ul': { fontFamily: 'var(--wg-font-mono)' },
    '& > ul > li': { padding: 'var(--wg-space-0_5) var(--wg-space-2)' },
    '& > ul > li[aria-selected]': {
      backgroundColor: 'var(--wg-list-active-background)',
      color: 'var(--wg-fg)',
    },
  },
});
