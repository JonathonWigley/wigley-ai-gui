// The one place a flow changes: the shared bookkeeping a signal applies, then
// the stage rules. Pure: no I/O, no clock, no DOM.

import type { PlanProgress } from './plan-reader';
import {
  IDLE_STAGE,
  type MainStage,
  type SessionFlow,
  startsSkill,
  type WorkflowSignal,
} from './contract';

const PLAN_FILE = /[\\/]plan-[^\\/]+[\\/]plan\.md$/;
const PLAN_FOLDER_NAME = /^plan-./;
const TRAILING_SEPARATORS = /[\\/]+$/;
const MAKE_SKILL = 'wigley:make';

export function newFlow(sessionId: string, projectDir: string): SessionFlow {
  return {
    sessionId,
    projectDir,
    stage: IDLE_STAGE,
    planDir: null,
    progress: null,
    turnRunning: false,
    runningSubagents: [],
    countdownEndsAt: null,
  };
}

// A path ending in /plan-<name>/plan.md, either separator.
export function isPlanFile(path: string): boolean {
  return PLAN_FILE.test(path);
}

// The folder that holds that plan.md.
export function planDirOf(path: string): string {
  return path.slice(0, lastSeparatorIndex(path));
}

// Applies `signal` to `flow`: the bookkeeping first, then each stage's `enter`
// in the order `stages` gives (the caller keeps them sorted by `order`), the
// first non-null answer winning. Returns `flow` itself when no field changed,
// otherwise a new flow; never mutates `flow`.
export function foldFlow(
  flow: SessionFlow,
  signal: WorkflowSignal,
  stages: readonly MainStage[],
): SessionFlow {
  const next: SessionFlow = { ...flow };
  applyBookkeeping(next, signal);
  applyStageRules(next, signal, stages);
  return sameFlow(flow, next) ? flow : next;
}

// Applies only what `signal` says about the running turn and subagents: every
// other field stays, and no stage rule runs. Returns `flow` itself when neither
// changed.
export function foldRunningState(
  flow: SessionFlow,
  signal: WorkflowSignal,
): SessionFlow {
  const next: SessionFlow = { ...flow };
  applyRunningState(next, signal);
  return sameFlow(flow, next) ? flow : next;
}

function applyRunningState(next: SessionFlow, signal: WorkflowSignal): void {
  switch (signal.type) {
    case 'turnStarted':
      next.turnRunning = true;
      break;
    case 'turnEnded':
      next.turnRunning = false;
      break;
    case 'subagentStarted':
      if (!next.runningSubagents.includes(signal.agentId)) {
        next.runningSubagents = [...next.runningSubagents, signal.agentId];
      }
      break;
    case 'subagentFinished':
      next.runningSubagents = next.runningSubagents.filter(
        (agentId) => agentId !== signal.agentId,
      );
      break;
    default:
      break;
  }
}

function applyBookkeeping(next: SessionFlow, signal: WorkflowSignal): void {
  applyRunningState(next, signal);
  switch (signal.type) {
    case 'turnStarted':
      next.countdownEndsAt = null;
      break;
    case 'turnEnded':
    case 'subagentStarted':
    case 'subagentFinished':
      break;
    case 'fileWritten':
      if (isPlanFile(signal.path)) {
        setPlanDir(next, planDirOf(signal.path));
      }
      break;
    case 'skillStarted': {
      const planDir = startsSkill(signal, MAKE_SKILL)
        ? planDirOfArgsPath(signal.argsPath)
        : null;
      if (planDir !== null) {
        setPlanDir(next, planDir);
      }
      break;
    }
    case 'planChanged':
      if (!sameProgress(next.progress, signal.progress)) {
        next.progress = signal.progress;
      }
      next.reviewRoundsAtMake ??= signal.progress.reviewRounds;
      break;
    case 'cleared':
      next.countdownEndsAt = null;
      next.turnRunning = false;
      next.runningSubagents = [];
      break;
    case 'stepReported':
    case 'planGone':
    case 'handedOff':
    case 'dismissed':
      break;
  }
}

function applyStageRules(
  next: SessionFlow,
  signal: WorkflowSignal,
  stages: readonly MainStage[],
): void {
  const entered = enteredStage(next, signal, stages);
  if (entered === null) {
    return;
  }
  if (entered.id !== next.stage) {
    next.stage = entered.id;
    next.countdownEndsAt = null;
    if (entered.id === IDLE_STAGE) {
      clearPlan(next);
    }
  }
  if (entered.stage?.clearsPlan === true && signal.type === 'skillStarted') {
    clearPlan(next);
  }
  if (entered.stage?.recordsReviewRounds === true) {
    next.reviewRoundsAtMake = next.progress?.reviewRounds ?? null;
  }
}

// The first stage rule's answer, with the stage of that id in `stages` when it
// names one there.
function enteredStage(
  flow: SessionFlow,
  signal: WorkflowSignal,
  stages: readonly MainStage[],
): { id: string; stage: MainStage | undefined } | null {
  for (const stage of stages) {
    const id = stage.enter(flow, signal);
    if (id !== null) {
      return { id, stage: stages.find((candidate) => candidate.id === id) };
    }
  }
  return null;
}

// The plan folder a `wigley:make` argument names: a plan.md, or a folder whose
// name starts `plan-`. Null when it names no plan.
function planDirOfArgsPath(argsPath: string | null): string | null {
  if (argsPath === null) {
    return null;
  }
  if (isPlanFile(argsPath)) {
    return planDirOf(argsPath);
  }
  const folder = argsPath.replace(TRAILING_SEPARATORS, '');
  const folderName = folder.slice(lastSeparatorIndex(folder) + 1);
  return PLAN_FOLDER_NAME.test(folderName) ? folder : null;
}

// A new plan folder drops the old plan's progress and review rounds; the
// folder's first read fills both.
function setPlanDir(next: SessionFlow, planDir: string): void {
  if (planDir !== next.planDir) {
    next.planDir = planDir;
    next.progress = null;
    next.reviewRoundsAtMake = null;
  }
}

function clearPlan(next: SessionFlow): void {
  next.planDir = null;
  next.progress = null;
}

function lastSeparatorIndex(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
}

function sameProgress(
  current: PlanProgress | null,
  incoming: PlanProgress,
): boolean {
  if (current === null) {
    return false;
  }
  const sameScalars =
    current.checked === incoming.checked &&
    current.total === incoming.total &&
    current.wave === incoming.wave &&
    current.reviewRounds === incoming.reviewRounds &&
    current.title === incoming.title;
  const sameTasks =
    current.tasks.length === incoming.tasks.length &&
    current.tasks.every((task, index) => {
      const other = incoming.tasks[index];
      return (
        task.wave === other.wave &&
        task.text === other.text &&
        task.done === other.done
      );
    });
  return sameScalars && sameTasks;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// `progress` compares by reference: the bookkeeping keeps the current object
// whenever the incoming one is equal.
function sameFlow(a: SessionFlow, b: SessionFlow): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.projectDir === b.projectDir &&
    a.stage === b.stage &&
    a.planDir === b.planDir &&
    a.progress === b.progress &&
    a.reviewRoundsAtMake === b.reviewRoundsAtMake &&
    a.turnRunning === b.turnRunning &&
    sameIds(a.runningSubagents, b.runningSubagents) &&
    a.countdownEndsAt === b.countdownEndsAt
  );
}
