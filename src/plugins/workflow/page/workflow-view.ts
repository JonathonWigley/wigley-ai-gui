import type { Clock, Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { ShownLayouts, ToastTone } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import type { OwnerKitServices } from '../../../shared/page/layout-host/base-kit';
import type {
  ChatComposerPart,
  ChatSidePart,
  ChatSideSection,
} from '../../chat/contract';
import type { SessionPart } from '../../sessions/contract';
import {
  IDLE_STAGE,
  type PageStage,
  type SessionFlow,
  type StageActionSpec,
  type StageStatus,
  statusLine,
  statusText,
  type WorkflowActionRequest,
} from '../contract';
import type {
  ActionInput,
  ChipInput,
  Layout,
  MarkState,
  SidePaneInput,
  SideWaveInput,
  StepInput,
  StripInput,
} from '../layouts/layout';
import type { PlanProgress } from '../plan-reader';
import { countdownText } from './countdown';
import {
  MAIN_ACTION,
  SIDE_LIST_CLASS,
  TOGGLE_FINISHED_WAVES,
} from './layout/workflow-kit';
import {
  createWorkflowParts,
  type Drawn,
  type RunCommand,
} from './layout/workflow-parts';

// The registered page halves of the stages, in stage order.
export interface PageStages {
  all(): readonly PageStage[];
}

// `flowOf` is the flow a session draws (the preview's sample while it shows,
// else the pushed flow or a new idle one); `nameOf` names the session in the
// log; `isPreview` is whether the session shows the preview, which runs
// nothing. The rest run the actions: `openDoc` the page one, `runAction` main's.
export interface WorkflowViewDeps {
  kit: OwnerKitServices;
  log: PluginLog;
  clock: Clock;
  timers: Timers;
  toast(text: string, tone: ToastTone): void;
  paths: Pick<Paths, 'join'>;
  stages: PageStages;
  flowOf(sessionId: string): SessionFlow;
  nameOf(sessionId: string): string;
  isPreview(sessionId: string): boolean;
  openDoc(path: string): void;
  runAction(request: WorkflowActionRequest): Promise<void>;
}

// `chipPart` draws a session's chip under its row, `stripPart` its strip above
// its Chat composer, and `sidePart` its side pane in the session hub's Plan
// section. Every held part draws again on `setFlow` for its session, on
// `setLayouts` and on `redraw`, and each second while it shows a countdown, the
// side pane aside. Each side pane draw sets the section's summary:
// `<checked>/<total>` while it draws a plan with boxes, else null. The side
// pane's list keeps its scroll across those draws, and while the pane has no
// layout box. `setFlow` also logs the session's stage, progress and countdown
// when each changes; `forget` drops what it logged for a session that left and
// its finished waves' fold. `setSidePaneHidden` shows or hides the side pane in
// every session, and `toggleFinishedWaves` opens or folds one session's finished
// waves, logging `nothing to run` and changing nothing while the pane would draw
// no fold. `mainAction` is the spec the main action runs, and `runFor` the one
// path that runs a workflow command for a session; only `toggleFinishedWaves`
// runs in the preview.
export interface WorkflowView {
  chipPart: SessionPart;
  stripPart: ChatComposerPart;
  sidePart: ChatSidePart;
  setFlow(flow: SessionFlow): void;
  forget(sessionId: string): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  redraw(): void;
  setSidePaneHidden(hidden: boolean): void;
  toggleFinishedWaves(sessionId: string): void;
  mainAction(flow: SessionFlow): StageActionSpec | null;
  runFor(sessionId: string, command: string): Promise<void>;
}

type PartKind = 'chip' | 'strip' | 'sidePane';

// One wrapper a part was built into, and what it drew there last. A side pane
// also holds its section, the scroll its list last reported in a `scroll` event
// with a layout box, and the observer that hands it back when the wrapper gets a
// box again.
interface HeldPart {
  kind: PartKind;
  sessionId: string;
  wrapper: HTMLElement;
  section: ChatSideSection | null;
  drawn: Drawn | null;
  showsCountdown: boolean;
  listScroll: number;
  paneBox: ResizeObserver | null;
}

// The boxes of one wave of the plan, or of its `Tasks` group.
interface PlanWave {
  title: string;
  tasks: readonly { text: string; done: boolean }[];
}

const TICK_MS = 1000;
const PLAN_FILE = 'plan.md';
const TASKS_GROUP_TITLE = 'Tasks';
const PENDING: MarkState = 'pending';

// Each wrapper outlives none of its builds: a row redraw or a composer draw
// builds and disposes a part many times, so the session's flow is read on
// every draw and the log lines are kept per session, logged only when their
// text changes. One tick a second redraws every part showing a countdown
// while any does.
export function createWorkflowView(deps: WorkflowViewDeps): WorkflowView {
  const { log, clock, timers } = deps;
  const parts = createWorkflowParts({ kit: deps.kit, log, clock });
  const held = new Set<HeldPart>();
  const loggedStages = new Map<string, string>();
  const loggedProgress = new Map<string, string>();
  const countdownShown = new Set<string>();
  const missingStagesLogged = new Set<string>();
  const finishedOpen = new Set<string>();
  let isSidePaneHidden = false;
  let pendingTick: number | null = null;

  // The page half that draws `flow`: its stage's, or idle's for a stage no
  // page half is registered for.
  const pageStageOf = (flow: SessionFlow): PageStage => {
    const stages = deps.stages.all();
    const stage = stages.find((each) => each.id === flow.stage);
    if (stage !== undefined) {
      return stage;
    }
    if (!missingStagesLogged.has(flow.stage)) {
      missingStagesLogged.add(flow.stage);
      log(`no page stage ${flow.stage}`);
    }
    const idle = stages.find((each) => each.id === IDLE_STAGE);
    if (idle === undefined) {
      throw new Error(`no page stage ${IDLE_STAGE}`);
    }
    return idle;
  };

  const availableActions = (flow: SessionFlow) =>
    pageStageOf(flow).actions.filter((spec) => spec.available(flow));

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

  const steps = (stage: PageStage, status: StageStatus | null): StepInput[] => {
    const shown = stepperStages(deps.stages.all(), stage);
    const current = shown.indexOf(stage);
    return shown.map((step, index) => ({
      id: step.id,
      label: step.label,
      state: stepState(index, current, status),
    }));
  };

  const countdown = (flow: SessionFlow): string | null =>
    flow.countdownEndsAt === null
      ? null
      : countdownText(flow.countdownEndsAt, clock.now());

  const chipInput = (flow: SessionFlow): ChipInput => {
    const stage = pageStageOf(flow);
    const status = stage.status(flow);
    return {
      stage: stage.id,
      label: stage.label,
      status,
      statusText: statusText(stage.label, status),
      detail: stage.detail(flow),
      countdown: countdown(flow),
      mainAction: actionInputs(flow)[0] ?? null,
    };
  };

  const stripInput = (flow: SessionFlow): StripInput => {
    const stage = pageStageOf(flow);
    const status = stage.status(flow);
    return {
      stage: stage.id,
      label: stage.label,
      status,
      statusText: statusText(stage.label, status),
      statusLine: statusLine(stage, flow),
      detail: stage.detail(flow),
      countdown: countdown(flow),
      steps: steps(stage, status),
      actions: actionInputs(flow),
      hasPlan: flow.progress !== null,
    };
  };

  // What the side pane draws for `flow`; null while it draws nothing: idle, no
  // plan read, or hidden.
  const sidePaneInput = (flow: SessionFlow): SidePaneInput | null => {
    const stage = pageStageOf(flow);
    const progress = flow.progress;
    if (stage.id === IDLE_STAGE || progress === null || isSidePaneHidden) {
      return null;
    }
    const openTaskState = stage.runsTasks
      ? (stage.status(flow) ?? PENDING)
      : PENDING;
    return {
      ...stripInput(flow),
      planTitle: progress.title,
      checked: progress.checked,
      total: progress.total,
      finishedOpen: finishedOpen.has(flow.sessionId),
      ...groupedWaves(progress, openTaskState),
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
    const run = runCommand(part.sessionId);
    switch (part.kind) {
      case 'chip': {
        const input = chipInput(flow);
        if (input.stage === IDLE_STAGE) {
          return false;
        }
        part.drawn = parts.chip(part.wrapper, input, run);
        return input.countdown !== null;
      }
      case 'strip': {
        const input = stripInput(flow);
        if (input.stage === IDLE_STAGE) {
          return false;
        }
        part.drawn = parts.strip(part.wrapper, input, run);
        return input.countdown !== null;
      }
      case 'sidePane': {
        const input = sidePaneInput(flow);
        part.section?.setSummary(sidePaneSummary(input));
        if (input === null) {
          return false;
        }
        part.drawn = parts.sidePane(part.wrapper, input, run);
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
    section: ChatSideSection | null,
  ): Disposable => {
    const part: HeldPart = {
      kind,
      sessionId,
      wrapper,
      section,
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

  const logFlow = (flow: SessionFlow) => {
    const name = deps.nameOf(flow.sessionId);
    if (loggedStages.get(flow.sessionId) !== flow.stage) {
      loggedStages.set(flow.sessionId, flow.stage);
      log(`${name} shows ${flow.stage}`);
    }
    if (flow.progress !== null) {
      const progress = progressText(flow.progress);
      if (loggedProgress.get(flow.sessionId) !== progress) {
        loggedProgress.set(flow.sessionId, progress);
        log(`${name} progress ${progress}`);
      }
    }
    const hasCountdown = flow.countdownEndsAt !== null;
    if (hasCountdown && !countdownShown.has(flow.sessionId)) {
      countdownShown.add(flow.sessionId);
      log(`countdown shown in ${name}`);
    } else if (!hasCountdown && countdownShown.has(flow.sessionId)) {
      countdownShown.delete(flow.sessionId);
      log(`countdown stopped in ${name}`);
    }
  };

  const runSpec = async (
    sessionId: string,
    flow: SessionFlow,
    spec: StageActionSpec,
  ): Promise<void> => {
    if (spec.side === 'main') {
      await deps.runAction({ sessionId, command: spec.command });
      return;
    }
    switch (spec.command) {
      case 'openPlan':
        if (flow.planDir === null) {
          throw new Error('the session has no plan');
        }
        deps.openDoc(deps.paths.join(flow.planDir, PLAN_FILE));
        return;
      default:
        throw new Error(`no page action ${spec.command}`);
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
    sidePart: {
      id: 'workflow.sidePane',
      title: 'Plan',
      order: 20,
      build: (wrapper, sessionId, section) =>
        hold('sidePane', wrapper, sessionId, section),
    },
    setFlow(flow) {
      try {
        logFlow(flow);
      } finally {
        drawSession(flow.sessionId);
      }
    },
    forget(sessionId) {
      loggedStages.delete(sessionId);
      loggedProgress.delete(sessionId);
      countdownShown.delete(sessionId);
      finishedOpen.delete(sessionId);
    },
    setLayouts(shown) {
      parts.setLayouts(shown);
      drawAll();
    },
    redraw: drawAll,
    setSidePaneHidden(hidden) {
      isSidePaneHidden = hidden;
      drawEach([...held].filter((part) => part.kind === 'sidePane'));
    },
    toggleFinishedWaves(sessionId) {
      const name = deps.nameOf(sessionId);
      const input = sidePaneInput(deps.flowOf(sessionId));
      const isFoldDrawn = input !== null && input.finishedWaves.length > 0;
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
      const spec =
        command === MAIN_ACTION
          ? mainAction(flow)
          : (availableActions(flow).find((each) => each.command === command) ??
            null);
      if (spec === null || !spec.enabled(flow)) {
        log(`nothing to run for ${command} in ${name}`);
        return;
      }
      try {
        await runSpec(sessionId, flow, spec);
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

// The Plan section's summary for what the pane draws: null while it draws nothing
// or a plan with no boxes.
function sidePaneSummary(input: SidePaneInput | null): string | null {
  return input !== null && input.total > 0
    ? `${input.checked}/${input.total}`
    : null;
}

// `<checked>/<total>`, then ` wave <n>` while a wave is open and
// ` review <r>` once a review round is logged.
function progressText(progress: PlanProgress): string {
  const wave = progress.wave === null ? '' : ` wave ${progress.wave}`;
  const review =
    progress.reviewRounds > 0 ? ` review ${progress.reviewRounds}` : '';
  return `${progress.checked}/${progress.total}${wave}${review}`;
}

// The plan's boxes grouped by the wave each sits under, in the order the
// waves first appear; boxes under no wave heading are the `Tasks` group.
function waves(progress: PlanProgress): PlanWave[] {
  const groups = new Map<number | null, PlanWave['tasks'][number][]>();
  for (const task of progress.tasks) {
    const group = groups.get(task.wave) ?? [];
    group.push({ text: task.text, done: task.done });
    groups.set(task.wave, group);
  }
  return [...groups].map(([wave, tasks]) => ({
    title: wave === null ? TASKS_GROUP_TITLE : `Wave ${wave}`,
    tasks,
  }));
}

// The plan's groups in file order: each with every task done is finished, the
// first other is the current wave, whose open tasks show `openTaskState`, and
// the rest are later.
function groupedWaves(
  progress: PlanProgress,
  openTaskState: MarkState,
): Pick<SidePaneInput, 'finishedWaves' | 'currentWave' | 'laterWaves'> {
  const groups = waves(progress);
  const isFinished = (wave: PlanWave) => wave.tasks.every((task) => task.done);
  const [current, ...later] = groups.filter((wave) => !isFinished(wave));
  return {
    finishedWaves: groups
      .filter(isFinished)
      .map((wave) => sideWave(wave, PENDING)),
    currentWave:
      current === undefined ? null : sideWave(current, openTaskState),
    laterWaves: later.map((wave) => sideWave(wave, PENDING)),
  };
}

function sideWave(wave: PlanWave, openTaskState: MarkState): SideWaveInput {
  return {
    title: wave.title,
    tasks: wave.tasks.map((task) => ({
      text: task.text,
      state: task.done ? 'done' : openTaskState,
    })),
  };
}
