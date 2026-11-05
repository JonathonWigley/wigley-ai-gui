// The agent-skills layout contract: what a layout in `layouts/agent-skills/<name>/layout.js` draws a session's skills
// with. In the session hub's Skills section, the app draws one `skillList` while the main agent has started any skill,
// and nothing otherwise, which hides the section. The app sets `data-layout-owner="agent-skills"` and
// `data-layout="<name>"` on the element the list returns, `<name>` being the layout that drew it, so
// `[data-layout-owner="agent-skills"][data-layout="<name>"] …` in a layout's CSS selects only its own list.
//
// The app keeps:
// - the section's frame, its title, its summary (the skill count) and its collapse, which are chat's;
// - no keys and no focus: the list takes neither.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// The names of the skills the session's main agent started, each once, in start order. A project-scoped skill's name
// comes without its folder path.
export interface SkillListInput {
  skills: readonly string[];
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
