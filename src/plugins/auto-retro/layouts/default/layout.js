// @ts-check

// The built-in auto-retro look: the count of retros still queued, as quiet
// text at the end of the Retro section's header.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  queued(parent, input, kit) {
    const element = kit.el(
      parent,
      'span',
      'auto-retro-queued',
      `${input.queued} queued`,
    );
    return { element };
  },
};

export default layout;
