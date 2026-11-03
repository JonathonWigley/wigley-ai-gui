import type { Clock, Timers } from '../../../contracts/ambient';
import type { PluginLog } from '../../../contracts/log';
import type { ShownLayouts } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
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
  Roster,
  RosterAgent,
  RosterTask,
  RosterTool,
} from '../../agents/contract';
import type { ChatComposerPart, ComposerStopExits } from '../../chat/contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  AgentStripKit,
  AgentStripPart,
  CompleteLayout,
  Layout,
  TaskBoxInput,
  TaskBoxPart,
  ToolLineInput,
} from '../layouts/layout';
import { agentStripManifest } from '../manifest';
import {
  agentMeta,
  boxLook,
  entryIndex,
  orderStripBoxes,
  outcomeOf,
  reselect,
  type StripBox,
  stepIndex,
  taskOwner,
} from './strip-boxes';

// `agents` is the only way the strip reads a roster. `setScope` sets the
// strip's key scope, `agent-strip.strip`; `nameOf` is a session's name in the
// page log; `createScroller` makes the HScroller a strip draws its boxes into.
export interface AgentStripDeps {
  kit: OwnerKitServices;
  log: PluginLog;
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
// session lists any box, the parts drawn into it last, each box's root in box
// order, and its running task boxes.
interface HeldWrapper {
  wrapper: HTMLElement;
  scroller: HScroller | null;
  parts: DrawnPart<AgentStripPart>[];
  boxElements: HTMLElement[];
  runningTasks: RunningTaskBox[];
}

// A running task box as drawn last: its key, its index in box order, its part,
// the input it was drawn or updated with, and when its task started.
interface RunningTaskBox {
  key: string;
  index: number;
  drawn: DrawnPart<TaskBoxPart>;
  input: TaskBoxInput;
  startedAt: number;
}

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

// The strip of each session's subagent and task boxes. A session's HScroller
// lives as long as it lists a box, so the user's scroll position and the
// chevrons survive each redraw. While any held strip shows a running task box,
// one tick a second updates each running task box's elapsed time, through its
// part's `update`, else by drawing that box again; every other box keeps its
// element. Once an `update` throws, the tick draws boxes again until the
// layouts change. After each draw it logs `boxes in <name>: <count>
// (<running> running)` when that text differs from the last one logged for the
// session, which starts as the empty strip's.
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
  // The layouts shown when a task box's `update` threw; while they are still
  // the shown ones, the tick draws running task boxes again instead.
  let updateFailedUnder: ShownLayouts<Layout> | null = null;

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
    holder.boxElements = [];
    holder.runningTasks = [];
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

  const disposeHolder = (holder: HeldWrapper) => {
    try {
      disposeParts(holder);
    } finally {
      disposeScroller(holder);
    }
  };

  const drawAgentBox = (
    track: HTMLElement,
    agent: RosterAgent,
    state: { isSelected: boolean; isOpen: boolean },
  ): DrawnPart<AgentStripPart> => {
    const look = boxLook(agent.outcome);
    return layoutParts.draw('agentBox', track, (agentBox, slot, rollback) =>
      agentBox(
        slot,
        {
          name: agent.name,
          meta: agentMeta(agent),
          description: agent.description,
          recentTools: agent.tools.slice(-RECENT_TOOLS).map(toolLineInput),
          status: look.dot,
          isDimmed: look.isDimmed,
          isSelected: state.isSelected,
          isOpen: state.isOpen,
        },
        kitFor(rollback),
      ),
    );
  };

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

  const emptyBoxesText = (sessionId: string) =>
    `boxes in ${deps.nameOf(sessionId)}: 0 (0 running)`;

  const logBoxes = (sessionId: string, boxes: readonly StripBox[]) => {
    const running = boxes.filter((box) => outcomeOf(box) === 'running').length;
    const text = `boxes in ${deps.nameOf(sessionId)}: ${boxes.length} (${running} running)`;
    const last = loggedBoxes.get(sessionId) ?? emptyBoxesText(sessionId);
    if (text === last) {
      return;
    }
    loggedBoxes.set(sessionId, text);
    log(text);
  };

  // Draws the session's boxes into its HScroller's track, making the
  // HScroller on the first draw with a box and dropping it on a draw with none.
  const draw = (sessionId: string, holder: HeldWrapper) => {
    disposeParts(holder);
    const roster = agents.roster(sessionId);
    const boxes = orderStripBoxes(roster);
    if (boxes.length === 0) {
      disposeScroller(holder);
      logBoxes(sessionId, boxes);
      return;
    }
    if (holder.scroller === null) {
      holder.scroller = deps.createScroller();
      holder.scroller.element.classList.add('agent-strip-scroller');
      holder.wrapper.append(holder.scroller.element);
    }
    const { track } = holder.scroller;
    track.replaceChildren();
    const now = clock.now();
    const selectedKey =
      selection?.sessionId === sessionId ? selection.key : null;
    const openKey = openKeys.get(sessionId);
    for (const [index, box] of boxes.entries()) {
      const state = {
        isSelected: box.key === selectedKey,
        isOpen: box.key === openKey,
      };
      let element: HTMLElement;
      if (box.kind === 'agent') {
        const drawn = drawAgentBox(track, box.agent, state);
        holder.parts.push(drawn);
        element = drawn.built.element;
        if (state.isOpen) {
          holder.parts.push(drawToolList(element, box.agent.tools));
        }
      } else {
        const { task } = box;
        const input = taskBoxInput(task, roster, state, now);
        const drawn = drawTaskBox(track, input);
        holder.parts.push(drawn);
        element = drawn.built.element;
        if (task.outcome === 'running') {
          const { key } = box;
          const { startedAt } = task;
          holder.runningTasks.push({ key, index, drawn, input, startedAt });
        }
      }
      holder.boxElements.push(element);
      listenForClick(element, sessionId, box.key);
    }
    holder.scroller.refresh();
    logBoxes(sessionId, boxes);
  };

  const listenForClick = (
    element: HTMLElement,
    sessionId: string,
    key: string,
  ) => element.addEventListener('click', () => toggleOpen(sessionId, key));

  // Draws the running task box again with its input and puts its element in
  // the old one's place.
  const replaceTaskBox = (
    sessionId: string,
    holder: HeldWrapper,
    running: RunningTaskBox,
  ) => {
    const old = running.drawn;
    const oldElement = old.built.element;
    if (holder.scroller === null) {
      throw new Error(`task box ${running.key} has no strip to draw into`);
    }
    const next = drawTaskBox(holder.scroller.track, running.input);
    const { element } = next.built;
    oldElement.replaceWith(element);
    holder.parts[holder.parts.indexOf(old)] = next;
    holder.boxElements[running.index] = element;
    running.drawn = next;
    listenForClick(element, sessionId, running.key);
    old.dispose();
  };

  // Runs the running task box's `update` with its input; false when it has
  // none, or when it threw, logging `layout <name> taskBox update failed:
  // <error>`, or threw earlier under the layouts still shown.
  const updateTaskBox = (running: RunningTaskBox): boolean => {
    const { drawn } = running;
    const { update } = drawn.built;
    const shown = layoutParts.shown();
    if (update === undefined || updateFailedUnder === shown) {
      return false;
    }
    try {
      update.call(drawn.built, running.input);
      return true;
    } catch (error) {
      log(
        `layout ${drawn.layoutName} taskBox update failed: ${errorText(error)}`,
      );
      updateFailedUnder = shown;
      return false;
    }
  };

  // Sets each running task box's elapsed time to now, through its `update`,
  // else by drawing it again, then refreshes the strip's HScroller.
  const tickRunningTasks = (sessionId: string, holder: HeldWrapper) => {
    if (holder.runningTasks.length === 0) {
      return;
    }
    const now = clock.now();
    try {
      callEach(holder.runningTasks, (running) => {
        running.input = {
          ...running.input,
          elapsedMs: now - running.startedAt,
        };
        if (!updateTaskBox(running)) {
          replaceTaskBox(sessionId, holder, running);
        }
      });
    } finally {
      holder.scroller?.refresh();
    }
  };

  const isRunningTaskShown = () =>
    [...held.values()].some((holder) => holder.runningTasks.length > 0);

  // Sets the tick while a running task box shows and none is pending; clears
  // a pending one once none shows.
  const updateTicker = () => {
    const isShown = isRunningTaskShown();
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
        tickRunningTasks(sessionId, holder),
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
    const element = holder?.boxElements[selection.index];
    const scroller = holder?.scroller ?? null;
    if (scroller !== null && element !== undefined) {
      scroller.reveal(element);
      // Chat's composer parts scroll in a pane too short for them all.
      element.scrollIntoView({ block: 'nearest' });
    }
  };

  const logSelected = (current: Selection, count: number) =>
    log(
      `selected box ${current.index + 1} of ${count} in ${deps.nameOf(current.sessionId)}`,
    );

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
          parts: [],
          boxElements: [],
          runningTasks: [],
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

function taskBoxInput(
  task: RosterTask,
  roster: Roster,
  state: { isSelected: boolean; isOpen: boolean },
  now: number,
): TaskBoxInput {
  const look = boxLook(task.outcome);
  return {
    description: task.description,
    owner: taskOwner(task, roster.agents),
    elapsedMs: task.outcome === 'running' ? now - task.startedAt : null,
    command: task.command,
    status: look.dot,
    isDimmed: look.isDimmed,
    isSelected: state.isSelected,
    isOpen: state.isOpen,
  };
}

function toolLineInput(tool: RosterTool): ToolLineInput {
  return {
    tool: tool.tool,
    summary: tool.summary,
    status: boxLook(tool.outcome).dot,
  };
}
