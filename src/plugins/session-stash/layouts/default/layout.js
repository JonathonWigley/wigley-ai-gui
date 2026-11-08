// @ts-check

// The built-in session-stash look: the stash dialog's body names the session,
// then holds the note box, then the hint under it.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  noteDialog(parent, input, kit) {
    const element = kit.el(parent, 'div', 'session-stash-note');
    kit.el(element, 'p', 'session-stash-session', input.session);
    kit.noteBox(element);
    kit.el(element, 'p', 'session-stash-hint', input.hint);
    return { element };
  },
};

export default layout;
