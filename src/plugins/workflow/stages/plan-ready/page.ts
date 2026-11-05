import {
  detailLine,
  isBusy,
  type PageStage,
  STAGE_ACTIVITY_RANK,
} from '../../contract';
import { heavyStateOf } from '../heavy-contract';
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
      side: 'main',
      available: (flow) => heavyStateOf(flow).countdownEndsAt !== null,
      enabled: () => true,
    },
    {
      command: 'clearAndMake',
      label: 'Clear & make',
      side: 'main',
      available: () => true,
      enabled: (flow) => !isBusy(flow),
    },
    {
      command: 'makeInNewSession',
      label: 'Make in new session',
      side: 'main',
      available: () => true,
      enabled: () => true,
    },
    OPEN_PLAN_ACTION,
  ],
  detail(flow) {
    const { progress } = heavyStateOf(flow);
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
