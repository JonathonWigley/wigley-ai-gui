import { definePlugin } from '../../shared/define-plugin';

// A popup over any mode that keeps one note draft — target repo, title, body,
// tags, a session and marked-up images — and sends it to a new or existing
// follow-up through Backlog, or to a new background session through chat.
export const notesManifest = definePlugin({
  id: 'notes',
  dependsOn: {
    main: ['sessions', 'chat', 'backlog'],
    page: ['sessions'],
  },
  reads: { main: [], page: [] },
  commands: {
    open: {
      label: 'open or close the note popup',
      group: 'notes',
      runsIn: 'page',
    },
    close: {
      label: 'close the popup, keeping the draft',
      group: 'notes',
      runsIn: 'page',
    },
    nextField: { label: 'next field', group: 'fields', runsIn: 'page' },
    prevField: { label: 'previous field', group: 'fields', runsIn: 'page' },
    act: { label: 'edit or pick the field', group: 'fields', runsIn: 'page' },
    editBox: { label: 'type in the field', group: 'fields', runsIn: 'page' },
    nextBox: { label: 'next text box', group: 'fields', runsIn: 'page' },
    prevBox: { label: 'previous text box', group: 'fields', runsIn: 'page' },
    leaveBox: { label: 'leave the box', group: 'fields', runsIn: 'page' },
    pickTarget: {
      label: 'pick the target repo',
      group: 'fields',
      runsIn: 'page',
    },
    pickTags: { label: 'add or remove a tag', group: 'fields', runsIn: 'page' },
    pickSession: {
      label: 'attach another session',
      group: 'fields',
      runsIn: 'page',
    },
    nextImage: { label: 'next image', group: 'images', runsIn: 'page' },
    prevImage: { label: 'previous image', group: 'images', runsIn: 'page' },
    remove: {
      label: 'remove the image or the session',
      group: 'fields',
      runsIn: 'page',
    },
    capture: { label: 'capture the window', group: 'images', runsIn: 'page' },
    sendFollowup: {
      label: 'send to a new follow-up',
      group: 'send',
      runsIn: 'page',
    },
    appendFollowup: {
      label: 'append to a follow-up',
      group: 'send',
      runsIn: 'page',
    },
    sendSession: {
      label: 'send to a new session',
      group: 'send',
      runsIn: 'page',
    },
    discard: { label: 'discard the draft', group: 'send', runsIn: 'page' },
    toolSelect: { label: 'select and move', group: 'markup', runsIn: 'page' },
    toolPen: { label: 'pen', group: 'markup', runsIn: 'page' },
    toolText: { label: 'text', group: 'markup', runsIn: 'page' },
    toolArrow: { label: 'arrow', group: 'markup', runsIn: 'page' },
    toolBox: { label: 'box', group: 'markup', runsIn: 'page' },
    nextColour: { label: 'next colour', group: 'markup', runsIn: 'page' },
    prevColour: { label: 'previous colour', group: 'markup', runsIn: 'page' },
    undo: { label: 'undo', group: 'markup', runsIn: 'page' },
    redo: { label: 'redo', group: 'markup', runsIn: 'page' },
    closeMarkup: { label: 'back to the note', group: 'markup', runsIn: 'page' },
    pickerDown: { label: 'next line', group: 'picker', runsIn: 'page' },
    pickerUp: { label: 'previous line', group: 'picker', runsIn: 'page' },
    pickerChoose: { label: 'pick', group: 'picker', runsIn: 'page' },
    pickerCancel: { label: 'close', group: 'picker', runsIn: 'page' },
    pickerFilter: { label: 'filter', group: 'picker', runsIn: 'page' },
    pickerList: { label: 'back to the list', group: 'picker', runsIn: 'page' },
    confirmYes: {
      label: 'yes, discard the draft',
      group: 'confirm',
      runsIn: 'page',
    },
    confirmNo: { label: 'keep the draft', group: 'confirm', runsIn: 'page' },
  },
  scopes: {
    popup: 'In the note popup',
    title: 'In the note title box',
    markup: 'In the markup view',
    picker: 'In a notes picker',
    confirm: 'In the discard confirmation',
  },
  settings: {
    launchBrief:
      'A nitpick to fix, noted while working. Make the change, then report.',
    autosaveDelayMs: 400,
    layout: 'default',
  },
  settingInfo: {
    launchBrief: {
      label: 'Launch brief',
      description:
        "The line a session started from a note reads first, before the note's text.",
    },
    autosaveDelayMs: {
      label: 'Autosave delay',
      description:
        'Milliseconds the note popup waits after an edit before it saves the draft.',
    },
    layout: {
      label: 'Layout',
      description:
        "The notes layout the note popup draws in: a folder name in notes' layouts folder, or default.",
    },
  },
  themeTokens: {
    'markup-red': { kind: 'color', default: 'var(--wg-status-error)' },
    'markup-yellow': { kind: 'color', default: 'var(--wg-status-warning)' },
    'markup-green': { kind: 'color', default: 'var(--wg-status-success)' },
    'markup-blue': { kind: 'color', default: 'var(--wg-status-info)' },
  },
});
