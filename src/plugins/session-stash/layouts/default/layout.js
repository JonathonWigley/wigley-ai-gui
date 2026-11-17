// @ts-check

// The built-in session-stash look: the stash dialog's body names the session,
// then holds the note box, then the hint under it.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  dialogFrame(parent, input, kit) {
    const panel = kit.el(parent, 'div', 'ui-floating material-floating ui-dialog');
    kit.el(panel, 'h2', 'ui-dialog-title', input.title);
    const body = kit.el(panel, 'div', 'ui-dialog-body');
    const actions = input.hasActions ? kit.el(panel, 'div', 'ui-dialog-actions') : null;
    return { element: panel, body, actions };
  },
  noteDialog(parent, input, kit) {
    const element = kit.el(parent, 'div', 'session-stash-note');
    kit.el(element, 'p', 'session-stash-session', input.session);
    kit.noteBox(element);
    kit.el(element, 'p', 'session-stash-hint', input.hint);
    return { element };
  },
};

export default layout;
