import type { PlanFormat } from '../../../contracts/contributions';
import {
  type ChecklistView,
  defaultChecklist,
  type SessionFlow,
} from '../contract';

// What a `plan` side pane lists for a flow, read in the workflow's own
// `planFormat` (null for its plugin's none); null while it lists nothing.
export interface PlanPane {
  checklist(flow: SessionFlow, format: PlanFormat | null): ChecklistView | null;
}

// The pane of an engine with no plan capability: the agent's checklist.
export const NO_PLAN_PANE: PlanPane = {
  checklist: (flow) => defaultChecklist(flow),
};
