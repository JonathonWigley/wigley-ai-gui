// The page halves' shared actions and detail.

import { isBusy, type SessionFlow, type StageActionSpec } from '../contract';

export const OPEN_PLAN_ACTION: StageActionSpec = {
  command: 'openPlan',
  label: 'Open plan',
  side: 'page',
  keyOnly: true,
  available: (flow) => flow.planDir !== null,
  enabled: () => true,
};

export const RESUME_MAKE_ACTION: StageActionSpec = {
  command: 'resumeMake',
  label: 'Resume make',
  side: 'main',
  keyOnly: true,
  available: (flow) =>
    !isBusy(flow) &&
    flow.progress !== null &&
    flow.progress.checked < flow.progress.total,
  enabled: () => true,
};

// The plan's title; '' until the plan is read.
export function planTitleDetail(flow: SessionFlow): string {
  return flow.progress === null ? '' : flow.progress.title;
}
