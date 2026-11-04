// The agent-skills layout contract: what a layout in `layouts/agent-skills/<name>/layout.js` draws a session's skills
// with. In the session hub's Skills section, the app draws one `skillList` while the session's roster lists any skill,
// and nothing otherwise, which hides the section. The app sets `data-layout-owner="agent-skills"` and
// `data-layout="<name>"` on the element the list returns, `<name>` being the layout that drew it, so
// `[data-layout-owner="agent-skills"][data-layout="<name>"] …` in a layout's CSS selects only its own list.
//
// The app keeps:
// - the section's frame, its title, its summary (the skill count) and its collapse, which are chat's;
// - no keys and no focus: the list takes neither.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// One skill an agent started. `ownerName` names that agent as it was when the skill started: `main`, or the subagent's
// name. `isMain` is true for the main agent's skill alone, since a subagent may be named `main`.
export interface SkillRowInput {
  skill: string;
  ownerName: string;
  isMain: boolean;
}

// The session's skills, in start order.
export interface SkillListInput {
  skills: readonly SkillRowInput[];
}

// What a part returns: its root, appended to `parent`.
export interface AgentSkillsPart {
  element: HTMLElement;
}

// Each part comes from the first layout that defines it among the `agent-skills.layout` setting and `default`; a part
// that throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
export interface Layout {
  skillList?(
    parent: HTMLElement,
    input: SkillListInput,
    kit: BaseKit,
  ): AgentSkillsPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
