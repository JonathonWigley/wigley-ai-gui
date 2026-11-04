// @ts-check

// The built-in agent-skills look: one row per skill, its name in mono before a
// tag per agent name that started it, counted when several agents share the name.

/**
 * @param {import('../layout').SkillListInput['skills']} skills
 * @returns {Map<string, { ownerName: string, isMain: boolean, count: number }[]>}
 *   each skill's owners, skills and owners in start order
 */
function ownersBySkill(skills) {
  /** @type {Map<string, { ownerName: string, isMain: boolean, count: number }[]>} */
  const owners = new Map();
  for (const { skill, ownerName, isMain } of skills) {
    const skillOwners = owners.get(skill) ?? [];
    owners.set(skill, skillOwners);
    const owner = skillOwners.find(
      (held) => held.ownerName === ownerName && held.isMain === isMain,
    );
    if (owner === undefined) {
      skillOwners.push({ ownerName, isMain, count: 1 });
    } else {
      owner.count += 1;
    }
  }
  return owners;
}

/** @type {import('../layout').CompleteLayout} */
const layout = {
  skillList(parent, input, kit) {
    const element = kit.el(parent, 'div', 'agent-skills-list');
    for (const [skill, owners] of ownersBySkill(input.skills)) {
      const row = kit.el(element, 'div', 'agent-skills-row');
      kit.el(row, 'span', 'agent-skills-name', skill).title = skill;
      const tags = kit.el(row, 'div', 'agent-skills-owners');
      for (const { ownerName, isMain, count } of owners) {
        const text = count > 1 ? `${ownerName} ×${count}` : ownerName;
        kit.tag(tags, text, isMain ? 'neutral' : 'accent');
      }
    }
    return { element };
  },
};

export default layout;
