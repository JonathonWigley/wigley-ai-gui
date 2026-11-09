import type { SessionFlow, StageId } from '../../workflow/contract';

// The stages of a `wigley:feature` run. A step it reports moves the flow only
// from these, so a standalone skill or an idle session shows nothing.
const FEATURE_RUN_STAGES: readonly StageId[] = [
  'explore',
  'interview',
  'plan',
  'coldRead',
  'planReady',
];

export function isInFeatureRun(flow: SessionFlow): boolean {
  return FEATURE_RUN_STAGES.includes(flow.stage);
}
