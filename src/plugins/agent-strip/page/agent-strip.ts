import type { Clock, Timers } from '../../../contracts/ambient';
import type { Log } from '../../../contracts/log';
import type { ShownLayouts } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type {
  DrawnPart,
  RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import type { HScroller } from '../../../shared/page/ui/h-scroller';
import type {
  AgentsPageExports,
  RosterAgent,
  RosterTask,
  RosterTool,
} from '../../agents/contract';
import type { ChatComposerPart, ComposerStopExits } from '../../chat/contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  AgentBoxInput,
  AgentBoxPart,
  AgentStripKit,
  AgentStripPart,
  BoxStatus,
  CompleteLayout,
  Layout,
  TaskBoxInput,
  TaskBoxPart,
  ToolLineInput,
} from '../layouts/layout';
import { agentStripManifest } from '../manifest';
import {
  entryIndex,
  orderStripBoxes,
  reselect,
  type StripBox,
  stepIndex,
} from './strip-boxes';

// `agents` is the only way the strip reads a roster. `setScope` sets the
// strip's key scope, `agent-strip.strip`; `nameOf` is a session's name in the
// page log; `createScroller` makes the HScroller a strip draws its agent boxes
// into.
export interface AgentStripDeps {
  kit: OwnerKitServices;
  log: Log;
  clock: Clock;
  timers: Timers;
  agents: AgentsPageExports;
  setScope(): void;
  nameOf(sessionId: string): string;
  createScroller(): HScroller;
}

// `part` is the composer part chat draws above each Chat tab's box, whose
// `stop` takes the entry cursor. The commands act on the strip holding the
// cursor and do nothing while none does: `prevBox` / `nextBox` move the
// selection, `leave` hands the cursor back to the entries, `toBox` to the chat
// box, `toggleBox` opens or closes the selected box. `setLayouts` redraws every
// strip; `forget` drops a session that left.
export interface AgentStrip {
  part: ChatComposerPart;
  prevBox(): void;
  nextBox(): void;
  leave(): void;
  toBox(how: 'insert' | 'append'): void;
  toggleBox(): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  forget(sessionId: string): void;
}

// A wrapper chat handed `part.build`, the HScroller it holds while the
// session lists an agent box, the rows element it holds while the session lists
// a task box, the parts drawn into them last, and its boxes in box order.
interface HeldWrapper {
  wrapper: HTMLElement;
  scroller: HScroller | null;
  rows: HTMLElement | null;
  parts: DrawnPart<AgentStripPart>[];
  boxes: TickingBox[];
}

// A box as drawn last: its key, its part, the input it was drawn or updated
// with, and when its subagent or task started. An agent box also holds its
// subagent's tool calls and, while open, the tool list drawn into it from them.
type TickingBox = {
  key: string;
  startedAt: number;
} & (
  | {
      kind: 'agent';
      drawn: DrawnPart<AgentBoxPart>;
      input: AgentBoxInput;
      tools: readonly RosterTool[];
      toolList: DrawnPart<AgentStripPart> | null;
    }
  | {
      kind: 'task';
      drawn: DrawnPart<TaskBoxPart>;
      input: TaskBoxInput;
    }
);

// The strip holding the entry cursor: its session, the exits its `enter` was
// handed, and the selected box's key and index.
interface Selection {
  sessionId: string;
  exits: ComposerStopExits;
  key: string;
  index: number;
}

const TICK_MS = 1000;
const RECENT_TOOLS = 3;
const SELECTION_LOG_CHARS = 80;
const TOOL_STATUS: Record<RosterTool['outcome'], BoxStatus> = {
  running: 'running',
  done: 'success',
  failed: 'error',
};

// The strip of each session's subagent cards and, under them, its task rows. A
// session's HScroller lives as long as it lists a subagent and its rows element
// as long as it lists a task, so the user's scroll positions and the chevrons
// survive each redraw. While any held strip shows a box, one tick a
// second updates each box's elapsed time, through its part's `update`, else by
// drawing that box again. Once an `update` throws, the tick draws boxes of that
// part again until the layouts change. After each draw it logs `boxes in
// <name>: <count> (<running> running)`, every box running, when that text
// differs from the last one logged for the session, which starts as the empty
// strip's. Each selection first logs the head of the text the selected box
// shows. Drawing an open box again keeps its tool list's scroll while the strip
// shows; a draw in a hidden tab, or a rebuilt composer, starts the list at the top.
export function createAgentStrip(deps: AgentStripDeps): AgentStrip {
  const { clock, timers, agents } = deps;
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: agentStripManifest.id,
    defaultLayout,
    log: deps.log,
  });
  const held = new Map<string, HeldWrapper>();
  // Each session's open box, by key.
  const openKeys = new Map<string, string>();
  const loggedBoxes = new Map<string, string>();
  let selection: Selection | null = null;
  let pendingTick: number | null = null;
  // The layouts shown when each part's `update` threw; while they are still
  // the shown ones, the tick draws that part's boxes again instead.
  const updateFailedUnder: Record<
    TickingBox['kind'],
    ShownLayouts<Layout> | null
  > = { agent: null, task: null };

  const log = (message: string) => deps.log(agentStripManifest.id, message);

  const boxesOf = (sessionId: string): StripBox[] =>
    orderStripBoxes(agents.roster(sessionId));

  const kitFor = (rollback: RollbackDeps): AgentStripKit =>
    createBaseKit(
      ownerBaseKitDeps(agentStripManifest, deps.kit, 'strip', rollback),
    );

  const disposeParts = (holder: HeldWrapper) => {
    const parts = holder.parts;
    holder.parts = [];
    holder.boxes = [];
    callEach(parts, (part) => part.dispose());
  };

  const disposeScroller = (holder: HeldWrapper) => {
    const scroller = holder.scroller;
    if (scroller === null) {
      return;
    }
    holder.scroller = null;
    scroller.element.remove();
    scroller.dispose();
  };

  const disposeRows = (holder: HeldWrapper) => {
    holder.rows?.remove();
    holder.rows = null;
  };

  const disposeHolder = (holder: HeldWrapper) => {
    try {
      disposeParts(holder);
    } finally {
      disposeRows(holder);
      disposeScroller(holder);
    }
  };

  // The HScroller's track, making the HScroller above any rows.
  const heldTrack = (holder: HeldWrapper): HTMLElement => {
    if (holder.scroller === null) {
      holder.scroller = deps.createScroller();
      holder.scroller.element.classList.add('agent-strip-scroller');
      holder.wrapper.insertBefore(holder.scroller.element, holder.rows);
    }
    return holder.scroller.track;
  };

  // The rows element, making it after any HScroller.
  const heldRows = (holder: HeldWrapper): HTMLElement => {
    if (holder.rows === null) {
      holder.rows = element('div', 'agent-strip-rows');
      holder.wrapper.append(holder.rows);
    }
    return holder.rows;
  };

  const drawAgentBox = (
    track: HTMLElement,
    input: AgentBoxInput,
  ): DrawnPart<AgentBoxPart> =>
    layoutParts.draw('agentBox', track, (agentBox, slot, rollback) =>
      agentBox(slot, input, kitFor(rollback)),
    );

  const drawTaskBox = (
    track: HTMLElement,
    input: TaskBoxInput,
  ): DrawnPart<TaskBoxPart> =>
    layoutParts.draw('taskBox', track, (taskBox, slot, rollback) =>
      taskBox(slot, input, kitFor(rollback)),
    );

  const drawToolList = (
    boxElement: HTMLElement,
    tools: readonly RosterTool[],
  ) =>
    layoutParts.draw('toolList', boxElement, (toolList, slot, rollback) =>
      toolList(slot, { tools: tools.map(toolLineInput) }, kitFor(rollback)),
    );

  // Draws an open box's tool list into its element, scrolled to `scrollTop`.
  const drawOpenToolList = (
    boxElement: HTMLElement,
    tools: readonly RosterTool[],
    scrollTop: number,
  ) => {
    const drawn = drawToolList(boxElement, tools);
    drawn.built.element.scrollTop = scrollTop;
    return drawn;
  };

  const emptyBoxesText = (sessionId: string) =>
    `boxes in ${deps.nameOf(sessionId)}: 0 (0 running)`;

  const logBoxes = (sessionId: string, boxes: readonly StripBox[]) => {
    const text = `boxes in ${deps.nameOf(sessionId)}: ${boxes.length} (${boxes.length} running)`;
    const last = loggedBoxes.get(sessionId) ?? emptyBoxesText(sessionId);
    if (text === last) {
      return;
    }
    loggedBoxes.set(sessionId, text);
    log(text);
  };

  // Draws the session's agent boxes into its HScroller's track and its task
  // boxes into its rows element, making each on the first draw with such a box
  // and dropping it on a draw with none. The rows keep their scroll.
  const draw = (sessionId: string, holder: HeldWrapper) => {
    const listScrollTops = new Map(
      holder.boxes.map((box) => [box.key, listScrollTop(box)]),
    );
    const rowsScrollTop = holder.rows?.scrollTop ?? 0;
    disposeParts(holder);
    const boxes = boxesOf(sessionId);
    if (!boxes.some((box) => box.kind === 'task')) {
      disposeRows(holder);
    }
    if (!boxes.some((box) => box.kind === 'agent')) {
      disposeScroller(holder);
    }
    holder.scroller?.track.replaceChildren();
    holder.rows?.replaceChildren();
    const now = clock.now();
    const selectedKey =
      selection?.sessionId === sessionId ? selection.key : null;
    const openKey = openKeys.get(sessionId);
    for (const box of boxes) {
      const state = {
        isSelected: box.key === selectedKey,
        isOpen: box.key === openKey,
      };
      const { key } = box;
      let boxElement: HTMLElement;
      if (box.kind === 'agent') {
        const { agent } = box;
        const input = agentBoxInput(agent, state, now);
        const drawn = drawAgentBox(heldTrack(holder), input);
        holder.parts.push(drawn);
        boxElement = drawn.built.element;
        const toolList = state.isOpen
          ? drawOpenToolList(
              boxElement,
              agent.tools,
              listScrollTops.get(key) ?? 0,
            )
          : null;
        if (toolList !== null) {
          holder.parts.push(toolList);
        }
        holder.boxes.push({
          kind: 'agent',
          key,
          startedAt: agent.startedAt,
          drawn,
          input,
          tools: agent.tools,
          toolList,
        });
      } else {
        const { task } = box;
        const input = taskBoxInput(task, state, now);
        const drawn = drawTaskBox(heldRows(holder), input);
        holder.parts.push(drawn);
        boxElement = drawn.built.element;
        holder.boxes.push({
          kind: 'task',
          key,
          startedAt: task.startedAt,
          drawn,
          input,
        });
      }
      listenForClick(boxElement, sessionId, key);
    }
    holder.scroller?.refresh();
    if (holder.rows !== null) {
      holder.rows.scrollTop = rowsScrollTop;
    }
    logBoxes(sessionId, boxes);
  };

  const listenForClick = (
    boxElement: HTMLElement,
    sessionId: string,
    key: string,
  ) => boxElement.addEventListener('click', () => toggleOpen(sessionId, key));

  // The element the box draws into: the track for an agent box, the rows
  // element for a task box.
  const trackOf = (holder: HeldWrapper, key: string): HTMLElement => {
    const box = holder.boxes.find((held) => held.key === key);
    const track = box?.kind === 'task' ? holder.rows : holder.scroller?.track;
    if (track === null || track === undefined) {
      throw new Error(`box ${key} has no strip to draw into`);
    }
    return track;
  };

  // Puts `next`, the box drawn again, in `old`'s place on the page and in the
  // holder.
  const swapBoxPart = (
    sessionId: string,
    holder: HeldWrapper,
    key: string,
    old: DrawnPart<AgentStripPart>,
    next: DrawnPart<AgentStripPart>,
  ) => {
    const boxElement = next.built.element;
    old.built.element.replaceWith(boxElement);
    holder.parts[holder.parts.indexOf(old)] = next;
    listenForClick(boxElement, sessionId, key);
  };

  // Draws the agent box again with its input, and its tool list into the new
  // element, at the old list's scroll, while it is open; the new parts replace
  // the old ones.
  const replaceAgentBox = (
    sessionId: string,
    holder: HeldWrapper,
    box: Extract<TickingBox, { kind: 'agent' }>,
  ) => {
    const old = box.drawn;
    const oldList = box.toolList;
    const scrollTop = listScrollTop(box);
    const next = drawAgentBox(trackOf(holder, box.key), box.input);
    swapBoxPart(sessionId, holder, box.key, old, next);
    box.drawn = next;
    if (oldList !== null) {
      const nextList = drawOpenToolList(
        next.built.element,
        box.tools,
        scrollTop,
      );
      holder.parts[holder.parts.indexOf(oldList)] = nextList;
      box.toolList = nextList;
    }
    callEach(oldList === null ? [old] : [old, oldList], (part) =>
      part.dispose(),
    );
  };

  // Draws the task box again with its input; the new part replaces the old one.
  const replaceTaskBox = (
    sessionId: string,
    holder: HeldWrapper,
    box: Extract<TickingBox, { kind: 'task' }>,
  ) => {
    const old = box.drawn;
    const next = drawTaskBox(trackOf(holder, box.key), box.input);
    swapBoxPart(sessionId, holder, box.key, old, next);
    box.drawn = next;
    old.dispose();
  };

  // Runs a drawn box's `update` with its input; false when it has none, or when
  // it threw, logging `layout <name> <part> update failed: <error>`, or that
  // part's `update` threw earlier under the layouts still shown.
  const updateBox = <I>(
    kind: TickingBox['kind'],
    drawn: DrawnPart<{ update?(input: I): void }>,
    input: I,
  ): boolean => {
    const { update } = drawn.built;
    const shown = layoutParts.shown();
    if (update === undefined || updateFailedUnder[kind] === shown) {
      return false;
    }
    try {
      update.call(drawn.built, input);
      return true;
    } catch (error) {
      log(
        `layout ${drawn.layoutName} ${kind}Box update failed: ${errorText(error)}`,
      );
      updateFailedUnder[kind] = shown;
      return false;
    }
  };

  // Sets the box's input to `elapsedMs` and runs its `update`, else `drawAgain`.
  const tickPart = <I extends { elapsedMs: number }>(
    box: {
      kind: TickingBox['kind'];
      drawn: DrawnPart<{ update?(input: I): void }>;
      input: I;
    },
    elapsedMs: number,
    drawAgain: () => void,
  ) => {
    box.input = { ...box.input, elapsedMs };
    if (!updateBox(box.kind, box.drawn, box.input)) {
      drawAgain();
    }
  };

  // Sets the box's elapsed time to now, through its `update`, else by drawing
  // it again.
  const tickBox = (
    sessionId: string,
    holder: HeldWrapper,
    box: TickingBox,
    now: number,
  ) => {
    const elapsedMs = now - box.startedAt;
    if (box.kind === 'agent') {
      tickPart(box, elapsedMs, () => replaceAgentBox(sessionId, holder, box));
    } else {
      tickPart(box, elapsedMs, () => replaceTaskBox(sessionId, holder, box));
    }
  };

  // Ticks each of the strip's boxes, then refreshes any HScroller.
  const tickStrip = (sessionId: string, holder: HeldWrapper) => {
    if (holder.boxes.length === 0) {
      return;
    }
    const now = clock.now();
    try {
      callEach(holder.boxes, (box) => tickBox(sessionId, holder, box, now));
    } finally {
      holder.scroller?.refresh();
    }
  };

  const isBoxShown = () =>
    [...held.values()].some((holder) => holder.boxes.length > 0);

  // Sets the tick while a box shows and none is pending; clears a pending one
  // once none shows.
  const updateTicker = () => {
    const isShown = isBoxShown();
    if (isShown && pendingTick === null) {
      pendingTick = timers.set(tick, TICK_MS);
    } else if (!isShown && pendingTick !== null) {
      timers.clear(pendingTick);
      pendingTick = null;
    }
  };

  const redraw = (sessionId: string) => {
    const holder = held.get(sessionId);
    if (holder === undefined) {
      return;
    }
    try {
      draw(sessionId, holder);
    } finally {
      updateTicker();
    }
  };

  const drawAll = () => {
    try {
      callEach([...held], ([sessionId, holder]) => draw(sessionId, holder));
    } finally {
      updateTicker();
    }
  };

  const tick = () => {
    pendingTick = null;
    try {
      callEach([...held], ([sessionId, holder]) =>
        tickStrip(sessionId, holder),
      );
    } finally {
      updateTicker();
    }
  };

  const revealSelected = () => {
    if (selection === null) {
      return;
    }
    const holder = held.get(selection.sessionId);
    const box = holder?.boxes[selection.index];
    if (box === undefined) {
      return;
    }
    const boxElement = box.drawn.built.element;
    if (box.kind === 'agent') {
      holder?.scroller?.reveal(boxElement);
    }
    // Chat's composer parts scroll in a pane too short for them all, and the
    // rows scroll past four.
    boxElement.scrollIntoView({ block: 'nearest' });
  };

  const logSelected = (current: Selection, count: number) => {
    const name = deps.nameOf(current.sessionId);
    const position = `${current.index + 1} of ${count} in ${name}`;
    const boxElement = held.get(current.sessionId)?.boxes[current.index]?.drawn
      .built.element;
    const shown = boxElement?.textContent ?? '';
    log(`box ${position} shows: ${shown.slice(0, SELECTION_LOG_CHARS)}`);
    log(`selected box ${position}`);
  };

  // Clears the selection and redraws its strip; returns the cleared one.
  const clearSelection = (): Selection | null => {
    const cleared = selection;
    if (cleared === null) {
      return null;
    }
    selection = null;
    redraw(cleared.sessionId);
    return cleared;
  };

  const leaveStrip = (exit: (exits: ComposerStopExits) => void) => {
    const cleared = clearSelection();
    if (cleared === null) {
      return;
    }
    log(`left strip in ${deps.nameOf(cleared.sessionId)}`);
    exit(cleared.exits);
  };

  const toggleOpen = (sessionId: string, key: string) => {
    const index = boxesOf(sessionId).findIndex((box) => box.key === key);
    if (index === -1) {
      return;
    }
    const name = deps.nameOf(sessionId);
    if (openKeys.get(sessionId) === key) {
      openKeys.delete(sessionId);
      log(`closed box ${index + 1} in ${name}`);
    } else {
      openKeys.set(sessionId, key);
      log(`opened box ${index + 1} in ${name}`);
    }
    redraw(sessionId);
  };

  const move = (delta: -1 | 1) => {
    if (selection === null) {
      return;
    }
    const boxes = boxesOf(selection.sessionId);
    const index = stepIndex(selection.index, delta, boxes.length);
    if (index === selection.index) {
      return;
    }
    selection = { ...selection, index, key: boxes[index].key };
    redraw(selection.sessionId);
    revealSelected();
    logSelected(selection, boxes.length);
  };

  // After the session's roster changed: the selection follows its box and is
  // scrolled into view when its index moved, or hands the cursor back once no
  // box is left, and the open box closes once its box is gone.
  const rosterChanged = (sessionId: string) => {
    const boxes = boxesOf(sessionId);
    const openKey = openKeys.get(sessionId);
    if (openKey !== undefined && !boxes.some((box) => box.key === openKey)) {
      openKeys.delete(sessionId);
    }
    let handBack: ComposerStopExits | null = null;
    let selectionMoved = false;
    if (selection?.sessionId === sessionId) {
      const index = reselect(selection.key, selection.index, boxes);
      if (index === null) {
        handBack = selection.exits;
        selection = null;
      } else {
        selectionMoved = index !== selection.index;
        selection = { ...selection, index, key: boxes[index].key };
      }
    }
    redraw(sessionId);
    if (selectionMoved) {
      revealSelected();
    }
    handBack?.toEntries();
  };

  agents.onRosterChanged(rosterChanged);

  return {
    part: {
      id: 'agent-strip.strip',
      build(wrapper, sessionId) {
        const earlier = held.get(sessionId);
        const holder: HeldWrapper = {
          wrapper,
          scroller: null,
          rows: null,
          parts: [],
          boxes: [],
        };
        held.set(sessionId, holder);
        try {
          if (earlier !== undefined) {
            disposeHolder(earlier);
          }
          draw(sessionId, holder);
        } finally {
          updateTicker();
        }
        return {
          dispose() {
            if (held.get(sessionId) === holder) {
              held.delete(sessionId);
            }
            try {
              disposeHolder(holder);
            } finally {
              updateTicker();
            }
          },
        };
      },
      stop: {
        // A selection another session's strip holds hands its cursor back
        // first.
        enter(sessionId, exits) {
          const boxes = boxesOf(sessionId);
          const index = entryIndex(boxes);
          if (index === null) {
            return false;
          }
          leaveStrip((otherExits) => otherExits.toEntries());
          selection = { sessionId, exits, key: boxes[index].key, index };
          deps.setScope();
          redraw(sessionId);
          revealSelected();
          logSelected(selection, boxes.length);
          return true;
        },
        leave(sessionId) {
          if (selection?.sessionId !== sessionId) {
            return;
          }
          selection = null;
          log(`left strip in ${deps.nameOf(sessionId)}`);
          redraw(sessionId);
        },
      },
    },
    prevBox: () => move(-1),
    nextBox: () => move(1),
    leave: () => leaveStrip((exits) => exits.toEntries()),
    toBox: (how) => leaveStrip((exits) => exits.toBox(how)),
    toggleBox() {
      if (selection !== null) {
        toggleOpen(selection.sessionId, selection.key);
      }
    },
    setLayouts(shown) {
      layoutParts.setLayouts(shown);
      drawAll();
    },
    forget(sessionId) {
      openKeys.delete(sessionId);
      loggedBoxes.delete(sessionId);
      if (selection?.sessionId === sessionId) {
        selection = null;
      }
    },
  };
}

// Where the box's tool list is scrolled; 0 with none.
function listScrollTop(box: TickingBox): number {
  return box.kind === 'agent' && box.toolList !== null
    ? box.toolList.built.element.scrollTop
    : 0;
}

function agentBoxInput(
  agent: RosterAgent,
  state: { isSelected: boolean; isOpen: boolean },
  now: number,
): AgentBoxInput {
  return {
    name: agent.name,
    kind: agent.isBackground ? 'backgroundAgent' : 'subagent',
    description: agent.description,
    model: agent.model,
    effort: agent.effort,
    spendUsd: agent.spendUsd,
    contextTokens: agent.contextTokens,
    contextWindow: agent.contextWindow,
    elapsedMs: now - agent.startedAt,
    recentTools: agent.tools.slice(-RECENT_TOOLS).map(toolLineInput),
    isSelected: state.isSelected,
    isOpen: state.isOpen,
  };
}

function taskBoxInput(
  task: RosterTask,
  state: { isSelected: boolean; isOpen: boolean },
  now: number,
): TaskBoxInput {
  return {
    name: task.ownerName,
    description: task.description,
    command: task.command,
    elapsedMs: now - task.startedAt,
    isSelected: state.isSelected,
    isOpen: state.isOpen,
  };
}

function toolLineInput(tool: RosterTool): ToolLineInput {
  return {
    tool: tool.tool,
    summary: tool.summary,
    status: TOOL_STATUS[tool.outcome],
  };
}
