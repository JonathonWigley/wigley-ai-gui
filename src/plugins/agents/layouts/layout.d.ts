// The agents layout contract: what a layout in `layouts/agents/<name>/layout.js` draws a session's running subagents
// and running tasks with. Under each session row, in the row part's wrapper, the app draws one `agentLine` per subagent
// the session runs and one `taskLine` per task, in start order; a task a listed subagent started is drawn right after
// that subagent's line, with `isNested` set, and every other task (the main agent's, or one whose subagent finished)
// takes its own place in start order. The app sets `data-layout-owner="agents"` and `data-layout="<name>"` on the
// element each line returns, `<name>` being the layout that drew it, so `[data-layout-owner="agents"][data-layout="<name>"] …`
// in a layout's CSS selects only its own lines.
//
// The app keeps:
// - the click on a line, which is the session row's own: it selects the session;
// - no keys and no focus: a line takes neither;
// - the redraw once a second while any line shows, which draws every line again with the new elapsed time.
// `kit.duration` formats the elapsed time as chat's activity line does: `42s`, `3m 05s` or `1h 02m`.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// One running subagent: its type (`Explore`, `wigley:sonnet-medium`), the task it was given, how long it has run in
// milliseconds, and how many tool calls it has started.
export interface AgentLineInput {
  agentType: string;
  description: string;
  elapsedMs: number;
  toolCalls: number;
}

// One running task (a background shell or another long-running job): what it runs, how long it has run in
// milliseconds, and whether it is drawn under its subagent's line.
export interface TaskLineInput {
  description: string;
  elapsedMs: number;
  isNested: boolean;
}

// The kit every agents part gets.
export interface AgentsKit extends BaseKit {}

// What a part returns: its root, appended to `parent`.
export interface AgentsPart {
  element: HTMLElement;
}

// Each part comes from the first layout that defines it among the `agents.layout` setting and `default`; a part that
// throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
export interface Layout {
  agentLine?(
    parent: HTMLElement,
    input: AgentLineInput,
    kit: AgentsKit,
  ): AgentsPart;
  taskLine?(
    parent: HTMLElement,
    input: TaskLineInput,
    kit: AgentsKit,
  ): AgentsPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
