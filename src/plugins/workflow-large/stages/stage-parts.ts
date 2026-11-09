// The page halves' shared actions and detail.

import {
  isBusy,
  type SessionFlow,
  type StageActionSpec,
} from '../../workflow/contract';
import { largeStateOf } from '../contract';

export const OPEN_PLAN_ACTION: StageActionSpec = {
  command: 'openPlan',
  label: 'Open plan',
  keyOnly: true,
  available: (flow) => largeStateOf(flow).planDir !== null,
  enabled: () => true,
};

export const RESUME_MAKE_ACTION: StageActionSpec = {
  command: 'resumeMake',
  label: 'Resume make',
  keyOnly: true,
  available(flow) {
    const { progress } = largeStateOf(flow);
    return (
      !isBusy(flow) && progress !== null && progress.checked < progress.total
    );
  },
  enabled: () => true,
};

// The plan's title; '' until the plan is read.
export function planTitleDetail(flow: SessionFlow): string {
  return largeStateOf(flow).progress?.title ?? '';
}
