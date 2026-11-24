// The one place a flow changes: the running state, the claim, the checklist,
// then the current workflow's fields and stage rules. Pure: no I/O, no
// clock, no DOM.

import {
  CHECKLIST_STAGE,
  CHECKLIST_WORKFLOW_ID,
  type ChecklistItem,
  type MainWorkflow,
  type SessionFlow,
  type WorkflowSignal,
} from './contract';

export function newFlow(sessionId: string, projectDir: string): SessionFlow {
  return {
    sessionId,
    projectDir,
    workflow: CHECKLIST_WORKFLOW_ID,
    movedUpFrom: null,
    stage: CHECKLIST_STAGE,
    checklist: null,
    checklistReported: false,
    plan: null,
    counters: {},
    enteredFrom: null,
    countdownEndsAt: null,
    unclaimedWork: false,
    turnRunning: false,
    runningSubagents: [],
  };
}

// Applies `signal` to `flow`: the running state, the claim of the first of
// `workflows` that claims it (the caller keeps them sorted by `order`), the
// checklist, then, of the current workflow alone, `foldFields`, each stage's `enter` in array order, the first non-null answer winning, and
// `afterStage`. A flow whose workflow has no entry in `workflows` takes the
// running state, the claim and the checklist only, so a checklist report never
// waits on a workflow. Returns `flow` itself when no field changed, otherwise a
// new flow; never mutates `flow`.
export function foldFlow(
  flow: SessionFlow,
  signal: WorkflowSignal,
  workflows: readonly MainWorkflow[],
): SessionFlow {
  const next: SessionFlow = { ...flow };
  applyBookkeeping(next, signal);
  applyClaim(next, signal, workflows);
  applyChecklist(next, signal);
  const current = workflows.find((workflow) => workflow.id === next.workflow);
  if (current === undefined) {
    return sameFlow(flow, next) ? flow : next;
  }
  const fielded = current.foldFields?.(next, signal) ?? next;
  const staged: SessionFlow = { ...fielded };
  applyStageRules(staged, signal, current);
  const after = current.afterStage?.(fielded, staged, signal) ?? staged;
  return sameFlow(flow, after) ? flow : after;
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

// A copy with `unclaimedWork` set when the flow is on the Checklist flow while
// `isFlagged` (a registered workflow `flagsUnclaimedWork`); otherwise `flow`.
export function markUnclaimedWork(
  flow: SessionFlow,
  isFlagged: boolean,
): SessionFlow {
  const isUnclaimed =
    flow.workflow === CHECKLIST_WORKFLOW_ID && isFlagged && !flow.unclaimedWork;
  return isUnclaimed ? { ...flow, unclaimedWork: true } : flow;
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
  if (signal.type === 'cleared') {
    next.turnRunning = false;
    next.runningSubagents = [];
    next.unclaimedWork = false;
  }
}

// Every claim empties the checklist. A claim from a stage that finishes its
// workflow, or from the Checklist flow, starts a new run, which moved up from
// nothing. Mid-run, another workflow's claim moved up from the current one, and
// the current workflow's own claim continues the run. Another workflow's claim
// starts it over at its first stage, with no plan, counters, entry stage or
// countdown.
function applyClaim(
  next: SessionFlow,
  signal: WorkflowSignal,
  workflows: readonly MainWorkflow[],
): void {
  const claimer = workflows.find((workflow) => workflow.claims(signal));
  if (claimer === undefined) {
    return;
  }
  const isOwnClaim = claimer.id === next.workflow;
  const startsNewRun =
    stageFinishes(next, workflows) || next.workflow === CHECKLIST_WORKFLOW_ID;
  next.checklist = null;
  if (startsNewRun) {
    next.movedUpFrom = null;
  } else if (!isOwnClaim) {
    next.movedUpFrom = next.workflow;
  }
  if (isOwnClaim) {
    return;
  }
  next.workflow = claimer.id;
  next.stage = claimer.firstStage;
  next.plan = null;
  next.counters = {};
  next.enteredFrom = null;
  next.countdownEndsAt = null;
  next.unclaimedWork = false;
}

function stageFinishes(
  flow: SessionFlow,
  workflows: readonly MainWorkflow[],
): boolean {
  const current = workflows.find((workflow) => workflow.id === flow.workflow);
  const stage = current?.stages.find((held) => held.id === flow.stage);
  return stage?.finishes === true;
}

// Sets `checklistReported` on any report. An equal list keeps the current
// array, so the fold reads as no change.
function applyChecklist(next: SessionFlow, signal: WorkflowSignal): void {
  if (signal.type !== 'checklistReported') {
    return;
  }
  next.checklistReported = true;
  if (!sameChecklist(next.checklist, signal.items)) {
    next.checklist = signal.items;
  }
}

function applyStageRules(
  next: SessionFlow,
  signal: WorkflowSignal,
  current: MainWorkflow,
): void {
  for (const stage of current.stages) {
    const entered = stage.enter(next, signal);
    if (entered !== null) {
      next.stage = entered;
      return;
    }
  }
}

function sameChecklist(
  current: readonly ChecklistItem[] | null,
  incoming: readonly ChecklistItem[],
): boolean {
  return (
    current !== null &&
    current.length === incoming.length &&
    current.every((item, index) => {
      const other = incoming[index];
      return (
        item.text === other.text &&
        item.done === other.done &&
        item.running === other.running
      );
    })
  );
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// `checklist` compares by reference: the fold keeps the current array whenever the
// incoming one is equal. `plan` and `counters` compare by their JSON.
function sameFlow(a: SessionFlow, b: SessionFlow): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.projectDir === b.projectDir &&
    a.workflow === b.workflow &&
    a.movedUpFrom === b.movedUpFrom &&
    a.stage === b.stage &&
    a.checklist === b.checklist &&
    a.checklistReported === b.checklistReported &&
    JSON.stringify(a.plan) === JSON.stringify(b.plan) &&
    JSON.stringify(a.counters) === JSON.stringify(b.counters) &&
    a.enteredFrom === b.enteredFrom &&
    a.countdownEndsAt === b.countdownEndsAt &&
    a.unclaimedWork === b.unclaimedWork &&
    a.turnRunning === b.turnRunning &&
    sameIds(a.runningSubagents, b.runningSubagents)
  );
}
