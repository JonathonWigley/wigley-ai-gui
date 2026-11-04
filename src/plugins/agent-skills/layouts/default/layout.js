// @ts-check

// The built-in agent-skills look: one row per skill, its name in mono before a
// tag naming the agent that started it.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  skillList(parent, input, kit) {
    const element = kit.el(parent, 'div', 'agent-skills-list');
    for (const { skill, ownerName, isMain } of input.skills) {
      const row = kit.el(element, 'div', 'agent-skills-row');
      kit.el(row, 'span', 'agent-skills-name', skill).title = skill;
      kit.tag(row, ownerName, isMain ? 'neutral' : 'accent');
    }
    return { element };
  },
};

export default layout;
