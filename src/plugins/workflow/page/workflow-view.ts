import type { Clock, Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { ShownLayouts, ToastTone } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import type { OwnerKitServices } from '../../../shared/page/layout-host/base-kit';
import type { ChatComposerPart } from '../../chat/contract';
import type { SessionPart } from '../../sessions/contract';
import {
  IDLE_STAGE,
  type PageStage,
  type SessionFlow,
  type StageActionSpec,
  type WorkflowActionRequest,
} from '../contract';
import type {
  ActionInput,
  ChipInput,
  FlowTabInput,
  Layout,
  PlanWaveInput,
  StepInput,
  StripInput,
} from '../layouts/layout';
import type { PlanProgress } from '../plan-reader';
import { countdownText } from './countdown';
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
// nothing. `stripBuilt` hears each strip build, before it draws. The rest run
// the actions: `openDoc` the page one, `runAction` main's.
export interface WorkflowViewDeps {
  kit: OwnerKitServices;
  log: Log;
  clock: Clock;
  timers: Timers;
  toast(text: string, tone: ToastTone): void;
  paths: Pick<Paths, 'join'>;
  stages: PageStages;
  flowOf(sessionId: string): SessionFlow;
  nameOf(sessionId: string): string;
  isPreview(sessionId: string): boolean;
  stripBuilt(sessionId: string): void;
  openDoc(path: string): void;
  runAction(request: WorkflowActionRequest): Promise<void>;
}

// `chipPart` draws a session's chip under its row, `stripPart` its strip
// above its Chat composer, and `drawFlowTab` its Flow tab into `body` until
// the returned dispose, setting the tab's status line on each draw. Every
// held part draws again on `setFlow` for its session, on `setLayouts` and on
// `redraw`, and each second while it shows a countdown. `setFlow` also logs
// the session's stage, progress and countdown when each changes; `forget`
// drops what it logged for a session that left. `mainAction` is the spec the
// main action runs, and `runFor` the one path that runs a workflow command
// for a session.
export interface WorkflowView {
  chipPart: SessionPart;
  stripPart: ChatComposerPart;
  drawFlowTab(
    body: HTMLElement,
    sessionId: string,
    setStatus: (status: string) => void,
  ): Disposable;
  setFlow(flow: SessionFlow): void;
  forget(sessionId: string): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  redraw(): void;
  mainAction(flow: SessionFlow): StageActionSpec | null;
  runFor(sessionId: string, command: string): Promise<void>;
}

type PartKind = 'chip' | 'strip' | 'flowTab';

// One wrapper a part was built into, and what it drew there last.
interface HeldPart {
  kind: PartKind;
  sessionId: string;
  wrapper: HTMLElement;
  setStatus: ((status: string) => void) | null;
  drawn: Drawn | null;
  showsCountdown: boolean;
}

const TICK_MS = 1000;
const MAIN_ACTION = 'mainAction';
const PLAN_FILE = 'plan.md';
const TASKS_GROUP_TITLE = 'Tasks';

// Each wrapper outlives none of its builds: a row redraw or a composer draw
// builds and disposes a part many times, so the session's flow is read on
// every draw and the log lines are kept per session, logged only when their
// text changes. One tick a second redraws every part showing a countdown
// while any does.
export function createWorkflowView(deps: WorkflowViewDeps): WorkflowView {
  const { log: writeLog, clock, timers } = deps;
  const log = (line: string) => writeLog('workflow', line);
  const parts = createWorkflowParts({ kit: deps.kit, log: writeLog });
  const held = new Set<HeldPart>();
  const loggedStages = new Map<string, string>();
  const loggedProgress = new Map<string, string>();
  const countdownShown = new Set<string>();
  const missingStagesLogged = new Set<string>();
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

  const mainAction = (flow: SessionFlow): StageActionSpec | null =>
    availableActions(flow)[0] ?? null;

  const actionInputs = (flow: SessionFlow): ActionInput[] =>
    availableActions(flow).map((spec, index) => ({
      command: spec.command,
      label: spec.label,
      enabled: spec.enabled(flow),
      main: index === 0,
    }));

  const steps = (stage: PageStage): StepInput[] => {
    const inStepper = deps.stages.all().filter((each) => each.inStepper);
    const current = inStepper.indexOf(stage);
    return inStepper.map((step, index) => ({
      id: step.id,
      label: step.label,
      state: stepState(index, current),
    }));
  };

  const countdown = (flow: SessionFlow): string | null =>
    flow.countdownEndsAt === null
      ? null
      : countdownText(flow.countdownEndsAt, clock.now());

  const chipInput = (flow: SessionFlow): ChipInput => {
    const stage = pageStageOf(flow);
    return {
      stage: stage.id,
      label: stage.label,
      detail: stage.detail(flow),
      countdown: countdown(flow),
      mainAction: actionInputs(flow)[0] ?? null,
    };
  };

  const stripInput = (flow: SessionFlow): StripInput => {
    const stage = pageStageOf(flow);
    return {
      stage: stage.id,
      label: stage.label,
      detail: stage.detail(flow),
      countdown: countdown(flow),
      steps: steps(stage),
      actions: actionInputs(flow),
    };
  };

  const flowTabInput = (flow: SessionFlow): FlowTabInput => {
    const progress = flow.progress;
    return {
      ...stripInput(flow),
      planTitle: progress === null ? null : progress.title,
      waves: progress === null ? [] : waves(progress),
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
      case 'flowTab': {
        const input = flowTabInput(flow);
        part.drawn = parts.flowTab(part.wrapper, input, run);
        part.setStatus?.(
          input.countdown === null
            ? input.label
            : `${input.label} · ${input.countdown}`,
        );
        return input.countdown !== null;
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

  const tick = () => {
    pendingTick = null;
    drawEach([...held].filter((part) => part.showsCountdown));
  };

  // Stops drawing `part` and disposes what it drew last.
  const release = (part: HeldPart) => {
    held.delete(part);
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
    setStatus: ((status: string) => void) | null,
  ): Disposable => {
    const part: HeldPart = {
      kind,
      sessionId,
      wrapper,
      setStatus,
      drawn: null,
      showsCountdown: false,
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
      build(wrapper, sessionId) {
        deps.stripBuilt(sessionId);
        return hold('strip', wrapper, sessionId, null);
      },
    },
    drawFlowTab: (body, sessionId, setStatus) =>
      hold('flowTab', body, sessionId, setStatus),
    setFlow(flow) {
      try {
        logFlow(flow);
      } finally {
        drawEach([...held].filter((part) => part.sessionId === flow.sessionId));
      }
    },
    forget(sessionId) {
      loggedStages.delete(sessionId);
      loggedProgress.delete(sessionId);
      countdownShown.delete(sessionId);
    },
    setLayouts(shown) {
      parts.setLayouts(shown);
      drawAll();
    },
    redraw: drawAll,
    mainAction,
    async runFor(sessionId, command) {
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

// The state of the stepper's step at `index` while the flow's stage is the
// step at `current`, -1 for a stage outside the stepper (idle), which leaves
// every step ahead.
function stepState(index: number, current: number): StepInput['state'] {
  if (current === -1 || index > current) {
    return 'ahead';
  }
  return index === current ? 'current' : 'done';
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
function waves(progress: PlanProgress): PlanWaveInput[] {
  const groups = new Map<number | null, PlanWaveInput['tasks'][number][]>();
  for (const task of progress.tasks) {
    const group = groups.get(task.wave) ?? [];
    group.push({ text: task.text, done: task.done });
    groups.set(task.wave, group);
  }
  return [...groups].map(([wave, tasks]) => ({
    title: wave === null ? TASKS_GROUP_TITLE : `Wave ${wave}`,
    tasks,
    current: wave !== null && wave === progress.wave,
  }));
}
