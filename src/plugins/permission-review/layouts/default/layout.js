// @ts-check

// The built-in permission-review look: the verdict's heading, coloured by its risk (or quiet while reviewing and when
// unavailable, through `data-state`), with the reviewer's summary or the reason under it.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  verdict(parent, input, kit) {
    const element = kit.el(parent, 'div', 'permission-review-verdict');
    element.dataset.state = input.state;
    if (input.risk !== null) {
      element.dataset.risk = input.risk;
    }
    kit.el(element, 'div', 'permission-review-verdict-heading', input.heading);
    if (input.detail !== null) {
      kit.el(element, 'div', 'permission-review-verdict-detail', input.detail);
    }
    return { element };
  },
};

export default layout;
