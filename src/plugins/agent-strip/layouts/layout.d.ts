// The agent-strip layout contract: what a layout in `layouts/agent-strip/<name>/layout.js` draws the strip above a Chat
// tab's composer box with. The app draws one `agentBox` per subagent of the session and one `taskBox` per task, failed
// ones included until the user's next message, in start order, into the strip's scrolling track. Into the open agent
// box's own root, after `agentBox` returns it, it draws a `toolList` of every tool call that subagent made; a task box
// draws its own `command` while `isOpen`. The app sets `data-layout-owner="agent-strip"` and `data-layout="<name>"` on
// the element each part returns, `<name>` being the layout that drew it, so
// `[data-layout-owner="agent-strip"][data-layout="<name>"] …` in a layout's CSS selects only its own boxes.
//
// The app keeps:
// - the selection, which the entry cursor's `j` hands the strip, and `h`/`l` move: the selected box draws with
//   `isSelected`, its focus ring and its key prompts the layout's own;
// - the open box, one per session, which Enter on the selected box or a click on any box opens and closes;
// - the key scope `agent-strip.strip` the kit's key hints name;
// - the scrolling track and its chevrons, and revealing the selected box;
// - a box's click, and no focus: a box takes none;
// - the elapsed time once a second while a task box runs: the app runs that box's `update` with the new `elapsedMs`,
//   or draws a box with no `update` again and replaces its element; every other box keeps its element.
// `kit.duration` formats the elapsed time as chat's activity line does: `42s`, `3m 05s` or `1h 02m`.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// A box's or a tool call's dot: running, or how it ended.
export type BoxStatus = 'running' | 'success' | 'error';

// One tool call a subagent made: the tool's name, what it acted on, and its status.
export interface ToolLineInput {
  tool: string;
  summary: string;
  status: BoxStatus;
}

// One subagent: its name (the label it was given, else its type), its `model · effort · $cost` with the unknown ones
// left out (`''` when none is known), the task it was given, and its latest three tool calls, oldest first. `isDimmed`
// is set once it finished.
export interface AgentBoxInput {
  name: string;
  meta: string;
  description: string;
  recentTools: readonly ToolLineInput[];
  status: BoxStatus;
  isDimmed: boolean;
  isSelected: boolean;
  isOpen: boolean;
}

// One task (a background shell or another long-running job): what it runs, the agent that started it (`main`, a
// subagent's name, or `subagent` once that subagent left the roster), how long it has run in milliseconds (null once
// it finished), and its shell command, null when the harness named none. `isDimmed` is set once it finished.
export interface TaskBoxInput {
  description: string;
  owner: string;
  elapsedMs: number | null;
  command: string | null;
  status: BoxStatus;
  isDimmed: boolean;
  isSelected: boolean;
  isOpen: boolean;
}

// Every tool call of the open subagent box, oldest first.
export interface ToolListInput {
  tools: readonly ToolLineInput[];
}

// The kit every agent-strip part gets; its key hints name the `agent-strip.strip` scope.
export interface AgentStripKit extends BaseKit {}

// What a part returns: its root, appended to `parent`.
export interface AgentStripPart {
  element: HTMLElement;
}

// What `taskBox` returns: its root, appended to `parent`, and an optional `update` the app runs once a second while
// the task runs, with the input the box was drawn with and the new `elapsedMs`, in place of drawing the box again. Once
// an `update` throws, the app logs it and draws its task boxes again instead until the layouts change.
export interface TaskBoxPart extends AgentStripPart {
  update?(input: TaskBoxInput): void;
}

// Each part comes from the first layout that defines it among the `agent-strip.layout` setting and `default`; a part
// that throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
export interface Layout {
  agentBox?(
    parent: HTMLElement,
    input: AgentBoxInput,
    kit: AgentStripKit,
  ): AgentStripPart;
  taskBox?(
    parent: HTMLElement,
    input: TaskBoxInput,
    kit: AgentStripKit,
  ): TaskBoxPart;
  toolList?(
    parent: HTMLElement,
    input: ToolListInput,
    kit: AgentStripKit,
  ): AgentStripPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
