import type { Clock, Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { ToastTone } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { tag } from '../../../shared/page/ui/tag';
import type {
  ChatComposerPart,
  ChatSidePart,
  ChatSideSection,
} from '../../chat/contract';
import type { RowActivity, SessionPart } from '../../sessions/contract';
import {
  type ActionInput,
  type ChecklistGroup,
  type ChecklistItem,
  type ChecklistView,
  type ChipInput,
  defaultChecklist,
  type Drawn,
  IDLE_STAGE,
  type MarkState,
  type PageStage,
  type PageWorkflow,
  type RunCommand,
  type SessionFlow,
  type SideGroupInput,
  type SidePaneInput,
  shownRowActivity,
  type StageActionSpec,
  type StageStatus,
  statusLine,
  statusText,
  type StepInput,
  type StripInput,
  type WorkflowId,
} from '../contract';
import {
  MAIN_ACTION,
  SIDE_LIST_CLASS,
  stageTagElement,
  TOGGLE_FINISHED_WAVES,
} from './layout/workflow-kit';

// `workflows` holds each workflow's page half, its stages in stage order. `flowOf`
// is the flow a session draws (the preview's sample while it shows, else the
// slot's flow or a new one); `nameOf` names the session in the log; `isPreview` is
// whether the session shows the preview, which runs nothing. `setRowActivity` sets
// what the session's row says for its stage, null for nothing. `isWorking` is
// whether the session's row holds a running activity, which the row's title line
// leaves to the chip's `Working` tag.
export interface WorkflowViewDeps {
  log: PluginLog;
  clock: Clock;
  timers: Timers;
  toast(text: string, tone: ToastTone): void;
  workflows: { all(): readonly PageWorkflow[] };
  flowOf(sessionId: string): SessionFlow;
  nameOf(sessionId: string): string;
  isPreview(sessionId: string): boolean;
  setRowActivity(sessionId: string, activity: RowActivity | null): void;
  isWorking(sessionId: string): boolean;
}

// `chipPart` draws a session's chip under its row, `stripPart` its strip above
// its Chat composer, each through the `draw` of the flow's workflow, and
// `sidePartFor` makes one workflow's section of the session hub, which draws a
// session's side pane only while its flow is of that workflow. A flow with no
// stage to draw draws nothing, but for the chip's `No workflow` tag after a
// missed level; a workflow or stage with no page half does the same and logs its
// name once. While the session `isWorking`, the chip ends on a running `Working`
// tag unless its stage is running, which its stage tag already says.
// `activityChanged` draws the session's chip again. Every held part draws again on `setFlow` for its session and on `redraw`,
// and each second while it shows a countdown, the side pane aside. `setFlow`, and
// `redraw` for each session with a chip, also set the session's row activity. Each
// side pane draw sets the section's summary: `<checked>/<total>` while it draws a
// checklist with items, else null. The side pane's list keeps its scroll across
// those draws, and while the pane has no layout box. `setFlow` also logs the
// session's level, trail, stage, progress and countdown, and a missed level, when
// each changes; `forget` drops what it logged for a session that left and its
// finished groups' fold.
// `setSidePaneHidden` shows or hides the side pane in every session, and
// `toggleFinishedWaves` opens or folds one session's finished groups, logging
// `nothing to run` and changing nothing while the input holds no finished group.
// `mainAction` is the spec the main action runs, and `runFor` the one path that
// runs a workflow command for a session, through the flow's `runAction`; only
// `toggleFinishedWaves` runs in the preview.
export interface WorkflowView {
  chipPart: SessionPart;
  stripPart: ChatComposerPart;
  sidePartFor(workflow: PageWorkflow): ChatSidePart;
  setFlow(flow: SessionFlow): void;
  activityChanged(sessionId: string): void;
  forget(sessionId: string): void;
  redraw(): void;
  setSidePaneHidden(hidden: boolean): void;
  toggleFinishedWaves(sessionId: string): void;
  mainAction(flow: SessionFlow): StageActionSpec | null;
  runFor(sessionId: string, command: string): Promise<void>;
}

type PartKind = 'chip' | 'strip' | 'sidePane';

// One wrapper a part was built into, and what it drew there last. A side pane
// also holds the workflow it draws for, its section, the scroll its list last
// reported in a `scroll` event with a layout box, and the observer that hands it
// back when the wrapper gets a box again.
interface HeldPart {
  kind: PartKind;
  sessionId: string;
  wrapper: HTMLElement;
  sideWorkflow: WorkflowId | null;
  section: ChatSideSection | null;
  drawn: Drawn | null;
  showsCountdown: boolean;
  listScroll: number;
  paneBox: ResizeObserver | null;
}

const TICK_MS = 1000;
const SIDE_PART_ORDER = 20;
const NO_WORKFLOW_TEXT = 'No workflow';
const WORKING_TEXT = 'Working';
const PENDING: MarkState = 'pending';

// Each wrapper outlives none of its builds: a row redraw or a composer draw
// builds and disposes a part many times, so the session's flow is read on
// every draw and the log lines are kept per session, logged only when their
// text changes. One tick a second redraws every part showing a countdown
// while any does.
export function createWorkflowView(deps: WorkflowViewDeps): WorkflowView {
  const { log, clock, timers } = deps;
  const held = new Set<HeldPart>();
  const loggedLevels = new Map<string, WorkflowId>();
  const loggedTrails = new Map<string, string>();
  const loggedStages = new Map<string, string>();
  const loggedProgress = new Map<string, string>();
  const countdownShown = new Set<string>();
  const noWorkflowLogged = new Set<string>();
  const missingWorkflowsLogged = new Set<string>();
  const missingStagesLogged = new Set<string>();
  const finishedOpen = new Set<string>();
  let isSidePaneHidden = false;
  let pendingTick: number | null = null;

  // The workflow that draws `flow`; null for a flow of none, or of one no plugin
  // holds.
  const pageWorkflowOf = (flow: SessionFlow): PageWorkflow | null => {
    if (flow.workflow === null) {
      return null;
    }
    const workflow = deps.workflows
      .all()
      .find((each) => each.id === flow.workflow);
    if (workflow !== undefined) {
      return workflow;
    }
    logOnce(
      missingWorkflowsLogged,
      flow.workflow,
      `no page workflow ${flow.workflow}`,
      log,
    );
    return null;
  };

  // The page half of `flow`'s stage in its workflow; null when pageWorkflowOf is,
  // or the workflow has no such stage.
  const pageStageOf = (flow: SessionFlow): PageStage | null => {
    const workflow = pageWorkflowOf(flow);
    if (workflow === null) {
      return null;
    }
    const stage = workflow.stages.find((each) => each.id === flow.stage);
    if (stage !== undefined) {
      return stage;
    }
    logOnce(
      missingStagesLogged,
      flow.stage,
      `no page stage ${flow.stage}`,
      log,
    );
    return null;
  };

  const availableActions = (flow: SessionFlow) =>
    (pageStageOf(flow)?.actions ?? []).filter((spec) => spec.available(flow));

  const buttonActions = (flow: SessionFlow) =>
    availableActions(flow).filter((spec) => spec.keyOnly !== true);

  const mainAction = (flow: SessionFlow): StageActionSpec | null =>
    buttonActions(flow)[0] ?? null;

  const actionInputs = (flow: SessionFlow): ActionInput[] =>
    buttonActions(flow).map((spec, index) => ({
      command: spec.command,
      label: spec.label,
      enabled: spec.enabled(flow),
      main: index === 0,
    }));

  const steps = (
    workflow: PageWorkflow,
    stage: PageStage,
    flow: SessionFlow,
    status: StageStatus | null,
  ): StepInput[] => {
    const shown = stepperStages(workflow.stages, stage);
    const current = shown.indexOf(stage);
    return shown.map((step, index) => ({
      id: step.id,
      label: step.label,
      state: stepState(index, current, status),
      progress: index === current ? (step.statusProgress?.(flow) ?? '') : '',
    }));
  };

  const countdown = (flow: SessionFlow): string | null =>
    pageWorkflowOf(flow)?.countdownText?.(flow, clock.now()) ?? null;

  const chipInput = (
    workflow: PageWorkflow,
    stage: PageStage,
    flow: SessionFlow,
  ): ChipInput => {
    const status = stage.status(flow);
    return {
      badge: workflow.badge,
      workflowLabel: workflow.label,
      stage: stage.id,
      label: stage.label,
      status,
      statusText: statusText(stage.label, status),
      detail: stage.detail(flow),
      countdown: countdown(flow),
      mainAction: actionInputs(flow)[0] ?? null,
      onRowLabel: shownRowActivity(stage, flow) !== null,
    };
  };

  const showRowActivity = (flow: SessionFlow) => {
    const stage = pageStageOf(flow);
    deps.setRowActivity(
      flow.sessionId,
      stage === null ? null : shownRowActivity(stage, flow),
    );
  };

  const stripInput = (
    workflow: PageWorkflow,
    stage: PageStage,
    flow: SessionFlow,
  ): StripInput => {
    const status = stage.status(flow);
    return {
      stage: stage.id,
      label: stage.label,
      status,
      statusText: statusText(stage.label, status),
      statusLine: statusLine(stage, flow),
      detail: stage.detail(flow),
      countdown: countdown(flow),
      steps: steps(workflow, stage, flow, status),
      actions: actionInputs(flow),
      hasChecklist:
        workflow.hasPlan?.(flow) ?? checklistOf(workflow, flow) !== null,
    };
  };

  // What the side pane draws for `flow`; null while it draws nothing: no stage,
  // idle, no checklist, or hidden.
  const sidePaneInput = (flow: SessionFlow): SidePaneInput | null => {
    const workflow = pageWorkflowOf(flow);
    const stage = pageStageOf(flow);
    if (
      workflow === null ||
      stage === null ||
      stage.id === IDLE_STAGE ||
      isSidePaneHidden
    ) {
      return null;
    }
    const checklist = checklistOf(workflow, flow);
    if (checklist === null) {
      return null;
    }
    const openItemState = stage.runsTasks
      ? (stage.status(flow) ?? PENDING)
      : PENDING;
    return {
      ...stripInput(workflow, stage, flow),
      checklistTitle: checklist.title,
      checked: checklist.checked,
      total: checklist.total,
      finishedOpen: finishedOpen.has(flow.sessionId),
      ...partitionedGroups(checklist.groups, openItemState),
    };
  };

  const runCommand =
    (sessionId: string): RunCommand =>
    (command) =>
      void view.runFor(sessionId, command);

  // Draws `part` with its session's flow into its emptied wrapper, and
  // returns whether a countdown shows there.
  const drawPart = (part: HeldPart): boolean => {
    const flow = deps.flowOf(part.sessionId);
    const workflow = pageWorkflowOf(flow);
    const stage = pageStageOf(flow);
    const run = runCommand(part.sessionId);
    const drawsStage =
      workflow !== null && stage !== null && stage.id !== IDLE_STAGE;
    switch (part.kind) {
      case 'chip': {
        const isWorking = deps.isWorking(part.sessionId);
        if (!drawsStage) {
          if (flow.workflow === null && flow.missedLevel) {
            part.wrapper.append(tag(NO_WORKFLOW_TEXT, 'error'));
          }
          if (isWorking) {
            part.wrapper.append(workingTag(clock));
          }
          return false;
        }
        const input = chipInput(workflow, stage, flow);
        part.drawn = workflow.draw.chip(part.wrapper, input, run);
        if (isWorking && input.status !== 'running') {
          part.wrapper.append(workingTag(clock));
        }
        return input.countdown !== null;
      }
      case 'strip': {
        if (!drawsStage) {
          return false;
        }
        const input = stripInput(workflow, stage, flow);
        part.drawn = workflow.draw.strip(part.wrapper, input, run);
        return input.countdown !== null;
      }
      case 'sidePane': {
        const input =
          part.sideWorkflow === flow.workflow ? sidePaneInput(flow) : null;
        part.section?.setSummary(sidePaneSummary(input));
        if (workflow === null || input === null) {
          return false;
        }
        part.drawn = workflow.draw.sidePane(part.wrapper, input, run);
        // The default pane draws no countdown, so the tick leaves it.
        return false;
      }
    }
  };

  const draw = (part: HeldPart) => {
    const last = part.drawn;
    part.drawn = null;
    part.showsCountdown = false;
    try {
      last?.dispose();
    } finally {
      part.wrapper.replaceChildren();
    }
    part.showsCountdown = drawPart(part);
    const newList = sideListOf(part);
    if (newList !== null) {
      newList.scrollTop = part.listScroll;
      // A scroll in the same frame as a draw loses that frame's delta.
      newList.addEventListener('scroll', () => {
        if (hasLayoutBox(newList)) {
          part.listScroll = newList.scrollTop;
        }
      });
    }
  };

  const isCountdownShown = () => [...held].some((part) => part.showsCountdown);

  // Sets the tick while a countdown shows and none is pending; clears a
  // pending one once none shows.
  const updateTicker = () => {
    const isShown = isCountdownShown();
    if (isShown && pendingTick === null) {
      pendingTick = timers.set(tick, TICK_MS);
    } else if (!isShown && pendingTick !== null) {
      timers.clear(pendingTick);
      pendingTick = null;
    }
  };

  const drawEach = (chosen: readonly HeldPart[]) => {
    try {
      callEach(chosen, draw);
    } finally {
      updateTicker();
    }
  };

  const drawAll = () => drawEach([...held]);

  const drawSession = (sessionId: string) =>
    drawEach([...held].filter((part) => part.sessionId === sessionId));

  const tick = () => {
    pendingTick = null;
    drawEach([...held].filter((part) => part.showsCountdown));
  };

  // Stops drawing `part` and disposes what it drew last.
  const release = (part: HeldPart) => {
    held.delete(part);
    part.paneBox?.disconnect();
    const last = part.drawn;
    part.drawn = null;
    part.showsCountdown = false;
    try {
      last?.dispose();
    } finally {
      updateTicker();
    }
  };

  // Holds a new wrapper of `kind` for the session and draws it; the returned
  // dispose lets it go. A first draw that throws lets it go and empties the
  // wrapper before the throw goes on.
  const hold = (
    kind: PartKind,
    wrapper: HTMLElement,
    sessionId: string,
    side: { workflow: WorkflowId; section: ChatSideSection } | null,
  ): Disposable => {
    const part: HeldPart = {
      kind,
      sessionId,
      wrapper,
      sideWorkflow: side?.workflow ?? null,
      section: side?.section ?? null,
      drawn: null,
      showsCountdown: false,
      listScroll: 0,
      paneBox: null,
    };
    held.add(part);
    try {
      drawEach([part]);
    } catch (error) {
      try {
        release(part);
      } finally {
        wrapper.replaceChildren();
      }
      throw error;
    }
    if (kind === 'sidePane') {
      part.paneBox = new ResizeObserver(() => reapplyListScroll(part));
      part.paneBox.observe(wrapper);
    }
    return { dispose: () => release(part) };
  };

  const logLevelAndTrail = (flow: SessionFlow, name: string) => {
    const workflow = pageWorkflowOf(flow);
    if (workflow === null) {
      loggedLevels.delete(flow.sessionId);
      loggedTrails.delete(flow.sessionId);
      return;
    }
    if (loggedLevels.get(flow.sessionId) !== workflow.id) {
      loggedLevels.set(flow.sessionId, workflow.id);
      log(`${name} level ${workflow.badge}`);
    }
    const stage = pageStageOf(flow);
    if (stage === null) {
      return;
    }
    const trail = stepperStages(workflow.stages, stage)
      .map((step) => step.label)
      .join(' › ');
    if (loggedTrails.get(flow.sessionId) !== trail) {
      loggedTrails.set(flow.sessionId, trail);
      log(`${name} trail ${trail}`);
    }
  };

  const logMissedLevel = (flow: SessionFlow, name: string) => {
    if (flow.workflow !== null || !flow.missedLevel) {
      noWorkflowLogged.delete(flow.sessionId);
    } else if (!noWorkflowLogged.has(flow.sessionId)) {
      noWorkflowLogged.add(flow.sessionId);
      log(`${name} no workflow`);
    }
  };

  const logFlow = (flow: SessionFlow) => {
    const name = deps.nameOf(flow.sessionId);
    logLevelAndTrail(flow, name);
    if (loggedStages.get(flow.sessionId) !== flow.stage) {
      loggedStages.set(flow.sessionId, flow.stage);
      log(`${name} shows ${flow.stage}`);
    }
    const progress = pageWorkflowOf(flow)?.progressText?.(flow) ?? null;
    if (progress !== null && loggedProgress.get(flow.sessionId) !== progress) {
      loggedProgress.set(flow.sessionId, progress);
      log(`${name} progress ${progress}`);
    }
    logMissedLevel(flow, name);
    const hasCountdown = countdown(flow) !== null;
    if (hasCountdown && !countdownShown.has(flow.sessionId)) {
      countdownShown.add(flow.sessionId);
      log(`countdown shown in ${name}`);
    } else if (!hasCountdown && countdownShown.has(flow.sessionId)) {
      countdownShown.delete(flow.sessionId);
      log(`countdown stopped in ${name}`);
    }
  };

  const view: WorkflowView = {
    chipPart: {
      id: 'workflow.chip',
      build: (wrapper, sessionId) => hold('chip', wrapper, sessionId, null),
    },
    stripPart: {
      id: 'workflow.strip',
      build: (wrapper, sessionId) => hold('strip', wrapper, sessionId, null),
    },
    sidePartFor: (workflow) => ({
      id: `${workflow.id}.sidePane`,
      title: workflow.draw.sideTitle,
      order: SIDE_PART_ORDER,
      build: (wrapper, sessionId, section) =>
        hold('sidePane', wrapper, sessionId, {
          workflow: workflow.id,
          section,
        }),
    }),
    setFlow(flow) {
      try {
        logFlow(flow);
      } finally {
        showRowActivity(flow);
        drawSession(flow.sessionId);
      }
    },
    activityChanged(sessionId) {
      drawEach(
        [...held].filter(
          (part) => part.kind === 'chip' && part.sessionId === sessionId,
        ),
      );
    },
    forget(sessionId) {
      loggedLevels.delete(sessionId);
      loggedTrails.delete(sessionId);
      noWorkflowLogged.delete(sessionId);
      loggedStages.delete(sessionId);
      loggedProgress.delete(sessionId);
      countdownShown.delete(sessionId);
      finishedOpen.delete(sessionId);
    },
    redraw() {
      const rowSessions = new Set(
        [...held]
          .filter((part) => part.kind === 'chip')
          .map((part) => part.sessionId),
      );
      for (const sessionId of rowSessions) {
        showRowActivity(deps.flowOf(sessionId));
      }
      drawAll();
    },
    setSidePaneHidden(hidden) {
      isSidePaneHidden = hidden;
      drawEach([...held].filter((part) => part.kind === 'sidePane'));
    },
    toggleFinishedWaves(sessionId) {
      const name = deps.nameOf(sessionId);
      const input = sidePaneInput(deps.flowOf(sessionId));
      const isFoldDrawn = input !== null && input.finishedGroups.length > 0;
      if (!isFoldDrawn) {
        log(`nothing to run for ${TOGGLE_FINISHED_WAVES} in ${name}`);
        return;
      }
      const isOpen = !finishedOpen.delete(sessionId);
      if (isOpen) {
        finishedOpen.add(sessionId);
      }
      log(`finished waves ${isOpen ? 'open' : 'folded'} in ${name}`);
      drawSession(sessionId);
    },
    mainAction,
    async runFor(sessionId, command) {
      if (command === TOGGLE_FINISHED_WAVES) {
        view.toggleFinishedWaves(sessionId);
        return;
      }
      if (deps.isPreview(sessionId)) {
        log(`preview runs nothing for ${command}`);
        return;
      }
      const flow = deps.flowOf(sessionId);
      const name = deps.nameOf(sessionId);
      const workflow = pageWorkflowOf(flow);
      const spec =
        command === MAIN_ACTION
          ? mainAction(flow)
          : (availableActions(flow).find((each) => each.command === command) ??
            null);
      if (workflow === null || spec === null || !spec.enabled(flow)) {
        log(`nothing to run for ${command} in ${name}`);
        return;
      }
      try {
        await workflow.runAction(sessionId, spec.command, flow);
      } catch (error) {
        log(`${spec.command} not run in ${name}: ${errorText(error)}`);
        deps.toast(`Workflow: ${errorText(error)}`, 'error');
        return;
      }
      log(`ran ${spec.command} in ${name}`);
    },
  };
  return view;
}

function workingTag(clock: Clock): HTMLElement {
  return stageTagElement(WORKING_TEXT, 'running', clock);
}

// The stepper's stages, in order, one per step slot: the slot member that is
// `stage`, otherwise the slot's last.
function stepperStages(
  stages: readonly PageStage[],
  stage: PageStage,
): PageStage[] {
  const inStepper = stages.filter((each) => each.inStepper);
  return inStepper.filter((each) => {
    if (each.stepSlot === undefined) {
      return true;
    }
    const slot = inStepper.filter((other) => other.stepSlot === each.stepSlot);
    const holder = slot.includes(stage) ? stage : slot[slot.length - 1];
    return each === holder;
  });
}

// The state of the stepper's step at `index` while the flow's stage is the
// step at `current`, -1 for a stage added with `inStepper: false`, which leaves
// every step pending. The flow's step shows `status`, a stage with none
// pending.
function stepState(
  index: number,
  current: number,
  status: StageStatus | null,
): MarkState {
  if (index > current) {
    return PENDING;
  }
  return index < current ? 'done' : (status ?? PENDING);
}

// The side list a side pane part holds; null for every other part, and while
// the pane or its layout draws none.
function sideListOf(part: HeldPart): HTMLElement | null {
  return part.kind === 'sidePane'
    ? part.wrapper.querySelector<HTMLElement>(`.${SIDE_LIST_CLASS}`)
    : null;
}

// A list with no layout box reads `scrollTop` 0 and drops a write to it.
function hasLayoutBox(list: HTMLElement): boolean {
  return list.getClientRects().length > 0;
}

// Puts the kept scroll back on `part`'s list while it has a layout box.
function reapplyListScroll(part: HeldPart): void {
  const list = sideListOf(part);
  if (list !== null && hasLayoutBox(list)) {
    list.scrollTop = part.listScroll;
  }
}

// The side section's summary for what the pane draws: null while it draws nothing
// or a checklist with no items.
function sidePaneSummary(input: SidePaneInput | null): string | null {
  return input !== null && input.total > 0
    ? `${input.checked}/${input.total}`
    : null;
}

function checklistOf(
  workflow: PageWorkflow,
  flow: SessionFlow,
): ChecklistView | null {
  return workflow.checklist === undefined
    ? defaultChecklist(flow)
    : workflow.checklist(flow);
}

// The checklist's groups in order: each with every item done is finished, the
// first other is the current group, whose open items show `openItemState`
// unless an item says whether it runs, and the rest are later.
function partitionedGroups(
  groups: readonly ChecklistGroup[],
  openItemState: MarkState,
): Pick<SidePaneInput, 'finishedGroups' | 'currentGroup' | 'laterGroups'> {
  const isFinished = (group: ChecklistGroup) =>
    group.items.every((item) => item.done);
  const [current, ...later] = groups.filter((group) => !isFinished(group));
  return {
    finishedGroups: groups
      .filter(isFinished)
      .map((group) => sideGroup(group, PENDING)),
    currentGroup:
      current === undefined ? null : sideGroup(current, openItemState),
    laterGroups: later.map((group) => sideGroup(group, PENDING)),
  };
}

function sideGroup(
  group: ChecklistGroup,
  openItemState: MarkState,
): SideGroupInput {
  return {
    title: group.title,
    items: group.items.map((item) => ({
      text: item.text,
      state: itemState(item, openItemState),
    })),
  };
}

function itemState(item: ChecklistItem, openItemState: MarkState): MarkState {
  if (item.done) {
    return 'done';
  }
  if (item.running === true) {
    return 'running';
  }
  if (item.running === false) {
    return PENDING;
  }
  return openItemState;
}

function logOnce(
  logged: Set<string>,
  name: string,
  line: string,
  log: PluginLog,
): void {
  if (!logged.has(name)) {
    logged.add(name);
    log(line);
  }
}
