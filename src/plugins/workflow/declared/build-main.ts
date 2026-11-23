// The main half of a declared workflow: its claim, its stages from their
// triggers, its counters and plan bookkeeping, and its fix cycles.

import type { StageDecl } from '../../../contracts/contributions';
import {
  type DeclaredWorkflow,
  type MainStage,
  type MainWorkflow,
  type PlanState,
  type SessionFlow,
  startsSkill,
  type WorkflowSignal,
} from '../contract';
import type { PlanFold } from './plan-fold';
import { matchTrigger, startsPlanFromArgs, type TriggerMatch } from './triggers';

// `planFold` keeps the flow's plan; an engine with no plan capability passes
// `NO_PLAN_FOLD`.
export function buildMainWorkflow(
  workflow: DeclaredWorkflow,
  planFold: PlanFold,
): MainWorkflow {
  const { decl } = workflow;
  const claims = (signal: WorkflowSignal) =>
    decl.claims.some((skill) => startsSkill(signal, skill));
  const stages: MainStage[] = decl.stages.map((stage, index) => ({
    id: stage.id,
    order: index,
    reportedAs: stage.step,
    finishes: stage.finishes,
    enter: (flow, signal) =>
      matchTrigger(flow, signal, workflow)?.stage.id === stage.id
        ? stage.id
        : null,
  }));
  return {
    id: workflow.id,
    order: decl.order,
    claims,
    firstStage: firstStageOf(decl.stages),
    stages,
    foldFields(flow, signal) {
      const plan = planFold.fold(
        flow,
        signal,
        workflow,
        startsPlanFromArgs(signal, decl),
      );
      const stopsCountdown =
        signal.type === 'turnStarted' || signal.type === 'cleared';
      const resetsCounters = claims(signal) && decl.counters !== undefined;
      if (plan === flow.plan && !stopsCountdown && !resetsCounters) {
        return flow;
      }
      return {
        ...flow,
        plan,
        countdownEndsAt: stopsCountdown ? null : flow.countdownEndsAt,
        counters: resetsCounters
          ? claimResetCounters(flow.counters, workflow)
          : flow.counters,
      };
    },
    afterStage(before, next, signal) {
      const match = matchTrigger(before, signal, workflow);
      return match === null && next.stage === before.stage
        ? next
        : afterMatch(before, next, match, workflow);
    },
    fixCycles(flow) {
      const { fixCycles } = decl;
      if (fixCycles === undefined) {
        return 0;
      }
      return 'counter' in fixCycles
        ? (flow.counters[fixCycles.counter] ?? 0)
        : (flow.plan?.progress?.counters[fixCycles.planCounter] ?? 0);
    },
  };
}

// The first stage holding a `skill` trigger, where a claim lands before the
// same fold's stage rules enter the claimed skill's stage; the first stage
// for a workflow that claims nothing.
function firstStageOf(stages: readonly StageDecl[]): string {
  const claimed = stages.find((stage) =>
    stage.enter.some((trigger) => 'skill' in trigger),
  );
  return (claimed ?? stages[0]).id;
}

// Each counter `resetOn: claim` at 0, the others as they are.
function claimResetCounters(
  counters: Record<string, number>,
  workflow: DeclaredWorkflow,
): Record<string, number> {
  const reset = { ...counters };
  for (const [name, counter] of Object.entries(
    workflow.decl.counters ?? {},
  )) {
    if (counter.resetOn === 'claim') {
      reset[name] = 0;
    }
  }
  return reset;
}

// What the stage rules' match does to the rest of the flow: `clearsPlan`
// drops the plan, a stage change stops the countdown and counts into a
// counter's stage, a trigger into a finishing stage keeps where it came from,
// and a trigger into a `records` stage snapshots its plan counters.
function afterMatch(
  before: SessionFlow,
  next: SessionFlow,
  match: TriggerMatch | null,
  workflow: DeclaredWorkflow,
): SessionFlow {
  const changed = next.stage !== before.stage;
  const entered = workflow.decl.stages.find((stage) => stage.id === next.stage);
  const byTrigger = match !== null && match.trigger !== 'reopen';
  const clearsPlan =
    byTrigger &&
    typeof match.trigger === 'object' &&
    'clearsPlan' in match.trigger &&
    match.trigger.clearsPlan === true;
  const after: SessionFlow = { ...next };
  if (clearsPlan) {
    after.plan = null;
  }
  if (changed) {
    after.countdownEndsAt = null;
    after.counters = countedInto(next.counters, next.stage, workflow);
  }
  if (changed && byTrigger && entered?.finishes === true) {
    after.enteredFrom = before.stage;
  }
  if (byTrigger && match.stage.records !== undefined && after.plan !== null) {
    after.plan = snapshotted(after.plan, match.stage.records);
  }
  return after;
}

// The counters with one added to each that counts `stage`.
function countedInto(
  counters: Record<string, number>,
  stage: string,
  workflow: DeclaredWorkflow,
): Record<string, number> {
  const counted = { ...counters };
  for (const [name, counter] of Object.entries(
    workflow.decl.counters ?? {},
  )) {
    if (counter.counts === stage) {
      counted[name] = (counted[name] ?? 0) + 1;
    }
  }
  return counted;
}

// The plan with each of `names` snapshotted at its read value, a snapshot
// dropped while the plan or that counter is unread.
function snapshotted(plan: PlanState, names: readonly string[]): PlanState {
  const snapshots = { ...plan.snapshots };
  for (const name of names) {
    const value = plan.progress?.counters[name];
    if (value === undefined) {
      delete snapshots[name];
    } else {
      snapshots[name] = value;
    }
  }
  return { ...plan, snapshots };
}
