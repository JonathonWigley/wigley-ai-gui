import type {
  DeclaredWorkflow,
  PlanState,
  SessionFlow,
  WorkflowSignal,
} from '../contract';

// The plan capability's part of a declared workflow's fold: the flow's plan
// after `signal`, before the stage rules. `planFromArgs` is true for a
// `skillStarted` a `planFromArgs` trigger of `workflow` names. Returns
// `flow.plan` itself for no change.
export interface PlanFold {
  fold(
    flow: SessionFlow,
    signal: WorkflowSignal,
    workflow: DeclaredWorkflow,
    planFromArgs: boolean,
  ): PlanState | null;
}

// The fold of an engine with no plan capability: the plan never changes.
export const NO_PLAN_FOLD: PlanFold = {
  fold: (flow) => flow.plan,
};
