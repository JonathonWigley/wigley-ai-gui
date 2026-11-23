// The `workflow.checklist` relay hook: whether the session's agent reported its
// checklist, and the items still open. A reported plan counts as a reported
// checklist, since a plan run's checklist is its plan.

import type { HookHandler } from '../../sessions/contract';
import type { ChecklistItem, SessionFlow } from '../contract';

export interface ChecklistHookReply {
  reported: boolean;
  open: number;
  items: ChecklistItem[];
}

export function checklistHookReply(
  flow: SessionFlow | null,
): ChecklistHookReply {
  if (flow === null) {
    return { reported: false, open: 0, items: [] };
  }
  const isPlanReported = flow.plan?.reported === true;
  const items = itemsOf(flow, isPlanReported);
  return {
    reported: flow.checklistReported || isPlanReported,
    open: items.filter((item) => !item.done).length,
    items,
  };
}

// Answers from the flow of the hook's session, once `ready` settles.
export function checklistHookHandler(deps: {
  ready: Promise<void>;
  flowOf(sessionId: string): SessionFlow | null;
}): HookHandler {
  return async (session) => {
    await deps.ready;
    return { ...checklistHookReply(deps.flowOf(session.id)) };
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
