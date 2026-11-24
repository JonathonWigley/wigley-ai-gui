// The stage rules of a declared workflow: which stage a signal enters, read
// from its triggers (docs/features/feature-contributions/design.md § Triggers).
// Pure.

import type {
  PredicateDecl,
  StageDecl,
  TriggerDecl,
  WorkflowDecl,
} from '../../../contracts/contributions';
import {
  type DeclaredWorkflow,
  isBusy,
  type SessionFlow,
  startsSkill,
  type WorkflowSignal,
} from '../contract';

// The stage a signal enters and what entered it: a trigger, or the `reopens`
// rule.
export interface TriggerMatch {
  stage: StageDecl;
  trigger: TriggerDecl | 'reopen';
}

// The stage `signal` moves `flow` to in `workflow`, null for none: first the
// reopen rule, then each stage in array order and its triggers in order, the
// first match winning. A `skill` trigger matches while the flow is in its
// stage; a `step` or `event` trigger does not.
export function matchTrigger(
  flow: SessionFlow,
  signal: WorkflowSignal,
  workflow: DeclaredWorkflow,
): TriggerMatch | null {
  const { decl } = workflow;
  const reopened = reopenedStage(flow, signal, decl);
  if (reopened !== null) {
    return { stage: reopened, trigger: 'reopen' };
  }
  for (const stage of decl.stages) {
    const trigger = stage.enter.find((each) =>
      triggerMatches(each, stage, flow, signal, decl),
    );
    if (trigger !== undefined) {
      return { stage, trigger };
    }
  }
  return null;
}

// Whether every one of `predicates` holds for `flow`; true for none.
export function allHold(
  predicates: readonly PredicateDecl[] | undefined,
  flow: SessionFlow,
): boolean {
  return (predicates ?? []).every((predicate) => holds(predicate, flow));
}

// Whether `predicate` holds for `flow`. Every plan predicate is false while
// the plan is unread.
export function holds(predicate: PredicateDecl, flow: SessionFlow): boolean {
  if (predicate === 'idle') {
    return !isBusy(flow);
  }
  if (predicate === 'busy') {
    return isBusy(flow);
  }
  const progress = flow.plan?.progress ?? null;
  if (progress === null) {
    return false;
  }
  if (typeof predicate === 'object') {
    const value = progress.counters[predicate.counterRose];
    const snapshot = flow.plan?.snapshots[predicate.counterRose];
    return value !== undefined && snapshot !== undefined && value > snapshot;
  }
  switch (predicate) {
    case 'planRead':
      return true;
    case 'planHasTasks':
      return progress.total > 0;
    case 'planOpen':
      return progress.checked < progress.total;
  }
}

// Whether `signal` starts a skill a `planFromArgs` trigger of `decl` names.
export function startsPlanFromArgs(
  signal: WorkflowSignal,
  decl: WorkflowDecl,
): boolean {
  return decl.stages.some((stage) =>
    stage.enter.some(
      (trigger) =>
        'skill' in trigger &&
        trigger.planFromArgs === true &&
        startsSkill(signal, trigger.skill),
    ),
  );
}

// A busy `planChanged` in a `reopens` stage returns the flow to the stage it
// entered that one from.
function reopenedStage(
  flow: SessionFlow,
  signal: WorkflowSignal,
  decl: WorkflowDecl,
): StageDecl | null {
  const current = decl.stages.find((stage) => stage.id === flow.stage);
  const reopens =
    signal.type === 'planChanged' &&
    current?.reopens === true &&
    isBusy(flow) &&
    flow.enteredFrom !== null;
  return reopens
    ? (decl.stages.find((stage) => stage.id === flow.enteredFrom) ?? null)
    : null;
}

function triggerMatches(
  trigger: TriggerDecl,
  stage: StageDecl,
  flow: SessionFlow,
  signal: WorkflowSignal,
  decl: WorkflowDecl,
): boolean {
  const isInStage = flow.stage === stage.id;
  const signalMatches =
    'skill' in trigger
      ? startsSkill(signal, trigger.skill)
      : !isInStage && nonSkillMatches(trigger, signal, decl);
  return (
    signalMatches &&
    isFrom(trigger.from, flow, decl) &&
    allHold(trigger.when, flow)
  );
}

function nonSkillMatches(
  trigger: Exclude<TriggerDecl, { skill: string }>,
  signal: WorkflowSignal,
  decl: WorkflowDecl,
): boolean {
  if ('step' in trigger) {
    return (
      signal.type === 'stepReported' &&
      decl.stages.some(
        (stage) => stage.id === signal.step && stage.step === trigger.step,
      )
    );
  }
  switch (trigger.event) {
    case 'turnEnded':
    case 'planChanged':
    case 'planGone':
      return signal.type === trigger.event;
    default:
      return signal.type === 'event' && signal.event === trigger.event;
  }
}

// Whether the flow's stage is one `from` lists or a member of a group it
// lists; true when `from` is left out.
function isFrom(
  from: readonly string[] | undefined,
  flow: SessionFlow,
  decl: WorkflowDecl,
): boolean {
  if (from === undefined) {
    return true;
  }
  return from.some(
    (name) =>
      name === flow.stage || (decl.groups?.[name] ?? []).includes(flow.stage),
  );
}
