import type { FindingAction } from '../../../contract';

// How the page names each finding action, on the card and in the review.
export const FINDING_ACTION_LABELS: Record<FindingAction, string> = {
  fix_now: 'Fix now',
  follow_up: 'Follow-up',
  leave_it: 'Leave it',
};
