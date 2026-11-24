// The rule both plan report sources share, `set_workflow_plan` and a plan
// report file: the folder a report names, and what a report does to the flow.

import type { Paths } from '../../../contracts/paths';
import {
  CHECKLIST_WORKFLOW_ID,
  type DeclaredWorkflow,
  type SessionFlow,
  type WorkflowMainExports,
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

// The declared workflow holding a session's flow when it uses the plan
// capability, else why a plan report is ignored, as the tool answers it.
export type PlanWorkflowLookup =
  | { workflow: DeclaredWorkflow; ignored: null }
  | { workflow: null; ignored: string };

export const NO_FLOW_IGNORED =
  'Ignored: the app holds no flow for this session.';
export const KEEPS_NO_PLAN_IGNORED =
  "Ignored: this session's workflow keeps no plan.";

export function notEnabledIgnored(workflowId: string): string {
  return `Ignored: this session's workflow ${workflowId} is not an enabled workflow.`;
}

const ignoredFor = (ignored: string): PlanWorkflowLookup => ({
  workflow: null,
  ignored,
});

// Once flows load, the session's plan workflow, or which of three cases
// ignores its report: no flow, a workflow no enabled entry has, or a workflow
// (the Checklist flow included) that keeps no plan.
export async function planWorkflowOf(
  deps: PlanReporterDeps,
  sessionId: string,
): Promise<PlanWorkflowLookup> {
  await deps.workflow.ready;
  const flow = deps.workflow.flowOf(sessionId);
  if (flow === null) {
    return ignoredFor(NO_FLOW_IGNORED);
  }
  const declared = deps.workflowOf(flow);
  if (declared === null) {
    return flow.workflow === null || flow.workflow === CHECKLIST_WORKFLOW_ID
      ? ignoredFor(KEEPS_NO_PLAN_IGNORED)
      : ignoredFor(notEnabledIgnored(flow.workflow));
  }
  return usesPlan(declared.decl)
    ? { workflow: declared, ignored: null }
    : ignoredFor(KEEPS_NO_PLAN_IGNORED);
}

// Once flows load, signals `planReported` live when the session's flow's
// workflow uses the plan capability; any other session is ignored.
export function planReporter(deps: PlanReporterDeps): PlanReporter {
  return async (sessionId, planDir) => {
    if ((await planWorkflowOf(deps, sessionId)).workflow === null) {
      return false;
    }
    deps.workflow.signal(sessionId, { type: 'planReported', planDir }, 'live');
    return true;
  };
}
