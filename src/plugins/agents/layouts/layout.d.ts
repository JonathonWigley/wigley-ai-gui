// The agents layout contract: what a layout in `layouts/agents/<name>/layout.js` draws the running subagent lines
// with. Under each session row, in the row part's wrapper, the app draws one `line` per subagent the session runs,
// in spawn order. The app sets `data-layout-owner="agents"` and `data-layout="<name>"` on the element each line
// returns, `<name>` being the layout that drew it, so `[data-layout-owner="agents"][data-layout="<name>"] …` in a
// layout's CSS selects only its own lines.
//
// The app keeps:
// - the click on a line, which is the session row's own: it selects the session;
// - no keys and no focus: a line takes neither;
// - the redraw once a second while any line shows, which draws every line again with the new elapsed text;
// - the elapsed text, formatted as `42s`, `3m 05s` or `1h 02m`.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// One running subagent: its type (`Explore`, `wigley:sonnet-medium`), the task it was given, how long it has run, and
// how many tool calls it has started.
export interface SubagentLineInput {
  agentType: string;
  description: string;
  elapsed: string;
  toolCalls: number;
}

// The kit every agents part gets.
export interface AgentsKit extends BaseKit {}

// What a part returns: its root, appended to `parent`.
export interface AgentsPart {
  element: HTMLElement;
}

// `line` comes from the first layout that defines it among the `agents.layout` setting and `default`; a line that
// throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
export interface Layout {
  line?(
    parent: HTMLElement,
    input: SubagentLineInput,
    kit: AgentsKit,
  ): AgentsPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
