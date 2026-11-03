// The agent-lines layout contract: what a layout in `layouts/agent-lines/<name>/layout.js` draws a session's running
// work with. Under each session row, in the row part's wrapper, the app draws one `workingLine` while the session runs
// any subagent or task, and nothing once none runs. The app sets `data-layout-owner="agent-lines"` and
// `data-layout="<name>"` on the element the line returns, `<name>` being the layout that drew it, so
// `[data-layout-owner="agent-lines"][data-layout="<name>"] …` in a layout's CSS selects only its own line.
//
// The app keeps:
// - the click on the line, which is the session row's own: it selects the session;
// - no keys and no focus: the line takes neither;
// - the redraw once a second while any line shows, which draws every line again with the new elapsed time.
// `kit.duration` formats the elapsed time as chat's activity line does: `42s`, `3m 05s` or `1h 02m`.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// A session's running work: how long since its earliest running subagent or task started, in milliseconds, and how
// many subagents and tasks (background shells and other long-running jobs) run.
export interface WorkingLineInput {
  elapsedMs: number;
  agentCount: number;
  taskCount: number;
}

// The kit every agent-lines part gets.
export interface AgentLinesKit extends BaseKit {}

// What a part returns: its root, appended to `parent`.
export interface AgentLinesPart {
  element: HTMLElement;
}

// Each part comes from the first layout that defines it among the `agent-lines.layout` setting and `default`; a part that
// throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
export interface Layout {
  workingLine?(
    parent: HTMLElement,
    input: WorkingLineInput,
    kit: AgentLinesKit,
  ): AgentLinesPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
