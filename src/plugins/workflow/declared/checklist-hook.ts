// The `workflow.checklist` relay hook: whether the session's agent reported its
// checklist, the items still open, and the step the session is on. A reported
// plan counts as a reported checklist, since a plan run's checklist is its plan.

import type { HookHandler } from '../../sessions/contract';
import type { ChecklistItem, DeclaredWorkflow, SessionFlow } from '../contract';

export interface ChecklistHookReply {
  reported: boolean;
  open: number;
  items: ChecklistItem[];
  // The flow's stage as `set_workflow_step` names it; null on the Checklist
  // flow, a workflow no entry holds, and a stage no step report names.
  step: string | null;
}

// `workflow` is the declared workflow holding `flow`, null for none.
export function checklistHookReply(
  flow: SessionFlow | null,
  workflow: DeclaredWorkflow | null,
): ChecklistHookReply {
  if (flow === null) {
    return { reported: false, open: 0, items: [], step: null };
  }
  const isPlanReported = flow.plan?.reported === true;
  const items = itemsOf(flow, isPlanReported);
  return {
    reported: flow.checklistReported || isPlanReported,
    open: items.filter((item) => !item.done).length,
    items,
    step: stepOf(flow, workflow),
  };
}

// Answers from the flow of the hook's session, once `ready` settles.
export function checklistHookHandler(deps: {
  ready: Promise<void>;
  flowOf(sessionId: string): SessionFlow | null;
  workflowOf(flow: SessionFlow): DeclaredWorkflow | null;
}): HookHandler {
  return async (session) => {
    await deps.ready;
    const flow = deps.flowOf(session.id);
    const workflow = flow === null ? null : deps.workflowOf(flow);
    return { ...checklistHookReply(flow, workflow) };
  };
}

// The checklist when one arrived; else a reported plan's tasks; else none.
function itemsOf(flow: SessionFlow, isPlanReported: boolean): ChecklistItem[] {
  if (flow.checklist !== null) {
    return flow.checklist.map(({ text, done }) => ({ text, done }));
  }
  if (!isPlanReported) {
    return [];
  }
  return (flow.plan?.progress?.tasks ?? []).map(({ text, done }) => ({
    text,
    done,
  }));
}

function stepOf(
  flow: SessionFlow,
  workflow: DeclaredWorkflow | null,
): string | null {
  const stage = workflow?.decl.stages.find((held) => held.id === flow.stage);
  return stage?.step ?? null;
}
