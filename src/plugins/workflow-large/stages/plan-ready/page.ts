import {
  detailLine,
  isBusy,
  type PageStage,
  STAGE_ACTIVITY_RANK,
} from '../../../workflow/contract';
import { largeStateOf } from '../../contract';
import { OPEN_PLAN_ACTION } from '../stage-parts';

export const planReadyPageStage: PageStage = {
  id: 'planReady',
  label: 'Make',
  inStepper: true,
  stepSlot: 'make',
  order: 30,
  actions: [
    {
      command: 'cancelCountdown',
      label: 'Cancel',
      available: (flow) => largeStateOf(flow).countdownEndsAt !== null,
      enabled: () => true,
    },
    {
      command: 'clearAndMake',
      label: 'Clear & make',
      available: () => true,
      enabled: (flow) => !isBusy(flow),
    },
    {
      command: 'makeInNewSession',
      label: 'Make in new session',
      available: () => true,
      enabled: () => true,
    },
    OPEN_PLAN_ACTION,
  ],
  detail(flow) {
    const { progress } = largeStateOf(flow);
    return progress === null
      ? ''
      : detailLine(progress.title, `${progress.total} tasks`);
  },
  status: () => 'ready',
  rowActivity: {
    word: 'ready to make',
    tone: 'attention',
    rank: STAGE_ACTIVITY_RANK,
    emphasis: 'raised',
  },
};
