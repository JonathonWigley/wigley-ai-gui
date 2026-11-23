// The plan capability's part of a declared workflow's fold: what a signal does
// to the flow's plan folder, its progress and its recorded counter snapshots,
// before the stage rules. Pure.

import type { WorkflowDecl } from '../../../contracts/contributions';
import type {
  DeclaredWorkflow,
  PlanProgress,
  PlanState,
  SessionFlow,
  WorkflowSignal,
} from '../contract';
import type { PlanFold } from '../declared/plan-fold';
import { usesPlan } from '../declared/uses-plan';
import { isPlanFilePath, planDirOfArgs } from './read-plan';

const NO_PLAN: PlanState = {
  dir: null,
  reported: false,
  unreportedDir: null,
  progress: null,
  snapshots: {},
};

// Whether each declaration uses the plan capability, read once per
// declaration.
const planUsers = new WeakMap<WorkflowDecl, boolean>();

function keepsPlan(decl: WorkflowDecl): boolean {
  let uses = planUsers.get(decl);
  if (uses === undefined) {
    uses = usesPlan(decl);
    planUsers.set(decl, uses);
  }
  return uses;
}

// The fold of the plan capability. A flow whose workflow keeps no plan keeps
// its plan as it is; a null plan reads as no folder, no progress and no
// snapshots. Returns `flow.plan` itself when nothing changed.
export function createPlanFold(): PlanFold {
  return {
    fold(flow, signal, workflow, planFromArgs) {
      if (!keepsPlan(workflow.decl)) {
        return flow.plan;
      }
      const before = flow.plan ?? NO_PLAN;
      const after = foldPlan(before, flow, signal, workflow, planFromArgs);
      return after === before ? flow.plan : after;
    },
  };
}

function foldPlan(
  plan: PlanState,
  flow: SessionFlow,
  signal: WorkflowSignal,
  workflow: DeclaredWorkflow,
  planFromArgs: boolean,
): PlanState {
  const format = workflow.planFormat;
  switch (signal.type) {
    case 'fileWritten':
      return isPlanFilePath(signal.path, format)
        ? followPlanDir(plan, planDirOf(signal.path))
        : plan;
    case 'skillStarted': {
      const planDir = planFromArgs
        ? planDirOfArgs(signal.argsPath, format)
        : null;
      return planDir === null ? plan : followPlanDir(plan, planDir);
    }
    case 'planReported':
      return reportPlanDir(plan, signal.planDir);
    case 'planChanged':
      return readProgress(plan, signal.progress, recordedIn(flow, workflow));
    default:
      return plan;
  }
}

// The counters the flow's current stage `records`.
function recordedIn(
  flow: SessionFlow,
  workflow: DeclaredWorkflow,
): readonly string[] {
  return (
    workflow.decl.stages.find((stage) => stage.id === flow.stage)?.records ?? []
  );
}

// The incoming progress unless it equals the held one, then each recorded
// counter's snapshot still absent filled from it: a new folder's first read
// records the counters its stage records.
function readProgress(
  plan: PlanState,
  incoming: PlanProgress,
  recorded: readonly string[],
): PlanState {
  const progress = sameProgress(plan.progress, incoming)
    ? plan.progress
    : incoming;
  let snapshots = plan.snapshots;
  for (const name of recorded) {
    const value = incoming.counters[name];
    if (snapshots[name] === undefined && value !== undefined) {
      snapshots = { ...snapshots, [name]: value };
    }
  }
  return progress === plan.progress && snapshots === plan.snapshots
    ? plan
    : { ...plan, progress, snapshots };
}

// A new plan folder drops the old plan's progress and snapshots; the folder's
// first read fills both.
function withPlanDir(plan: PlanState, planDir: string): PlanState {
  return planDir === plan.dir
    ? plan
    : { ...plan, dir: planDir, progress: null, snapshots: {} };
}

// A reported folder: marks it, and a new one keeps the unreported folder it
// moves away from, or the one an earlier report kept, while that folder has the
// reported folder's plan folder name under the same feature folder; any other
// folder is another plan's.
function reportPlanDir(plan: PlanState, planDir: string): PlanState {
  let unreportedDir = plan.unreportedDir;
  if (planDir !== plan.dir && !plan.reported) {
    unreportedDir = plan.dir;
  }
  if (
    unreportedDir !== null &&
    featureAndPlanNameOf(unreportedDir) !== featureAndPlanNameOf(planDir)
  ) {
    unreportedDir = null;
  }
  const moved = withPlanDir(plan, planDir);
  return moved === plan && plan.reported && unreportedDir === plan.unreportedDir
    ? plan
    : { ...moved, reported: true, unreportedDir };
}

// A folder seen in a write or a skill argument, not reported: a new one drops
// the report mark and the unreported folder kept, and the folder already held
// keeps both.
function followPlanDir(plan: PlanState, planDir: string): PlanState {
  return planDir === plan.dir
    ? plan
    : {
        ...withPlanDir(plan, planDir),
        reported: false,
        unreportedDir: null,
      };
}

// The folder that holds a plan file path.
function planDirOf(path: string): string {
  return path.slice(0, lastSeparatorIndex(path));
}

// The last two segments: the feature folder and the plan folder in it.
function featureAndPlanNameOf(folder: string): string {
  const planStart = lastSeparatorIndex(folder);
  const featureStart = Math.max(
    folder.lastIndexOf('/', planStart - 1),
    folder.lastIndexOf('\\', planStart - 1),
  );
  return folder.slice(featureStart + 1).replace(/\\/g, '/');
}

function lastSeparatorIndex(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
}

// Every field by value, `counters` and each task line's fields included.
export function sameProgress(
  current: PlanProgress | null,
  incoming: PlanProgress,
): boolean {
  if (current === null) {
    return false;
  }
  const sameScalars =
    current.title === incoming.title &&
    current.checked === incoming.checked &&
    current.total === incoming.total &&
    current.wave === incoming.wave;
  const currentCounters = Object.keys(current.counters);
  const sameCounters =
    currentCounters.length === Object.keys(incoming.counters).length &&
    currentCounters.every(
      (name) => current.counters[name] === incoming.counters[name],
    );
  const sameTasks =
    current.tasks.length === incoming.tasks.length &&
    current.tasks.every((task, index) => {
      const other = incoming.tasks[index];
      return (
        task.group === other.group &&
        task.text === other.text &&
        task.done === other.done &&
        task.file === other.file &&
        task.status === other.status &&
        task.verification === other.verification
      );
    });
  return sameScalars && sameCounters && sameTasks;
}
