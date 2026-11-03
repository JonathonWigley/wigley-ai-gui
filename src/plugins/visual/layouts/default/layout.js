// @ts-check

// The built-in visual look: a running dot and a line of text while the block
// streams, then the frame in a clipped, rounded box as wide as its column.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  card(parent, kit) {
    const card = kit.card(parent, 'visual-card');
    kit.statusDot(card, 'running');
    kit.el(card, 'span', 'visual-card-text', 'drawing visual…');
    return card;
  },
  visual(parent, kit) {
    const root = kit.el(parent, 'div', 'visual');
    kit.frame(root);
    return root;
  },
};

export default layout;
