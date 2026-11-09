// The rule both plan report sources share, `set_workflow_plan` and `plan.py`'s
// report files: the folder a report names, and what a report does to the flow.

import type { Paths } from '../../../contracts/paths';
import type { WorkflowMainExports } from '../../workflow/contract';
import { LARGE_WORKFLOW_ID, largeSignal } from '../contract';

// Folds a session's report of `planDir`; resolves whether a Large flow holds
// the session.
export type PlanReporter = (
  sessionId: string,
  planDir: string,
) => Promise<boolean>;

// `folder` normalized with no trailing separator, the form `fileWritten`'s
// plan path gives its parent; symlinks are kept.
export function normalPlanDir(paths: Paths, folder: string): string {
  return paths.parent(paths.join(folder, 'plan.md'));
}

// Once flows load, signals `planReported` live when a Large flow holds the
// session; a session in no flow or another workflow's is ignored.
export function largePlanReporter(
  workflow: Pick<WorkflowMainExports, 'ready' | 'flowOf' | 'signal'>,
): PlanReporter {
  return async (sessionId, planDir) => {
    await workflow.ready;
    if (workflow.flowOf(sessionId)?.workflow !== LARGE_WORKFLOW_ID) {
      return false;
    }
    workflow.signal(
      sessionId,
      largeSignal({ type: 'planReported', planDir }),
      'live',
    );
    return true;
  };
}
