import type { Disposable } from '../../../contracts/disposable';
import type { DeclaredWorkflow, SessionFlow } from '../contract';

// The declared workflows main runs now, as `workflow.declared` holds them.
// `onWorkflowsChanged` hears each new list; `workflowOf` is the entry holding
// the flow, null for the Checklist flow and an id no entry has.
export interface EnabledWorkflows {
  enabledWorkflows(): readonly DeclaredWorkflow[];
  onWorkflowsChanged(
    listener: (workflows: readonly DeclaredWorkflow[]) => void,
  ): Disposable;
  workflowOf(flow: SessionFlow): DeclaredWorkflow | null;
}

// `set` replaces the list and tells each listener when the new list differs
// from the last by its JSON.
export function createEnabledWorkflows(): EnabledWorkflows & {
  set(workflows: readonly DeclaredWorkflow[]): void;
} {
  let current: readonly DeclaredWorkflow[] = [];
  const listeners = new Set<(workflows: readonly DeclaredWorkflow[]) => void>();
  return {
    enabledWorkflows: () => current,
    onWorkflowsChanged(listener) {
      const registered = (workflows: readonly DeclaredWorkflow[]) =>
        listener(workflows);
      listeners.add(registered);
      return { dispose: () => listeners.delete(registered) };
    },
    workflowOf: (flow) =>
      current.find((workflow) => workflow.id === flow.workflow) ?? null,
    set(workflows) {
      const isSame = JSON.stringify(workflows) === JSON.stringify(current);
      current = [...workflows];
      if (isSame) {
        return;
      }
      for (const listener of [...listeners]) {
        listener(current);
      }
    },
  };
}
