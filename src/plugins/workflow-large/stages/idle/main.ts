import { IDLE_STAGE, type MainStage } from '../../../workflow/contract';
import { largeEventOf } from '../../contract';

export const idleMainStage: MainStage = {
  id: IDLE_STAGE,
  order: 0,
  enter(flow, signal) {
    const event = largeEventOf(signal);
    const dismissedClosedRun =
      event?.type === 'dismissed' && flow.stage === 'closed';
    return event?.type === 'handedOff' || dismissedClosedRun
      ? IDLE_STAGE
      : null;
  },
};
