// The agent-strip layout contract: what a layout in `layouts/agent-strip/<name>/layout.js` draws the strip above a Chat
// tab's composer box with. The app draws one `agentBox` per running subagent of the session, in start order, into the
// strip's scrolling track, and one `taskBox` per running task, in start order, as a row in the column under it; a box
// leaves the moment its subagent or task ends, so every box shows running work and none shows failed or dimmed. Into
// the open agent box's own root, after `agentBox` returns it, it draws a `toolList` of every tool call that subagent
// made; a task row draws its full command, its owner and its description while `isOpen`.
// The app sets `data-layout-owner="agent-strip"` and `data-layout="<name>"` on the element each part returns, `<name>`
// being the layout that drew it, so `[data-layout-owner="agent-strip"][data-layout="<name>"] …` in a layout's CSS selects
// only its own boxes.
//
// The app keeps:
// - the selection, which the entry cursor's `j` hands the strip, and `h`/`l` move through the cards and then the rows:
//   the selected box draws with `isSelected`, its focus ring and its key prompts the layout's own;
// - the open box, one per session, which Enter on the selected box or a click on any box opens and closes;
// - the key scope `agent-strip.strip` the kit's key hints name;
// - the scrolling track and its chevrons, the rows' column, and revealing the selected box;
// - a box's click, and no focus: a box takes none;
// - the elapsed time once a second on every agent and task box: the app runs the box's `update` with the new
//   `elapsedMs`, or draws a box with no `update` again and replaces its element, an open agent box's `toolList` with it;
// - an open `toolList`'s `scrollTop` across every draw of its box, and the rows column's across every draw, while the
//   strip shows; a draw in a hidden tab, or a rebuilt composer, starts them at the top.
// `kit.duration` formats the elapsed time as chat's activity line does: `42s`, `3m 05s` or `1h 02m`.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// A tool call's status: running, or how it ended.
export type BoxStatus = 'running' | 'success' | 'error';

// What an agent box is: a subagent, or one its launch receipt says runs in the background.
export type AgentKind = 'subagent' | 'backgroundAgent';

// One tool call a subagent made: the tool's name, what it acted on, and its status.
export interface ToolLineInput {
  tool: string;
  summary: string;
  status: BoxStatus;
}

// One subagent: its name (the label it was given, else its type), its kind, the task it was given, its model and
// effort, its estimated spend in dollars, its latest reply's context tokens and its model's context window, each null
// until known, how long it has run in milliseconds, and its latest three tool calls, oldest first.
export interface AgentBoxInput {
  name: string;
  kind: AgentKind;
  description: string;
  model: string | null;
  effort: string | null;
  spendUsd: number | null;
  contextTokens: number | null;
  contextWindow: number | null;
  elapsedMs: number;
  recentTools: readonly ToolLineInput[];
  isSelected: boolean;
  isOpen: boolean;
}

// One task row (a background shell or another long-running job): the agent that started it (`main`, a subagent's name,
// or `subagent` for one never listed), what it runs, its shell command, null when the harness named none, and how long
// it has run in milliseconds. The default row shows `name` only while open.
export interface TaskBoxInput {
  name: string;
  description: string;
  command: string | null;
  elapsedMs: number;
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

// What `agentBox` returns: its root, appended to `parent`, and an optional `update` the app runs once a second with the
// input the box was drawn with and the new `elapsedMs`, in place of drawing the box again. Once an `update` throws, the
// app logs it and draws its agent boxes again instead until the layouts change.
export interface AgentBoxPart extends AgentStripPart {
  update?(input: AgentBoxInput): void;
}

// What `taskBox` returns: its root, appended to `parent`, and an optional `update` the app runs once a second with the
// input the box was drawn with and the new `elapsedMs`, in place of drawing the box again. Once an `update` throws, the
// app logs it and draws its task boxes again instead until the layouts change.
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
  ): AgentBoxPart;
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
