// @ts-check

// The built-in scoped-agents look: the ask box's heading, its hint, then the
// text box.

/** @type {import('../layout').CompleteScopedAgentsLayout} */
const layout = {
  askBox(parent, input, kit) {
    const root = kit.el(parent, 'div', 'scoped-agents-ask');
    kit.el(root, 'h3', 'scoped-agents-ask-title', input.heading);
    kit.el(root, 'p', 'scoped-agents-ask-hint', input.hint);
    kit.textBox(root);
    return { element: root };
  },
};

export default layout;
