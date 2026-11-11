// @ts-check

// The built-in live-view look: the notice, when there is one, as one dim line
// with its button after it, over the slot the app puts the video into.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  liveView(parent, input, kit) {
    const element = kit.el(parent, 'div', 'live-view');
    const { notice } = input;
    if (notice !== null) {
      const line = kit.el(element, 'div', 'live-view-notice');
      kit.el(line, 'span', 'live-view-notice-text', notice.text);
      if (notice.action !== null) {
        kit.button(line, notice.action.label, notice.action.command, {
          variant: 'secondary',
        });
      }
    }
    const videoSlot = kit.el(element, 'div', 'live-view-video-slot');
    return { element, videoSlot };
  },
};

export default layout;
