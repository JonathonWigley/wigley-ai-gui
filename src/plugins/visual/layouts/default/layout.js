// @ts-check

// The built-in visual look: a running dot and a line of text while the block
// streams, then the frame in a clipped, rounded box as wide as its column
// over a bar holding the expand control; the overlay shows the frame in a
// sheet filling the window, with its place under it when there is more than
// one.

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
    const bar = kit.el(root, 'div', 'visual-bar');
    const button = kit.expand(bar);
    kit.keyHint(button, 'openVisuals');
    return root;
  },
  overlay(parent, input, kit) {
    const root = kit.el(parent, 'div', 'visual-overlay-part');
    const body = kit.el(root, 'div', 'visual-overlay-body');
    kit.frame(body);
    const count = kit.el(
      root,
      'div',
      'visual-overlay-count',
      `${input.index + 1} of ${input.count}`,
    );
    count.hidden = input.count < 2;
    return root;
  },
};

export default layout;
