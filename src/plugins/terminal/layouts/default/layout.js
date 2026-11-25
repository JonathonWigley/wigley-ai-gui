// @ts-check

// The built-in terminal look: one row over the screen holding the shell's
// folder, ellipsized, with the full folder as its tooltip; a tag saying whether
// the shell is starting, running or exited, and how it ended; and, once it has
// exited, a Restart button that starts a new shell; and the hint for the chord
// that closes the drawer.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  drawerHeader(parent, input, kit) {
    const element = kit.el(parent, 'div', 'terminal-header');
    kit.el(element, 'span', 'terminal-header-folder', input.folder).title =
      input.folder;
    if (input.state === 'starting') {
      kit.tag(element, 'starting', 'neutral');
    } else if (input.state === 'running') {
      kit.tag(element, 'running', 'running');
    } else {
      kit.tag(element, `exited: ${input.exitReason ?? 'unknown'}`, 'error');
      kit.button(element, 'Restart', 'terminal.restart', {
        arg: input.sessionId,
      });
    }
    kit.keyHint(element, 'toggle', { label: 'close' });
    return { element };
  },
};

export default layout;
