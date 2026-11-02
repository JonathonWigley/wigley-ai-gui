export interface TypedSkill {
  skill: string;
  args: string;
}

// The skill a sent message names when it begins with `/`, as a harness reports it in `skillStarted`; null for any
// other message.
export function typedSkill(text: string): TypedSkill | null {
  const match = /^\/(\S+)(.*)$/s.exec(text);
  if (match === null) {
    return null;
  }
  return { skill: match[1], args: match[2].trim() };
}
