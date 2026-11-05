import {
  detailLine,
  isBusy,
  type PageStage,
  STAGE_ACTIVITY_RANK,
} from '../../contract';
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
      available: (flow) => flow.countdownEndsAt !== null,
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
  detail: (flow) =>
    flow.progress === null
      ? ''
      : detailLine(flow.progress.title, `${flow.progress.total} tasks`),
  status: () => 'ready',
  rowActivity: {
    word: 'ready to make',
    tone: 'attention',
    rank: STAGE_ACTIVITY_RANK,
    emphasis: 'raised',
  },
};
