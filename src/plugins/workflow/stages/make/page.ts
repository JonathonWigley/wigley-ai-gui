import { busyStatus, detailLine, type PageStage } from '../../contract';
import { OPEN_PLAN_ACTION, RESUME_MAKE_ACTION } from '../stage-parts';

export const makePageStage: PageStage = {
  id: 'make',
  label: 'Make',
  inStepper: true,
  stepSlot: 'make',
  runsTasks: true,
  order: 40,
  actions: [RESUME_MAKE_ACTION, OPEN_PLAN_ACTION],
  detail(flow) {
    const progress = flow.progress;
    if (progress === null) {
      return '';
    }
    const wave = progress.wave === null ? '' : `wave ${progress.wave}`;
    return detailLine(
      `${progress.checked}/${progress.total}`,
      wave,
      progress.title,
    );
  },
  status: busyStatus,
  statusProgress(flow) {
    const progress = flow.progress;
    return progress === null ? '' : ` ${progress.checked}/${progress.total}`;
  },
};
