// The rule both plan report sources share, `set_workflow_plan` and a plan
// report file: the folder a report names, and what a report does to the flow.

import type { Paths } from '../../../contracts/paths';
import type {
  DeclaredWorkflow,
  SessionFlow,
  WorkflowMainExports,
} from '../contract';
import { usesPlan } from '../declared/uses-plan';

// Folds a session's report of `planDir`; resolves whether a flow of a plan
// workflow holds the session.
export type PlanReporter = (
  sessionId: string,
  planDir: string,
) => Promise<boolean>;

export interface PlanReporterDeps {
  readonly workflow: Pick<WorkflowMainExports, 'ready' | 'flowOf' | 'signal'>;
  // The flow's declared workflow; null for the Checklist flow and an id no
  // enabled entry has.
  workflowOf(flow: SessionFlow): DeclaredWorkflow | null;
}

// `folder` normalized with no trailing separator, the form `fileWritten`'s
// plan path gives its parent; symlinks are kept.
export function normalPlanDir(paths: Paths, folder: string): string {
  return paths.parent(paths.join(folder, 'plan.md'));
}

// Once flows load, the declared workflow holding the session's flow when it
// uses the plan capability; null for a session in no flow or in a flow whose
// workflow keeps no plan.
export async function planWorkflowOf(
  deps: PlanReporterDeps,
  sessionId: string,
): Promise<DeclaredWorkflow | null> {
  await deps.workflow.ready;
  const flow = deps.workflow.flowOf(sessionId);
  const declared = flow === null ? null : deps.workflowOf(flow);
  return declared !== null && usesPlan(declared.decl) ? declared : null;
}

// Once flows load, signals `planReported` live when the session's flow's
// workflow uses the plan capability; any other session is ignored.
export function planReporter(deps: PlanReporterDeps): PlanReporter {
  return async (sessionId, planDir) => {
    if ((await planWorkflowOf(deps, sessionId)) === null) {
      return false;
    }
    deps.workflow.signal(sessionId, { type: 'planReported', planDir }, 'live');
    return true;
  };
}
