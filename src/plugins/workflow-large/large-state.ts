// Large's plan bookkeeping: what a signal does to its plan folder, its progress,
// its recorded review rounds and its countdown. Pure.

import {
  IDLE_STAGE,
  type SessionFlow,
  startsSkill,
  type WorkflowSignal,
} from '../workflow/contract';
import type { PlanProgress } from '../../shared/plan-progress';
import {
  largeEventOf,
  type LargeMainStage,
  type LargeState,
  largeStateIn,
  largeStateOf,
} from './contract';
import { LARGE_MAIN_STAGES } from './stages';

const PLAN_FILE = /[\\/]plan-[^\\/]+[\\/]plan\.md$/;
const PLAN_FOLDER_NAME = /^plan-./;
const TRAILING_SEPARATORS = /[\\/]+$/;
const MAKE_SKILL = 'wigley:make';

// A path ending in /plan-<name>/plan.md, either separator.
export function isPlanFile(path: string): boolean {
  return PLAN_FILE.test(path);
}

// The folder that holds that plan.md.
export function planDirOf(path: string): string {
  return path.slice(0, lastSeparatorIndex(path));
}

// The state `signal` leaves: its own bookkeeping, then what the stage it enters
// does to the plan. Returns `flow.state` itself when nothing changed.
export function foldLargeState(
  flow: SessionFlow,
  signal: WorkflowSignal,
): unknown {
  const before = largeStateOf(flow);
  const next: LargeState = { ...before };
  applySignal(next, signal);
  applyEnteredStage(next, flow, signal);
  return sameLargeState(before, next) ? flow.state : next;
}

// The review rounds the plan records, the number the fix stage shows as its cycle.
export function largeFixCycles(flow: SessionFlow): number {
  return largeStateOf(flow).progress?.reviewRounds ?? 0;
}

// `progress` compares by reference: the fold keeps the current object whenever
// the incoming one is equal.
export function sameLargeState(a: unknown, b: unknown): boolean {
  const left = largeStateIn(a);
  const right = largeStateIn(b);
  return (
    left.planDir === right.planDir &&
    left.planReported === right.planReported &&
    left.unreportedPlanDir === right.unreportedPlanDir &&
    left.progress === right.progress &&
    left.reviewRoundsAtMake === right.reviewRoundsAtMake &&
    left.countdownEndsAt === right.countdownEndsAt
  );
}

function applySignal(next: LargeState, signal: WorkflowSignal): void {
  switch (signal.type) {
    case 'turnStarted':
    case 'cleared':
      next.countdownEndsAt = null;
      break;
    case 'fileWritten':
      if (isPlanFile(signal.path)) {
        followPlanDir(next, planDirOf(signal.path));
      }
      break;
    case 'skillStarted': {
      const planDir = startsSkill(signal, MAKE_SKILL)
        ? planDirOfArgsPath(signal.argsPath)
        : null;
      if (planDir !== null) {
        followPlanDir(next, planDir);
      }
      break;
    }
    case 'custom': {
      const event = largeEventOf(signal);
      if (event?.type === 'planChanged') {
        if (!sameProgress(next.progress, event.progress)) {
          next.progress = event.progress;
        }
        next.reviewRoundsAtMake ??= event.progress.reviewRounds;
      } else if (event?.type === 'planReported') {
        reportPlanDir(next, event.planDir);
      }
      break;
    }
    default:
      break;
  }
}

function applyEnteredStage(
  next: LargeState,
  flow: SessionFlow,
  signal: WorkflowSignal,
): void {
  const entered = enteredStage({ ...flow, state: next }, signal);
  if (entered === null) {
    return;
  }
  if (entered.id !== flow.stage) {
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

// The first stage rule's answer, with the stage of that id when it names one.
function enteredStage(
  flow: SessionFlow,
  signal: WorkflowSignal,
): { id: string; stage: LargeMainStage | undefined } | null {
  for (const stage of LARGE_MAIN_STAGES) {
    const id = stage.enter(flow, signal);
    if (id !== null) {
      return {
        id,
        stage: LARGE_MAIN_STAGES.find((candidate) => candidate.id === id),
      };
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
function setPlanDir(next: LargeState, planDir: string): void {
  if (planDir !== next.planDir) {
    next.planDir = planDir;
    next.progress = null;
    next.reviewRoundsAtMake = null;
  }
}

// A reported folder: marks it, and a new one keeps the unreported folder it
// moves away from, or the one an earlier report kept.
function reportPlanDir(next: LargeState, planDir: string): void {
  if (planDir !== next.planDir && !next.planReported) {
    next.unreportedPlanDir = next.planDir;
  }
  setPlanDir(next, planDir);
  next.planReported = true;
}

// A folder seen in a write or a make argument, not reported: a new one drops
// the report mark and the unreported folder kept, and the folder already held
// keeps both.
function followPlanDir(next: LargeState, planDir: string): void {
  if (planDir !== next.planDir) {
    setPlanDir(next, planDir);
    next.planReported = false;
    next.unreportedPlanDir = null;
  }
}

function clearPlan(next: LargeState): void {
  next.planDir = null;
  next.planReported = false;
  next.unreportedPlanDir = null;
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
        task.done === other.done &&
        task.file === other.file &&
        task.status === other.status
      );
    });
  return sameScalars && sameTasks;
}
