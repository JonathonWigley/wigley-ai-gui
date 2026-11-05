// @ts-check

// The built-in agent-skills look: one row per skill, its name in mono, holding its
// full text as its tooltip.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  skillList(parent, input, kit) {
    const element = kit.el(parent, 'div', 'agent-skills-list');
    for (const skill of input.skills) {
      kit.el(element, 'div', 'agent-skills-name', skill).title = skill;
    }
    return { element };
  },
};

export default layout;
