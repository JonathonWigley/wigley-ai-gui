// Whether a declared workflow uses the plan capability, read from what its
// declaration names (docs/features/feature-contributions/design.md § The plan
// capability). Pure.

import type {
  PredicateDecl,
  StageDecl,
  TriggerDecl,
  WorkflowDecl,
} from '../../../contracts/contributions';

const PLAN_EVENTS: ReadonlySet<string> = new Set(['planChanged', 'planGone']);

// True when the declaration has a plan side pane, a plan trigger, a plan
// predicate, a `records` stage, a plan fix-cycle counter, an `openPlan` action
// or a template naming `{plan` anywhere.
export function usesPlan(decl: WorkflowDecl): boolean {
  const actions = Object.values(decl.actions ?? {});
  const hasPlanAction = actions.some(
    (action) =>
      action.kind === 'openPlan' ||
      namesPlan(action.text) ||
      hasPlanPredicate(action.available) ||
      hasPlanPredicate(action.enabled),
  );
  const hasPlanFixCycles =
    decl.fixCycles !== undefined && 'planCounter' in decl.fixCycles;
  return (
    decl.sidePane.kind === 'plan' ||
    hasPlanFixCycles ||
    hasPlanAction ||
    decl.stages.some(stageUsesPlan)
  );
}

function stageUsesPlan(stage: StageDecl): boolean {
  const templates = [
    stage.progress,
    stage.chipProgress,
    ...(stage.detail ?? []),
  ];
  return (
    stage.records !== undefined ||
    templates.some(namesPlan) ||
    stage.enter.some(triggerUsesPlan)
  );
}

function triggerUsesPlan(trigger: TriggerDecl): boolean {
  const isPlanEvent = 'event' in trigger && PLAN_EVENTS.has(trigger.event);
  const movesPlan =
    ('clearsPlan' in trigger && trigger.clearsPlan === true) ||
    ('planFromArgs' in trigger && trigger.planFromArgs === true);
  return isPlanEvent || movesPlan || hasPlanPredicate(trigger.when);
}

function hasPlanPredicate(predicates: readonly PredicateDecl[] | undefined) {
  return (predicates ?? []).some(
    (predicate) => predicate !== 'idle' && predicate !== 'busy',
  );
}

function namesPlan(template: string | undefined): boolean {
  return template?.includes('{plan') === true;
}
