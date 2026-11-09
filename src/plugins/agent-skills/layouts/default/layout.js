// @ts-check

// The built-in agent-skills look: the skills grouped by their namespace (the
// part before the first `:`), each group under its dim name, the skills without
// one first and unnamed; each skill a chip holding the rest of its name in mono,
// with its full name as its tooltip. Groups and chips keep start order.

/** @type {import('../layout').CompleteLayout} */
const layout = {
  skillList(parent, input, kit) {
    const element = kit.el(parent, 'div', 'agent-skills-list');
    for (const [namespace, skills] of byNamespace(input.skills)) {
      const group = kit.el(element, 'div', 'agent-skills-group');
      if (namespace !== '') {
        kit.el(group, 'div', 'agent-skills-namespace', namespace);
      }
      const chips = kit.el(group, 'div', 'agent-skills-chips');
      for (const skill of skills) {
        kit.el(chips, 'span', 'agent-skills-name', skill.name).title =
          skill.full;
      }
    }
    return { element };
  },
};

/**
 * @param {readonly string[]} skills
 * @returns {Map<string, { name: string, full: string }[]>}
 */
function byNamespace(skills) {
  /** @type {Map<string, { name: string, full: string }[]>} */
  const groups = new Map([['', []]]);
  for (const full of skills) {
    const colon = full.indexOf(':');
    const namespace = colon < 0 ? '' : full.slice(0, colon);
    const group = groups.get(namespace) ?? [];
    group.push({ name: full.slice(colon + 1), full });
    groups.set(namespace, group);
  }
  if (groups.get('')?.length === 0) {
    groups.delete('');
  }
  return groups;
}

export default layout;
